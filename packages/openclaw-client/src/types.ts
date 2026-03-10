// OpenClaw Gateway API types

export interface GatewayHealth {
  status: "ok" | "error";
  version: string;
  uptime: number;
}

export interface Session {
  id: string;
  channel: string;
  agentId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  model: string;
  systemPrompt?: string;
}

export interface GatewayConfig {
  agents: Agent[];
  channels: Record<string, unknown>;
  settings: Record<string, unknown>;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  agentId?: string;
  sessionId?: string;
  stream?: boolean;
  model?: string;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

export interface ChatCompletion {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenClawClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
  /** Custom fetch implementation (e.g. Tauri HTTP plugin) to bypass CORS. */
  fetchFn?: typeof fetch;
}

export type StreamChunkCallback = (chunk: ChatCompletionChunk) => void;
export type StreamDoneCallback = (fullText: string) => void;
export type StreamErrorCallback = (error: Error) => void;

export interface WebSocketMessage {
  type: string;
  sessionId?: string;
  data?: unknown;
}
