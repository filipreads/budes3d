import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, type Locale } from "@/lib/i18n";
import { getAccountProfile, updateAccountProfile } from "@/lib/account.functions";
import { TwoFactorCard } from "@/components/account/TwoFactorCard";

export const Route = createFileRoute("/account/settings")({
  head: () => ({
    meta: [
      { title: "Profile settings — Relievo Studio" },
      { name: "description", content: "Update your display name, avatar, language, email and password." },
      { property: "og:title", content: "Profile settings — Relievo Studio" },
      { property: "og:description", content: "Manage your Relievo Studio profile and sign-in details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsTab,
});

function SettingsTab() {
  const { user, signOut } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({
    queryKey: ["account-profile", user?.id],
    queryFn: () => getAccountProfile(),
    enabled: Boolean(user),
    staleTime: 5 * 60 * 1000,
  });

  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    if (data) setDisplayName(data.displayName);
  }, [data]);

  async function saveProfile(patch: { displayName?: string; preferredLocale?: string; avatarPath?: string }) {
    setSaving(true);
    try {
      await updateAccountProfile({ data: patch });
      await queryClient.invalidateQueries({ queryKey: ["account-profile", user?.id] });
      await queryClient.invalidateQueries({ queryKey: ["account-summary", user?.id] });
      toast.success(t("account.saved"));
    } catch {
      toast.error(t("account.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function onAvatar(file: File) {
    if (!user) return;
    setSaving(true);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${user.id}/avatar/${Date.now()}.${extension}`;
      const { error } = await supabase.storage.from("portrait-uploads").upload(path, file, { upsert: true });
      if (error) throw error;
      await saveProfile({ avatarPath: path });
    } catch {
      toast.error(t("account.saveFailed"));
      setSaving(false);
    }
  }

  async function changeEmail() {
    if (!newEmail.trim()) return;
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    if (error) toast.error(error.message);
    else {
      toast.success(t("account.emailSent"));
      setNewEmail("");
    }
  }

  async function changePassword() {
    if (newPassword.length < 8) {
      toast.error(t("account.passwordShort"));
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) toast.error(error.message);
    else {
      toast.success(t("account.passwordChanged"));
      setNewPassword("");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-5">
          <h2 className="font-display text-lg">{t("account.profile")}</h2>

          <div className="flex items-center gap-4">
            {data?.avatarUrl ? (
              <img src={data.avatarUrl} alt="" className="size-16 rounded-full object-cover" />
            ) : (
              <span className="grid size-16 place-items-center rounded-full bg-muted font-display text-xl">
                {(displayName || data?.email || "?").charAt(0).toUpperCase()}
              </span>
            )}
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onAvatar(file);
                }}
              />
              <Button variant="secondary" size="sm" disabled={saving} onClick={() => fileRef.current?.click()}>
                {t("account.uploadAvatar")}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">{t("account.avatarHint")}</p>
            </div>
          </div>

          <div className="grid gap-2 sm:max-w-sm">
            <Label htmlFor="display-name">{t("account.displayName")}</Label>
            <Input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </div>

          <div className="grid gap-2 sm:max-w-sm">
            <Label htmlFor="locale">{t("account.language")}</Label>
            <select
              id="locale"
              value={locale}
              onChange={(event) => {
                const next = event.target.value as Locale;
                setLocale(next);
                void saveProfile({ preferredLocale: next });
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="en">English</option>
              <option value="cs">Čeština</option>
            </select>
          </div>

          <Button disabled={saving} onClick={() => void saveProfile({ displayName })}>
            {t("account.save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <h2 className="font-display text-lg">{t("account.signInDetails")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("account.email")}: {data?.email}
          </p>

          <div className="grid gap-2 sm:max-w-sm">
            <Label htmlFor="new-email">{t("account.newEmail")}</Label>
            <Input
              id="new-email"
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              autoComplete="email"
            />
            <Button variant="secondary" onClick={() => void changeEmail()}>
              {t("account.changeEmail")}
            </Button>
          </div>

          <div className="grid gap-2 sm:max-w-sm">
            <Label htmlFor="new-password">{t("account.newPassword")}</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
            <Button variant="secondary" onClick={() => void changePassword()}>
              {t("account.changePassword")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <TwoFactorCard />

      <Card>

        <CardContent className="space-y-3 p-5">
          <p className="text-sm text-muted-foreground">{t("account.dataNote")}</p>
          <Button variant="ghost" onClick={() => void signOut()}>
            {t("nav.signout")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
