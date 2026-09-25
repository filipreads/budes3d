/**
 * Studio session rules, kept free of React/Supabase so they can be tested.
 *
 * Every studio visit starts a fresh session. A previous project may only come
 * back when the customer explicitly confirms it, and a finished model is never
 * restored into a new session (it lives under "My projects").
 */

export const PROJECT_KEY = "relievo:project";
export const SESSION_KEY = "relievo:session";
export const CHECKOUT_KEY = "relievo:checkout";

export type ResumeCandidate = {
  projectId: string;
  stage: string;
  done: boolean;
  modelRef: string | null;
};

export type ResumeDecision = "ignore" | "prompt" | "failed";

/** What the studio may do with a job it found on entry. Never auto-restores. */
export function decideResume(job: ResumeCandidate | null): ResumeDecision {
  if (!job) return "ignore";
  if (job.stage === "failed") return "failed";
  // Finished runs are never re-opened as a new session.
  if (job.done || job.stage === "ready") return "ignore";
  return "prompt";
}

export function newSessionId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type CheckoutBinding = { sessionId: string; projectId: string; modelRef: string };

export type BindingProblem = "missing" | "session" | "project" | "model" | null;

/**
 * Validates that what checkout is about to bill is the model the customer
 * approved in this studio session.
 */
export function checkBinding(input: {
  binding: CheckoutBinding | null;
  sessionId: string | null;
  projectId: string | null;
  projectModelUrl?: string | null;
}): BindingProblem {
  const { binding, sessionId, projectId } = input;
  if (!binding || !projectId) return "missing";
  if (!sessionId || binding.sessionId !== sessionId) return "session";
  if (binding.projectId !== projectId) return "project";
  if (input.projectModelUrl !== undefined && input.projectModelUrl !== binding.modelRef) return "model";
  return null;
}

export function parseBinding(raw: string | null): CheckoutBinding | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CheckoutBinding>;
    if (typeof v.sessionId === "string" && typeof v.projectId === "string" && typeof v.modelRef === "string") {
      return { sessionId: v.sessionId, projectId: v.projectId, modelRef: v.modelRef };
    }
  } catch {
    /* ignore */
  }
  return null;
}
