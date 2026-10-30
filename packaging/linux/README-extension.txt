Prism browser extension
=======================

  Chrome / Edge / Brave / Opera / Vivaldi / Helium / Chromium
    Add it from the Chrome Web Store (it updates by itself):
    https://chromewebstore.google.com/detail/prism-download-manager/mmcdeiglkbfbicdjboocmhehodogilfl
    Click "Add to Chrome" (Brave: "Add to Brave"), then "Add extension".
    Added Prism by hand before? Remove that copy on chrome://extensions first.

  Firefox / Zen (Prism isn't in Firefox Add-ons yet)
    about:debugging#/runtime/this-firefox -> "Load Temporary Add-on" -> manifest.json
    in the `firefox` folder Prism shows in Settings -> Browser integration:

      deb / rpm   /usr/lib/Prism/extension
      AppImage    ~/.local/share/prism/extension (Prism copies it there: the AppImage's own
                  files move to a new place every time it starts)

    or prism-firefox.zip from the release page, unzipped into a folder that stays.

Prism registers its native messaging host automatically. Open Prism -> Settings ->
Browser integration to check the status or repair it with one click.
