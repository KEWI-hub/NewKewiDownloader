# สร้างไอคอนแอปจากภาพนกต้นฉบับ: ตัดเป็นวงกลม + วงแหวนกำลังโหลด + ป้ายลูกศรลง
# รันด้วย: python assets/make_icon.py
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "bird-source.png")
OUT_ICO = os.path.join(HERE, "app.ico")
OUT_PNG = os.path.join(HERE, "app-512.png")

S = 1024                 # วาดใหญ่ไว้ก่อนแล้วค่อยย่อ ขอบจะเนียน
RING_W = int(S * 0.055)  # ความหนาวงแหวน
PAD = int(S * 0.035)     # ระยะวงแหวนห่างขอบภาพ
BLUE = (41, 151, 255, 255)
BLUE_DIM = (41, 151, 255, 60)
WHITE = (255, 255, 255, 255)


def circle_crop(img, size):
    """ตัดภาพเป็นวงกลม โดยครอปจากกลางภาพให้เป็นจัตุรัสก่อน"""
    w, h = img.size
    side = min(w, h)
    img = img.crop(((w - side) // 2, (h - side) // 2,
                    (w + side) // 2, (h + side) // 2)).resize((size, size), Image.LANCZOS)
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img.convert("RGBA"), (0, 0), mask)
    return out


def main():
    bird = Image.open(SRC).convert("RGBA")

    canvas = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    inner = PAD + RING_W + int(S * 0.012)          # เว้นที่ให้วงแหวน
    face = circle_crop(bird, S - inner * 2)
    canvas.paste(face, (inner, inner), face)

    d = ImageDraw.Draw(canvas)
    box = (PAD + RING_W // 2, PAD + RING_W // 2,
           S - PAD - RING_W // 2, S - PAD - RING_W // 2)

    # รางวงแหวนจางๆ เต็มวง แล้วทับด้วยส่วนที่ "โหลดแล้ว" 260 องศา
    d.arc(box, 0, 360, fill=BLUE_DIM, width=RING_W)
    d.arc(box, -100, 160, fill=BLUE, width=RING_W)

    # ป้ายกลมมุมล่างขวา มีลูกศรลง = กำลังดาวน์โหลด
    b = int(S * 0.30)
    bx, by = S - b - int(S * 0.015), S - b - int(S * 0.015)
    d.ellipse((bx - int(S * 0.022), by - int(S * 0.022),
               bx + b + int(S * 0.022), by + b + int(S * 0.022)), fill=(255, 255, 255, 255))
    d.ellipse((bx, by, bx + b, by + b), fill=BLUE)

    cx, cy = bx + b / 2, by + b / 2
    shaft = b * 0.17
    d.rounded_rectangle((cx - shaft * 0.42, cy - b * 0.26, cx + shaft * 0.42, cy + b * 0.06),
                        radius=shaft * 0.42, fill=WHITE)
    d.polygon([(cx - b * 0.21, cy + b * 0.00), (cx + b * 0.21, cy + b * 0.00),
               (cx, cy + b * 0.25)], fill=WHITE)
    d.rounded_rectangle((cx - b * 0.22, cy + b * 0.29, cx + b * 0.22, cy + b * 0.37),
                        radius=b * 0.04, fill=WHITE)

    canvas.resize((512, 512), Image.LANCZOS).save(OUT_PNG)
    canvas.save(OUT_ICO, sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("wrote", OUT_ICO, "and", OUT_PNG)


if __name__ == "__main__":
    main()
