-- Public sales inquiries for ALZA Flow marketing contact form.
-- Staging-safe additive table. No customer/business tables are altered.
-- Anonymous users must not SELECT or INSERT directly; Edge Function uses service_role.

CREATE TABLE IF NOT EXISTS public.sales_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL,
  work_email text NOT NULL,
  agency_name text NOT NULL,
  user_band text NOT NULL,
  phone text,
  message text,
  status text NOT NULL DEFAULT 'new',
  source text NOT NULL,
  consent boolean NOT NULL DEFAULT false,
  ip_hash text,
  payload_hash text,
  notification_status text,
  acknowledgement_status text,
  CONSTRAINT sales_inquiries_status_check
    CHECK (status IN ('new', 'contacted', 'qualified', 'closed')),
  CONSTRAINT sales_inquiries_source_check
    CHECK (source IN ('pricing_contact', 'landing_contact')),
  CONSTRAINT sales_inquiries_user_band_check
    CHECK (user_band IN ('51-100', '101-250', '251-500', '500+'))
);

CREATE INDEX IF NOT EXISTS sales_inquiries_email_created_idx
  ON public.sales_inquiries (work_email, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_inquiries_ip_created_idx
  ON public.sales_inquiries (ip_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_inquiries_payload_created_idx
  ON public.sales_inquiries (payload_hash, created_at DESC);

COMMENT ON TABLE public.sales_inquiries IS
  'Public ALZA Flow sales inquiries. Readable only via service_role; never exposed to anon SELECT.';

ALTER TABLE public.sales_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_inquiries FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sales_inquiries FROM PUBLIC;
REVOKE ALL ON TABLE public.sales_inquiries FROM anon;
REVOKE ALL ON TABLE public.sales_inquiries FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.sales_inquiries TO service_role;
