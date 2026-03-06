import { createParser } from "eventsource-parser";
import type {
  Agent,
  ChatCompletionChunk,
  ChatCompletionRequest,
  GatewayConfig,
  GatewayHealth,
  OpenClawClientOptions,
  Session,
  StreamChunkCallback,
  StreamDoneCallback,
  StreamErrorCallback,
} from "./types.js";

export class OpenClawClient {
  private baseUrl: string;
  private apiKey?: string;
  private timeout: number;

  constructor(options: OpenClawClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    if (options.apiKey !== undefined) {
      this.apiKey = options.apiKey;
    }
    this.timeout = options.timeout ?? 30_000;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey !== undefined) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          ...this.buildHeaders(),
          ...(init?.headers as Record<string, string> | undefined),
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      return res.json() as Promise<T>;
    } finally {
      clearTimeout(timer);
    }
  }

  // Health check
  async health(): Promise<GatewayHealth> {
    return this.request<GatewayHealth>("/health");
  }

  // Sessions
  async getSessions(): Promise<Session[]> {
    return this.request<Session[]>("/sessions");
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.request<Session>(`/sessions/${sessionId}`);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request<void>(`/sessions/${sessionId}`, { method: "DELETE" });
  }

  // Agents
  async getAgents(): Promise<Agent[]> {
    return this.request<Agent[]>("/agents");
  }

  // Config
  async getConfig(): Promise<GatewayConfig> {
    return this.request<GatewayConfig>("/config");
  }

  async updateConfig(config: Partial<GatewayConfig>): Promise<GatewayConfig> {
    return this.request<GatewayConfig>("/config", {
      method: "PATCH",
      body: JSON.stringify(config),
    });
  }

  // Streaming chat completion
  async streamChat(
    request: ChatCompletionRequest,
    onChunk: StreamChunkCallback,
    onDone: StreamDoneCallback,
    onError: StreamErrorCallback,
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout * 10);

    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({ ...request, stream: true }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      }

      if (!res.body) {
        throw new Error("Response body is null");
      }

      let fullText = "";
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      const parser = createParser({
        onEvent(event) {
          if (event.data === "[DONE]") return;
          try {
            const chunk = JSON.parse(event.data) as ChatCompletionChunk;
            const delta = chunk.choices[0]?.delta?.content ?? "";
            fullText += delta;
            onChunk(chunk);
          } catch {
            // skip malformed chunks
          }
        },
      });

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }

      onDone(fullText);
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      clearTimeout(timer);
    }
  }

  // Non-streaming chat completion
  async chat(request: ChatCompletionRequest): Promise<string> {
    return new Promise((resolve, reject) => {
      this.streamChat(
        request,
        () => {},
        resolve,
        reject,
      );
    });
  }
}
