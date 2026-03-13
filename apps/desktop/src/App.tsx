import { Component, useEffect, type ReactNode } from "react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import i18n from "./i18n.ts";
import { DeployPage } from "./pages/DeployPage.tsx";
import { InstancesPage } from "./pages/InstancesPage.tsx";
import { ChatPage } from "./pages/ChatPage.tsx";
import { SecurityPage } from "./pages/SecurityPage.tsx";
import { TokenPage } from "./pages/TokenPage.tsx";
import { ConnectorsPage } from "./pages/ConnectorsPage.tsx";
import { RagPage } from "./pages/RagPage.tsx";
import { McpPage } from "./pages/McpPage.tsx";
import { RouterPage } from "./pages/RouterPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { LocalModelPage } from "./pages/LocalModelPage.tsx";
import { RemoteSessionsPage } from "./pages/RemoteSessionsPage.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { initRemoteSessionListeners } from "./store/remoteSessions.ts";
import { initAutoUpdater } from "./store/updater.ts";

initRemoteSessionListeners();
initAutoUpdater().catch((e) => console.warn("[updater] init failed:", e));

// ── Error boundary — prevents one page crash from taking down the whole app ──

interface EBState { error: Error | null }

class PageErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  override state: EBState = { error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
          <p className="text-lg font-semibold text-destructive">{i18n.t("common.pageError")}</p>
          <pre className="text-xs text-muted-foreground bg-muted rounded-lg p-4 max-w-xl overflow-auto text-left">
            {this.state.error.message}
          </pre>
          <button
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm"
            onClick={() => this.setState({ error: null })}
          >
            {i18n.t("common.retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Startup navigator — handles clawno-home-instances setting ────────────────

const LAST_ROUTE_KEY = "clawno-last-route";
const RESTORE_BLACKLIST = ["/settings"]; // never restore these on startup

function StartupNavigator() {
  const location = useLocation();
  const navigate  = useNavigate();

  // On first mount: if "go to instances on startup" is OFF, restore last route
  useEffect(() => {
    const homeInstances = localStorage.getItem("clawno-home-instances");
    const pinHome = homeInstances === null ? true : homeInstances === "1";
    if (!pinHome) {
      const last = localStorage.getItem(LAST_ROUTE_KEY);
      if (last && last !== "/" && !RESTORE_BLACKLIST.includes(last)) {
        navigate(last, { replace: true });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — run once on mount

  // Persist current route so we can restore it next launch
  useEffect(() => {
    localStorage.setItem(LAST_ROUTE_KEY, location.pathname);
  }, [location.pathname]);

  return null;
}

// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-background text-foreground overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-auto" style={{ height: "100vh" }}>
          <StartupNavigator />
          <PageErrorBoundary>
            <Routes>
              <Route path="/" element={<InstancesPage />} />
              <Route path="/deploy" element={<DeployPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/security" element={<SecurityPage />} />
              <Route path="/tokens" element={<TokenPage />} />
              <Route path="/connectors" element={<ConnectorsPage />} />
              <Route path="/rag" element={<RagPage />} />
              <Route path="/mcp" element={<McpPage />} />
              <Route path="/router" element={<RouterPage />} />
              <Route path="/local-models" element={<LocalModelPage />} />
              <Route path="/remote-sessions" element={<RemoteSessionsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </PageErrorBoundary>
        </main>
      </div>
    </BrowserRouter>
  );
}
