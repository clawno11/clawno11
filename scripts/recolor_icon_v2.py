"""
用新素材重新制作图标：
- 素材：用户提供的新版 "11 + 龙虾" 图
- 目标色：电气青 hsl(187°, 85%, 40%)
- 效果：橙红 → 青色渐变（上亮 #5EEAF5 → 下深 #067A8A）
"""

import colorsys
from pathlib import Path
from PIL import Image

SRC = Path(r"C:\Users\01\.cursor\projects\d-clawno11\assets\c__Users_01_AppData_Roaming_Cursor_User_workspaceStorage_16c757163dee844e004f3de095af9879_images_Generated_image-f0144f7b-be91-4bab-9927-fe321cf0eaf9.png")
ICONS_DIR = Path(r"d:\clawno11\apps\desktop\src-tauri\icons")

# 目标色相 187°（电气青）
TARGET_HUE = 187 / 360.0

# 渐变：顶部亮青 → 底部深青
# 原图约 630px 高，图标内容区约 y:60~580
GRAD_TOP_V_BOOST  =  0.45   # 顶部亮度提升量（加法）
GRAD_BOT_V_SCALE  =  0.72   # 底部亮度缩放

def is_warm(h_norm: float) -> bool:
    h = h_norm * 360
    return (0 <= h <= 58) or (330 <= h <= 360)

def recolor_pixel(r, g, b, a, y_ratio: float):
    """y_ratio: 0=顶部, 1=底部"""
    if a < 10:
        return (r, g, b, a)

    rn, gn, bn = r/255.0, g/255.0, b/255.0
    h, s, v = colorsys.rgb_to_hsv(rn, gn, bn)

    if is_warm(h) and s > 0.20 and v > 0.06:
        h = TARGET_HUE

        # 渐变：顶部 V 更高（亮青），底部 V 更低（深青）
        # 线性插值：top_boost → bot_scale
        top_add   = GRAD_TOP_V_BOOST * (1.0 - y_ratio)   # 顶部额外加亮
        bot_scale = 1.0 - (1.0 - GRAD_BOT_V_SCALE) * y_ratio  # 底部压暗
        v = min(1.0, (v + top_add) * bot_scale)

        # 饱和度：顶部略低（更亮），底部略高（更纯）
        s = min(1.0, s * (0.85 + 0.25 * y_ratio))

    rr, gg, bb = colorsys.hsv_to_rgb(h, s, v)
    return (round(rr*255), round(gg*255), round(bb*255), a)

print("读取素材…")
src = Image.open(SRC).convert("RGBA")
w, h = src.size
print(f"  原始尺寸 {w}x{h}")

print("色相偏移 + 渐变映射…")
out = src.copy()
pixels = out.load()
for y in range(h):
    y_ratio = y / (h - 1)
    for x in range(w):
        pixels[x, y] = recolor_pixel(*pixels[x, y], y_ratio)

# 裁切到正方形中心（去除外圈灰色背景）
# 素材有外边距，图标内容在约 x:120~890, y:60~820（按比例估算）
crop_ratio = 0.12
cx, cy = w // 2, h // 2
half = int(min(w, h) * (1 - crop_ratio) / 2)
cropped = out.crop((cx - half, cy - half, cx + half, cy + half))

print("输出图标文件…")
SIZES = {
    "icon.png":              None,
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

base = cropped
for filename, size in SIZES.items():
    dst = ICONS_DIR / filename
    img = base if size is None else base.resize(size, Image.LANCZOS)
    img.save(dst, "PNG")
    print(f"  OK {filename} {img.size}")

print("生成 icon.ico…")
ico_sizes = [(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)]
frames = [base.resize(s, Image.LANCZOS) for s in ico_sizes]
frames[0].save(
    ICONS_DIR / "icon.ico",
    format="ICO",
    sizes=ico_sizes,
    append_images=frames[1:],
)
print("  OK icon.ico")

# 预览：保存一份大图到桌面
preview = ICONS_DIR / "icon.png"
print(f"\n完成！预览图：{preview}")
