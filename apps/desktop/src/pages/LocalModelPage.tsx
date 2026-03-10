import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Cpu, Download, Trash2, CheckCircle, XCircle, Loader,
  RefreshCw, Play, Star, AlertTriangle, HardDrive, ExternalLink,
} from "lucide-react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  ollamaCheckStatus, ollamaEnsureInstalled, ollamaStartServer,
  ollamaListLocalModels, ollamaDeleteModel, ollamaPullModel, ollamaSetModel,
  type OllamaStatus, type OllamaModel, type OllamaPullProgress,
} from "../ipc";

// ── Model catalog ────────────────────────────────────────────────────────────

interface CatalogModel {
  id: string;
  name: string;
  sizeLabel: string;
  desc: string;
  tags: string[];
  recommended?: boolean;
}

const CATALOG: CatalogModel[] = [
  {
    id: "qwen2.5:7b",
    name: "Qwen 2.5 7B",
    sizeLabel: "4.7 GB",
    desc: "通义千问，中文理解能力业界领先，日常对话/编程/分析全能推荐",
    tags: ["中文优秀", "代码", "推荐"],
    recommended: true,
  },
  {
    id: "qwen2.5:3b",
    name: "Qwen 2.5 3B",
    sizeLabel: "1.9 GB",
    desc: "轻量版千问，适合 8GB 内存以下设备，速度快",
    tags: ["轻量", "中文", "低内存"],
  },
  {
    id: "deepseek-r1:7b",
    name: "DeepSeek-R1 7B",
    sizeLabel: "4.7 GB",
    desc: "强推理模型，数学/逻辑/代码题表现突出",
    tags: ["强推理", "数学", "代码"],
  },
  {
    id: "llama3.2:3b",
    name: "Llama 3.2 3B",
    sizeLabel: "2.0 GB",
    desc: "Meta 轻量英文模型，国际化场景首选",
    tags: ["英文", "轻量", "Meta"],
  },
  {
    id: "qwen2.5:14b",
    name: "Qwen 2.5 14B",
    sizeLabel: "9.0 GB",
    desc: "千问旗舰版，需要 16GB 内存，性能接近 GPT-4o",
    tags: ["旗舰", "中文", "高配"],
  },
  {
    id: "mistral:7b",
    name: "Mistral 7B",
    sizeLabel: "4.1 GB",
    desc: "欧洲高质量英文模型，推理速度快",
    tags: ["英文", "快速"],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(0)} MB`;
}

function statusLabel(status: OllamaStatus): { text: string; color: string } {
  if (!status.installed) return { text: "未安装", color: "text-red-500" };
  if (!status.running)   return { text: "已安装，未运行", color: "text-amber-500" };
  return { text: `运行中${status.version ? " · " + status.version : ""}`, color: "text-green-500" };
}

// ── Pull progress store (keyed by model name) ─────────────────────────────────

interface PullState {
  percent: number;
  status: string;
  done: boolean;
  error: string | null;
}

// ── Default model storage ────────────────────────────────────────────────────

const DEFAULT_MODEL_KEY = "clawno-ollama-default-model";

function getDefaultModel(): string {
  return localStorage.getItem(DEFAULT_MODEL_KEY) ?? "";
}

function setDefaultModel(name: string): void {
  localStorage.setItem(DEFAULT_MODEL_KEY, name);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: OllamaStatus }) {
  const { text, color } = statusLabel(status);
  return (
    <span className={`text-xs font-medium ${color}`}>{text}</span>
  );
}

function Tag({ label, highlight }: { label: string; highlight?: boolean }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
      highlight
        ? "bg-primary/15 text-primary font-semibold"
        : "bg-muted text-muted-foreground"
    }`}>
      {label}
    </span>
  );
}

interface CatalogCardProps {
  model: CatalogModel;
  isInstalled: boolean;
  isDefault: boolean;
  pull: PullState | null;
  onPull: (id: string) => void;
  ollamaInstalled: boolean;
}

function CatalogCard({ model, isInstalled, isDefault, pull, onPull, ollamaInstalled }: CatalogCardProps) {
  const isPulling = pull !== null && !pull.done;

  return (
    <div className={`relative rounded-xl border p-4 transition-colors ${
      isDefault
        ? "border-primary/50 bg-primary/5"
        : isInstalled
        ? "border-green-500/30 bg-green-500/5"
        : "border-border bg-card"
    }`}>
      {model.recommended && !isInstalled && (
        <span className="absolute -top-2 right-3 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 font-semibold border border-amber-200 dark:border-amber-700">
          推荐
        </span>
      )}

      {/* Header row: name + size */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold">{model.name}</span>
            {isDefault && <Star size={12} className="text-primary flex-shrink-0" />}
          </div>
          <span className="text-xs text-muted-foreground font-mono">{model.sizeLabel}</span>
        </div>

        {/* Installed badge */}
        {isInstalled && (
          <span className="flex items-center gap-1 text-xs text-green-600 flex-shrink-0 mt-0.5">
            <CheckCircle size={13} />
            已下载
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed mb-3">{model.desc}</p>

      <div className="flex flex-wrap gap-1 mb-3">
        {model.tags.map((t) => (
          <Tag key={t} label={t} highlight={t === "推荐"} />
        ))}
      </div>

      {/* Action row — always at the bottom, full width */}
      {!isInstalled && (
        isPulling ? (
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Loader size={11} className="animate-spin" />
                {pull!.status === "starting-server" ? "启动 Ollama 服务…" : pull!.status}
              </span>
              <span className="tabular-nums font-mono">{pull!.percent.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${pull!.percent}%` }}
              />
            </div>
          </div>
        ) : (
          <button
            onClick={() => onPull(model.id)}
            disabled={!ollamaInstalled}
            title={!ollamaInstalled ? "请先安装 Ollama 引擎" : `下载 ${model.name}`}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg
                       bg-primary text-primary-foreground text-xs font-semibold
                       hover:bg-primary/90 transition-colors
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={13} />
            {!ollamaInstalled ? "需先安装 Ollama" : `下载 ${model.name}`}
          </button>
        )
      )}

      {pull?.done && pull.error && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-red-500">
          <XCircle size={12} />
          {pull.error}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function LocalModelPage() {
  const [status, setStatus]               = useState<OllamaStatus | null>(null);
  const [localModels, setLocalModels]     = useState<OllamaModel[]>([]);
  const [pulling, setPulling]             = useState<Record<string, PullState>>({});
  const [defaultModel, setDefaultModelState] = useState(getDefaultModel);
  const [installing, setInstalling]       = useState(false);
  const [installResult, setInstallResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [startingServer, setStartingServer] = useState(false);
  const [refreshing, setRefreshing]       = useState(false);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);

  // ── Fetch status & local models ──────────────────────────────────────────────
  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [s, models] = await Promise.all([
        ollamaCheckStatus(),
        ollamaListLocalModels(),
      ]);
      setStatus(s);
      setLocalModels(models);
    } catch {
      // ignore
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Listen to pull progress events ───────────────────────────────────────────
  useEffect(() => {
    const unlisten = listen<OllamaPullProgress>("ollama-pull-progress", (evt) => {
      const p = evt.payload;
      setPulling((prev) => ({
        ...prev,
        [p.model]: {
          percent: p.percent,
          status: p.status,
          done: p.done,
          error: p.error ?? null,
        },
      }));

      if (p.done && !p.error) {
        // Model downloaded — refresh list and auto-set as default if none set yet.
        refresh(true);
        if (!getDefaultModel()) {
          handleSetDefault(p.model);
        }
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [refresh]);

  // ── Install Ollama engine ────────────────────────────────────────────────────
  const handleInstall = async () => {
    setInstalling(true);
    setInstallResult(null);
    try {
      const res = await ollamaEnsureInstalled();
      if (res.ok) {
        setInstallResult({ ok: true, msg: "Ollama 引擎安装成功！" });
        await refresh();
      } else {
        const raw = res.detail.replace("ollama-install-failed:", "");
        setInstallResult({ ok: false, msg: raw });
      }
    } catch (e) {
      setInstallResult({ ok: false, msg: String(e) });
    } finally {
      setInstalling(false);
    }
  };

  // ── Start server ─────────────────────────────────────────────────────────────
  const handleStartServer = async () => {
    setStartingServer(true);
    try {
      await ollamaStartServer();
      await refresh();
    } finally {
      setStartingServer(false);
    }
  };

  // ── Pull model ───────────────────────────────────────────────────────────────
  const handlePull = async (modelId: string) => {
    setPulling((prev) => ({
      ...prev,
      [modelId]: { percent: 0, status: "connecting", done: false, error: null },
    }));
    try {
      await ollamaPullModel(modelId);
    } catch (e) {
      setPulling((prev) => ({
        ...prev,
        [modelId]: { percent: 0, status: "error", done: true, error: String(e) },
      }));
    }
  };

  // ── Delete model ─────────────────────────────────────────────────────────────
  const handleDelete = async (name: string) => {
    if (!window.confirm(`确认删除模型 ${name}？该操作不可恢复。`)) return;
    setDeletingModel(name);
    try {
      await ollamaDeleteModel(name);
      if (defaultModel === name) {
        setDefaultModel("");
        setDefaultModelState("");
      }
      await refresh(true);
    } finally {
      setDeletingModel(null);
    }
  };

  // ── Set default model ────────────────────────────────────────────────────────
  const handleSetDefault = async (name: string) => {
    setDefaultModel(name);
    setDefaultModelState(name);
    // Notify OpenClaw gateway to route to this Ollama model.
    try {
      await ollamaSetModel(name);
    } catch {
      // Non-fatal: gateway will pick it up on next restart.
    }
  };

  const installedNames = new Set(localModels.map((m) => m.name));

  return (
    <div className="page-enter p-6 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-2xl font-bold tracking-tight">本地模型</h1>
        <span
          className="font-mono text-xs px-2 py-0.5 rounded-full font-semibold"
          style={{
            background: "rgba(168,85,247,0.1)",
            color: "hsl(271,81%,56%)",
            border: "1px solid rgba(168,85,247,0.2)",
          }}
        >
          Ollama
        </span>
      </div>
      <p className="text-muted-foreground text-sm mb-6">
        无需 API Key，本地运行 AI 模型，数据完全不出网
      </p>

      {/* ── Engine Status Card ── */}
      <div className="rounded-xl border border-border bg-card p-4 mb-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0">
              <Cpu size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">Ollama 引擎</p>
              {status ? (
                <StatusBadge status={status} />
              ) : (
                <span className="text-xs text-muted-foreground">检测中…</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refresh()}
              disabled={refreshing}
              className="p-1.5 rounded-lg border border-border hover:bg-muted/50 transition-colors disabled:opacity-40"
              title="刷新状态"
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            </button>

            {status && !status.installed && (
              <button
                onClick={handleInstall}
                disabled={installing}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {installing ? <Loader size={12} className="animate-spin" /> : <Download size={12} />}
                {installing ? "安装中…" : "安装 Ollama"}
              </button>
            )}

            {status?.installed && !status.running && (
              <button
                onClick={handleStartServer}
                disabled={startingServer}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {startingServer ? <Loader size={12} className="animate-spin" /> : <Play size={12} />}
                {startingServer ? "启动中…" : "启动服务"}
              </button>
            )}
          </div>
        </div>

        {/* Install result */}
        {installResult && (
          <div className={`mt-3 rounded-xl border p-3 text-xs ${
            installResult.ok
              ? "border-green-200 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400"
              : "border-red-200 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400"
          }`}>
            <div className="flex items-start gap-2">
              {installResult.ok ? <CheckCircle size={13} className="flex-shrink-0 mt-0.5" /> : <XCircle size={13} className="flex-shrink-0 mt-0.5" />}
              <div className="flex-1 space-y-1.5">
                {installResult.ok ? (
                  <p>{installResult.msg}</p>
                ) : (
                  <>
                    <p><strong>自动安装失败</strong>（{installResult.msg}）</p>
                    <p>请手动下载安装包后再重试：</p>
                    <button
                      onClick={() => openUrl("https://ollama.com/download")}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-current opacity-80 hover:opacity-100 transition-opacity"
                    >
                      <ExternalLink size={11} />
                      前往 ollama.com 下载（约 100 MB）
                    </button>
                    <p className="opacity-70">下载后双击安装，安装完成后点「刷新」按钮。</p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Not installed hint */}
        {status && !status.installed && !installResult && (
          <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
            <div className="flex items-start gap-2">
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <div className="text-[11px] leading-relaxed space-y-1.5">
                <p><strong>未检测到 Ollama</strong>，需要先安装引擎才能使用本地模型。</p>
                <p>
                  点「安装 Ollama」可自动安装；如果多次失败，可{" "}
                  <button
                    onClick={() => openUrl("https://ollama.com/download")}
                    className="underline underline-offset-2 hover:opacity-70 transition-opacity inline-flex items-center gap-0.5"
                  >
                    前往官网手动下载 <ExternalLink size={10} />
                  </button>
                  {" "}后刷新页面。
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Installed Models ── */}
      {localModels.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <HardDrive size={14} className="text-primary" />
            <h2 className="text-sm font-semibold">已下载的模型</h2>
            <span className="text-xs text-muted-foreground ml-auto">
              共 {localModels.length} 个
            </span>
          </div>

          <div className="rounded-xl border border-border bg-card divide-y divide-border">
            {localModels.map((model) => (
              <div key={model.name} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{model.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(model.size)}</p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {defaultModel === model.name ? (
                    <span className="flex items-center gap-1 text-xs text-primary font-medium">
                      <Star size={12} />
                      默认
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSetDefault(model.name)}
                      className="text-xs text-muted-foreground hover:text-primary transition-colors"
                      title="设为默认模型"
                    >
                      设为默认
                    </button>
                  )}

                  <button
                    onClick={() => handleDelete(model.name)}
                    disabled={deletingModel === model.name}
                    className="p-1 rounded text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-40"
                    title="删除模型"
                  >
                    {deletingModel === model.name
                      ? <Loader size={13} className="animate-spin" />
                      : <Trash2 size={13} />}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {defaultModel && (
            <p className="mt-2 text-[11px] text-muted-foreground text-center">
              当前默认本地模型：<span className="font-mono text-foreground">{defaultModel}</span>
              &nbsp;·&nbsp;对话时选择"本地模型"实例即可使用
            </p>
          )}
        </div>
      )}

      {/* ── Model Catalog ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Download size={14} className="text-primary" />
          <h2 className="text-sm font-semibold">可下载的模型</h2>
          <span className="text-xs text-muted-foreground ml-auto">
            {CATALOG.length} 个推荐模型
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CATALOG.map((model) => (
            <CatalogCard
              key={model.id}
              model={model}
              isInstalled={installedNames.has(model.id)}
              isDefault={defaultModel === model.id}
              pull={pulling[model.id] ?? null}
              onPull={handlePull}
              ollamaInstalled={status?.installed ?? false}
            />
          ))}
        </div>

        <p className="mt-4 text-[11px] text-muted-foreground text-center leading-relaxed">
          模型文件存储在本机，单个约 2–9 GB，下载前请确认磁盘空间充足（建议预留 20 GB）。
          <br />
          更多模型可在 <span className="text-primary">ollama.com/library</span> 搜索，然后在终端运行{" "}
          <code className="font-mono bg-muted px-1 rounded">ollama pull 模型名</code> 安装。
        </p>
      </div>
    </div>
  );
}
