ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS premium_generations integer NOT NULL DEFAULT 0;

INSERT INTO public.app_settings (key, value)
VALUES ('premium_generation_rate', '{"czk": 24900, "eur": 990}'::jsonb)
ON CONFLICT (key) DO NOTHING;