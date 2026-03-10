/**
 * Unit tests for the TF-IDF cosine similarity search engine in ragStore.
 * We test the pure functions (tokenise, tf, cosine) by extracting their
 * logic here — no database required.
 */
import { describe, it, expect } from "vitest";

// ── Replicate the pure helpers from ragStore.ts ─────────────────────────────
// (Kept as local copies so this test file has zero side-effects.)

function tokenise(text: string): string[] {
  const tokens: string[] = [];
  for (const m of text.toLowerCase().matchAll(/[a-z0-9_\-]{2,}/g)) {
    tokens.push(m[0]!);
  }
  const cjk = text.replace(/[^\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) {
    tokens.push(cjk[i]! + cjk[i + 1]!);
  }
  return tokens;
}

function tf(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  const total = tokens.length || 1;
  freq.forEach((v, k) => freq.set(k, v / total));
  return freq;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, normA = 0, normB = 0;
  a.forEach((v, k) => { dot += v * (b.get(k) ?? 0); normA += v * v; });
  b.forEach((v) => { normB += v * v; });
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("tokenise", () => {
  it("extracts latin words", () => {
    expect(tokenise("hello world")).toContain("hello");
    expect(tokenise("hello world")).toContain("world");
  });

  it("ignores single characters", () => {
    expect(tokenise("a b c d")).toHaveLength(0);
  });

  it("extracts CJK bigrams", () => {
    const tokens = tokenise("人工智能");
    expect(tokens).toContain("人工");
    expect(tokens).toContain("工智");
    expect(tokens).toContain("智能");
  });

  it("handles mixed Chinese and English", () => {
    const tokens = tokenise("AI人工智能");
    expect(tokens).toContain("ai");
    expect(tokens).toContain("人工");
  });

  it("is case-insensitive for latin", () => {
    const tokens = tokenise("JavaScript TypeScript");
    expect(tokens).toContain("javascript");
    expect(tokens).toContain("typescript");
  });
});

describe("cosine similarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const v = tf(tokenise("hello world"));
    expect(cosine(v, v)).toBeCloseTo(1.0, 5);
  });

  it("returns 0.0 for completely disjoint vectors", () => {
    const a = tf(tokenise("apple banana"));
    const b = tf(tokenise("猫狗兔子"));
    expect(cosine(a, b)).toBeCloseTo(0.0, 5);
  });

  it("returns 0.0 for empty vectors", () => {
    expect(cosine(new Map(), new Map())).toBe(0);
  });

  it("higher similarity for related text", () => {
    const query   = tf(tokenise("如何部署人工智能"));
    const related = tf(tokenise("人工智能部署指南，介绍如何在服务器上运行模型"));
    const unrelated = tf(tokenise("今天的午餐是什么，建议吃米饭"));
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });

  it("is symmetric", () => {
    const a = tf(tokenise("machine learning model"));
    const b = tf(tokenise("deep learning neural network model"));
    expect(cosine(a, b)).toBeCloseTo(cosine(b, a), 10);
  });
});
