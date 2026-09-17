-- Allow public header Contact us inquiries to persist source=header_contact.
-- Additive check-constraint update only. Does not change anti-spam or customer tables.

ALTER TABLE public.sales_inquiries
  DROP CONSTRAINT IF EXISTS sales_inquiries_source_check;

ALTER TABLE public.sales_inquiries
  ADD CONSTRAINT sales_inquiries_source_check
  CHECK (source IN ('pricing_contact', 'landing_contact', 'header_contact'));
