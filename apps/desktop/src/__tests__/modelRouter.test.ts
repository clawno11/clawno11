import { describe, it, expect, beforeEach } from "vitest";
import { matchRule, type RoutingRule } from "../store/modelRouter";

const makeRule = (overrides: Partial<RoutingRule> = {}): RoutingRule => ({
  id: crypto.randomUUID(),
  name: "test",
  keywords: ["code", "bug"],
  instanceId: "inst-1",
  priority: 10,
  enabled: true,
  ...overrides,
});

describe("matchRule", () => {
  it("returns null for empty rule list", () => {
    expect(matchRule("hello", [])).toBeNull();
  });

  it("matches a keyword case-insensitively", () => {
    const rule = makeRule({ keywords: ["代码", "CODE"] });
    expect(matchRule("帮我写代码", [rule])).toBe(rule);
    expect(matchRule("write CODE please", [rule])).toBe(rule);
  });

  it("returns null when no keyword matches", () => {
    const rule = makeRule({ keywords: ["python"] });
    expect(matchRule("hello world", [rule])).toBeNull();
  });

  it("skips disabled rules", () => {
    const rule = makeRule({ keywords: ["python"], enabled: false });
    expect(matchRule("python script", [rule])).toBeNull();
  });

  it("evaluates rules in ascending priority order", () => {
    const highPri = makeRule({ keywords: ["debug"], instanceId: "high", priority: 5 });
    const lowPri  = makeRule({ keywords: ["debug"], instanceId: "low",  priority: 20 });
    const result = matchRule("debug this", [lowPri, highPri]);
    expect(result?.instanceId).toBe("high");
  });

  it("OR-matches across multiple keywords in a single rule", () => {
    const rule = makeRule({ keywords: ["python", "rust", "typescript"] });
    expect(matchRule("write a rust function", [rule])).toBe(rule);
    expect(matchRule("typescript interface", [rule])).toBe(rule);
  });

  it("returns the first matching rule when multiple match", () => {
    const r1 = makeRule({ keywords: ["代码"], instanceId: "r1", priority: 1 });
    const r2 = makeRule({ keywords: ["代码"], instanceId: "r2", priority: 2 });
    expect(matchRule("写代码", [r1, r2])?.instanceId).toBe("r1");
  });
});
