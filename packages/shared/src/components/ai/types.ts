export interface ProviderPricing {
  hasFree?: boolean;
  freeLabel?: string;
  range?: string;
  priceNote: string;
}

export const FEATURED_AI = [
  {
    id:          "zai" as const,
    emoji:       "🧠",
    name:        "智谱 AI (GLM)",
    badge:       "直连",
    badgeClass:  "bg-emerald-50 border-emerald-200 text-emerald-700",
    highlight:   "GLM-4-Flash 可用 · 配置简单",
    registerUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    placeholder: "输入 API Key",
  },
  {
    id:          "openrouter" as const,
    emoji:       "🌐",
    name:        "OpenRouter",
    badge:       "聚合",
    badgeClass:  "bg-blue-50 border-blue-200 text-blue-700",
    highlight:   "一个 Key 可用多种模型",
    registerUrl: "https://openrouter.ai/keys",
    placeholder: "sk-or-v1-...",
  },
  {
    id:          "minimax" as const,
    emoji:       "🐋",
    name:        "MiniMax（海螺）",
    badge:       "直连",
    badgeClass:  "bg-violet-50 border-violet-200 text-violet-700",
    highlight:   "海螺 AI 背后的模型 · 配置简单",
    registerUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    placeholder: "输入 API Key",
  },
] as const;

export const PROVIDER_PRICING: Record<string, ProviderPricing> = {
  zai:         { hasFree: false, priceNote: "多档模型可选，具体价格请查看官网" },
  minimax:     { hasFree: false, priceNote: "多档模型可选，具体价格请查看官网" },
  anthropic:   { hasFree: false, priceNote: "提供 Haiku / Sonnet / Opus 等多档模型，具体价格请查看官网" },
  openai:      { hasFree: false, priceNote: "提供 GPT-4o-mini / GPT-4o / o1 等多档模型，具体价格请查看官网" },
  openrouter:  { hasFree: false, priceNote: "聚合平台，付费模型价格与各厂商官网一致" },
  deepseek:    { hasFree: false, priceNote: "提供 DeepSeek-V3 / R1 等模型，具体价格请查看官网" },
  moonshot:    { hasFree: false, priceNote: "提供不同上下文长度模型，具体价格请查看官网" },
  qwen:        { hasFree: false, priceNote: "提供 Turbo / Plus / Max 等多档模型，具体价格请查看官网" },
  doubao:      { hasFree: false, priceNote: "提供 Lite / Pro 等多档模型，具体价格请查看官网" },
  hunyuan:     { hasFree: false, priceNote: "多档模型可选，具体价格请查看官网" },
  spark:       { hasFree: false, priceNote: "多档模型可选，具体价格请查看官网" },
  baichuan:    { hasFree: false, priceNote: "提供 Turbo 等多档模型，具体价格请查看官网" },
  stepfun:     { hasFree: false, priceNote: "提供多档模型，具体价格请查看官网" },
  lingyi:      { hasFree: false, priceNote: "提供 Lightning / Medium / Large 等多档模型，具体价格请查看官网" },
  siliconflow: { hasFree: false, priceNote: "多种开源模型可选，更多模型请查看官网" },
};

// direct: true  = OpenClaw 原生支持，配完即用
// direct: false = 需先在 OpenRouter 里开通对应模型，再填 OpenRouter Key
export const AI_PROVIDERS = [
  { id: "zai",         direct: true,  label: "智谱 AI / ZAI (GLM)",    placeholder: "...",          registerUrl: "https://open.bigmodel.cn/usercenter/apikeys",                            tip: "获取 API Key 后配置即可使用" },
  { id: "minimax",     direct: true,  label: "MiniMax（海螺）",         placeholder: "...",          registerUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key", tip: "获取 API Key 后配置即可使用" },
  { id: "anthropic",   direct: true,  label: "Anthropic (Claude)",      placeholder: "sk-ant-api03-...", registerUrl: "https://console.anthropic.com/",                                  tip: "需在官网注册并获取 API Key" },
  { id: "openai",      direct: true,  label: "OpenAI (GPT)",            placeholder: "sk-proj-...",  registerUrl: "https://platform.openai.com/api-keys",                               tip: "需在官网注册并获取 API Key" },
  { id: "openrouter",  direct: true,  label: "OpenRouter（聚合平台）",  placeholder: "sk-or-v1-...", registerUrl: "https://openrouter.ai/keys",                                          tip: "一个 Key 可用 DeepSeek/Claude/GPT 等多种模型" },
  { id: "deepseek",    direct: false, label: "DeepSeek（深度求索）",    placeholder: "sk-...",       registerUrl: "https://platform.deepseek.com/api_keys",                             tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "moonshot",    direct: false, label: "Moonshot / Kimi",         placeholder: "sk-...",       registerUrl: "https://platform.moonshot.cn/console/api-keys",                     tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "qwen",        direct: false, label: "阿里通义千问 (Qwen)",     placeholder: "sk-...",       registerUrl: "https://bailian.console.aliyun.com/",                                tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "doubao",      direct: false, label: "字节豆包 (Doubao)",       placeholder: "...",          registerUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",    tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "hunyuan",     direct: false, label: "腾讯混元 (Hunyuan)",      placeholder: "sk-...",       registerUrl: "https://console.cloud.tencent.com/hunyuan/api-key",                  tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "spark",       direct: false, label: "讯飞星火 (Spark)",        placeholder: "...",          registerUrl: "https://xinghuo.xfyun.cn/sparkapi",                                  tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "baichuan",    direct: false, label: "百川智能 (Baichuan)",     placeholder: "sk-...",       registerUrl: "https://platform.baichuan-ai.com/console/apikey",                    tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "stepfun",     direct: false, label: "阶跃星辰 (Step)",         placeholder: "sk-...",       registerUrl: "https://platform.stepfun.com/interface-key",                         tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "lingyi",      direct: false, label: "零一万物 (Yi)",           placeholder: "...",          registerUrl: "https://platform.lingyiwanwu.com/apikeys",                           tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
  { id: "siliconflow", direct: false, label: "硅基流动 (SiliconFlow)",  placeholder: "sk-...",       registerUrl: "https://cloud.siliconflow.cn/account/ak",                            tip: "需通过 OpenRouter 中转使用，建议直接配置 OpenRouter Key" },
] as const;

export const FEATURED_IDS = FEATURED_AI.map((f) => f.id as string);

// Providers whose models natively accept audio input (multimodal).
// Used to decide: send raw audio vs fall back to local STT.
export const AUDIO_CAPABLE_PROVIDERS = new Set([
  "openai",
  "google",
  "anthropic",
]);

export function isAudioCapable(provider: string): boolean {
  return AUDIO_CAPABLE_PROVIDERS.has(provider);
}
