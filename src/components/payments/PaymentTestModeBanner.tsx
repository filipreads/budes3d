import { useI18n } from "@/lib/i18n";
const clientToken = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"] as string | undefined;

export function PaymentTestModeBanner() {
  const { t } = useI18n();
  if (!clientToken) {
    return (
      <div className="w-full border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
        {t("payments.notConfigured")}
      </div>
    );
  }
  if (clientToken.startsWith("pk_test_")) {
    return (
      <div className="w-full border-b border-border bg-muted px-4 py-2 text-center text-sm text-muted-foreground">
        {t("payments.testMode")}
      </div>
    );
  }
  return null;
}
