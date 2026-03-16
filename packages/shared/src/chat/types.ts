export interface ChatMessage {
  role: string;
  content: string;
}

export interface UIMessage extends ChatMessage {
  id: string;
  streaming?: boolean;
  createdAt?: number;
}

export interface CloudModelInfo {
  model: string;
  label: string;
}

/**
 * 所有支持的云端模型映射（按 provider key 索引）。
 * Desktop 使用全量列表，Mobile 可按需取子集。
 */
export const PROVIDER_CLOUD_MODELS: Record<string, CloudModelInfo> = {
  zai:         { model: "zai/glm-4-flash",                             label: "智谱 GLM-4-Flash" },
  minimax:     { model: "minimax/MiniMax-M2",                          label: "MiniMax M2" },
  openai:      { model: "openai/gpt-4o-mini",                          label: "GPT-4o Mini" },
  anthropic:   { model: "anthropic/claude-haiku-3",                    label: "Claude Haiku 3" },
  openrouter:  { model: "openrouter/meta-llama/llama-3.2-3b-instruct", label: "Llama 3.2 3B" },
  moonshot:    { model: "moonshot/kimi-k2.5",                          label: "Kimi K2.5" },
  qwen:        { model: "modelstudio/qwen3.5-plus",                   label: "通义千问 3.5 Plus" },
  doubao:      { model: "volcengine/doubao-seed-1-8-251228",           label: "豆包 Seed 1.8" },
  deepseek:    { model: "openrouter/deepseek/deepseek-chat",           label: "DeepSeek V3" },
  hunyuan:     { model: "openrouter/tencent/hunyuan-lite",             label: "混元 Lite" },
  spark:       { model: "openrouter/iflytek/spark-lite",               label: "讯飞星火 Lite" },
};

/** Mobile 使用的精简 provider 子集 */
export const MOBILE_PROVIDER_KEYS = [
  "zai", "openrouter", "minimax", "openai", "anthropic",
] as const;
