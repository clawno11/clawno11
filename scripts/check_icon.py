from PIL import Image
img = Image.open(r'D:\clawno11\apps\desktop\src-tauri\icons\icon.png').convert('RGBA')
w, h = img.size
print(f'Size: {w}x{h}')
corners = {
    'top-left':     img.getpixel((5, 5)),
    'top-right':    img.getpixel((w-5, 5)),
    'bottom-left':  img.getpixel((5, h-5)),
    'bottom-right': img.getpixel((w-5, h-5)),
    'center':       img.getpixel((w//2, h//2)),
}
for name, rgba in corners.items():
    state = 'TRANSPARENT' if rgba[3] == 0 else ('OPAQUE' if rgba[3] == 255 else f'SEMI alpha={rgba[3]}')
    print(f'  {name}: R={rgba[0]} G={rgba[1]} B={rgba[2]} A={rgba[3]}  -> {state}')
