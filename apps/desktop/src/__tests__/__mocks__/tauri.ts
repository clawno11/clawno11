// Minimal stub for @tauri-apps/* packages in vitest unit tests.
// Real IPC is not available in the jsdom environment; tests that need IPC
// should mock specific functions using vi.mock() at the test level.
export const invoke = async () => undefined;
export const open = async () => undefined;
export const Store = class {};
export const Database = class {};
