import { Component, useEffect, type ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import i18n from "./i18n.ts";
import { BottomNav } from "./components/BottomNav.tsx";
import { ChatPage } from "./pages/ChatPage.tsx";
import { InstancesPage } from "./pages/InstancesPage.tsx";
import { ConnectPage } from "./pages/ConnectPage.tsx";
import { MorePage } from "./pages/MorePage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { TokenPage } from "./pages/TokenPage.tsx";
import { RagPage } from "./pages/RagPage.tsx";
import { McpPage } from "./pages/McpPage.tsx";
import { RouterPage } from "./pages/RouterPage.tsx";
import { SecurityPage } from "./pages/SecurityPage.tsx";
import { useAiConfigStore } from "./store/aiConfig.ts";

// ── Error boundary ──────────────────────────────────────────────────────

interface EBState { error: Error | null }

class PageErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  state: EBState = { error: null };

  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
          <p className="text-lg font-semibold text-red-600">
            {i18n.t("common.pageError")}
          </p>
          <pre className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] rounded-xl p-4 max-w-xs overflow-auto text-left">
            {this.state.error.message}
          </pre>
          <button
            className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold"
            style={{ background: "hsl(var(--primary))" }}
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

// ── App ──────────────────────────────────────────────────────────────────

function AppContent() {
  const { load } = useAiConfigStore();

  // Hydrate AI config from encrypted store once on mount
  useEffect(() => {
    load().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="flex flex-col h-full bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
      style={{ height: "100dvh" }}
    >
      {/* Page content */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <PageErrorBoundary>
          <Routes>
            <Route path="/"         element={<InstancesPage />} />
            <Route path="/chat"     element={<ChatPage />} />
            <Route path="/connect"  element={<ConnectPage />} />
            <Route path="/more"     element={<MorePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/tokens"   element={<TokenPage />} />
            <Route path="/rag"      element={<RagPage />} />
            <Route path="/mcp"      element={<McpPage />} />
            <Route path="/router"   element={<RouterPage />} />
            <Route path="/security" element={<SecurityPage />} />
          </Routes>
        </PageErrorBoundary>
      </main>

      {/* Bottom navigation */}
      <BottomNav />
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
