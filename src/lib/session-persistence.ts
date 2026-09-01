import { supabase } from "@/integrations/supabase/client";

/**
 * "Stay signed in" preference.
 *
 * Supabase always persists the session in local storage, so when the customer
 * opts out we treat the session as tab-scoped: a marker is written to
 * sessionStorage on every load, and if a fresh browser session starts without
 * that marker we sign the user out before anything protected renders.
 */
const PREF_KEY = "relievo:stay-signed-in";
const TAB_KEY = "relievo:session-alive";

export function getStaySignedIn(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(PREF_KEY) !== "false";
}

export function setStaySignedIn(value: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PREF_KEY, value ? "true" : "false");
  if (!value) window.sessionStorage.setItem(TAB_KEY, "1");
}

/** Run once on boot, before protected UI reads the session. */
export async function enforceSessionPersistence() {
  if (typeof window === "undefined") return;
  const stay = getStaySignedIn();
  const alive = window.sessionStorage.getItem(TAB_KEY) === "1";
  window.sessionStorage.setItem(TAB_KEY, "1");
  if (stay || alive) return;
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session) await supabase.auth.signOut();
  } catch {
    /* nothing to clean up */
  }
}
