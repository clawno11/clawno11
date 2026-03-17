/**
 * ConnectPage — mobile-first server connection setup.
 *
 * Supports two connection methods:
 *  1. xEdge (WeChat login, easy setup)
 *  2. Tailscale VPN (global, cross-platform)
 *
 * Users enter the server address manually (shown on the desktop Connectors page).
 */
import { useState, useEffect, useCallback } from "react";
import {
  Network, ExternalLink, Wifi, WifiOff, Plus, CheckCircle2,
  AlertTriangle, Loader, ChevronDown, ChevronUp, Info, Zap,
  Server, ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { getTailscaleStatus, probeGatewayUrl, fetchChatProxyToken, type TailscaleStatus } from "../ipc";
import { useInstanceStore, type ClawInstance } from "../store/instances";
import { TopBar } from "../components/TopBar";

const DEFAULT_PORT = 18800;

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
    <section className="rounded-2xl border border-[hsl(var(--border))] overflow-hidden bg-[hsl(var(--card))]">
      <div className="px-4 py-3 border-b border-[hsl(var(--border))]"
        style={{ background: `${color}08` }}>
        <p className="font-semibold text-sm" style={{ color }}>{title}</p>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

// ── URL parser ────────────────────────────────────────────────────────────

// ── Main ─────────────────────────────────────────────────────────────────

export function ConnectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addOrUpdate, updateTokenByHost, setGlobalChatProxyToken } = useInstanceStore();

  const [method, setMethod]         = useState<ConnectMethod>("xedge");
  const [tailscale, setTailscale]   = useState<TailscaleStatus | null>(null);
  const [tsLoading, setTsLoading]   = useState(false);

  const [url, setUrl]               = useState("");
  const [name, setName]             = useState("");
  const [chatProxyToken, setChatProxyToken] = useState<string | undefined>();
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
      if (ok && !chatProxyToken) {
        try {
          const token = await fetchChatProxyToken(trimmed);
          if (token) {
            setChatProxyToken(token);
            setGlobalChatProxyToken(token);
            try {
              const host = new URL(trimmed).host;
              if (host) updateTokenByHost(host, token);
            } catch { /* ignore */ }
          }
        } catch { /* non-fatal */ }
      }
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
      chatProxyToken,
    };
    addOrUpdate(inst);
    setAdded(true);
    setTimeout(() => setAdded(false), 3000);
  };

  const activeMethod = METHOD_META.find((m) => m.id === method)!;

  return (
    <div className="flex flex-col h-full">
      <TopBar title={t("connect.title")} subtitle={t("connect.desc")} />

      <div className="flex-1 scrollable p-4 pb-6 space-y-4">

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
                  background: active ? m.bg : "hsl(var(--card))",
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
          <section className="rounded-2xl border border-[hsl(var(--border))] overflow-hidden bg-[hsl(var(--card))]">
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
