const REPO = "clawno11/clawno11";
const VERSION = "26.3.22";

const ghRelease = (file: string) =>
  `https://github.com/${REPO}/releases/download/v${VERSION}/${file}`;

export const downloads = {
  mac: ghRelease(`ClawNo.11_${VERSION}_aarch64.dmg`),
  macIntel: ghRelease(`ClawNo.11_${VERSION}_x64.dmg`),
  windows: ghRelease(`ClawNo.11_${VERSION}_x64-setup.exe`),
  windowsMsi: ghRelease(`ClawNo.11_${VERSION}_x64_en-US.msi`),
  linuxDeb: ghRelease(`ClawNo.11_${VERSION}_amd64.deb`),
  linuxAppImage: ghRelease(`ClawNo.11_${VERSION}_amd64.AppImage`),
  linuxRpm: ghRelease(`ClawNo.11-${VERSION}-1.x86_64.rpm`),
  ios: "https://testflight.apple.com/join/BmVqFUkC",
  android: `https://github.com/${REPO}/actions/workflows/android-build.yml`,
  releases: `https://github.com/${REPO}/releases`,
  github: `https://github.com/${REPO}`,
} as const;
