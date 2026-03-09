"""
用已生成的青色 icon.png，批量更新：
  - desktop: icons/*.png + icons/ios/ + icons/android/mipmap-*/
  - mobile : src-tauri/icons/*.png + src-tauri/icons/ios/
Android 特殊处理：
  - ic_launcher / ic_launcher_round  → 加圆角/圆形蒙版
  - ic_launcher_foreground           → 前景层，去除背景，放大到 108dp 安全区
"""

import colorsys, math
from pathlib import Path
from PIL import Image, ImageDraw

# ── 已生成好的青色源图 ─────────────────────────────────────────────────
SRC = Path(r"d:\clawno11\apps\desktop\src-tauri\icons\icon.png")

DESKTOP_ICONS = Path(r"d:\clawno11\apps\desktop\src-tauri\icons")
MOBILE_ICONS  = Path(r"d:\clawno11\apps\mobile\src-tauri\icons")

# ── 工具函数 ──────────────────────────────────────────────────────────

def apply_round_rect(img: Image.Image, radius_ratio=0.22) -> Image.Image:
    """给方形图加圆角（Android ic_launcher 样式）"""
    img = img.convert("RGBA")
    w, h = img.size
    r = int(min(w, h) * radius_ratio)
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([0, 0, w-1, h-1], radius=r, fill=255)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(img, mask=mask)
    return out

def apply_circle(img: Image.Image) -> Image.Image:
    """给方形图加圆形蒙版（Android ic_launcher_round 样式）"""
    img = img.convert("RGBA")
    w, h = img.size
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse([0, 0, w-1, h-1], fill=255)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(img, mask=mask)
    return out

def make_foreground(img: Image.Image, canvas_ratio=1.0) -> Image.Image:
    """
    Android 自适应图标前景层：
    图标内容缩放到画布的 66%（安全区），周围留透明边距
    """
    img = img.convert("RGBA")
    size = img.size[0]
    canvas = int(size * canvas_ratio)
    content_size = int(canvas * 0.66)
    resized = img.resize((content_size, content_size), Image.LANCZOS)
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    offset = (canvas - content_size) // 2
    out.paste(resized, (offset, offset), resized)
    return out

# ── 读取已生成的青色图标作为基础 ──────────────────────────────────────
print("读取青色源图…")
base = Image.open(SRC).convert("RGBA")
W, H = base.size
print(f"  尺寸 {W}x{H}")

def sized(size):
    return base.resize((size, size), Image.LANCZOS)

# ══════════════════════════════════════════════════════════════════════
# 1. iOS 图标（desktop + mobile 两处）
# ══════════════════════════════════════════════════════════════════════
IOS_SIZES = {
    "AppIcon-20x20@1x.png":       20,
    "AppIcon-20x20@2x.png":       40,
    "AppIcon-20x20@2x-1.png":     40,
    "AppIcon-20x20@3x.png":       60,
    "AppIcon-29x29@1x.png":       29,
    "AppIcon-29x29@2x.png":       58,
    "AppIcon-29x29@2x-1.png":     58,
    "AppIcon-29x29@3x.png":       87,
    "AppIcon-40x40@1x.png":       40,
    "AppIcon-40x40@2x.png":       80,
    "AppIcon-40x40@2x-1.png":     80,
    "AppIcon-40x40@3x.png":       120,
    "AppIcon-60x60@2x.png":       120,
    "AppIcon-60x60@3x.png":       180,
    "AppIcon-76x76@1x.png":       76,
    "AppIcon-76x76@2x.png":       152,
    "AppIcon-83.5x83.5@2x.png":   167,
    "AppIcon-512@2x.png":         1024,
}

def write_ios(ios_dir: Path):
    ios_dir.mkdir(parents=True, exist_ok=True)
    for name, px in IOS_SIZES.items():
        img = sized(px)
        img.save(ios_dir / name, "PNG")
        print(f"  iOS  {name} ({px}x{px})")

print("\n[iOS - desktop]")
write_ios(DESKTOP_ICONS / "ios")

print("\n[iOS - mobile]")
write_ios(MOBILE_ICONS / "ios")

# ══════════════════════════════════════════════════════════════════════
# 2. Android 图标（desktop 的 icons/android/mipmap-*/）
# ══════════════════════════════════════════════════════════════════════
ANDROID_DPI = {
    "mipmap-mdpi":    48,
    "mipmap-hdpi":    72,
    "mipmap-xhdpi":   96,
    "mipmap-xxhdpi":  144,
    "mipmap-xxxhdpi": 192,
}

def write_android(android_dir: Path):
    for dpi, px in ANDROID_DPI.items():
        dpi_dir = android_dir / dpi
        dpi_dir.mkdir(parents=True, exist_ok=True)

        base_img = sized(px)

        # ic_launcher.png — 圆角矩形
        apply_round_rect(base_img).save(dpi_dir / "ic_launcher.png", "PNG")
        # ic_launcher_round.png — 圆形
        apply_circle(base_img).save(dpi_dir / "ic_launcher_round.png", "PNG")
        # ic_launcher_foreground.png — 前景层（透明背景，内容缩小到安全区）
        make_foreground(base_img).save(dpi_dir / "ic_launcher_foreground.png", "PNG")

        print(f"  Android  {dpi} ({px}x{px})")

print("\n[Android - desktop]")
write_android(DESKTOP_ICONS / "android")

# ══════════════════════════════════════════════════════════════════════
# 3. Mobile 通用 PNG 尺寸（和 desktop 相同规格）
# ══════════════════════════════════════════════════════════════════════
MOBILE_SIZES = {
    "icon.png":              None,
    "128x128.png":           128,
    "128x128@2x.png":        256,
    "32x32.png":             32,
    "64x64.png":             64,
    "Square30x30Logo.png":   30,
    "Square44x44Logo.png":   44,
    "Square71x71Logo.png":   71,
    "Square89x89Logo.png":   89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png":         50,
}

print("\n[Mobile PNG sizes]")
for name, px in MOBILE_SIZES.items():
    img = base if px is None else sized(px)
    img.save(MOBILE_ICONS / name, "PNG")
    print(f"  mobile  {name} ({img.size[0]}x{img.size[1]})")

# mobile icon.ico
print("\n[Mobile ico]")
ico_frames = [sized(s) for s in [256,128,64,48,32,16]]
ico_frames[0].save(
    MOBILE_ICONS / "icon.ico", format="ICO",
    sizes=[(s,s) for s in [256,128,64,48,32,16]],
    append_images=ico_frames[1:],
)
print("  mobile  icon.ico")

print("\n全部完成！")
