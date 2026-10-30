# libav.js (remux-cli) — ของคนอื่น ไม่ใช่โค้ดเรา

ไฟล์ในโฟลเดอร์นี้คือ **ffmpeg ที่คอมไพล์เป็น WebAssembly** ไม่ได้เขียนขึ้นในโปรเจกต์นี้
ห้ามแก้ด้วยมือ — ถ้าจะอัปเกรดให้ดึงใหม่จาก npm แล้วทับทั้งโฟลเดอร์

| | |
|---|---|
| แพ็กเกจ | `@imput/libav.js-remux-cli` |
| เวอร์ชัน | `6.8.7` (libav `6.8.7.1`, ffmpeg 6.x) |
| ต้นทาง | https://github.com/imputnet/libav.js (fork ของ https://github.com/Yahweasel/libav.js) |

## ดึงใหม่ยังไง

```bash
npm pack @imput/libav.js-remux-cli@6.8.7
# แล้วเอาจาก dist/ มาสามไฟล์:
#   libav-remux-cli.mjs                  ← ตัวโหลด
#   libav-6.8.7.1-remux-cli.wasm.mjs     ← glue ของ emscripten
#   libav-6.8.7.1-remux-cli.wasm.wasm    ← ตัว ffmpeg
```

ตัวโหลดหา glue กับ wasm จาก **โฟลเดอร์เดียวกับตัวมันเอง** (`libav.base = import.meta.url`)
ดังนั้นสามไฟล์ต้องอยู่ด้วยกันเสมอ

## ทำไมเลือกตัวนี้

ตัวแปรนี้ **ตัดตัวเข้ารหัสออกหมด เหลือแค่ตัวแยกกับตัวรวมสตรีม** (remux) และยังมี `ffmpeg_main`
ให้เรียกแบบ command line ได้ เลยเหลือ wasm แค่ 2.4 MB เทียบกับตัวที่มี h264/aac ครบซึ่งหนักกว่าเท่าตัว

เราไม่ต้องการตัวเข้ารหัสเลย เพราะกฎของโปรเจกต์คือ **ไม่เข้ารหัสวิดีโอใหม่** — ทุกงานใช้ `-c copy`
(และห้าม H.265 โดยเด็ดขาด ซึ่งตัวแปรนี้บังคับให้เราทำตามอยู่แล้ว เพราะเข้ารหัสอะไรไม่ได้เลย)

บรรทัด configuration ที่ฝังอยู่ในไบนารีบอกของที่มีจริง:

```
--disable-everything
--enable-demuxer=mov      --enable-muxer=mp4 --enable-muxer=mov --enable-muxer=ipod
--enable-demuxer=matroska --enable-muxer=matroska --enable-muxer=webm
--enable-demuxer=mp3 --enable-demuxer=ogg --enable-demuxer=wav
--enable-decoder=movtext --enable-decoder=webvtt
```

**ไม่มีตัวแยก HLS และไม่มีตัวแยก MPEG-TS** — เรื่องนี้สำคัญและเสียเวลาค้นพบ:
ในไบนารีมีคำว่า `mpegts` อยู่ (เป็นชื่อ**ตัวรวม**) แต่ `ffmpeg -f mpegts -i …` ตอบว่า
`Unknown input format: 'mpegts'` การเช็คด้วยการ grep หาคำในไฟล์จึงหลอกได้ ต้องลองจริง

และตัวแปรที่ `libav.js` ทางการแจก (`default`, `default-cli`) **แยกวิดีโอไม่ได้เลย** —
มันเปิดมาแค่ ogg/matroska/flac/wav กับโคเดกเสียง ลองแล้วได้ `Unknown input format: 'mpegts'`
เหมือนกัน เสียเวลาไปหนึ่งรอบกับการสลับไปใช้ตัวนั้น

HLS ที่ส่ง segment เป็น `.ts` จึงต้องผ่าน `vendor/muxjs` ก่อนเสมอ ดู NOTICE ที่นั่น
ส่วนการอ่าน `.m3u8` กับการดึง segment เราทำเองใน JS อยู่แล้ว (ได้โหลดขนานหลายช่อง
กับทำต่อจากที่ค้างได้ ซึ่งถ้าปล่อยให้ ffmpeg ดึงเองจะทำไม่ได้)

## สัญญาอนุญาต

ffmpeg เป็น LGPL v2.1+ ส่วนตัว `ffmpeg` command line เป็น GPL v2+
โปรแกรมนี้แจกจ่าย binary ก้อนนี้ต่อโดยไม่แก้ไข และชี้ที่มาไว้ข้างบนตามเงื่อนไข
