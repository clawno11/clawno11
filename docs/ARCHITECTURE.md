# Architecture Documentation

## Overview

ClawNo.11 is a monorepo using pnpm workspaces with a cargo workspace for Rust code. The architecture is designed for code sharing across desktop (Tauri), mobile (Tauri mobile), and web platforms.

## Workspace Structure

```
clawno11/
├── apps/
│   ├── desktop/       # Tauri desktop app (Windows, macOS, Linux)
│   ├── mobile/        # Tauri mobile app (iOS, Android)
│   └── web/           # Next.js marketing landing page
├── packages/
│   └── shared/        # Shared TypeScript code (stores, components, utilities)
├── crates/            # Shared Rust crates
├── scripts/           # Build and utility scripts
└── docs/              # Documentation
```

## Key Architecture Decisions

### 1. Monorepo with pnpm Workspaces

- **Why**: Enable code sharing between desktop, mobile, and web
- **Tool**: pnpm with workspaces configuration in `pnpm-workspace.yaml`
- **Build**: Turbo for efficient, parallel builds

### 2. Shared Package (`@clawno/shared`)

Contains all UI-agnostic code shared across platforms:

- **Stores**: Zustand stores for state management
  - `ragStore` - Private knowledge base (RAG)
  - `mcpStore` - MCP plugin manager
  - `secureStore` - Encrypted storage for API keys
  - `providerStore` - AI provider configuration
  - `instanceStore` - OpenClaw instance management
  - `tokenLogStore` - Token usage tracking
  - `tokenPricingStore` - Token pricing data

- **Components**: Reusable UI components
  - Chat components (MessageList, ChatInput, ChatBanners)
  - Common components (ToggleRow, HealthBadge, LangSelector)
  - Page content components (RouterPageContent, RagPageContent, etc.)

- **Utilities**: Shared helpers
  - `utils.ts` - General utilities
  - `db.ts` - Database URL constant
  - `piiFilter.ts` - PII redaction
  - `modelRouter.ts` - Smart model routing logic

### 3. Rust Workspace

Shared Rust code in `crates/` directory:

- **IPC Types**: Shared IPC channel definitions
- **Common Utilities**: Rust helpers used by desktop and mobile

### 4. Platform-Specific Entry Points

Each app has its own entry point but imports from shared packages:

- **Desktop**: `apps/desktop/src/` - Tauri + React
- **Mobile**: `apps/mobile/src/` - Tauri mobile + React
- **Web**: `apps/web/src/` - Next.js (marketing-only currently)

## CI/CD Pipeline

### Architecture CI (`.github/workflows/arch-ci.yml`)

Runs on every push and PR:

1. **Type Check** - TypeScript type checking across all packages
2. **Lint** - ESLint/Prettier checks
3. **Rust Check** - `cargo fmt`, `cargo clippy`, `cargo test`
4. **Desktop Build Check** - Verify desktop app builds
5. **Mobile Build Check** - Verify mobile code compiles
6. **Web Build Check** - Verify Next.js builds
7. **Workspace Integrity** - Validate workspace structure
8. **Documentation Check** - Ensure docs exist and are updated

### Release Build (`.github/workflows/release.yml`)

Triggered on `v*` tags:

- Builds desktop app for Windows, macOS, and Linux
- Creates GitHub releases with installers

### iOS Build (`.github/workflows/ios-build.yml`)

Manual trigger for iOS builds:

- Builds iOS app with code signing
- Optional upload to TestFlight

### Pre-commit Hooks (`.husky/pre-commit`)

Runs locally before every commit:

1. Type check (`pnpm typecheck`)
2. Lint (`pnpm lint`)
3. Rust format check (`cargo fmt --all --check`)
4. Rust clippy (`cargo clippy`)

## Code Organization Principles

### Shared Code Goes to `packages/shared/`

If code is used by more than one platform (desktop + mobile), it belongs in the shared package.

### Platform-Specific Code Stays in `apps/*/src/`

Code that's specific to one platform (e.g., Tauri APIs, platform UI) stays in the app's own source.

### Rust Code Goes to `crates/` or `apps/*/src-tauri/`

- Shared Rust utilities → `crates/`
- Platform-specific Tauri backend → `apps/*/src-tauri/`

## Dependency Flow

```
Desktop App
    ↓ imports
Shared Package
    ↓ imports
Crates (Rust)

Mobile App
    ↓ imports
Shared Package
    ↓ imports
Crates (Rust)

Web App
    ↓ imports (when needed)
Shared Package
```

## Build Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all dev servers
pnpm dev

# Type check
pnpm typecheck

# Lint
pnpm lint

# Clean build artifacts
pnpm clean

# Build specific app
pnpm --filter @clawno/desktop build
pnpm --filter @clawno/mobile build
pnpm --filter @clawno/web build
```

## Testing Strategy

### Unit Tests

- Rust: `cargo test`
- TypeScript: `vitest` (configured in packages/shared)

### Integration Tests

- Build verification in CI
- Manual testing on each platform

### Architecture Tests

- Workspace integrity checks
- Export validation
- Documentation completeness

## Security Considerations

1. **API Keys**: Stored encrypted in `secureStore` using platform keychains
2. **PII Filtering**: Automatic redaction before sending to AI
3. **Local-Only Design**: No telemetry, no tracking, data stays on device
4. **Kill Switch**: Emergency offline mode in Security page

## Performance Optimizations

1. **Turbo**: Parallel builds with caching
2. **pnpm**: Fast, disk-efficient package manager
3. **Shared Code**: Avoid duplication across platforms
4. **Lazy Loading**: Components and routes are loaded on demand

## Future Enhancements

- [ ] Add E2E tests for critical user flows
- [ ] Add performance benchmarks
- [ ] Add automated security scanning
- [ ] Add coverage reporting

## Maintenance Guidelines

### Adding a New Store

1. Create store in `packages/shared/src/stores/`
2. Export from `packages/shared/package.json`
3. Use in desktop and mobile apps
4. Update this documentation

### Adding a New Platform

1. Create new app in `apps/`
2. Add to `pnpm-workspace.yaml`
3. Import from `@clawno/shared` as needed
4. Update CI/CD workflows

### Updating Rust Code

1. Make changes in `crates/` or `apps/*/src-tauri/`
2. Run `cargo fmt` and `cargo clippy`
3. Update tests if needed
4. Commit with descriptive message

## Troubleshooting

### Build Failures

- Check CI logs in GitHub Actions
- Run pre-commit hooks locally: `pnpm typecheck && pnpm lint && cargo fmt --all --check && cargo clippy`
- Clear cache: `pnpm clean && rm -rf node_modules`

### Type Errors

- Ensure all packages are up to date: `pnpm install`
- Check shared package exports in `packages/shared/package.json`
- Verify import paths are correct

### Rust Issues

- Update Rust toolchain: `rustup update`
- Check `Cargo.toml` dependencies
- Verify target platforms are installed

## Resources

- [Tauri Documentation](https://tauri.app/v1/guides/)
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Turbo](https://turbo.build/repo/docs)
- [React](https://react.dev/)
- [Next.js](https://nextjs.org/docs)
