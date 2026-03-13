import sharp from "sharp";
import { mkdirSync, copyFileSync } from "fs";
import { join } from "path";

const SRC = "apps/desktop/src-tauri/icons/icon.png";
const ICONS_DIR = "apps/desktop/src-tauri/icons";

async function main() {
  const meta = await sharp(SRC).metadata();
  console.log(`Source: ${meta.width}x${meta.height}, channels: ${meta.channels}`);

  // The original icon has a rounded rectangle with gray padding around it.
  // We crop into the interior of the rounded rect, discarding the outer padding
  // and baked-in rounded corners entirely. macOS will apply its own squircle mask.
  //
  // Scan from the left edge at the vertical center to find where the dark bg starts
  const midY = Math.floor(meta.height / 2);
  const row = await sharp(SRC)
    .extract({ left: 0, top: midY, width: meta.width, height: 1 })
    .raw()
    .toBuffer();

  // Find left inset: first pixel whose brightness < 30 (dark navy interior)
  let leftInset = 0;
  for (let x = 0; x < meta.width; x++) {
    const r = row[x * 4], g = row[x * 4 + 1], b = row[x * 4 + 2];
    if (r < 30 && g < 40 && b < 60) { leftInset = x; break; }
  }
  // Find right inset (from right edge)
  let rightInset = 0;
  for (let x = meta.width - 1; x >= 0; x--) {
    const r = row[x * 4], g = row[x * 4 + 1], b = row[x * 4 + 2];
    if (r < 30 && g < 40 && b < 60) { rightInset = meta.width - 1 - x; break; }
  }

  // Use symmetric inset (take the larger of left/right to be safe)
  const inset = Math.max(leftInset, rightInset);
  console.log(`Detected inset: ${inset}px (left=${leftInset}, right=${rightInset})`);

  // Crop to the inner content area
  const cropSize = meta.width - inset * 2;
  const croppedBuf = await sharp(SRC)
    .extract({ left: inset, top: inset, width: cropSize, height: cropSize })
    .png()
    .toBuffer();

  const fullBleedBuf = croppedBuf;
  console.log(`✓ Cropped to ${cropSize}x${cropSize} interior (removed ${inset}px padding)`);

  const sizes = [
    { name: "32x32.png", size: 32 },
    { name: "64x64.png", size: 64 },
    { name: "128x128.png", size: 128 },
    { name: "128x128@2x.png", size: 256 },
    { name: "icon.png", size: 1024 },
  ];

  const trimmedBuf = fullBleedBuf;

  for (const { name, size } of sizes) {
    const outPath = join(ICONS_DIR, name);
    await sharp(trimmedBuf)
      .resize(size, size, { fit: "fill" })
      .png()
      .toFile(outPath);
    console.log(`✓ ${name} (${size}x${size})`);
  }

  // Generate .ico (Windows) from 256px version
  // sharp can't make .ico directly, but we already have a working .ico on Windows
  // Just regenerate the Square logos for Windows Store
  const squareSizes = [
    { name: "Square30x30Logo.png", size: 30 },
    { name: "Square44x44Logo.png", size: 44 },
    { name: "Square71x71Logo.png", size: 71 },
    { name: "Square89x89Logo.png", size: 89 },
    { name: "Square107x107Logo.png", size: 107 },
    { name: "Square142x142Logo.png", size: 142 },
    { name: "Square150x150Logo.png", size: 150 },
    { name: "Square284x284Logo.png", size: 284 },
    { name: "Square310x310Logo.png", size: 310 },
    { name: "StoreLogo.png", size: 50 },
  ];

  for (const { name, size } of squareSizes) {
    const outPath = join(ICONS_DIR, name);
    await sharp(trimmedBuf)
      .resize(size, size, { fit: "fill" })
      .png()
      .toFile(outPath);
    console.log(`✓ ${name} (${size}x${size})`);
  }

  // Generate .ico from multiple sizes
  // We'll create a 256x256 PNG for the ico
  const ico256 = await sharp(trimmedBuf)
    .resize(256, 256, { fit: "fill" })
    .png()
    .toBuffer();

  // Build ICO manually (single 256x256 PNG entry)
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0);     // reserved
  icoHeader.writeUInt16LE(1, 2);     // type: icon
  icoHeader.writeUInt16LE(1, 4);     // count: 1 image

  const dirEntry = Buffer.alloc(16);
  dirEntry.writeUInt8(0, 0);          // width (0 = 256)
  dirEntry.writeUInt8(0, 1);          // height (0 = 256)
  dirEntry.writeUInt8(0, 2);          // color palette
  dirEntry.writeUInt8(0, 3);          // reserved
  dirEntry.writeUInt16LE(1, 4);       // color planes
  dirEntry.writeUInt16LE(32, 6);      // bits per pixel
  dirEntry.writeUInt32LE(ico256.length, 8);  // image size
  dirEntry.writeUInt32LE(22, 12);     // offset (6 + 16 = 22)

  const icoBuffer = Buffer.concat([icoHeader, dirEntry, ico256]);
  const { writeFileSync } = await import("fs");
  writeFileSync(join(ICONS_DIR, "icon.ico"), icoBuffer);
  console.log("✓ icon.ico (256x256)");

  // Generate .icns for macOS using iconutil approach
  // Create iconset with required sizes
  const icnsDir = join(ICONS_DIR, "icon.iconset");
  mkdirSync(icnsDir, { recursive: true });

  const icnsSizes = [
    { name: "icon_16x16.png", size: 16 },
    { name: "icon_16x16@2x.png", size: 32 },
    { name: "icon_32x32.png", size: 32 },
    { name: "icon_32x32@2x.png", size: 64 },
    { name: "icon_128x128.png", size: 128 },
    { name: "icon_128x128@2x.png", size: 256 },
    { name: "icon_256x256.png", size: 256 },
    { name: "icon_256x256@2x.png", size: 512 },
    { name: "icon_512x512.png", size: 512 },
    { name: "icon_512x512@2x.png", size: 1024 },
  ];

  for (const { name, size } of icnsSizes) {
    await sharp(trimmedBuf)
      .resize(size, size, { fit: "fill" })
      .png()
      .toFile(join(icnsDir, name));
  }
  console.log("✓ icon.iconset/ prepared (run 'iconutil -c icns icon.iconset' on macOS to generate .icns)");

  // iOS icons
  const iosSizes = [
    { name: "AppIcon-20x20@1x.png", size: 20 },
    { name: "AppIcon-20x20@2x.png", size: 40 },
    { name: "AppIcon-20x20@2x-1.png", size: 40 },
    { name: "AppIcon-20x20@3x.png", size: 60 },
    { name: "AppIcon-29x29@1x.png", size: 29 },
    { name: "AppIcon-29x29@2x.png", size: 58 },
    { name: "AppIcon-29x29@2x-1.png", size: 58 },
    { name: "AppIcon-29x29@3x.png", size: 87 },
    { name: "AppIcon-40x40@1x.png", size: 40 },
    { name: "AppIcon-40x40@2x.png", size: 80 },
    { name: "AppIcon-40x40@2x-1.png", size: 80 },
    { name: "AppIcon-40x40@3x.png", size: 120 },
    { name: "AppIcon-60x60@2x.png", size: 120 },
    { name: "AppIcon-60x60@3x.png", size: 180 },
    { name: "AppIcon-76x76@1x.png", size: 76 },
    { name: "AppIcon-76x76@2x.png", size: 152 },
    { name: "AppIcon-83.5x83.5@2x.png", size: 167 },
    { name: "AppIcon-512@2x.png", size: 1024 },
  ];

  const iosDir = join(ICONS_DIR, "ios");
  mkdirSync(iosDir, { recursive: true });
  for (const { name, size } of iosSizes) {
    await sharp(trimmedBuf)
      .resize(size, size, { fit: "fill" })
      .png()
      .toFile(join(iosDir, name));
    console.log(`✓ ios/${name} (${size}x${size})`);
  }

  // Android icons
  const androidSizes = [
    { dir: "mipmap-mdpi", size: 48 },
    { dir: "mipmap-hdpi", size: 72 },
    { dir: "mipmap-xhdpi", size: 96 },
    { dir: "mipmap-xxhdpi", size: 144 },
    { dir: "mipmap-xxxhdpi", size: 192 },
  ];

  for (const { dir, size } of androidSizes) {
    const d = join(ICONS_DIR, "android", dir);
    mkdirSync(d, { recursive: true });

    await sharp(trimmedBuf)
      .resize(size, size, { fit: "fill" })
      .png()
      .toFile(join(d, "ic_launcher.png"));

    // Round version
    const roundMask = Buffer.from(
      `<svg width="${size}" height="${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="white"/></svg>`
    );
    const roundBuf = await sharp(trimmedBuf)
      .resize(size, size, { fit: "fill" })
      .composite([{ input: roundMask, blend: "dest-in" }])
      .png()
      .toBuffer();
    await sharp(roundBuf).toFile(join(d, "ic_launcher_round.png"));

    // Foreground (108dp with 18dp padding on each side = content is 72/108 of total)
    const fgSize = Math.round(size * 108 / 48);
    const contentSize = Math.round(size * 72 / 48);
    const padding = Math.round((fgSize - contentSize) / 2);
    const fgContent = await sharp(trimmedBuf)
      .resize(contentSize, contentSize, { fit: "fill" })
      .png()
      .toBuffer();
    await sharp({ create: { width: fgSize, height: fgSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: fgContent, left: padding, top: padding }])
      .png()
      .toFile(join(d, "ic_launcher_foreground.png"));

    console.log(`✓ android/${dir}/ (${size}px)`);
  }

  console.log("\n✅ All icons regenerated!");
  console.log("⚠️  On macOS, run: cd apps/desktop/src-tauri/icons && iconutil -c icns icon.iconset && rm -rf icon.iconset");
}

main().catch(console.error);
