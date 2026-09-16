import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
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
import { getStaySignedIn, setStaySignedIn } from "@/lib/session-persistence";

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
  description?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 border-b border-border/70 pb-6 last:border-0 last:pb-0">
      <div>
        <h2 className="font-display text-base sm:text-lg">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
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
  const [stay, setStay] = useState(true);

  useEffect(() => {
    setStay(getStaySignedIn());
  }, []);

  const identities = (user?.identities ?? []).map((identity) => identity.provider);
  const methods: { key: "account.methodPassword" | "account.methodGoogle" | "account.methodApple"; active: boolean }[] = [
    { key: "account.methodPassword", active: identities.includes("email") || identities.length === 0 },
    { key: "account.methodGoogle", active: identities.includes("google") },
    { key: "account.methodApple", active: identities.includes("apple") },
  ];

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
      <Card>
        <CardContent className="space-y-6 p-4 sm:p-6">
          <p className="text-sm text-muted-foreground">{t("account.settingsLead")}</p>

          <Section title={t("account.profile")}>
            <div className="flex items-center gap-4">
              {data?.avatarUrl ? (
                <img src={data.avatarUrl} alt="" className="size-14 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="grid size-14 shrink-0 place-items-center rounded-full bg-muted font-display text-lg">
                  {(displayName || data?.email || "?").charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0">
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
                <Input id="display-name" className="h-11 sm:h-9" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
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
                  className="h-11 rounded-md border border-input bg-background px-3 text-sm sm:h-9 sm:px-2"
                >
                  <option value="en">English</option>
                  <option value="cs">Čeština</option>
                </select>
              </div>
            </div>

            <Button className="w-full sm:w-auto" disabled={saving} onClick={() => void saveProfile({ displayName })}>
              {t("account.save")}
            </Button>
          </Section>

          <Section title={t("account.shipping")} description={t("account.shippingHint")}>
            {!editingAddress ? (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <p className="min-w-0 break-words text-sm text-muted-foreground">
                  {addressSummary || t("account.addressEmpty")}
                </p>
                <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setEditingAddress(true)}>
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
                        className="h-11 sm:h-9"
                        value={address[key]}
                        onChange={(event) => setAddress({ ...address, [key]: event.target.value })}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button
                    className="w-full sm:w-auto"
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
                    className="w-full sm:w-auto"
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

          <Section title={t("account.security")} description={data?.email ?? undefined}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="new-email">{t("account.newEmail")}</Label>
                <Input
                  id="new-email"
                  type="email"
                  className="h-11 sm:h-9"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  autoComplete="email"
                />
                <Button variant="secondary" size="sm" className="w-full sm:w-auto" onClick={() => void changeEmail()}>
                  {t("account.changeEmail")}
                </Button>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="new-password">{t("account.newPassword")}</Label>
                <Input
                  id="new-password"
                  type="password"
                  className="h-11 sm:h-9"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                />
                <Button variant="secondary" size="sm" className="w-full sm:w-auto" onClick={() => void changePassword()}>
                  {t("account.changePassword")}
                </Button>
              </div>
            </div>
          </Section>
        </CardContent>
      </Card>

      <TwoFactorCard />

      <Card>
        <CardContent className="p-0">
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 sm:p-6 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="font-display text-base sm:text-lg">{t("account.advanced")}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{t("account.advancedHint")}</span>
              </span>
              <ChevronDown
                className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <div className="space-y-6 px-4 pb-6 sm:px-6">
              <Section title={t("account.signinMethods")} description={t("account.signinMethodsHint")}>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {methods.map((method) => (
                    <li key={method.key} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 truncate">{t(method.key)}</span>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          method.active ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {method.active ? t("account.methodLinked") : "—"}
                      </span>
                    </li>
                  ))}
                </ul>

                <label className="flex items-start gap-3 rounded-lg bg-muted/50 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-5 accent-primary"
                    checked={stay}
                    onChange={(event) => {
                      setStay(event.target.checked);
                      setStaySignedIn(event.target.checked);
                    }}
                  />
                  <span>
                    {t("account.staySignedIn")}
                    <span className="block text-xs text-muted-foreground">{t("account.staySignedInHint")}</span>
                  </span>
                </label>
              </Section>

              <Section title={t("account.viewerQuality")} description={t("account.viewerQualityHint")}>
                <div className="grid w-full grid-cols-3 gap-1 rounded-lg border border-border p-1 sm:inline-flex sm:w-auto">
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
                      className={`min-h-10 rounded-md px-2 py-1.5 text-center text-[13px] leading-tight transition-colors sm:min-h-0 sm:px-3 sm:text-sm ${
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

              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("account.dataNote")}</p>
                <Button variant="ghost" className="w-full sm:w-auto" onClick={() => void signOut()}>
                  {t("nav.signout")}
                </Button>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
