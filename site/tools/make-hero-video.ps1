<#
.SYNOPSIS
  Builds the website's media from the finished marketing renders and switches them on.

.DESCRIPTION
  1. Hero loop  — cuts a short, silent, seamlessly looping clip from the teaser
                  (marketing/video/prism-teaser-30s.mp4) into
                  site/assets/video/hero-loop.mp4 (H.264, faststart) and hero-loop.webm (AV1 or VP9),
                  keeps the MP4 under -MaxMB, then sets data-hero-video="on" in site/index.html.
  2. Film poster — if marketing/video/prism-promo-poster-frame.png exists, re-encodes
                  site/assets/img/film-poster.{webp,avif} (1280x720) from it.
  3. Key visual  — encodes marketing/keyvisual/prism-kv-04-burst-3840x2160.png (or -KeyVisual) into
                  site/assets/img/keyvisual{,-1280}.{webp,avif} and sets data-hero-art="kv"
                  (used in the dark theme; the light theme keeps the vector prism).
                  The committed files were made by build-images.py; re-run only to switch the image.

  Each step is skipped (with a message) when its source file is missing, so the script can be
  re-run at any time. The page works without any of these files.

.EXAMPLE
  pwsh site/tools/make-hero-video.ps1                       # defaults
  pwsh site/tools/make-hero-video.ps1 -Start 4 -Duration 9  # pick a different 9 s window
#>
[CmdletBinding()]
param(
  [string]$Teaser      = "marketing/video/prism-teaser-30s.mp4",
  [double]$Start       = 2,      # seconds into the teaser where the loop starts
  [double]$Duration    = 9,      # seconds taken from the teaser (loop is Duration-1 s after the crossfade)
  [int]   $Width       = 1600,   # 1280–1920
  [double]$MaxMB       = 6,
  [string]$PosterFrame = "marketing/video/prism-promo-poster-frame.png",
  [string]$KeyVisual   = ""
)

$ErrorActionPreference = "Stop"
$repo  = Resolve-Path (Join-Path $PSScriptRoot "../..")
Set-Location $repo
$site  = Join-Path $repo "site"
$index = Join-Path $site "index.html"
$vidDir = Join-Path $site "assets/video"
$imgDir = Join-Path $site "assets/img"
New-Item -ItemType Directory -Force $vidDir | Out-Null

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) { throw "ffmpeg not found on PATH." }
$encoders = (& ffmpeg -hide_banner -encoders 2>$null) -join "`n"

function Set-HtmlFlag([string]$name, [string]$value) {
  $html = [IO.File]::ReadAllText($index)
  $new = [regex]::Replace($html, "$name=""[^""]*""", "$name=""$value""", 1)
  if ($new -ne $html) { [IO.File]::WriteAllText($index, $new, (New-Object Text.UTF8Encoding($false))) }
  Write-Host "  index.html: $name=""$value"""
}

# ---------------------------------------------------------------- 1. hero loop
Write-Host "1) Hero loop"
if (Test-Path $Teaser) {
  $fade = 1
  $len  = $Duration - $fade
  # main = [Start+fade, Start+Duration); its last second crossfades into the clip's first second,
  # so the last frame equals the first frame of `main` -> seamless loop.
  $filter = "[0:v]scale=${Width}:-2:flags=lanczos,fps=30,format=yuv420p,split[a][b];" +
            "[a]trim=start=${fade}:duration=${len},setpts=PTS-STARTPTS[main];" +
            "[b]trim=duration=${fade},setpts=PTS-STARTPTS[head];" +
            "[main][head]xfade=transition=fade:duration=${fade}:offset=$($len - $fade)[v]"
  $mp4 = Join-Path $vidDir "hero-loop.mp4"
  $crf = 24
  do {
    & ffmpeg -hide_banner -loglevel error -y -ss $Start -t $Duration -i $Teaser -an -filter_complex $filter -map "[v]" `
      -c:v libx264 -preset slow -crf $crf -profile:v high -pix_fmt yuv420p -movflags +faststart $mp4
    $mb = (Get-Item $mp4).Length / 1MB
    Write-Host ("  hero-loop.mp4  crf {0}: {1:N2} MB" -f $crf, $mb)
    $crf += 2
  } while ($mb -gt $MaxMB -and $crf -le 34)

  $webm = Join-Path $vidDir "hero-loop.webm"
  if ($encoders -match "libsvtav1") {
    & ffmpeg -hide_banner -loglevel error -y -ss $Start -t $Duration -i $Teaser -an -filter_complex $filter -map "[v]" `
      -c:v libsvtav1 -preset 6 -crf 38 -pix_fmt yuv420p $webm
  } elseif ($encoders -match "libvpx-vp9") {
    & ffmpeg -hide_banner -loglevel error -y -ss $Start -t $Duration -i $Teaser -an -filter_complex $filter -map "[v]" `
      -c:v libvpx-vp9 -b:v 0 -crf 36 -row-mt 1 -pix_fmt yuv420p $webm
  }
  if (Test-Path $webm) { Write-Host ("  hero-loop.webm: {0:N2} MB" -f ((Get-Item $webm).Length / 1MB)) }
  Set-HtmlFlag "data-hero-video" "on"
} else {
  Write-Host "  skipped: $Teaser not found (hero keeps the animated SVG prism)."
}

# ---------------------------------------------------------------- 2. film poster
Write-Host "2) Film poster"
if (Test-Path $PosterFrame) {
  $vf = "scale=1280:720:force_original_aspect_ratio=increase:flags=lanczos,crop=1280:720"
  & ffmpeg -hide_banner -loglevel error -y -i $PosterFrame -vf $vf -c:v libwebp -quality 84 (Join-Path $imgDir "film-poster.webp")
  $avif = Join-Path $imgDir "film-poster.avif"
  & ffmpeg -hide_banner -loglevel error -y -i $PosterFrame -vf "$vf,format=yuv420p" -c:v libaom-av1 -still-picture 1 -crf 30 -cpu-used 4 $avif 2>$null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $avif) -or (Get-Item $avif).Length -eq 0) {
    # No AVIF encoder: drop the AVIF source so browsers use the fresh WebP.
    Remove-Item $avif -ErrorAction SilentlyContinue
    $html = [IO.File]::ReadAllText($index).Replace('<source type="image/avif" srcset="assets/img/film-poster.avif">', '')
    [IO.File]::WriteAllText($index, $html, (New-Object Text.UTF8Encoding($false)))
    Write-Host "  AVIF encoder unavailable - using WebP only."
  }
  Write-Host "  film-poster updated from $PosterFrame"
} else {
  Write-Host "  skipped: $PosterFrame not found (keeps the rendered prism poster)."
}

# ---------------------------------------------------------------- 3. key visual
Write-Host "3) Key visual"
if (-not $KeyVisual) {
  $preferred = "marketing/keyvisual/prism-kv-04-burst-3840x2160.png"   # prism right of centre, left half empty for the headline
  if (Test-Path $preferred) { $KeyVisual = $preferred }
  else {
    $cands = Get-ChildItem "marketing/keyvisual" -File -Include *.png, *.jpg, *.jpeg, *.webp -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notmatch "alpha|portrait|square" } | Sort-Object Name
    if ($cands) { $KeyVisual = $cands[0].FullName }
  }
}
if ($KeyVisual -and (Test-Path $KeyVisual)) {
  $avifOk = $true
  foreach ($v in @(@{ W = 2400; S = "" }, @{ W = 1280; S = "-1280" })) {
    $vf = "scale=$($v.W):-2:flags=lanczos"
    & ffmpeg -hide_banner -loglevel error -y -i $KeyVisual -vf $vf -c:v libwebp -quality 82 (Join-Path $imgDir "keyvisual$($v.S).webp")
    & ffmpeg -hide_banner -loglevel error -y -i $KeyVisual -vf "$vf,format=yuv420p" -c:v libaom-av1 -still-picture 1 -crf 30 -cpu-used 4 (Join-Path $imgDir "keyvisual$($v.S).avif") 2>$null
    if ($LASTEXITCODE -ne 0) { $avifOk = $false }
  }
  if (-not $avifOk) {
    Remove-Item (Join-Path $imgDir "keyvisual*.avif") -ErrorAction SilentlyContinue
    $html = [regex]::Replace([IO.File]::ReadAllText($index), '<source type="image/avif" data-srcset="assets/img/keyvisual[^"]*"[^>]*>', '')
    [IO.File]::WriteAllText($index, $html, (New-Object Text.UTF8Encoding($false)))
  }
  Set-HtmlFlag "data-hero-art" "kv"
  Write-Host "  key visual: $KeyVisual (dark theme hero)"
} else {
  Write-Host "  skipped: no image in marketing/keyvisual/."
}

$total = (Get-ChildItem $site -Recurse -File | Measure-Object Length -Sum).Sum / 1MB
Write-Host ("Done. site/ is now {0:N1} MB." -f $total)
