"""
把所有图标的圆角之外设置为透明。
原理：用与原图相同尺寸的圆角矩形 mask，圆角内保留原像素，圆角外 alpha=0。
圆角半径按 iOS/macOS 规范：约为图标边长的 17.5%。
"""

from PIL import Image, ImageDraw
import os, shutil

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
ICON_DIR        = os.path.join(ROOT, "apps", "desktop", "src-tauri", "icons")
MOBILE_ICON_DIR = os.path.join(ROOT, "apps", "mobile",  "src-tauri", "icons")

# 圆角半径比例（iOS HIG 标准约 17.5%）
RADIUS_RATIO = 0.175

def make_transparent(src_path: str, dst_path: str):
    img = Image.open(src_path).convert("RGBA")
    w, h = img.size
    radius = int(min(w, h) * RADIUS_RATIO)

    # 创建圆角矩形 mask（白色=保留，黑色=透明）
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (w - 1, h - 1)], radius=radius, fill=255)

    # 把 mask 应用到 alpha 通道
    r, g, b, a = img.split()
    # 取原 alpha 和 mask 的交集（两者都不透明才保留）
    import PIL.ImageChops as ImageChops
    new_a = ImageChops.multiply(a, mask)
    result = Image.merge("RGBA", (r, g, b, new_a))
    result.save(dst_path, "PNG")
    print(f"  ✓ {os.path.relpath(dst_path)}")

def resize_and_save(src_path: str, dst_path: str, size: tuple):
    img = Image.open(src_path).convert("RGBA")
    img = img.resize(size, Image.LANCZOS)
    img.save(dst_path, "PNG")
    print(f"  ✓ {os.path.relpath(dst_path)}  ({size[0]}x{size[1]})")

# ── 1. 处理主 icon.png（1024x1024 基准图）─────────────────────────────────────
base_src  = os.path.join(ICON_DIR, "icon.png")
base_out  = os.path.join(ICON_DIR, "icon.png")
tmp       = os.path.join(ICON_DIR, "_icon_orig.png")
shutil.copy2(base_src, tmp)          # 备份原图

print("\n[1/4] 生成透明背景主图标...")
make_transparent(tmp, base_out)

# ── 2. 重新生成各尺寸 Linux/macOS/Windows 桌面图标 ────────────────────────────
print("\n[2/4] 生成桌面各尺寸...")
sizes = {
    "32x32.png":      (32,   32),
    "64x64.png":      (64,   64),
    "128x128.png":    (128,  128),
    "128x128@2x.png": (256,  256),
}
for fname, sz in sizes.items():
    resize_and_save(base_out, os.path.join(ICON_DIR, fname), sz)

# ── 3. 重新生成 Windows Square logos（保持透明）────────────────────────────────
print("\n[3/4] 生成 Windows Square logos...")
win_sizes = {
    "Square30x30Logo.png":   (30,  30),
    "Square44x44Logo.png":   (44,  44),
    "Square71x71Logo.png":   (71,  71),
    "Square89x89Logo.png":   (89,  89),
    "Square107x107Logo.png": (107, 107),
    "Square142x142Logo.png": (142, 142),
    "Square150x150Logo.png": (150, 150),
    "Square284x284Logo.png": (284, 284),
    "Square310x310Logo.png": (310, 310),
    "StoreLogo.png":         (50,  50),
}
for fname, sz in win_sizes.items():
    resize_and_save(base_out, os.path.join(ICON_DIR, fname), sz)

# ── 4. iOS 图标（iOS 要求无透明，白色背景填充）───────────────────────────────
print("\n[4/4] 生成 iOS 图标（iOS 不支持透明，用白色背景）...")
ios_dir = os.path.join(ICON_DIR, "ios")
ios_sizes = {
    "AppIcon-20x20@1x.png":     (20,  20),
    "AppIcon-20x20@2x.png":     (40,  40),
    "AppIcon-20x20@2x-1.png":   (40,  40),
    "AppIcon-20x20@3x.png":     (60,  60),
    "AppIcon-29x29@1x.png":     (29,  29),
    "AppIcon-29x29@2x.png":     (58,  58),
    "AppIcon-29x29@2x-1.png":   (58,  58),
    "AppIcon-29x29@3x.png":     (87,  87),
    "AppIcon-40x40@1x.png":     (40,  40),
    "AppIcon-40x40@2x.png":     (80,  80),
    "AppIcon-40x40@2x-1.png":   (80,  80),
    "AppIcon-40x40@3x.png":     (120, 120),
    "AppIcon-60x60@2x.png":     (120, 120),
    "AppIcon-60x60@3x.png":     (180, 180),
    "AppIcon-76x76@1x.png":     (76,  76),
    "AppIcon-76x76@2x.png":     (152, 152),
    "AppIcon-83.5x83.5@2x.png": (167, 167),
    "AppIcon-512@2x.png":       (1024, 1024),
}

transparent_img = Image.open(base_out).convert("RGBA")
for fname, sz in ios_sizes.items():
    resized = transparent_img.resize(sz, Image.LANCZOS)
    # iOS 不允许透明图标，用白色背景合成
    bg = Image.new("RGBA", sz, (255, 255, 255, 255))
    bg.paste(resized, mask=resized.split()[3])
    final = bg.convert("RGB")
    final.save(os.path.join(ios_dir, fname), "PNG")
    print(f"  ✓ ios/{fname}  ({sz[0]}x{sz[1]})")

# ── 5. 同步更新 Mobile 端所有图标 ────────────────────────────────────────────
print("\n[5/5] 同步 apps/mobile/src-tauri/icons/ ...")

# mobile 桌面尺寸
for fname, sz in sizes.items():
    resize_and_save(base_out, os.path.join(MOBILE_ICON_DIR, fname), sz)

# mobile Windows Square logos
for fname, sz in win_sizes.items():
    resize_and_save(base_out, os.path.join(MOBILE_ICON_DIR, fname), sz)

# mobile iOS 图标
mobile_ios_dir = os.path.join(MOBILE_ICON_DIR, "ios")
if os.path.isdir(mobile_ios_dir):
    for fname, sz in ios_sizes.items():
        resized = transparent_img.resize(sz, Image.LANCZOS)
        bg = Image.new("RGBA", sz, (255, 255, 255, 255))
        bg.paste(resized, mask=resized.split()[3])
        bg.convert("RGB").save(os.path.join(mobile_ios_dir, fname), "PNG")
        print(f"  ✓ mobile/ios/{fname}  ({sz[0]}x{sz[1]})")

# Android 图标维持 foreground/background 分层体系，无需修改
print("  (Android 图标维持现有文件，foreground/background 分层无需修改)")

# 清理备份
os.remove(tmp)

print("\n✅ 全部完成！重新构建应用即可生效。")
