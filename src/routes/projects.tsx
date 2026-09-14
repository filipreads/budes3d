import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/account/StatusChip";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { deleteProject, renameProject } from "@/lib/studio.functions";
import { toast } from "sonner";
import { Check, Pencil, Search, Trash2, X } from "lucide-react";
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

function ProjectsPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const { data } = useQuery({
    queryKey: ["projects-page", user?.id],
    enabled: Boolean(user),
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [projectsResult, ordersResult] = await Promise.all([
        supabase
          .from("projects")
          .select("id, title, status, model_url, created_at")
          .order("created_at", { ascending: false }),
        supabase.from("orders").select("order_number, project_id"),
      ]);
      const map: Record<string, string> = {};
      for (const order of ordersResult.data ?? []) {
        if (order.project_id) map[order.project_id] = order.order_number;
      }
      return { projects: (projectsResult.data ?? []) as ProjectRow[], orderedProjects: map };
    },
  });

  const projects = data?.projects ?? [];
  const orderedProjects = data?.orderedProjects ?? {};

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return projects;
    return projects.filter((project) => project.title.toLowerCase().includes(term));
  }, [projects, search]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["projects-page", user?.id] });
    await queryClient.invalidateQueries({ queryKey: ["account-summary", user?.id] });
  }

  async function onDelete(projectId: string) {
    setRemoving(projectId);
    try {
      const result = await deleteProject({ data: { projectId } });
      if (!result.deleted) {
        toast.error(t("projects.deleteBlocked").replace("{order}", result.blockedByOrder ?? ""));
        return;
      }
      await refresh();
      toast.success(t("projects.deleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("projects.delete"));
    } finally {
      setRemoving(null);
    }
  }

  async function onRename(projectId: string) {
    const title = draftTitle.trim();
    if (!title) return;
    setEditingId(null);
    try {
      await renameProject({ data: { projectId, title } });
      await refresh();
      toast.success(t("projects.renamed"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("projects.rename"));
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
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-5 sm:py-12">
        <h1 className="font-display text-2xl sm:text-3xl">{t("projects.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">{t("projects.subtitle")}</p>

        {projects.length > 3 ? (
          <div className="relative mt-5">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("projects.search")}
              aria-label={t("projects.search")}
              className="pl-9"
            />
          </div>
        ) : null}

        {projects.length === 0 ? (
          <Card className="mt-6">
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">{t("projects.empty")}</p>
              <Button asChild className="mt-5">
                <Link to="/editor">{t("nav.cta")}</Link>
              </Button>
            </CardContent>
          </Card>
        ) : visible.length === 0 ? (
          <Card className="mt-6">
            <CardContent className="p-8 text-center text-muted-foreground">{t("projects.noResults")}</CardContent>
          </Card>
        ) : (
          <div className="mt-6 space-y-3">
            {visible.map((project) => {
              const orderNumber = orderedProjects[project.id];
              const isEditing = editingId === project.id;
              return (
                <Card key={project.id}>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <Input
                            autoFocus
                            value={draftTitle}
                            maxLength={80}
                            aria-label={t("projects.renameTitle")}
                            onChange={(event) => setDraftTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void onRename(project.id);
                              if (event.key === "Escape") setEditingId(null);
                            }}
                          />
                          <Button size="icon" aria-label={t("projects.save")} onClick={() => void onRename(project.id)}>
                            <Check className="size-4" />
                          </Button>
                          <Button size="icon" variant="ghost" aria-label={t("common.cancel")} onClick={() => setEditingId(null)}>
                            <X className="size-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <p className="truncate font-display text-lg">{project.title}</p>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-7 shrink-0"
                            aria-label={t("projects.rename")}
                            onClick={() => {
                              setDraftTitle(project.title);
                              setEditingId(project.id);
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        </div>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <StatusChip status={project.model_url ? project.status : "draft"} />
                        {orderNumber ? (
                          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
                            {t("projects.ordered")} · {orderNumber}
                          </span>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {t("projects.created")} {new Date(project.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button asChild variant="secondary" size="sm" className="flex-1 sm:flex-none">
                        <Link to="/editor" search={{ project: project.id }}>
                          {t("projects.open")}
                        </Link>
                      </Button>
                      {orderNumber ? null : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("projects.delete")}
                              disabled={removing === project.id}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("projects.delete")}</AlertDialogTitle>
                              <AlertDialogDescription>{t("projects.deleteConfirm")}</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
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
              );
            })}
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
