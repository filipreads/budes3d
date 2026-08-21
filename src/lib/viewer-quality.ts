export type ViewerQuality = "high" | "low";
/** What the customer picked: "auto" defers to device detection. */
export type ViewerQualityPreference = "auto" | ViewerQuality;

const STORAGE_KEY = "relievo:viewer-quality";

/** Reads the manual preference the customer stored (defaults to automatic). */
export function getViewerQualityPreference(): ViewerQualityPreference {
  if (typeof window === "undefined") return "auto";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "low" || stored === "high" || stored === "auto") return stored;
  } catch {
    /* private mode */
  }
  return "auto";
}

/**
 * Picks a sensible default for the 3D stage. Phones, low-core or low-memory
 * devices and users who asked for reduced motion start in the light preset so
 * the first frame arrives fast instead of stuttering.
 */
export function detectViewerQuality(): ViewerQuality {
  if (typeof window === "undefined") return "high";

  const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number };
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const narrow = window.innerWidth < 900;
  const lowMemory = typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4;
  const fewCores = typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  return (coarse && narrow) || lowMemory || fewCores || reducedMotion ? "low" : "high";
}

/** The preset actually used: the manual choice, or detection when set to auto. */
export function resolveViewerQuality(preference = getViewerQualityPreference()): ViewerQuality {
  return preference === "auto" ? detectViewerQuality() : preference;
}

export const VIEWER_QUALITY_EVENT = "relievo:viewer-quality-changed";

export function rememberViewerQuality(preference: ViewerQualityPreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
    window.dispatchEvent(new CustomEvent(VIEWER_QUALITY_EVENT));
  } catch {
    /* private mode — the preset just won't persist */
  }
}


/** Renderer settings per preset. */
export const QUALITY_SETTINGS: Record<ViewerQuality, {
  dpr: [number, number];
  shadows: boolean;
  contactShadows: boolean;
  antialias: boolean;
  autoRotate: boolean;
}> = {
  high: { dpr: [1, 2], shadows: true, contactShadows: true, antialias: true, autoRotate: true },
  low: { dpr: [0.75, 1.25], shadows: false, contactShadows: false, antialias: false, autoRotate: false },
};
