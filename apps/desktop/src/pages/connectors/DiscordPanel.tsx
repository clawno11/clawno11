import { useState, useEffect } from "react";
import {
  CheckCircle2, AlertTriangle, Loader,
  Check, BadgeCheck, Info,
  ChevronDown, MessageSquare,
} from "lucide-react";
import {
  testDiscordConfig,
  saveDiscordConfig,
  getDiscordConfig,
  startDiscordBot,
  stopDiscordBot,
  getDiscordBotStatus,
  type DiscordBotInfo,
} from "../../ipc";
import { GuideSteps } from "./helpers";

export function DiscordPanel({ activePort }: { activePort: number }) {
  const [token, setToken]               = useState("");
  const [testing, setTesting]           = useState(false);
  const [botInfo, setBotInfo]           = useState<DiscordBotInfo | null>(null);
  const [testErr, setTestErr]           = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  const [saved, setSaved]               = useState(false);
  const [saveErr, setSaveErr]           = useState<string | null>(null);
  const [running, setRunning]           = useState(false);
  const [toggling, setToggling]         = useState(false);
  const [toggleErr, setToggleErr]       = useState<string | null>(null);
  const [savedHint, setSavedHint]       = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);

  useEffect(() => {
    getDiscordConfig()
      .then((t) => { if (t) setSavedHint(t.slice(0, 8) + "…"); })
      .catch(() => {})
      .finally(() => setLoadingExisting(false));
    getDiscordBotStatus().then(setRunning).catch(() => {});
  }, []);

  const handleTest = async () => {
    if (!token.trim()) return;
    setTesting(true); setTestErr(null); setBotInfo(null); setSaveErr(null); setToggleErr(null);
    try {
      const info = await testDiscordConfig(token.trim());
      setBotInfo(info);
    } catch (e) {
      setTestErr(String(e));
    } finally { setTesting(false); }
  };

  const handleSave = async () => {
    if (!botInfo) return;
    setSaving(true); setSaveErr(null);
    try {
      await saveDiscordConfig(token.trim());
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
        await stopDiscordBot();
        setRunning(false);
      } else {
        await startDiscordBot(activePort);
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
        style={{ background: "rgba(88,101,242,0.05)" }}>
        <MessageSquare size={16} style={{ color: "#5865F2" }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Discord Bot</p>
          <p className="text-xs text-muted-foreground">接入 Discord 服务器，@提及或私信触发 AI 回复</p>
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
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-xs text-indigo-800">
            <BadgeCheck size={14} className="text-indigo-500" />
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
              placeholder="从 Discord 开发者后台获取 Bot Token"
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
              已验证：<strong>{botInfo.username}</strong>
              {botInfo.discriminator !== "0" ? `#${botInfo.discriminator}` : ""}
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

        {/* MESSAGE_CONTENT intent notice */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <Info size={13} className="flex-shrink-0 mt-0.5" />
          <span>需在 Discord 开发者后台启用 <strong>MESSAGE CONTENT</strong> 特权意图，否则 Bot 只能接收私信。</span>
        </div>

        {/* Start / Stop */}
        <button
          onClick={handleToggle}
          disabled={toggling || (!savedHint && !botInfo)}
          className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 ${
            running
              ? "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
              : "bg-[#5865F2]/10 text-[#5865F2] border border-[#5865F2]/20 hover:bg-[#5865F2]/20"
          }`}
        >
          {toggling ? <Loader size={14} className="animate-spin" /> : <MessageSquare size={14} />}
          {running ? "停止机器人" : "启动机器人"}
        </button>

        {/* Guide */}
        <details className="group">
          <summary className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
            <Info size={12} /> 如何创建 Discord 机器人
            <ChevronDown size={12} className="group-open:rotate-180 transition-transform ml-auto" />
          </summary>
          <GuideSteps steps={[
            "访问 discord.com/developers/applications，新建应用",
            "左侧菜单选「Bot」，点「Reset Token」获取 Token",
            "在「Privileged Gateway Intents」区域开启「MESSAGE CONTENT INTENT」",
            "在「OAuth2 → URL Generator」选 bot 权限，生成邀请链接，把 Bot 加入你的服务器",
            "将 Token 粘贴到上方输入框，验证后保存，再点「启动机器人」",
            "在服务器中 @提及机器人，或通过私信与 AI 对话",
          ]} />
        </details>
      </div>
    </div>
  );
}
