/**
 * Persistence for generation runs.
 *
 * Every run gets a row in `generation_jobs` so the provider, its job id, the
 * stage history, the produced files and the printability verdict survive a
 * reload, a retry and a support question weeks later. Writes go through the
 * caller's own Supabase client, so RLS keeps one customer out of another's job.
 */
import type { Database } from "@/integrations/supabase/types";

type JobRow = Database["public"]["Tables"]["generation_jobs"]["Row"];
type JobPatch = Database["public"]["Tables"]["generation_jobs"]["Update"];

// The authenticated client from `requireSupabaseAuth`; typed loosely so this
// helper stays usable from every pipeline branch.
type Client = { from: (table: string) => any };

export async function openJob(
  supabase: Client,
  input: { projectId: string; userId: string; engine: string; provider: string; plan: string },
): Promise<string | null> {
  const { data } = await supabase
    .from("generation_jobs")
    .insert({
      project_id: input.projectId,
      user_id: input.userId,
      engine: input.engine,
      provider: input.provider,
      plan: input.plan,
      stage: "queued",
      progress: 0,
      status: "generating",
    })
    .select("id")
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** Most recent run of a project — the one the studio is currently driving. */
export async function currentJob(supabase: Client, projectId: string, userId: string): Promise<JobRow | null> {
  const { data } = await supabase
    .from("generation_jobs")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as JobRow | null) ?? null;
}

export async function patchJob(supabase: Client, jobId: string | null, fields: JobPatch): Promise<void> {
  if (!jobId) return;
  await supabase.from("generation_jobs").update(fields).eq("id", jobId);
}
