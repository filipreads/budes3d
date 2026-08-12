INSERT INTO public.user_roles (user_id, role) VALUES ('74f1f675-db1f-4a73-8cc4-37b2431b90b3', 'admin') ON CONFLICT DO NOTHING;

CREATE TABLE public.order_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  template text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  locale text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'queued',
  error text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.order_emails TO authenticated;
GRANT ALL ON public.order_emails TO service_role;

ALTER TABLE public.order_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read order emails" ON public.order_emails
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER order_emails_updated_at BEFORE UPDATE ON public.order_emails
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "admins update orders" ON public.orders
FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins read downloads" ON public.order_downloads
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins read profiles" ON public.profiles
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));