"""
把 icon.png 里的橙红色系像素色相偏移到系统主色"电气青" hsl(187°, 85%, 40%)
只改颜色，构图/形状完全不变。
"""

import colorsys
import struct
import zlib
from pathlib import Path
from PIL import Image

# ── 路径配置 ──────────────────────────────────────────
ICONS_DIR = Path(r"d:\clawno11\apps\desktop\src-tauri\icons")
SRC = ICONS_DIR / "icon.png"

# 目标色相（°）：电气青 187°
TARGET_HUE = 187 / 360.0

# 需要替换的源色相范围（橙红：0°~55° 以及 330°~360°）
def is_warm(h_norm: float) -> bool:
    h = h_norm * 360
    return (0 <= h <= 55) or (330 <= h <= 360)

# ── 色相映射函数 ──────────────────────────────────────
def shift_pixel(r: int, g: int, b: int, a: int):
    """对单像素做色相偏移，不改变饱和度和亮度。"""
    if a < 10:
        return (r, g, b, a)

    rn, gn, bn = r / 255.0, g / 255.0, b / 255.0
    h, s, v = colorsys.rgb_to_hsv(rn, gn, bn)

    # 只处理：暖色（橙红）+ 有足够饱和度（S>0.25）+ 非纯黑
    if is_warm(h) and s > 0.25 and v > 0.06:
        h = TARGET_HUE
        # 可以小幅增加饱和度让青色更鲜明
        s = min(1.0, s * 1.05)

    rr, gg, bb = colorsys.hsv_to_rgb(h, s, v)
    return (round(rr * 255), round(gg * 255), round(bb * 255), a)

# ── 主处理 ────────────────────────────────────────────
def recolor(src_path: Path, dst_path: Path):
    img = Image.open(src_path).convert("RGBA")
    pixels = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            pixels[x, y] = shift_pixel(*pixels[x, y])
    img.save(dst_path, format="PNG")
    print(f"  saved → {dst_path.name}  ({w}x{h})")

# ── 输出各尺寸 ────────────────────────────────────────
SIZES = {
    "icon.png":              None,      # 原始大图，保持尺寸
    "128x128.png":           (128, 128),
    "128x128@2x.png":        (256, 256),
    "32x32.png":             (32, 32),
    "64x64.png":             (64, 64),
    "Square30x30Logo.png":   (30, 30),
    "Square44x44Logo.png":   (44, 44),
    "Square71x71Logo.png":   (71, 71),
    "Square89x89Logo.png":   (89, 89),
    "Square107x107Logo.png": (107, 107),
    "Square142x142Logo.png": (142, 142),
    "Square150x150Logo.png": (150, 150),
    "Square284x284Logo.png": (284, 284),
    "Square310x310Logo.png": (310, 310),
    "StoreLogo.png":         (50, 50),
}

print("正在读取源图标…")
src_img = Image.open(SRC).convert("RGBA")

# 先对源图做色相偏移，得到"主色版"
print("正在做色相偏移（橙红 → 电气青）…")
recolored_src = src_img.copy()
pixels = recolored_src.load()
w, h = recolored_src.size
for y in range(h):
    for x in range(w):
        pixels[x, y] = shift_pixel(*pixels[x, y])

print(f"输出 {len(SIZES)} 个图标文件：")
for filename, size in SIZES.items():
    dst = ICONS_DIR / filename
    if size is None:
        out = recolored_src
    else:
        out = recolored_src.resize(size, Image.LANCZOS)
    out.save(dst, format="PNG")
    print(f"  OK {filename}  {out.size}")

# ── 生成 .ico（多尺寸嵌入）────────────────────────────
print("正在生成 icon.ico…")
ico_sizes = [(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)]
ico_frames = [recolored_src.resize(s, Image.LANCZOS) for s in ico_sizes]
ico_frames[0].save(
    ICONS_DIR / "icon.ico",
    format="ICO",
    sizes=ico_sizes,
    append_images=ico_frames[1:],
)
print("  OK icon.ico")
print("\n全部完成！")
