import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DeployPage } from "./pages/DeployPage.tsx";
import { InstancesPage } from "./pages/InstancesPage.tsx";
import { ChatPage } from "./pages/ChatPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { Sidebar } from "./components/Sidebar.tsx";

export function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-background text-foreground overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<InstancesPage />} />
            <Route path="/deploy" element={<DeployPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
