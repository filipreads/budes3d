ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS share_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS share_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.get_shared_preview(_token text)
RETURNS TABLE (
  order_number text,
  delivery_type text,
  config_snapshot jsonb,
  model_url text,
  project_title text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.order_number, o.delivery_type, o.config_snapshot, p.model_url, p.title, o.created_at
  FROM public.orders o
  LEFT JOIN public.projects p ON p.id = o.project_id
  WHERE o.share_token = _token AND o.share_enabled = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_shared_preview(text) TO anon, authenticated;