REVOKE ALL ON FUNCTION public.protect_order_financials() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_shared_preview(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_shared_preview(text) TO anon, authenticated;