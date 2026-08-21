import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search["redirect"] === "string" ? (search["redirect"] as string) : "",
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Relievo Studio" },
      { name: "description", content: "Sign in to save portrait projects, approve 3D previews and manage orders." },
      { property: "og:title", content: "Sign in — Relievo Studio" },
      { property: "og:description", content: "Access your 3D portrait projects and orders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: "/auth" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

  const safeRedirect = redirect.startsWith("/") ? redirect : "/editor";

  /** Returns true when a second factor is required (and shows the code step). */
  async function requiresSecondFactor() {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!data || data.currentLevel === data.nextLevel || data.nextLevel !== "aal2") return false;
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const factor = (factors?.totp ?? []).find((item) => item.status === "verified");
    if (!factor) return false;
    setMfaFactorId(factor.id);
    setMfaCode("");
    return true;
  }

  async function signIn() {
    setBusy(true);
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
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: mfaFactorId,
      code: mfaCode,
    });
    setBusy(false);
    if (error) { toast.error("Invalid code"); return; }
    setMfaFactorId(null);
    void navigate({ to: safeRedirect });
  }

  async function signUp() {
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}${safeRedirect}` },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Account created — you're signed in.");
    void navigate({ to: safeRedirect });
  }

  async function google() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) { toast.error("Google sign-in failed"); return; }
    if (result.redirected) return;
    if (await requiresSecondFactor()) return;
    void navigate({ to: safeRedirect });
  }


  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 items-center px-5 py-14">
        <Card className="w-full">
          <CardContent className="p-7">
            {mfaFactorId ? (
              <div className="space-y-4">
                <h1 className="font-display text-2xl">Enter your authentication code</h1>
                <p className="text-sm text-muted-foreground">
                  Open your authenticator app and enter the current 6-digit code.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="mfa-signin-code">6-digit code</Label>
                  <Input
                    id="mfa-signin-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <Button className="w-full" disabled={busy || mfaCode.length < 6} onClick={() => void verifyMfa()}>
                  Continue
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setMfaFactorId(null);
                    void supabase.auth.signOut();
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <>
            <h1 className="font-display text-2xl">Welcome to the studio</h1>

            <p className="mt-1 text-sm text-muted-foreground">Sign in to save projects and place orders.</p>

            <Button variant="outline" className="mt-6 w-full" onClick={() => void google()}>
              Continue with Google
            </Button>

            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> or email <span className="h-px flex-1 bg-border" />
            </div>

            <Tabs defaultValue="signin">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Create account</TabsTrigger>
              </TabsList>
              <div className="mt-5 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
              </div>
              <TabsContent value="signin">
                <Button className="mt-5 w-full" disabled={busy} onClick={() => void signIn()}>
                  Sign in
                </Button>
              </TabsContent>
              <TabsContent value="signup">
                <Button className="mt-5 w-full" disabled={busy} onClick={() => void signUp()}>
                  Create account
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
