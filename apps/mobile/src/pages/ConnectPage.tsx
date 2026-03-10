/**
 * ConnectPage — mobile-first server connection setup.
 *
 * Supports two connection methods:
 *  1. xEdge 干将互联 (recommended for mainland China)
 *  2. Tailscale VPN (for users outside China)
 */
import { useState, useEffect, useCallback } from "react";
import {
  Network, ExternalLink, Wifi, WifiOff, Plus, CheckCircle2,
  AlertTriangle, Loader, ChevronDown, ChevronUp, Info, Zap,
  QrCode, ClipboardPaste, Server, ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { getTailscaleStatus, probeGatewayUrl, type TailscaleStatus } from "../ipc";
import { useInstanceStore, type ClawInstance } from "../store/instances";
import { TopBar } from "../components/TopBar";

const DEFAULT_PORT = 18789;

type ConnectMethod = "xedge" | "tailscale";

// ── Method Tab ────────────────────────────────────────────────────────────

const METHOD_META: {
  id: ConnectMethod;
  icon: typeof Network;
  color: string;
  bg: string;
  labelKey: string;
  descKey: string;
}[] = [
  { id: "xedge",     icon: Zap,     color: "#06b6d4", bg: "rgba(6,182,212,0.1)",  labelKey: "connect.methodXedge",     descKey: "connect.methodXedgeDesc" },
  { id: "tailscale", icon: Network, color: "#8b5cf6", bg: "rgba(139,92,246,0.1)", labelKey: "connect.methodTailscale", descKey: "connect.methodTailscaleDesc" },
];

// ── Guide step list ───────────────────────────────────────────────────────

function GuideSteps({ steps }: { steps: string[] }) {
  return (
    <ol className="space-y-2.5 mt-3">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-2.5 text-xs text-[hsl(var(--muted-foreground))]">
          <span
            className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5"
          >
            {i + 1}
          </span>
          <span className="leading-relaxed whitespace-pre-line">{step}</span>
        </li>
      ))}
    </ol>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] overflow-hidden bg-white">
      <div className="px-4 py-3 border-b border-[hsl(var(--border))]"
        style={{ background: `${color}08` }}>
        <p className="font-semibold text-sm" style={{ color }}>{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ── QR / Deep-link parser ─────────────────────────────────────────────────

const PIN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Derive a 6-char PIN from the first 6 bytes of a UTF-8 token string.
 *  Must match the Rust `derive_pin` function in pairing.rs. */
function derivePin(token: string): string {
  return Array.from(token.slice(0, 6)).map(
    (ch) => PIN_ALPHABET[ch.charCodeAt(0) % PIN_ALPHABET.length]
  ).join("");
}

/** Decode URL-safe Base64 (no padding) to a UTF-8 string.
 *  Uses TextDecoder so that non-ASCII server names (e.g. Chinese) are handled correctly. */
function b64Decode(s: string): string {
  try {
    const padded  = s.replace(/-/g, "+").replace(/_/g, "/");
    const withPad = padded + "==".slice(0, (4 - (padded.length % 4)) % 4);
    // atob returns a binary string — convert to Uint8Array then decode as UTF-8.
    const binary  = atob(withPad);
    const bytes   = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

interface ParsedPairLink {
  host: string;       // e.g. "192.168.1.5:18789"
  name: string;
  token: string;
  expiresAt: number;  // unix seconds
  pin: string;
  /** Verify-server port (optional — present only when desktop supports it). */
  verifyPort?: number;
}

interface ParsedConnectLink {
  url: string;
  name: string;
  method: ConnectMethod;
}

/** Parse the new secure format: clawno11://pair?h=B64&n=B64&t=TOKEN&exp=TS */
function parsePairLink(raw: string): ParsedPairLink | null {
  try {
    const text = raw.trim();
    if (!text.startsWith("clawno11://pair")) return null;
    const withHttp = text.replace("clawno11://pair", "https://x.invalid/pair");
    const parsed = new URL(withHttp);
    const host      = b64Decode(parsed.searchParams.get("h") ?? "");
    const name      = b64Decode(parsed.searchParams.get("n") ?? "");
    const token     = parsed.searchParams.get("t") ?? "";
    const expiresAt = parseInt(parsed.searchParams.get("exp") ?? "0", 10);
    const vpRaw     = parsed.searchParams.get("vp");
    const verifyPort = vpRaw ? parseInt(vpRaw, 10) : undefined;
    if (!host || !token || !expiresAt) return null;
    return { host, name, token, expiresAt, pin: derivePin(token), verifyPort };
  } catch { return null; }
}

/** Parse the legacy format: clawno11://connect?url=...&name=...&method=... */
function parseConnectLink(raw: string): ParsedConnectLink | null {
  try {
    const text = raw.trim();
    if (text.startsWith("clawno11://connect")) {
      const withHttp = text.replace("clawno11://connect", "https://x.invalid/connect");
      const parsed = new URL(withHttp);
      const url    = decodeURIComponent(parsed.searchParams.get("url") ?? "");
      const name   = decodeURIComponent(parsed.searchParams.get("name") ?? "");
      const method = (parsed.searchParams.get("method") ?? "xedge") as ConnectMethod;
      if (url) return { url, name, method };
    }
    if (text.startsWith("http://") || text.startsWith("https://")) {
      return { url: text, name: "", method: "xedge" };
    }
  } catch { /* invalid */ }
  return null;
}

// ── PIN Confirmation Modal ─────────────────────────────────────────────────

function PinConfirmModal({
  pairInfo,
  onConfirm,
  onCancel,
}: {
  pairInfo: ParsedPairLink;
  onConfirm: (host: string, name: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const nowSecs = () => Math.floor(Date.now() / 1000);
  const [remaining, setRemaining] = useState(pairInfo.expiresAt - nowSecs());
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const tick = setInterval(() => {
      setRemaining(pairInfo.expiresAt - nowSecs());
    }, 1000);
    return () => clearInterval(tick);
  }, [pairInfo.expiresAt]);

  const expired = remaining <= 0;

  const handleConfirm = async () => {
    if (expired || confirming) return;
    setConfirming(true);
    try {
      await onConfirm(pairInfo.host, pairInfo.name);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-sm rounded-2xl bg-white overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[hsl(var(--primary))]/10 flex items-center justify-center mx-auto mb-3">
            <QrCode size={22} className="text-[hsl(var(--primary))]" />
          </div>
          <p className="font-bold text-base">{t("connect.pinConfirmTitle")}</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
            {pairInfo.name || pairInfo.host}
          </p>
        </div>

        {/* PIN */}
        <div className="mx-5 mb-4 rounded-xl border-2 border-[hsl(var(--primary))]/20 bg-[hsl(var(--primary))]/5 p-4 text-center">
          <p className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-2">
            {t("connect.pinLabel")}
          </p>
          <p className="text-4xl font-black tracking-[0.3em] text-[hsl(var(--primary))] font-mono">
            {pairInfo.pin}
          </p>
          <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-2 leading-relaxed">
            {t("connect.pinInstruction")}
          </p>
        </div>

        {/* Expiry */}
        {expired ? (
          <p className="text-center text-xs text-red-500 font-semibold mb-4 flex items-center justify-center gap-1">
            <AlertTriangle size={12} /> {t("connect.pinExpired")}
          </p>
        ) : (
          <p className="text-center text-xs text-[hsl(var(--muted-foreground))] mb-4">
            {t("connect.pinExpiry", { seconds: Math.max(0, remaining) })}
          </p>
        )}

        {/* Buttons */}
        <div className="flex gap-3 px-5 pb-5">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl border border-[hsl(var(--border))] text-sm font-semibold text-[hsl(var(--foreground))]"
          >
            {t("connect.pinCancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={expired || confirming}
            className="flex-1 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary)/0.8))" }}
          >
            {confirming && <Loader size={14} className="animate-spin" />}
            {t("connect.pinConfirmBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Paste / QR banner ─────────────────────────────────────────────────────

function QrPasteBanner({ onPairConfirmed, onLegacyParsed }: {
  onPairConfirmed: (url: string, name: string, method: ConnectMethod) => void;
  onLegacyParsed: (url: string, name: string, method: ConnectMethod) => void;
}) {
  const { t } = useTranslation();
  const [pasting, setPasting]       = useState(false);
  const [err, setErr]               = useState<string | null>(null);
  const [pendingPair, setPendingPair] = useState<ParsedPairLink | null>(null);

  const handlePaste = async () => {
    setPasting(true);
    setErr(null);
    try {
      const text = await navigator.clipboard.readText();

      // Try new secure format first.
      const pair = parsePairLink(text);
      if (pair) {
        if (pair.expiresAt <= Math.floor(Date.now() / 1000)) {
          setErr(t("connect.qrExpiredErr"));
          return;
        }
        setPendingPair(pair);
        return;
      }

      // Fall back to legacy format.
      const legacy = parseConnectLink(text);
      if (legacy) {
        onLegacyParsed(legacy.url, legacy.name, legacy.method);
      } else {
        setErr(t("connect.qrPasteErr"));
      }
    } catch {
      setErr(t("connect.qrClipboardErr"));
    } finally {
      setPasting(false);
    }
  };

  const handlePinConfirm = async (host: string, name: string) => {
    const url = `http://${host}`;
    // Attempt to consume the token via the verify micro-server so the desktop
    // can enforce single-use semantics.  We extract the LAN IP from the host
    // (strip the gateway port) and use the verify port from the QR data.
    if (pendingPair?.verifyPort && pendingPair.verifyPort > 0) {
      const lanIp = host.split(":")[0];
      const verifyUrl = `http://${lanIp}:${pendingPair.verifyPort}/pair/verify`;
      try {
        await fetch(verifyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: pendingPair.token }),
          signal: AbortSignal.timeout(3000),
        });
      } catch {
        // Verify failed (network error / desktop too old) — proceed anyway.
        // PIN visual confirmation is still the primary security gate.
      }
    }
    onPairConfirmed(url, name, "xedge");
    setPendingPair(null);
  };

  return (
    <>
      {pendingPair && (
        <PinConfirmModal
          pairInfo={pendingPair}
          onConfirm={handlePinConfirm}
          onCancel={() => setPendingPair(null)}
        />
      )}

      <div className="rounded-2xl border border-[hsl(var(--border))] bg-white overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[hsl(var(--border))]/60"
          style={{ background: "rgba(6,182,212,0.04)" }}>
          <QrCode size={16} className="text-[hsl(var(--primary))]" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{t("connect.qrTitle")}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{t("connect.qrDesc")}</p>
          </div>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 border border-green-200 text-green-700 flex-shrink-0">
            OTP
          </span>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
            {t("connect.qrInstruction")}
          </p>
          <button
            onClick={handlePaste}
            disabled={pasting}
            className="touch-btn w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary)/0.8))" }}
          >
            {pasting ? <Loader size={14} className="animate-spin" /> : <ClipboardPaste size={14} />}
            {t("connect.qrPasteBtn")}
          </button>
          {err && (
            <p className="text-xs text-red-500 flex items-center gap-1.5">
              <AlertTriangle size={12} /> {err}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────

export function ConnectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addOrUpdate } = useInstanceStore();

  const [method, setMethod]         = useState<ConnectMethod>("xedge");
  const [tailscale, setTailscale]   = useState<TailscaleStatus | null>(null);
  const [tsLoading, setTsLoading]   = useState(false);

  const [url, setUrl]               = useState("");
  const [name, setName]             = useState("");
  const [testing, setTesting]       = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; ms?: number } | null>(null);
  const [added, setAdded]           = useState(false);
  const [showTailscaleGuide, setShowTailscaleGuide] = useState(false);
  const [showXedgeGuide, setShowXedgeGuide]         = useState(false);

  const refreshTailscale = useCallback(() => {
    setTsLoading(true);
    getTailscaleStatus()
      .then(setTailscale)
      .catch(() => setTailscale({ installed: false, running: false, ip: null, version: null }))
      .finally(() => setTsLoading(false));
  }, []);

  // Probe Tailscale-compatible VPN (also covers xEdge which uses the same 100.x.x.x range)
  useEffect(() => {
    if (method === "tailscale" || method === "xedge") {
      refreshTailscale();
    }
  }, [method]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill URL when Tailscale IP is detected
  useEffect(() => {
    if (tailscale?.ip && !url) {
      setUrl(`http://${tailscale.ip}:${DEFAULT_PORT}`);
    }
  }, [tailscale]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTest = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setTesting(true);
    setTestResult(null);
    setAdded(false);
    const start = Date.now();
    try {
      const ok = await probeGatewayUrl(trimmed);
      setTestResult({ ok, ms: Date.now() - start });
    } catch {
      setTestResult({ ok: false });
    } finally {
      setTesting(false);
    }
  };

  const handleAdd = () => {
    const trimmed = url.trim();
    if (!trimmed || !testResult?.ok) return;
    const inst: ClawInstance = {
      id: crypto.randomUUID(),
      name: name.trim() || trimmed,
      kind: "remote",
      gatewayUrl: trimmed.replace(/^http/, "ws"),
      uiUrl:      trimmed,
      httpUrl:    trimmed,
      port:       extractPort(trimmed),
      deployedAt: Date.now(),
      health:     "unknown",
    };
    addOrUpdate(inst);
    setAdded(true);
    setTimeout(() => setAdded(false), 3000);
  };

  const activeMethod = METHOD_META.find((m) => m.id === method)!;

  const applyParsed = useCallback((parsedUrl: string, parsedName: string, parsedMethod: ConnectMethod) => {
    setUrl(parsedUrl);
    if (parsedName) setName(parsedName);
    setMethod(parsedMethod);
    setTestResult(null);
    setAdded(false);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <TopBar title={t("connect.title")} subtitle={t("connect.desc")} />

      <div className="flex-1 scrollable p-4 pb-6 space-y-4">

        {/* ── QR / Paste Banner (OTP + PIN) ── */}
        <QrPasteBanner onPairConfirmed={applyParsed} onLegacyParsed={applyParsed} />

        {/* ── Method selector ── */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {METHOD_META.map((m) => {
            const Icon = m.icon;
            const active = m.id === method;
            return (
              <button
                key={m.id}
                onClick={() => setMethod(m.id)}
                className="touch-btn flex flex-col items-center gap-1.5 py-3 rounded-2xl border transition-all"
                style={{
                  background: active ? m.bg : "white",
                  borderColor: active ? m.color : "hsl(var(--border))",
                  boxShadow: active ? `0 0 0 1.5px ${m.color}40` : "none",
                }}
              >
                <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                  style={{ background: active ? m.bg : "rgba(0,0,0,0.04)" }}>
                  <Icon size={16} style={{ color: active ? m.color : "hsl(var(--muted-foreground))" }} />
                </div>
                <p className="text-[10px] font-semibold leading-tight text-center"
                  style={{ color: active ? m.color : "hsl(var(--foreground))" }}>
                  {t(m.labelKey)}
                </p>
                <p className="text-[9px] text-[hsl(var(--muted-foreground))] leading-tight text-center">
                  {t(m.descKey)}
                </p>
              </button>
            );
          })}
        </div>

        <div className="space-y-4">

          {/* ── Tailscale guide ── */}
          {method === "tailscale" && (
            <Section title={t("connect.tailscaleSection")} color={activeMethod.color}>
              <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
                {t("connect.tailscaleDesc")}
              </p>

              {/* Status pill */}
              <div className={`mt-3 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border ${
                tailscale?.running
                  ? "border-green-200 bg-green-50"
                  : "border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30"
              }`}>
                {tsLoading
                  ? <Loader size={14} className="animate-spin text-[hsl(var(--muted-foreground))]" />
                  : tailscale?.running
                    ? <Wifi size={14} className="text-green-600" />
                    : <WifiOff size={14} className="text-[hsl(var(--muted-foreground))]" />}
                <div className="flex-1">
                  <p className={`text-sm font-medium ${tailscale?.running ? "text-green-700" : "text-[hsl(var(--foreground))]"}`}>
                    {tailscale?.running ? t("connect.tailscaleActive") : t("connect.tailscaleInactive")}
                  </p>
                  {tailscale?.ip && (
                    <p className="text-xs text-green-600 font-mono mt-0.5">
                      {t("connect.tailscaleIp")}: {tailscale.ip}
                    </p>
                  )}
                </div>
                <button
                  onClick={refreshTailscale}
                  disabled={tsLoading}
                  className="touch-btn p-1.5 rounded-full"
                >
                  <Loader size={14} className={`text-[hsl(var(--muted-foreground))] ${tsLoading ? "animate-spin" : ""}`} />
                </button>
              </div>

              {!tailscale?.installed && (
                <a
                  href="https://tailscale.com/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="touch-btn mt-3 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-white text-sm font-semibold"
                  style={{ background: activeMethod.color }}
                >
                  <ExternalLink size={14} />
                  {t("connect.downloadTailscale")}
                </a>
              )}

              <button
                onClick={() => setShowTailscaleGuide((v) => !v)}
                className="touch-btn flex items-center gap-1.5 text-xs font-medium mt-3 py-1"
                style={{ color: activeMethod.color }}
              >
                <Info size={13} />
                {t("connect.tailscaleGuide")}
                {showTailscaleGuide ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
              </button>

              {showTailscaleGuide && (
                <>
                  <GuideSteps steps={[
                    t("connect.guideStep1"),
                    t("connect.guideStep2"),
                    t("connect.guideStep3"),
                    t("connect.guideStep4"),
                  ]} />
                  <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-3 leading-relaxed">
                    {t("connect.tailscalePrivacyNote")}
                  </p>
                </>
              )}
            </Section>
          )}


          {/* ── xEdge guide ── */}
          {method === "xedge" && (
            <Section title={t("connect.xedgeSection")} color={activeMethod.color}>
              <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
                {t("connect.xedgeDesc")}
              </p>

              {/* Free tier badge */}
              <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ background: "rgba(6,182,212,0.1)", color: "#0891b2", border: "1px solid rgba(6,182,212,0.25)" }}>
                <CheckCircle2 size={11} />
                {t("connect.xedgeFree")}
              </div>

              {/* Auto-detected IP status (xEdge uses same 100.x.x.x range as Tailscale) */}
              {tailscale?.running ? (
                <div className="mt-3 flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-green-200 bg-green-50">
                  <Wifi size={14} className="text-green-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-700">{t("connect.tailscaleActive")}</p>
                    {tailscale.ip && (
                      <p className="text-xs text-green-600 font-mono mt-0.5">
                        {t("connect.tailscaleIp")}: {tailscale.ip}
                      </p>
                    )}
                  </div>
                </div>
              ) : tailscale !== null && (
                <div className="mt-3 flex items-center gap-2 px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/20">
                  <WifiOff size={14} className="text-[hsl(var(--muted-foreground))] flex-shrink-0" />
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">{t("connect.tailscaleInactive")}</p>
                </div>
              )}

              <button
                onClick={() => setShowXedgeGuide((v) => !v)}
                className="touch-btn flex items-center gap-1.5 text-xs font-medium mt-3 py-1"
                style={{ color: activeMethod.color }}
              >
                <Info size={13} />
                {t("connect.xedgeGuide")}
                {showXedgeGuide ? <ChevronUp size={12} className="ml-auto" /> : <ChevronDown size={12} className="ml-auto" />}
              </button>

              {showXedgeGuide && (
                <>
                  <GuideSteps steps={[
                    t("connect.xedgeStep1"),
                    t("connect.xedgeStep2"),
                    t("connect.xedgeStep3"),
                    t("connect.xedgeStep4"),
                  ]} />
                  <p className="text-[11px] mt-3 leading-relaxed text-center px-1"
                    style={{ color: activeMethod.color }}>
                    {t("connect.xedgeTip")}
                  </p>
                  <a
                    href="https://xedge.cc"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="touch-btn mt-2 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white"
                    style={{ background: "linear-gradient(135deg, #06b6d4, #0891b2)" }}
                  >
                    <ExternalLink size={14} />
                    {t("connect.xedgeDownload")}
                  </a>
                </>
              )}
            </Section>
          )}

          {/* ── Add Server (universal, always visible) ── */}
          <section className="rounded-2xl border border-[hsl(var(--border))] overflow-hidden bg-white">
            <div className="px-4 py-3 border-b border-[hsl(var(--border))]">
              <p className="font-semibold text-sm flex items-center gap-2">
                <Plus size={16} style={{ color: "hsl(var(--primary))" }} />
                {t("connect.addServerSection")}
              </p>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1.5">{t("connect.nameLabel")}</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("connect.namePlaceholder")}
                  className="w-full px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm focus:ring-2 focus:ring-[hsl(var(--primary))]/30 focus:border-[hsl(var(--primary))]/60"
                />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1.5">{t("connect.urlLabel")}</label>
                <input
                  value={url}
                  onChange={(e) => { setUrl(e.target.value); setTestResult(null); setAdded(false); }}
                  placeholder={t("connect.urlPlaceholder")}
                  className="w-full px-3 py-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] text-sm font-mono focus:ring-2 focus:ring-[hsl(var(--primary))]/30 focus:border-[hsl(var(--primary))]/60"
                  autoCapitalize="none"
                  autoCorrect="off"
                  inputMode="url"
                />
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-1.5 leading-relaxed">
                  {t("connect.urlHint")}
                </p>
              </div>

              {testResult && (
                <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm border ${
                  testResult.ok
                    ? "border-green-200 bg-green-50 text-green-700"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}>
                  {testResult.ok
                    ? <CheckCircle2 size={15} className="flex-shrink-0" />
                    : <AlertTriangle size={15} className="flex-shrink-0" />}
                  <span>
                    {testResult.ok
                      ? t("connect.testSuccess", { ms: testResult.ms })
                      : t("connect.testFailed")}
                  </span>
                </div>
              )}

              {added && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm border border-blue-200 bg-blue-50 text-blue-700">
                  <CheckCircle2 size={15} className="flex-shrink-0" />
                  <span>{t("connect.added")}</span>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleTest}
                  disabled={testing || !url.trim()}
                  className="touch-btn flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-[hsl(var(--primary))]/40 text-[hsl(var(--primary))] text-sm font-semibold disabled:opacity-40"
                >
                  {testing && <Loader size={14} className="animate-spin" />}
                  {testing ? t("connect.testing") : t("connect.testBtn")}
                </button>

                <button
                  onClick={handleAdd}
                  disabled={!testResult?.ok || added}
                  className="touch-btn flex-1 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-40"
                  style={{ background: testResult?.ok ? "hsl(var(--primary))" : "rgba(0,0,0,0.15)" }}
                >
                  {t("connect.addBtn")}
                </button>
              </div>
            </div>
          </section>

          {/* ── Deploy a new server via SSH ── */}
          <button
            onClick={() => navigate("/deploy")}
            className="touch-btn w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-colors"
            style={{ border: "1px solid rgba(6,182,212,0.2)", background: "rgba(6,182,212,0.03)" }}
          >
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(6,182,212,0.1)" }}>
              <Server size={17} style={{ color: "hsl(var(--primary))" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-[hsl(var(--foreground))]">{t("connect.deployNewServer")}</p>
              <p className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                {t("connect.deployNewServerDesc")}
              </p>
            </div>
            <ChevronRight size={16} className="text-[hsl(var(--muted-foreground))] flex-shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
}

function extractPort(url: string): number {
  try {
    const u = new URL(url);
    return parseInt(u.port || "18789", 10);
  } catch {
    return DEFAULT_PORT;
  }
}
