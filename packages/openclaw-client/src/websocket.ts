import type { WebSocketMessage } from "./types.js";

export type WSMessageHandler = (msg: WebSocketMessage) => void;
export type WSErrorHandler = (err: Event) => void;

export class OpenClawWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Map<string, WSMessageHandler[]> = new Map();
  private onErrorHandler?: WSErrorHandler;
  private reconnectDelay = 2_000;
  private maxReconnectDelay = 30_000;
  private shouldReconnect = true;

  constructor(gatewayBaseUrl: string) {
    this.url = gatewayBaseUrl.replace(/^http/, "ws") + "/ws";
  }

  connect(): void {
    this.shouldReconnect = true;
    this._connect();
  }

  private _connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectDelay = 2_000;
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as WebSocketMessage;
        const typeHandlers = this.handlers.get(msg.type) ?? [];
        const wildcardHandlers = this.handlers.get("*") ?? [];
        for (const h of [...typeHandlers, ...wildcardHandlers]) {
          h(msg);
        }
      } catch {
        // skip malformed messages
      }
    };

    this.ws.onerror = (err: Event) => {
      this.onErrorHandler?.(err);
    };

    this.ws.onclose = () => {
      if (!this.shouldReconnect) return;
      setTimeout(() => {
        this.reconnectDelay = Math.min(
          this.reconnectDelay * 2,
          this.maxReconnectDelay,
        );
        this._connect();
      }, this.reconnectDelay);
    };
  }

  on(type: string, handler: WSMessageHandler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  off(type: string, handler: WSMessageHandler): void {
    const list = this.handlers.get(type) ?? [];
    this.handlers.set(
      type,
      list.filter((h) => h !== handler),
    );
  }

  onError(handler: WSErrorHandler): void {
    this.onErrorHandler = handler;
  }

  send(msg: WebSocketMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
