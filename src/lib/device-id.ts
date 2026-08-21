const KEY = "relievo.device-id";

/** Stable per-browser identifier used for "remember this device" at 2FA sign-in. */
export function getDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(KEY);
  if (!id || id.length < 16) {
    id = crypto.randomUUID() + crypto.randomUUID().slice(0, 8);
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

export function getDeviceLabel(): string {
  if (typeof navigator === "undefined") return "Browser";
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Mac OS X/.test(ua)
      ? "macOS"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iOS"
          : "Unknown OS";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Safari\//.test(ua)
        ? "Safari"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : "Browser";
  return `${browser} · ${os}`;
}
