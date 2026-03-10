import { describe, it, expect } from "vitest";
import { detectPii, redactPii } from "../store/piiFilter";

describe("detectPii", () => {
  it("detects Chinese phone numbers", () => {
    const matches = detectPii("联系我：13812345678");
    expect(matches).toHaveLength(1);
    expect(matches[0]!.type).toBe("PHONE");
    expect(matches[0]!.original).toBe("13812345678");
  });

  it("does not match 10-digit numbers", () => {
    expect(detectPii("1234567890")).toHaveLength(0);
  });

  it("detects email addresses", () => {
    const matches = detectPii("send to user@example.com please");
    expect(matches.some((m) => m.type === "EMAIL")).toBe(true);
  });

  it("detects sk- API keys", () => {
    const key = "sk-" + "a".repeat(25);
    const matches = detectPii(`key=${key}`);
    expect(matches.some((m) => m.type === "API_KEY")).toBe(true);
  });

  it("detects 18-digit Chinese ID cards", () => {
    const matches = detectPii("身份证：110101199003071234");
    expect(matches.some((m) => m.type === "ID_CARD")).toBe(true);
  });

  it("returns empty for clean text", () => {
    expect(detectPii("今天天气真好！")).toHaveLength(0);
  });

  it("sorts matches by start position", () => {
    const matches = detectPii("13812345678 and user@foo.com");
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i]!.start).toBeGreaterThanOrEqual(matches[i - 1]!.start);
    }
  });
});

describe("redactPii", () => {
  it("replaces phone with placeholder", () => {
    const { redacted } = redactPii("电话：13812345678");
    expect(redacted).toContain("[PHONE_");
    expect(redacted).not.toContain("13812345678");
  });

  it("leaves clean text unchanged", () => {
    const { redacted, matches } = redactPii("hello world");
    expect(redacted).toBe("hello world");
    expect(matches).toHaveLength(0);
  });

  it("replaces multiple PII types in one pass", () => {
    const input = "email: a@b.com phone: 13812345678";
    const { redacted } = redactPii(input);
    expect(redacted).not.toContain("a@b.com");
    expect(redacted).not.toContain("13812345678");
  });

  it("preserves text around redacted segments", () => {
    const { redacted } = redactPii("前缀 13812345678 后缀");
    expect(redacted).toMatch(/^前缀 \[PHONE_\d+\] 后缀$/);
  });
});
