# mux.js — ของคนอื่น ไม่ใช่โค้ดเรา

| | |
|---|---|
| แพ็กเกจ | `mux.js` (เอาแค่ `dist/mux-mp4.min.js`) |
| เวอร์ชัน | 7.1.0 |
| สัญญาอนุญาต | Apache-2.0 (ดู `LICENSE`) |
| ต้นทาง | https://github.com/videojs/mux.js |

ห้ามแก้ด้วยมือ · อัปเกรดด้วย `npm pack mux.js@<ver>` แล้วเอา `dist/mux-mp4.min.js` มาทับ

## มันมาทำอะไรที่นี่

**libav.js ทุกตัวแปรที่แจกเป็นแพ็กเกจ แยกสตรีม MPEG-TS ไม่ได้** ซึ่งเป็นเรื่องที่รู้ได้จาก
การลองเท่านั้น — ffmpeg ที่คอมไพล์มาตอบว่า `Unknown input format: 'mpegts'` ทั้งที่ในไบนารี
มีคำว่า `mpegts` อยู่ (นั่นเป็นชื่อ**ตัวรวม** ไม่ใช่ตัวแยก) ดูบรรทัด configuration ได้ที่
`vendor/libav/NOTICE.md`

แต่ HLS ส่วนใหญ่ในโลกส่ง segment เป็น `.ts` จึงต้องมีตัวแยก MPEG-TS ที่ทำงานได้จริง
`mux.js` คือตัวที่ `hls.js` ใช้ทำงานนี้มาหลายปี มันแปลง MPEG-TS เป็น mp4 แบบแบ่งท่อน
ด้วย JavaScript ล้วน แล้วเราส่งผลลัพธ์นั้นต่อให้ ffmpeg (ซึ่ง**อ่าน** mp4 ได้) ทำเป็น mp4 ปกติ

สายงานจึงเป็น: `.ts` → mux.js → mp4 แบ่งท่อน → ffmpeg `-c copy` → **mp4 ปกติ**
ส่วน segment ที่เป็น fragmented mp4 (`.m4s`) อยู่แล้ว ข้ามขั้น mux.js ไปตรงๆ

ไฟล์นี้เป็นบันเดิลแบบ UMD · ตอน import เข้า module worker มันจะไปตั้ง `globalThis.muxjs`
ให้เอง (เพราะไม่เจอ `exports`) เลยเรียกใช้ผ่าน `self.muxjs` ไม่ใช่ค่าที่ import กลับมา
