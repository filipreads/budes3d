ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS generation_stage text,
  ADD COLUMN IF NOT EXISTS generation_progress integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_job_id text,
  ADD COLUMN IF NOT EXISTS session_hash text,
  ADD COLUMN IF NOT EXISTS preview_video_url text,
  ADD COLUMN IF NOT EXISTS generation_started_at timestamptz;