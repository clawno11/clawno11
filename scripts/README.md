# Scripts

This directory contains utility scripts for the ClawNo.11 project.

## Available Scripts

### Build Scripts

- `build-desktop.sh` - Build desktop app for all platforms
- `build-mobile.sh` - Build mobile app for Android
- `build-web.sh` - Build web app for production

### Development Scripts

- `dev.sh` - Start all development servers
- `dev-desktop.sh` - Start desktop development server
- `dev-mobile.sh` - Start mobile development server

### Utility Scripts

- `clean.sh` - Clean all build artifacts
- `setup.sh` - Initial project setup
- `update-deps.sh` - Update all dependencies

## Usage

All scripts should be run from the project root:

```bash
# Example: Build desktop app
./scripts/build-desktop.sh

# Example: Start development
./scripts/dev.sh
```

## Adding New Scripts

1. Create script file with appropriate name
2. Make it executable: `chmod +x scripts/your-script.sh`
3. Document usage in this README
4. Update `package.json` if needed
