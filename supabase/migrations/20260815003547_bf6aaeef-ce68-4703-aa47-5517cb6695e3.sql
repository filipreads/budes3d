REVOKE ALL ON FUNCTION public.protect_order_financials() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
REVOKE ALL ON FUNCTION public.get_shared_preview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shared_preview(text) TO anon, authenticated;