CREATE OR REPLACE FUNCTION public.protect_order_financials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'admin') OR auth.uid() IS NULL OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.payment_status := OLD.payment_status;
  NEW.fulfilment_status := OLD.fulfilment_status;
  NEW.payment_provider := OLD.payment_provider;
  NEW.payment_reference := OLD.payment_reference;
  NEW.paid_at := OLD.paid_at;
  NEW.subtotal_cents := OLD.subtotal_cents;
  NEW.shipping_cents := OLD.shipping_cents;
  NEW.total_cents := OLD.total_cents;
  NEW.line_items := OLD.line_items;
  NEW.currency := OLD.currency;
  NEW.order_number := OLD.order_number;
  NEW.user_id := OLD.user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_protect_financials ON public.orders;
CREATE TRIGGER orders_protect_financials
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.protect_order_financials();