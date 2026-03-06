# Clawno

**One-click deployment & AI chat client for OpenClaw**

> Deploy OpenClaw in one click. Chat with AI on desktop & mobile.

## Overview

Clawno is a native desktop and mobile app that makes deploying and using [OpenClaw](https://openclaw.ai) effortless:

- **Desktop App** (Tauri 2.0 + React): One-click local and remote server deployment, instance management, channel configuration
- **Mobile App** (Expo + React Native): AI chat interface with streaming output, voice input, and remote deployment management

## Project Structure

```
clawno/
├── apps/
│   ├── desktop/          # Tauri 2.0 + React 19 desktop app
│   └── mobile/           # Expo 52 + React Native mobile app
├── packages/
│   ├── openclaw-client/  # OpenClaw Gateway HTTP + WebSocket client
│   └── deploy-engine/    # Local & SSH remote deployment logic
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Tauri 2.0, React 19, TypeScript, shadcn/ui |
| Mobile | Expo 52, React Native, NativeWind |
| Deployment | Node.js, pm2, SSH2, Docker |
| Monorepo | pnpm workspaces, Turborepo |

## Getting Started

```bash
# Install dependencies
pnpm install

# Development
pnpm dev

# Build all packages
pnpm build
```

## License

MIT
