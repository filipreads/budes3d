import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { getDeviceId, getDeviceLabel } from "@/lib/device-id";
import { isDeviceTrusted, trustDevice } from "@/lib/mfa-devices.functions";
import { getStaySignedIn, setStaySignedIn } from "@/lib/session-persistence";
import { useI18n, type TranslationKey } from "@/lib/i18n";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search["redirect"] === "string" ? (search["redirect"] as string) : "",
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Relievo Studio" },
      { name: "description", content: "Sign in with Apple, Google or email to save portrait projects, approve 3D previews and manage orders." },
      { property: "og:title", content: "Sign in — Relievo Studio" },
      { property: "og:description", content: "Access your 3D portrait projects and orders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 384 512" className={className} fill="currentColor" aria-hidden focusable="false">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.7l4-3z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.4.6 4.6 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
    </svg>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { redirect } = useSearch({ from: "/auth" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<"apple" | "google" | null>(null);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [remember, setRemember] = useState(true);
  const [stay, setStay] = useState(() => getStaySignedIn());

  const safeRedirect = redirect.startsWith("/") ? redirect : "/editor";

  function persistChoice(next: boolean) {
    setStay(next);
    setStaySignedIn(next);
  }

  /** Returns true when a second factor is required (and shows the code step). */
  async function requiresSecondFactor() {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!data || data.currentLevel === data.nextLevel || data.nextLevel !== "aal2") return false;
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = (factors?.totp ?? []).find((item) => item.status === "verified");
    if (!factor) return false;
    try {
      const { trusted } = await isDeviceTrusted({ data: { deviceId: getDeviceId() } });
      if (trusted) return false;
    } catch {
      /* fall through to the code prompt */
    }
    setMfaFactorId(factor.id);
    setMfaCode("");
    return true;
  }

  async function signIn() {
    setBusy(true);
    setStaySignedIn(stay);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setBusy(false); toast.error(error.message); return; }
    const needsCode = await requiresSecondFactor();
    setBusy(false);
    if (needsCode) return;
    void navigate({ to: safeRedirect });
  }

  async function verifyMfa() {
    if (!mfaFactorId || mfaCode.length < 6) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfaFactorId, code: mfaCode });
    if (error) { setBusy(false); toast.error(t("mfa.invalidCode")); return; }
    if (remember) {
      try {
        await trustDevice({ data: { deviceId: getDeviceId(), label: getDeviceLabel() } });
      } catch {
        /* remembering is best-effort */
      }
    }
    setBusy(false);
    setMfaFactorId(null);
    void navigate({ to: safeRedirect });
  }

  async function signUp() {
    setBusy(true);
    setStaySignedIn(stay);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}${safeRedirect}` },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("auth.created"));
    void navigate({ to: safeRedirect });
  }

  async function oauth(name: "apple" | "google") {
    setProvider(name);
    setStaySignedIn(stay);
    const result = await lovable.auth.signInWithOAuth(name, { redirect_uri: window.location.origin });
    if (result.error) {
      setProvider(null);
      toast.error(t(name === "apple" ? "auth.appleFailed" : "auth.googleFailed"));
      return;
    }
    if (result.redirected) return;
    setProvider(null);
    if (await requiresSecondFactor()) return;
    void navigate({ to: safeRedirect });
  }

  const points: TranslationKey[] = ["auth.point1", "auth.point2", "auth.point3"];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-5 py-10 md:py-16 lg:grid-cols-[1fr_minmax(0,26rem)]">
        <section className="hidden lg:block">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Relievo Studio</p>
          <h2 className="mt-3 font-display text-4xl leading-tight">{t("auth.welcome")}</h2>
          <p className="mt-3 max-w-md text-sm text-muted-foreground">{t("auth.lead")}</p>
          <ul className="mt-7 space-y-3">
            {points.map((key) => (
              <li key={key} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
                  <Check className="size-3" aria-hidden />
                </span>
                {t(key)}
              </li>
            ))}
          </ul>
        </section>

        <Card className="w-full border-border/70 shadow-lg shadow-black/5">
          <CardContent className="p-6 sm:p-7">
            {mfaFactorId ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-primary">
                  <ShieldCheck className="size-5" aria-hidden />
                  <h1 className="font-display text-xl sm:text-2xl">{t("auth.mfaTitle")}</h1>
                </div>
                <p className="text-sm text-muted-foreground">{t("auth.mfaHint")}</p>
                <div className="space-y-1.5">
                  <Label htmlFor="mfa-signin-code">{t("auth.mfaCode")}</Label>
                  <Input
                    id="mfa-signin-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    className="text-center text-lg tracking-[0.4em]"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-primary"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  <span>
                    {t("mfa.rememberDevice")}
                    <span className="block text-xs text-muted-foreground">{t("mfa.rememberHint")}</span>
                  </span>
                </label>
                <Button className="w-full" disabled={busy || mfaCode.length < 6} onClick={() => void verifyMfa()}>
                  {busy ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
                  {t("auth.continue")}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setMfaFactorId(null);
                    void supabase.auth.signOut();
                  }}
                >
                  {t("auth.cancel")}
                </Button>
              </div>
            ) : (
              <>
                <h1 className="font-display text-2xl lg:hidden">{t("auth.welcome")}</h1>
                <p className="mt-1 text-sm text-muted-foreground lg:hidden">{t("auth.lead")}</p>

                <div className="mt-5 space-y-2.5 lg:mt-0">
                  <Button
                    variant="outline"
                    className="h-11 w-full justify-center gap-2.5"
                    disabled={provider !== null}
                    onClick={() => void oauth("apple")}
                  >
                    {provider === "apple" ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <AppleIcon className="size-4" />
                    )}
                    {t("auth.apple")}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 w-full justify-center gap-2.5"
                    disabled={provider !== null}
                    onClick={() => void oauth("google")}
                  >
                    {provider === "google" ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <GoogleIcon className="size-4" />
                    )}
                    {t("auth.google")}
                  </Button>
                </div>

                <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  <span className="whitespace-nowrap">{t("auth.orEmail")}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>

                <Tabs defaultValue="signin">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="signin">{t("auth.signinTab")}</TabsTrigger>
                    <TabsTrigger value="signup">{t("auth.signupTab")}</TabsTrigger>
                  </TabsList>
                  <div className="mt-5 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="email">{t("auth.emailLabel")}</Label>
                      <Input
                        id="email"
                        type="email"
                        autoComplete="email"
                        className="h-11"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="password">{t("auth.passwordLabel")}</Label>
                      <Input
                        id="password"
                        type="password"
                        autoComplete="current-password"
                        className="h-11"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </div>
                    <label className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-primary"
                        checked={stay}
                        onChange={(e) => persistChoice(e.target.checked)}
                      />
                      <span>
                        {t("auth.stay")}
                        <span className="block text-xs text-muted-foreground">{t("auth.stayHint")}</span>
                      </span>
                    </label>
                  </div>
                  <TabsContent value="signin">
                    <Button className="mt-4 h-11 w-full" disabled={busy} onClick={() => void signIn()}>
                      {busy ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
                      {t("auth.signinTab")}
                    </Button>
                  </TabsContent>
                  <TabsContent value="signup">
                    <Button className="mt-4 h-11 w-full" disabled={busy} onClick={() => void signUp()}>
                      {busy ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
                      {t("auth.signupTab")}
                    </Button>
                  </TabsContent>
                </Tabs>

                <p className="mt-5 text-center text-xs text-muted-foreground">
                  <Link to="/help" className="underline underline-offset-2 hover:text-foreground">
                    {t("nav.help")}
                  </Link>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
