-- Storage: owner UPDATE for models (regeneration upsert) and uploads; admin read across both buckets
CREATE POLICY "own models update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'portrait-models' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'portrait-models' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "own uploads update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'portrait-uploads' AND (auth.uid())::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'portrait-uploads' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "own models delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'portrait-models' AND (auth.uid())::text = (storage.foldername(name))[1]);

CREATE POLICY "admins read customer files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('portrait-models','portrait-uploads') AND public.has_role(auth.uid(), 'admin'));

-- Payment session tracking (Stripe or any future provider); never client-writable
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_provider text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
CREATE INDEX IF NOT EXISTS orders_payment_reference_idx ON public.orders (payment_reference);

-- Support requests submitted from /contact (server-side insert only)
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL,
  order_number text,
  topic text NOT NULL DEFAULT 'general',
  message text NOT NULL,
  locale text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.contact_messages TO authenticated;
GRANT ALL ON public.contact_messages TO service_role;
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read contact messages" ON public.contact_messages FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "users read own contact messages" ON public.contact_messages FOR SELECT TO authenticated
  USING (user_id = auth.uid());