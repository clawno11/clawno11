# iOS Build Chain Setup - Phase R4

## Overview

This checklist guides you through setting up the iOS build chain on macOS. Phase R4 (iOS 构建链闭合) requires a Mac with Xcode 15+.

## Prerequisites

### Hardware/Software Requirements
- [ ] macOS 14+ (Sonoma or later)
- [ ] Xcode 15.4+ (via App Store or Developer Portal)
- [ ] Apple Developer Account (Team ID required)
- [ ] Node.js 22+ (use nvm or install from nodejs.org)
- [ ] Rust stable toolchain (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)

### Apple Developer Setup

#### 1. Create App ID and Bundle Identifier
- [ ] Log in to [Apple Developer Portal](https://developer.apple.com/account/)
- [ ] Navigate to Certificates, Identifiers & Profiles → Identifiers
- [ ] Create a new App ID:
  - **Platform**: iOS, iPadOS
  - **Bundle ID**: `ai.clawno11.mobile` (or your custom bundle ID)
  - **Capabilities**: Enable if needed (e.g., iCloud, App Groups)
  - **Note down the Bundle ID**

#### 2. Create Development Certificate
- [ ] Navigate to Certificates, Identifiers & Profiles → Certificates
- [ ] Create a new certificate:
  - **Type**: iOS App Development (for testing) or iOS Distribution (for release)
  - **Upload CSR**: Generate from Keychain Access (Certificate Assistant → Request a Certificate)
  - **Download and install** the certificate in Keychain Access
  - **Export as .p12** with a password:
    ```bash
    security export -k ~/Library/Keychains/login.keychain-db -t p12 -f /tmp/certificate.p12 -P "YOUR_PASSWORD" -C "Certificate Name"
    ```
  - **Base64 encode** the .p12 file:
    ```bash
    base64 -i /tmp/certificate.p12 | pbcopy
    ```

#### 3. Create Provisioning Profile
- [ ] Navigate to Certificates, Identifiers & Profiles → Profiles
- [ ] Create a new profile:
  - **Type**: iOS App Development (for testing) or App Store (for release)
  - **App ID**: Select the App ID created above
  - **Certificates**: Select the certificate created above
  - **Devices**: Select test devices (for development only)
  - **Download and install** the profile
  - **Base64 encode** the profile:
    ```bash
    base64 -i ~/Downloads/Your_Profile.mobileprovision | pbcopy
    ```

## GitHub Secrets Setup

Add the following secrets to your GitHub repository (Settings → Secrets and variables → Actions):

| Secret Name | Description | How to Get |
|------------|-------------|-------------|
| `APPLE_TEAM_ID` | Your Apple Team ID | Found in Apple Developer Portal → Membership |
| `APPLE_CERTIFICATE_P12_BASE64` | Base64-encoded certificate | From step 2 above |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the .p12 file | Set when exporting certificate |
| `IOS_PROVISION_PROFILE_BASE64` | Base64-encoded provisioning profile | From step 3 above |
| `APPLE_SIGNING_IDENTITY` | Certificate identity name | Usually "Apple Development: Your Name" or "iPhone Distribution" |
| `APP_STORE_CONNECT_API_KEY_ID` | API Key ID (for TestFlight) | Create in App Store Connect → Users and Access → Keys |
| `APP_STORE_CONNECT_API_ISSUER` | API Key Issuer ID | Found with API Key ID above |
| `APP_STORE_CONNECT_API_KEY` | API Key (private key .p8 content) | Downloaded when creating API Key |

## Local macOS Setup

### 1. Install Dependencies
```bash
# Install Rust targets for iOS
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios

# Install Tauri CLI (if not already installed)
cargo install tauri-cli

# Clone and setup project
cd D:\clawno11  # or your project directory
pnpm install
```

### 2. Update Mobile App Configuration

Edit `apps/mobile/src-tauri/tauri.conf.json`:
```json
{
  "bundle": {
    "identifier": "ai.clawno11.mobile",
    "publisher": "YOUR_TEAM_ID",
    "iOS": {
      "minimumSystemVersion": "17.0"
    }
  }
}
```

Replace `YOUR_TEAM_ID` with your actual Apple Team ID (e.g., "XXXXXXXXXX").

### 3. Initialize iOS Project (Run Locally First)
```bash
cd apps/mobile
pnpm tauri ios init
```

This will generate the Xcode project in `apps/mobile/src-tauri/gen/apple/`.

### 4. Configure Info.plist

The iOS build workflow already includes these permissions, but verify them:

```bash
# Edit Info.plist
open apps/mobile/src-tauri/gen/apple/clawno-mobile_iOS/Info.plist
```

Required permissions (already configured in workflow):
- `NSDocumentsFolderUsageDescription`: "需要访问文档以导入知识库文件"
- `NSLocalNetworkUsageDescription`: "需要访问本地网络以连接您的 OpenClaw AI 网关"
- `NSBonjourServices`: HTTP/HTTPS services for local discovery
- `NSAppTransportSecurity`: Allow arbitrary loads for localhost

### 5. Install Certificate and Profile (Local Build Only)

For local testing on your Mac:
```bash
# Install certificate
security import /path/to/certificate.p12 -k ~/Library/Keychains/login.keychain-db -P "PASSWORD" -T /usr/bin/codesign

# Install provisioning profile
mkdir -p ~/Library/MobileDevice/Provisioning\ Profiles
cp /path/to/profile.mobileprovision ~/Library/MobileDevice/Provisioning\ Profiles/
```

## Building Locally (Test)

### Build for iOS Simulator
```bash
cd apps/mobile
pnpm tauri ios build
```

### Build for Physical Device
```bash
cd apps/mobile
pnpm tauri ios build --target aarch64-apple-ios
```

### Build for App Store (Requires Distribution Certificate)
```bash
cd apps/mobile
pnpm tauri ios build --export-method app-store-connect
```

## GitHub Actions Build (Automated)

Once secrets are configured:

1. **Manual Trigger**:
   - Go to Actions → iOS Build → Run workflow
   - Select whether to upload to TestFlight
   - Click "Run workflow"

2. **Automated Build**:
   - The workflow can be modified to trigger on tags (e.g., `v*`)
   - Update `.github/workflows/ios-build.yml`:
     ```yaml
     on:
       push:
         tags:
           - "v*"
       workflow_dispatch:
     ```

3. **Artifacts**:
   - IPA file is uploaded as an artifact for manual download
   - Optionally uploaded to TestFlight if configured

## Troubleshooting

### Common Issues

#### 1. "No signing certificate found"
- **Cause**: Certificate not installed or wrong signing identity
- **Fix**: Install the .p12 certificate in Keychain Access and verify identity
- **Command**: `security find-identity -v -p codesigning`

#### 2. "Provisioning profile doesn't include application identifier"
- **Cause**: Bundle ID mismatch between App ID and provisioning profile
- **Fix**: Ensure `tauri.conf.json` bundle identifier matches App ID in Developer Portal

#### 3. "Code signing is required"
- **Cause**: Code signing is required for iOS apps
- **Fix**: Ensure proper certificate and profile are installed and configured

#### 4. "Team ID placeholder not replaced"
- **Cause**: Workflow didn't replace `YOUR_TEAM_ID` placeholder
- **Fix**: The workflow runs `sed` to replace it, but verify `APPLE_TEAM_ID` secret is set

#### 5. "API Key authentication failed"
- **Cause**: App Store Connect API key is invalid or expired
- **Fix**: Regenerate API Key in App Store Connect and update secrets

### Verification Steps

Before running the full build:
```bash
# Verify Rust targets installed
rustup target list | grep apple-ios

# Verify Xcode selected
xcode-select -p  # Should point to Xcode 15.4+

# Verify Node version
node --version  # Should be 22+

# Verify pnpm works
pnpm --version

# Test build (dry run)
cd apps/mobile
pnpm tauri ios init
```

## Post-Build

### Distribute via TestFlight
1. Build completes successfully
2. IPA uploaded to TestFlight (if enabled)
3. Go to App Store Connect → TestFlight → ClawNo.11
4. Add internal testers (yourself, team members)
5. Test on physical devices

### Distribute via IPA (Ad Hoc)
1. Download IPA artifact from GitHub Actions
2. Use tools like [AltStore](https://altstore.io/) or [Sideloadly](https://sideloadly.io/) to install on device
3. Requires re-signing every 7 days (for free Apple IDs)

## Checklist Summary

- [ ] Apple Developer Account set up
- [ ] App ID created
- [ ] Development/Distribution certificate created and installed
- [ ] Provisioning profile created and installed
- [ ] GitHub secrets configured (all 8 secrets)
- [ ] Local macOS dev environment set up (Xcode, Rust, Node.js)
- [ ] iOS project initialized (`pnpm tauri ios init`)
- [ ] `tauri.conf.json` updated with correct Bundle ID and Team ID
- [ ] Local build tested successfully
- [ ] GitHub Actions build tested successfully
- [ ] TestFlight distribution tested (optional)

## Resources

- [Tauri iOS Documentation](https://tauri.app/v1/guides/building/ios)
- [Apple Developer Documentation](https://developer.apple.com/documentation/)
- [App Store Connect Help](https://help.apple.com/app-store-connect/)
- [Tauri Mobile GitHub](https://github.com/tauri-apps/tauri)

## Next Steps After R4 Completion

Once iOS build chain is working:
1. Update `docs/ARCHITECTURE.md` with iOS build status
2. Update `memory/YYYY-MM-DD.md` with Phase R4 completion
3. Consider adding automated iOS builds on version tags
4. Set up TestFlight beta testing program
5. Prepare for App Store submission guidelines

---

**Last Updated**: 2026-03-13
**Status**: Ready to execute when macOS is available
