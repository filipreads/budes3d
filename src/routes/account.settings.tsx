import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useI18n, type Locale } from "@/lib/i18n";
import { updateAccountProfile, EMPTY_SHIPPING_ADDRESS, type ShippingAddress } from "@/lib/account.functions";
import { useProfile } from "@/hooks/useProfile";
import {
  getViewerQualityPreference,
  rememberViewerQuality,
  type ViewerQualityPreference,
} from "@/lib/viewer-quality";
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

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div>
          <h2 className="font-display text-lg">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function SettingsTab() {
  const { user, signOut } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { profile: data } = useProfile();

  const [displayName, setDisplayName] = useState("");
  const [address, setAddress] = useState<ShippingAddress>(EMPTY_SHIPPING_ADDRESS);
  const [editingAddress, setEditingAddress] = useState(false);
  const [quality, setQuality] = useState<ViewerQualityPreference>("auto");
  const [saving, setSaving] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    if (!data) return;
    setDisplayName(data.displayName);
    setAddress(data.shippingAddress ?? EMPTY_SHIPPING_ADDRESS);
  }, [data]);

  useEffect(() => {
    setQuality(getViewerQualityPreference());
  }, []);

  const addressSummary = [address.name, address.line1, address.city, address.postalCode, address.country]
    .map((value) => (value ?? "").trim())
    .filter(Boolean)
    .join(", ");

  async function saveProfile(patch: {
    displayName?: string;
    preferredLocale?: string;
    avatarPath?: string;
    shippingAddress?: ShippingAddress | null;
  }) {
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
      <Section title={t("account.profile")}>
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

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="display-name">{t("account.displayName")}</Label>
            <Input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </div>
          <div className="grid gap-2">
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
        </div>

        <Button disabled={saving} onClick={() => void saveProfile({ displayName })}>
          {t("account.save")}
        </Button>
      </Section>

      <Section title={t("account.shipping")} description={t("account.shippingHint")}>
        {!editingAddress ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{addressSummary || t("account.addressEmpty")}</p>
            <Button size="sm" variant="secondary" onClick={() => setEditingAddress(true)}>
              {addressSummary ? t("account.editAddress") : t("account.addAddress")}
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["name", "checkout.fullName"],
                  ["line1", "checkout.address"],
                  ["line2", "checkout.address2"],
                  ["city", "checkout.city"],
                  ["postalCode", "checkout.postalCode"],
                  ["country", "checkout.country"],
                  ["phone", "account.phone"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`ship-${key}`}>{t(label)}</Label>
                  <Input
                    id={`ship-${key}`}
                    value={address[key]}
                    onChange={(event) => setAddress({ ...address, [key]: event.target.value })}
                  />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={saving}
                onClick={async () => {
                  await saveProfile({ shippingAddress: address });
                  setEditingAddress(false);
                }}
              >
                {t("account.saveAddress")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setAddress(data?.shippingAddress ?? EMPTY_SHIPPING_ADDRESS);
                  setEditingAddress(false);
                }}
              >
                {t("account.cancel")}
              </Button>
            </div>
          </>
        )}
      </Section>

      <Section title={t("account.security")}>
        <p className="text-sm text-muted-foreground">
          {t("account.email")}: {data?.email}
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="new-email">{t("account.newEmail")}</Label>
            <Input
              id="new-email"
              type="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              autoComplete="email"
            />
            <Button variant="secondary" size="sm" onClick={() => void changeEmail()}>
              {t("account.changeEmail")}
            </Button>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="new-password">{t("account.newPassword")}</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
            <Button variant="secondary" size="sm" onClick={() => void changePassword()}>
              {t("account.changePassword")}
            </Button>
          </div>
        </div>
      </Section>

      <TwoFactorCard />

      <Section title={t("account.viewerQuality")} description={t("account.viewerQualityHint")}>
        <div className="inline-flex rounded-lg border border-border p-1">
          {(
            [
              ["auto", "account.qualityAuto"],
              ["high", "account.qualityHigh"],
              ["low", "account.qualityLow"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={quality === value}
              onClick={() => {
                setQuality(value);
                rememberViewerQuality(value);
              }}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                quality === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </Section>

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
