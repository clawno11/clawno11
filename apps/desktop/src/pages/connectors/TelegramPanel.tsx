import { useState, useEffect } from "react";
import {
  CheckCircle2, AlertTriangle, Loader,
  Check, BadgeCheck, Wifi,
  ChevronDown, Info, Send,
} from "lucide-react";
import {
  testTelegramConfig,
  saveTelegramConfig,
  getTelegramConfig,
  startTelegramBot,
  stopTelegramBot,
  getTelegramBotStatus,
  type TelegramBotInfo,
} from "../../ipc";
import { GuideSteps } from "./helpers";

export function TelegramPanel({ activePort }: { activePort: number }) {
  const [token, setToken]               = useState("");
  const [testing, setTesting]           = useState(false);
  const [botInfo, setBotInfo]           = useState<TelegramBotInfo | null>(null);
  const [testErr, setTestErr]           = useState<string | null>(null);
  const [saveErr, setSaveErr]           = useState<string | null>(null);
  const [toggleErr, setToggleErr]       = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  const [saved, setSaved]               = useState(false);
  const [running, setRunning]           = useState(false);
  const [toggling, setToggling]         = useState(false);
  const [savedHint, setSavedHint]       = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);

  useEffect(() => {
    getTelegramConfig()
      .then((t) => { if (t) setSavedHint(t.slice(0, 8) + "…"); })
      .catch(() => {})
      .finally(() => setLoadingExisting(false));
    getTelegramBotStatus().then(setRunning).catch(() => {});
  }, []);

  const handleTest = async () => {
    if (!token.trim()) return;
    setTesting(true); setTestErr(null); setBotInfo(null); setSaveErr(null); setToggleErr(null);
    try {
      const info = await testTelegramConfig(token.trim());
      setBotInfo(info);
    } catch (e) {
      setTestErr(String(e));
    } finally { setTesting(false); }
  };

  const handleSave = async () => {
    if (!botInfo) return;
    setSaving(true); setSaveErr(null);
    try {
      await saveTelegramConfig(token.trim());
      setSaved(true);
      setSavedHint(token.trim().slice(0, 8) + "…");
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setSaveErr(String(e));
    } finally { setSaving(false); }
  };

  const handleToggle = async () => {
    setToggling(true); setToggleErr(null);
    try {
      if (running) {
        await stopTelegramBot();
        setRunning(false);
      } else {
        await startTelegramBot(activePort);
        setRunning(true);
      }
    } catch (e) {
      setToggleErr(String(e));
    } finally { setToggling(false); }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border"
        style={{ background: "rgba(42,171,238,0.05)" }}>
        <Send size={16} style={{ color: "#2AABEE" }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Telegram Bot</p>
          <p className="text-xs text-muted-foreground">用 @BotFather 创建机器人，轮询对话，无需公网 IP</p>
        </div>
        {running && (
          <span className="flex items-center gap-1 text-[11px] font-semibold text-green-600 px-2 py-0.5 rounded-full bg-green-50 border border-green-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            运行中
          </span>
        )}
      </div>

      <div className="p-5 space-y-4">
        {loadingExisting ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader size={13} className="animate-spin" /> 读取已保存配置…
          </div>
        ) : savedHint ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800">
            <BadgeCheck size={14} className="text-blue-500" />
            已配置 Token（前缀：{savedHint}）
          </div>
        ) : null}

        {/* Token input */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Bot Token</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={token}
              onChange={(e) => { setToken(e.target.value); setBotInfo(null); setTestErr(null); }}
              placeholder="从 @BotFather 获取，格式：123456:ABC-DEF…"
              className="flex-1 px-3 py-2 rounded-lg border border-border text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              onClick={handleTest}
              disabled={testing || !token.trim()}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {testing ? <Loader size={14} className="animate-spin" /> : "验证"}
            </button>
          </div>
        </div>

        {/* Validation result */}
        {botInfo && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
            <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
            <span className="text-xs text-green-800 flex-1">
              已验证：<strong>@{botInfo.username}</strong>（{botInfo.first_name}）
            </span>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1 text-xs font-semibold rounded-lg text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader size={12} className="animate-spin" /> : saved ? <Check size={12} /> : "保存"}
            </button>
          </div>
        )}

        {testErr && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">{testErr}</span>
          </div>
        )}
        {saveErr && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">保存失败：{saveErr}</span>
          </div>
        )}
        {toggleErr && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <AlertTriangle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-red-700">启停失败：{toggleErr}</span>
          </div>
        )}

        {/* Start / Stop */}
        <button
          onClick={handleToggle}
          disabled={toggling || (!savedHint && !botInfo)}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 ${
            running
              ? "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
              : "bg-[#2AABEE]/10 text-[#2AABEE] border border-[#2AABEE]/20 hover:bg-[#2AABEE]/20"
          }`}
        >
          {toggling ? <Loader size={14} className="animate-spin" /> : <Wifi size={14} />}
          {running ? "停止机器人" : "启动机器人"}
        </button>

        {/* Guide */}
        <details className="group">
          <summary className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
            <Info size={12} /> 如何创建 Telegram 机器人
            <ChevronDown size={12} className="group-open:rotate-180 transition-transform ml-auto" />
          </summary>
          <GuideSteps steps={[
            "在 Telegram 搜索 @BotFather，发送 /newbot",
            "按提示设置机器人名称（如「我的AI助手」）和用户名（必须以 bot 结尾）",
            "BotFather 会回复一个 Token，复制粘贴到上方输入框",
            "点击「验证」确认无误后点「保存」，再点「启动机器人」",
            "机器人启动后，在 Telegram 与它对话即可",
          ]} />
        </details>
      </div>
    </div>
  );
}
