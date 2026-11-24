# Update Brandlab screenshots (api/_updates.js): a phone screenshot on a
# 1280x800 card with the Brandlab gradient, so it reads in the 16:10 frame.
# usage: python3 scripts/update-phone-card.py <phone.png> <out.jpg> [crop_top] [crop_bottom]
import sys
from PIL import Image, ImageDraw, ImageFilter
src, out = sys.argv[1], sys.argv[2]
top = int(sys.argv[3]) if len(sys.argv) > 3 else 0
bottom = int(sys.argv[4]) if len(sys.argv) > 4 else 0
W, H = 1280, 800
bg = Image.new("RGB", (W, H)); d = ImageDraw.Draw(bg)
c1, c2, c3 = (255, 165, 43), (169, 116, 255), (59, 155, 255)
for x in range(W):
    t = x / (W - 1)
    a, (p, q) = (t / .5, (c1, c2)) if t < .5 else ((t - .5) / .5, (c2, c3))
    d.line([(x, 0), (x, H)], fill=tuple(int(p[i] * (1 - a) + q[i] * a) for i in range(3)))
ph = Image.open(src).convert("RGB")
ph = ph.crop((0, top, ph.width, ph.height - bottom))
h = H - 80; w = int(ph.width * h / ph.height)
ph = ph.resize((w, h), Image.LANCZOS)
mask = Image.new("L", (w, h), 0); ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=36, fill=255)
sh = Image.new("RGBA", (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle(((W - w) // 2 + 6, 46, (W + w) // 2 + 6, 46 + h), radius=40, fill=(0, 0, 0, 110))
sh = sh.filter(ImageFilter.GaussianBlur(18))
bg = bg.convert("RGBA"); bg.alpha_composite(sh); bg = bg.convert("RGB")
bg.paste(ph, ((W - w) // 2, 40), mask)
bg.save(out, "JPEG", quality=84, optimize=True, progressive=True)
