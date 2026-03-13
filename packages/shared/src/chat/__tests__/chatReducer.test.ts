import { describe, it, expect } from "vitest";
import { chatReducer, type ChatState, type ChatAction } from "../useChatEngine";
import type { UIMessage } from "../types";

function mkMsg(overrides: Partial<UIMessage> = {}): UIMessage {
  return { id: "m1", role: "user", content: "hello", ...overrides };
}

const EMPTY: ChatState = { messages: [], isStreaming: false };

describe("chatReducer", () => {
  // ── LOAD ────────────────────────────────────────────────────────────────

  describe("LOAD", () => {
    it("replaces messages and sets isStreaming false", () => {
      const prev: ChatState = { messages: [mkMsg()], isStreaming: true };
      const msgs = [mkMsg({ id: "a" }), mkMsg({ id: "b" })];
      const next = chatReducer(prev, { type: "LOAD", messages: msgs });
      expect(next.messages).toEqual(msgs);
      expect(next.isStreaming).toBe(false);
    });
  });

  // ── CLEAR ───────────────────────────────────────────────────────────────

  describe("CLEAR", () => {
    it("clears messages and stops streaming", () => {
      const prev: ChatState = { messages: [mkMsg()], isStreaming: true };
      const next = chatReducer(prev, { type: "CLEAR" });
      expect(next.messages).toEqual([]);
      expect(next.isStreaming).toBe(false);
    });
  });

  // ── ADD_PAIR ────────────────────────────────────────────────────────────

  describe("ADD_PAIR", () => {
    it("appends user and assistant messages and sets isStreaming true", () => {
      const user = mkMsg({ id: "u1", role: "user", content: "hi" });
      const assistant = mkMsg({ id: "a1", role: "assistant", content: "", streaming: true });
      const next = chatReducer(EMPTY, { type: "ADD_PAIR", userMsg: user, assistantMsg: assistant });
      expect(next.messages).toHaveLength(2);
      expect(next.messages[0]!.id).toBe("u1");
      expect(next.messages[1]!.id).toBe("a1");
      expect(next.isStreaming).toBe(true);
    });

    it("preserves existing messages", () => {
      const prev: ChatState = { messages: [mkMsg({ id: "old" })], isStreaming: false };
      const user = mkMsg({ id: "u2", role: "user" });
      const assistant = mkMsg({ id: "a2", role: "assistant" });
      const next = chatReducer(prev, { type: "ADD_PAIR", userMsg: user, assistantMsg: assistant });
      expect(next.messages).toHaveLength(3);
      expect(next.messages[0]!.id).toBe("old");
    });
  });

  // ── CHUNK ───────────────────────────────────────────────────────────────

  describe("CHUNK", () => {
    it("updates content of the matching message", () => {
      const prev: ChatState = {
        messages: [
          mkMsg({ id: "u1", role: "user" }),
          mkMsg({ id: "a1", role: "assistant", content: "he", streaming: true }),
        ],
        isStreaming: true,
      };
      const next = chatReducer(prev, { type: "CHUNK", id: "a1", text: "hello world" });
      expect(next.messages[1]!.content).toBe("hello world");
      expect(next.isStreaming).toBe(true);
    });

    it("does not affect other messages", () => {
      const prev: ChatState = {
        messages: [
          mkMsg({ id: "u1", role: "user", content: "orig" }),
          mkMsg({ id: "a1", role: "assistant", content: "" }),
        ],
        isStreaming: true,
      };
      const next = chatReducer(prev, { type: "CHUNK", id: "a1", text: "new" });
      expect(next.messages[0]!.content).toBe("orig");
    });
  });

  // ── DONE ────────────────────────────────────────────────────────────────

  describe("DONE", () => {
    it("sets streaming false on the message and isStreaming false", () => {
      const prev: ChatState = {
        messages: [mkMsg({ id: "a1", streaming: true })],
        isStreaming: true,
      };
      const next = chatReducer(prev, { type: "DONE", id: "a1" });
      expect(next.messages[0]!.streaming).toBe(false);
      expect(next.isStreaming).toBe(false);
    });
  });

  // ── ERROR ───────────────────────────────────────────────────────────────

  describe("ERROR", () => {
    it("sets error content, streaming false, and isStreaming false", () => {
      const prev: ChatState = {
        messages: [mkMsg({ id: "a1", content: "", streaming: true })],
        isStreaming: true,
      };
      const next = chatReducer(prev, { type: "ERROR", id: "a1", content: "Something broke" });
      expect(next.messages[0]!.content).toBe("Something broke");
      expect(next.messages[0]!.streaming).toBe(false);
      expect(next.isStreaming).toBe(false);
    });
  });

  // ── STOP_STREAMING ─────────────────────────────────────────────────────

  describe("STOP_STREAMING", () => {
    it("sets isStreaming false without modifying messages", () => {
      const msgs = [mkMsg({ id: "a1", streaming: true })];
      const prev: ChatState = { messages: msgs, isStreaming: true };
      const next = chatReducer(prev, { type: "STOP_STREAMING" });
      expect(next.isStreaming).toBe(false);
      expect(next.messages).toEqual(msgs);
    });
  });

  // ── Immutability ────────────────────────────────────────────────────────

  describe("immutability", () => {
    it("never mutates the previous state", () => {
      const msg = mkMsg({ id: "a1", content: "old", streaming: true });
      const prev: ChatState = { messages: [msg], isStreaming: true };
      const frozen = JSON.parse(JSON.stringify(prev));

      chatReducer(prev, { type: "CHUNK", id: "a1", text: "new" });
      expect(prev).toEqual(frozen);

      chatReducer(prev, { type: "DONE", id: "a1" });
      expect(prev).toEqual(frozen);

      chatReducer(prev, { type: "ERROR", id: "a1", content: "err" });
      expect(prev).toEqual(frozen);
    });
  });
});
