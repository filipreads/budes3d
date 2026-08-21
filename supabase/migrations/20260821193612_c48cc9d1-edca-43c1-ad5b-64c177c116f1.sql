CREATE TABLE public.trusted_mfa_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_hash text not null,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  unique (user_id, device_hash)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trusted_mfa_devices TO authenticated;
GRANT ALL ON public.trusted_mfa_devices TO service_role;
ALTER TABLE public.trusted_mfa_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own trusted devices" ON public.trusted_mfa_devices FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX trusted_mfa_devices_user_idx ON public.trusted_mfa_devices(user_id);