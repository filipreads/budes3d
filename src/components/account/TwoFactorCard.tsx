import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { countTrustedDevices, forgetTrustedDevices } from "@/lib/mfa-devices.functions";

type Enrolling = { factorId: string; qr: string; secret: string };

export function TwoFactorCard() {
  const { t } = useI18n();
  const [factors, setFactors] = useState<{ id: string; status: string }[]>([]);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [trustedCount, setTrustedCount] = useState(0);


  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []).map((factor) => ({ id: factor.id, status: factor.status })));
    try {
      const { count } = await countTrustedDevices();
      setTrustedCount(count);
    } catch {
      setTrustedCount(0);
    }
  }, []);

  async function forgetDevices() {
    setBusy(true);
    try {
      await forgetTrustedDevices();
      await refresh();
      toast.success(t("mfa.forgotten"));
    } catch {
      toast.error(t("mfa.failed"));
    } finally {
      setBusy(false);
    }
  }


  useEffect(() => {
    void refresh();
  }, [refresh]);

  const verified = factors.find((factor) => factor.status === "verified") ?? null;

  async function startEnroll() {
    setBusy(true);
    try {
      // Clear any half-finished factor so re-enrolling never hits a name clash.
      for (const factor of factors.filter((f) => f.status !== "verified")) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `authenticator-${Date.now()}`,
      });
      if (error || !data) throw error ?? new Error("enroll failed");
      setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
      setCode("");
    } catch {
      toast.error(t("mfa.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll() {
    if (!enrolling || code.trim().length < 6) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrolling.factorId,
      code: code.trim(),
    });
    setBusy(false);
    if (error) {
      toast.error(t("mfa.invalidCode"));
      return;
    }
    setEnrolling(null);
    setCode("");
    await refresh();
    toast.success(t("mfa.enrolled"));
  }

  async function cancelEnroll() {
    if (enrolling) await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId });
    setEnrolling(null);
    setCode("");
    await refresh();
  }

  async function disable() {
    if (!verified) return;
    setBusy(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: verified.id });
    setBusy(false);
    if (error) {
      toast.error(t("mfa.failed"));
      return;
    }
    await refresh();
    toast.success(t("mfa.removed"));
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex items-start gap-3">
          {verified ? (
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          ) : (
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <div className="min-w-0 space-y-1">
            <h2 className="font-display text-base sm:text-lg">{t("mfa.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("mfa.subtitle")}</p>
            <p className="text-sm font-medium">{verified ? t("mfa.enabled") : t("mfa.disabled")}</p>
          </div>
        </div>

        {verified ? (
          <div className="space-y-3">
            <Button variant="secondary" className="w-full sm:w-auto" disabled={busy} onClick={() => void disable()}>
              {t("mfa.disable")}
            </Button>
            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-medium">{t("mfa.trustedDevices")}</p>
              <p className="text-sm text-muted-foreground">{t("mfa.trustedCount", { count: trustedCount })}</p>
              {trustedCount > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 px-0"
                  disabled={busy}
                  onClick={() => void forgetDevices()}
                >
                  {t("mfa.forgetDevices")}
                </Button>
              ) : null}
            </div>
          </div>

        ) : enrolling ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("mfa.scan")}</p>
            <img
              src={enrolling.qr}
              alt=""
              className="size-36 rounded-md border border-border bg-white p-2 sm:size-44"
            />
            <p className="break-all text-xs text-muted-foreground">
              {t("mfa.secret")}: <code className="font-mono">{enrolling.secret}</code>
            </p>
            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="mfa-code">{t("mfa.code")}</Label>
              <Input
                id="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="w-full sm:w-auto"
                disabled={busy || code.length < 6}
                onClick={() => void confirmEnroll()}
              >
                {t("mfa.verify")}
              </Button>
              <Button variant="ghost" className="w-full sm:w-auto" disabled={busy} onClick={() => void cancelEnroll()}>
                {t("mfa.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <Button className="w-full sm:w-auto" disabled={busy} onClick={() => void startEnroll()}>
            {t("mfa.enable")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
