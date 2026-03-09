/**
 * Zero-cost API key verification.
 * After writing a key to OpenClaw config, probe the provider's endpoint
 * to confirm the key is actually valid before showing "已配置".
 */

export type VerifyStatus = "idle" | "verifying" | "ok" | "relay" | "failed";

export interface VerifyResult {
  status: "ok" | "relay" | "failed";
  message?: string;
}

/** Provider IDs that are supported natively by OpenClaw (direct connection). */
export const DIRECT_PROVIDER_IDS = new Set([
  "zai", "minimax", "anthropic", "openai", "openrouter",
]);

type ProbeSpec = { url: string; headers: Record<string, string> };

const PROBES: Record<string, ProbeSpec> = {
  openrouter: {
    url:     "https://openrouter.ai/api/v1/auth/key",
    headers: {},
  },
  zai: {
    url:     "https://open.bigmodel.cn/api/paas/v4/models",
    headers: {},
  },
  anthropic: {
    url:     "https://api.anthropic.com/v1/models",
    headers: { "anthropic-version": "2023-06-01" },
  },
  openai: {
    url:     "https://api.openai.com/v1/models",
    headers: {},
  },
  minimax: {
    url:     "https://api.minimaxi.com/v1/models",
    headers: {},
  },
};

/**
 * Verify a freshly-written API key with a cheap, zero-cost probe request.
 *
 * - `isDirect`: pass `true` for providers that OpenClaw calls directly,
 *   `false` for relay providers (routed through OpenRouter).
 *   When `false`, returns `"relay"` — key was written but cannot be tested directly.
 */
export async function verifyProviderKey(
  providerId: string,
  apiKey: string,
  isDirect: boolean,
): Promise<VerifyResult> {
  if (!isDirect) return { status: "relay" };

  const spec = PROBES[providerId];
  if (!spec) return { status: "ok" };

  const headers: Record<string, string> = { ...spec.headers };
  // Inject auth header based on provider convention
  if (providerId === "anthropic") {
    headers["x-api-key"] = apiKey;
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const resp = await fetch(spec.url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (resp.ok) return { status: "ok" };
    if (resp.status === 401 || resp.status === 403)
      return { status: "failed", message: "Key 无效或已过期，请重新获取" };
    if (resp.status === 429)
      return { status: "failed", message: "请求过于频繁，请稍后重试" };
    return { status: "failed", message: `验证返回 HTTP ${resp.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.toLowerCase().includes("abort") || msg.toLowerCase().includes("timeout"))
      return { status: "failed", message: "验证超时，请检查网络连接" };
    return { status: "failed", message: msg };
  }
}
