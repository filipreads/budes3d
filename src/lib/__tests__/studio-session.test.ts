import { describe, expect, it } from "vitest";
import { checkBinding, decideResume, newSessionId, parseBinding } from "../studio-session";

describe("studio resume", () => {
  it("never restores a finished model as a new session", () => {
    expect(decideResume({ projectId: "p", stage: "ready", done: true, modelRef: "u/p.glb" })).toBe("ignore");
    expect(decideResume({ projectId: "p", stage: "ready", done: false, modelRef: "u/p.glb" })).toBe("ignore");
    expect(decideResume({ projectId: "p", stage: "storing", done: true, modelRef: "u/p.glb" })).toBe("ignore");
  });
  it("asks before resuming a running job", () => {
    expect(decideResume({ projectId: "p", stage: "sculpting", done: false, modelRef: null })).toBe("prompt");
  });
  it("handles empty and failed", () => {
    expect(decideResume(null)).toBe("ignore");
    expect(decideResume({ projectId: "p", stage: "failed", done: false, modelRef: null })).toBe("failed");
  });
  it("creates distinct session ids", () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });
});

describe("checkout binding", () => {
  const binding = { sessionId: "s1", projectId: "p1", modelRef: "u/p1.glb" };
  it("accepts a matching binding", () => {
    expect(checkBinding({ binding, sessionId: "s1", projectId: "p1", projectModelUrl: "u/p1.glb" })).toBeNull();
  });
  it("rejects mismatches", () => {
    expect(checkBinding({ binding: null, sessionId: "s1", projectId: "p1" })).toBe("missing");
    expect(checkBinding({ binding, sessionId: "s2", projectId: "p1" })).toBe("session");
    expect(checkBinding({ binding, sessionId: "s1", projectId: "old" })).toBe("project");
    expect(checkBinding({ binding, sessionId: "s1", projectId: "p1", projectModelUrl: "u/other.glb" })).toBe("model");
  });
  it("parses safely", () => {
    expect(parseBinding("nope")).toBeNull();
    expect(parseBinding(JSON.stringify(binding))).toEqual(binding);
  });
});
