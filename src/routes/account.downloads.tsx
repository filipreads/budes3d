import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { listAllDownloads } from "@/lib/account.functions";
import { getOrderDownloadUrl } from "@/lib/downloads.functions";
import { downloadModelFile } from "@/lib/mesh-export";

export const Route = createFileRoute("/account/downloads")({
  head: () => ({
    meta: [
      { title: "Downloads — Relievo Studio" },
      { name: "description", content: "Every 3D file from your paid portrait orders, ready as GLB or STL." },
      { property: "og:title", content: "Downloads — Relievo Studio" },
      { property: "og:description", content: "GLB and STL files from your paid orders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DownloadsTab,
});

function DownloadsTab() {
  const { user } = useAuth();
  const { t } = useI18n();
  const [preparing, setPreparing] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["account-downloads", user?.id],
    queryFn: () => listAllDownloads(),
    enabled: Boolean(user),
    staleTime: 2 * 60 * 1000,
  });

  async function run(downloadId: string, format: "glb" | "stl") {
    setPreparing(`${downloadId}-${format}`);
    try {
      const file = await getOrderDownloadUrl({ data: { downloadId } });
      const filename = file.filename.replace(/\.[^.]+$/, `.${format}`);
      await downloadModelFile(file.url, format, filename, file.heightMm);
    } catch {
      toast.error(t("account.downloadFailed"));
    } finally {
      setPreparing(null);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((key) => (
          <div key={key} className="h-20 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if ((data ?? []).length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">{t("account.downloadsEmpty")}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {(data ?? []).map((entry) => (
        <Card key={entry.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="font-display text-lg">{entry.label}</p>
              <p className="text-sm text-muted-foreground">
                {entry.orderNumber} · {new Date(entry.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(["glb", "stl"] as const).map((format) => (
                <Button
                  key={format}
                  size="sm"
                  variant="secondary"
                  disabled={preparing === `${entry.id}-${format}`}
                  onClick={() => void run(entry.id, format)}
                >
                  <Download className="mr-1.5 size-3.5" />
                  {preparing === `${entry.id}-${format}`
                    ? t("account.preparing")
                    : `${t("account.download")} ${format.toUpperCase()}`}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
