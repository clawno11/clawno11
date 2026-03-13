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
  siliconflow: { model: "openrouter/meta-llama/llama-3.1-8b-instruct", label: "SiliconFlow Llama 3.1 8B" },
  hunyuan:     { model: "openrouter/tencent/hunyuan-lite",             label: "混元 Lite" },
  spark:       { model: "openrouter/iflytek/spark-lite",               label: "讯飞星火 Lite" },
  zai:         { model: "zai/glm-4-flash",                             label: "智谱 GLM-4-Flash" },
  openrouter:  { model: "openrouter/meta-llama/llama-3.2-3b-instruct", label: "Llama 3.2 3B" },
  doubao:      { model: "openrouter/bytedance/doubao-lite-32k",        label: "豆包 Lite" },
  minimax:     { model: "minimax/MiniMax-M2",                          label: "MiniMax M2" },
  deepseek:    { model: "openrouter/deepseek/deepseek-chat",           label: "DeepSeek V3" },
  qwen:        { model: "openrouter/qwen/qwen-plus",                   label: "通义千问 Plus" },
  moonshot:    { model: "openrouter/moonshot-ai/moonshot-v1-8k",       label: "月之暗面 v1-8k" },
  openai:      { model: "openai/gpt-4o-mini",                          label: "GPT-4o Mini" },
  anthropic:   { model: "anthropic/claude-haiku-3",                    label: "Claude Haiku 3" },
};

/** Mobile 使用的精简 provider 子集 */
export const MOBILE_PROVIDER_KEYS = [
  "zai", "openrouter", "minimax", "openai", "anthropic",
] as const;
