import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { deleteProject } from "@/lib/studio.functions";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "My studio projects — Relievo Studio" },
      { name: "description", content: "Reopen past portrait uploads, 3D previews and download your generated files." },
      { property: "og:title", content: "My studio projects — Relievo Studio" },
      { property: "og:description", content: "Every portrait project you've started, ready to reopen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProjectsPage,
});

type ProjectRow = {
  id: string;
  title: string;
  status: string;
  model_url: string | null;
  created_at: string;
};

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [orderedProjects, setOrderedProjects] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void supabase
      .from("projects")
      .select("id, title, status, model_url, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => setProjects((data ?? []) as ProjectRow[]));

    void supabase
      .from("orders")
      .select("order_number, project_id")
      .then(({ data }) => {
        const map: Record<string, string> = {};
        for (const order of data ?? []) {
          if (order.project_id) map[order.project_id] = order.order_number;
        }
        setOrderedProjects(map);
      });
  }, [user]);

  async function onDelete(projectId: string) {
    setRemoving(projectId);
    try {
      const result = await deleteProject({ data: { projectId } });
      if (!result.deleted) {
        toast.error(t("projects.deleteBlocked").replace("{order}", result.blockedByOrder ?? ""));
        return;
      }
      setProjects((current) => current.filter((project) => project.id !== projectId));
      toast.success(t("projects.deleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("projects.delete"));
    } finally {
      setRemoving(null);
    }
  }

  if (!loading && !user) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader />
        <main className="mx-auto w-full max-w-md flex-1 px-5 py-20 text-center">
          <h1 className="font-display text-2xl">{t("projects.signIn")}</h1>
          <Button className="mt-6" onClick={() => void navigate({ to: "/auth", search: { redirect: "/projects" } })}>
            {t("nav.signin")}
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12">
        <h1 className="font-display text-3xl">{t("projects.title")}</h1>
        <p className="mt-2 text-muted-foreground">{t("projects.subtitle")}</p>

        {projects.length === 0 ? (
          <Card className="mt-6">
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">{t("projects.empty")}</p>
              <Button asChild className="mt-5">
                <Link to="/editor">{t("nav.cta")}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="mt-6 space-y-3">
            {projects.map((project) => (
              <Card key={project.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                  <div>
                    <p className="font-display text-lg">{project.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("projects.created")} {new Date(project.created_at).toLocaleDateString()} ·{" "}
                      {project.model_url ? project.status : t("projects.noModel")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="secondary">
                      <Link to="/editor" search={{ project: project.id }}>
                        {t("projects.open")}
                      </Link>
                    </Button>
                    {orderedProjects[project.id] ? (
                      <p className="max-w-xs text-xs text-muted-foreground">
                        {t("projects.deleteBlocked").replace("{order}", orderedProjects[project.id]!)}
                      </p>
                    ) : (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={t("projects.delete")} disabled={removing === project.id}>
                            <Trash2 className="size-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("projects.delete")}</AlertDialogTitle>
                            <AlertDialogDescription>{t("projects.deleteConfirm")}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t("nav.menu") === "" ? "" : "×"}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void onDelete(project.id)}>
                              {t("projects.delete")}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
