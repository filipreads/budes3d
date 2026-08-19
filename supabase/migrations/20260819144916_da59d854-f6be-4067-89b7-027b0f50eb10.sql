CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read settings" ON public.app_settings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins insert settings" ON public.app_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update settings" ON public.app_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER app_settings_updated_at BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.app_settings (key, value)
VALUES ('zerogpu', '{"plan":"free","free_quota_seconds":300,"pro_quota_seconds":1500}'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS generation_seconds integer;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS generation_plan text;