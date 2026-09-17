-- Additive job_title for public sales inquiries.
-- Keeps agency_name internally for V1 compatibility. No destructive rename.
-- Does not change RLS, anti-spam columns, or customer/business tables.

ALTER TABLE public.sales_inquiries
  ADD COLUMN IF NOT EXISTS job_title text;

UPDATE public.sales_inquiries
  SET job_title = '—'
  WHERE job_title IS NULL OR btrim(job_title) = '';

ALTER TABLE public.sales_inquiries
  ALTER COLUMN job_title SET DEFAULT '';

ALTER TABLE public.sales_inquiries
  ALTER COLUMN job_title SET NOT NULL;

ALTER TABLE public.sales_inquiries
  ALTER COLUMN job_title DROP DEFAULT;

COMMENT ON COLUMN public.sales_inquiries.agency_name IS
  'Company name submitted on the public form. Column name kept for V1 compatibility.';

COMMENT ON COLUMN public.sales_inquiries.job_title IS
  'Job title / designation submitted on the public ALZA Flow sales inquiry form.';
