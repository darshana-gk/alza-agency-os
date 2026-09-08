-- ALZA Flow Pay waitlist V1 (staging-first).
-- Saves Coming Soon interest only. Does not enable payments or payout processing.
-- Does not alter users, agency_profile, or existing tenant RLS.

CREATE TABLE IF NOT EXISTS public.flow_pay_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_profile_id uuid NOT NULL REFERENCES public.agency_profile (id),
  submitted_by_user_id uuid NOT NULL REFERENCES public.users (id),
  name text NOT NULL,
  work_email text NOT NULL,
  agency_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'interested',
  CONSTRAINT flow_pay_waitlist_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT flow_pay_waitlist_agency_name_len CHECK (char_length(btrim(agency_name)) BETWEEN 1 AND 200),
  CONSTRAINT flow_pay_waitlist_email_len CHECK (char_length(btrim(work_email)) BETWEEN 3 AND 320),
  CONSTRAINT flow_pay_waitlist_email_at CHECK (position('@' in work_email) > 1),
  CONSTRAINT flow_pay_waitlist_status_check CHECK (status = 'interested')
);

COMMENT ON TABLE public.flow_pay_waitlist IS
  'ALZA Flow Pay Coming Soon waitlist. Interest only; not a payment record.';

COMMENT ON COLUMN public.flow_pay_waitlist.agency_profile_id IS
  'Submitting agency. Stamped from current_user_agency_profile_id(); never taken from the client.';

COMMENT ON COLUMN public.flow_pay_waitlist.submitted_by_user_id IS
  'Submitting app user. Stamped from current_app_user_id(); never taken from the client.';

COMMENT ON COLUMN public.flow_pay_waitlist.status IS
  'Waitlist state. V1 default/only value: interested.';

CREATE UNIQUE INDEX IF NOT EXISTS flow_pay_waitlist_agency_email_uidx
  ON public.flow_pay_waitlist (agency_profile_id, (lower(btrim(work_email))));

CREATE INDEX IF NOT EXISTS flow_pay_waitlist_agency_created_idx
  ON public.flow_pay_waitlist (agency_profile_id, created_at DESC);

ALTER TABLE public.flow_pay_waitlist ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.flow_pay_waitlist FROM PUBLIC;
REVOKE ALL ON TABLE public.flow_pay_waitlist FROM anon;
REVOKE ALL ON TABLE public.flow_pay_waitlist FROM authenticated;
GRANT SELECT ON TABLE public.flow_pay_waitlist TO authenticated;

DROP POLICY IF EXISTS flow_pay_waitlist_select ON public.flow_pay_waitlist;
CREATE POLICY flow_pay_waitlist_select ON public.flow_pay_waitlist
  FOR SELECT TO authenticated
  USING (
    (public.same_agency(agency_profile_id) AND public.is_admin_directory_role())
    OR public.is_alza_support()
  );

-- No INSERT/UPDATE/DELETE policies for authenticated. Mutations go through the RPC.

DROP FUNCTION IF EXISTS public.join_flow_pay_waitlist(text, text, text);

CREATE OR REPLACE FUNCTION public.join_flow_pay_waitlist(
  p_name text,
  p_work_email text,
  p_agency_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agency uuid;
  v_user uuid;
  v_id uuid;
  v_name text := nullif(btrim(p_name), '');
  v_email text := nullif(btrim(p_work_email), '');
  v_agency_name text := nullif(btrim(p_agency_name), '');
BEGIN
  IF public.is_alza_support() AND public.current_user_agency_profile_id() IS NULL THEN
    RAISE EXCEPTION 'ALZA Support cannot join the Flow Pay waitlist for an agency';
  END IF;
  IF NOT public.is_admin_directory_role() THEN
    RAISE EXCEPTION 'Only Owners and Admins can join the Flow Pay waitlist';
  END IF;

  v_agency := public.current_user_agency_profile_id();
  v_user := public.current_app_user_id();
  IF v_agency IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Agency membership is required';
  END IF;
  IF v_name IS NULL OR v_email IS NULL OR v_agency_name IS NULL THEN
    RAISE EXCEPTION 'Name, work email, and agency name are required';
  END IF;
  IF position('@' in v_email) < 2 THEN
    RAISE EXCEPTION 'Enter a valid work email';
  END IF;

  INSERT INTO public.flow_pay_waitlist (
    agency_profile_id,
    submitted_by_user_id,
    name,
    work_email,
    agency_name,
    status
  )
  VALUES (
    v_agency,
    v_user,
    v_name,
    v_email,
    v_agency_name,
    'interested'
  )
  ON CONFLICT (agency_profile_id, (lower(btrim(work_email))))
  DO UPDATE SET
    name = EXCLUDED.name,
    agency_name = EXCLUDED.agency_name,
    submitted_by_user_id = EXCLUDED.submitted_by_user_id,
    work_email = EXCLUDED.work_email
  RETURNING public.flow_pay_waitlist.id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.join_flow_pay_waitlist(text, text, text) IS
  'Owner/Admin waitlist join. Stamps agency and user from session. Upserts on agency + email.';

REVOKE ALL ON FUNCTION public.join_flow_pay_waitlist(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_flow_pay_waitlist(text, text, text) TO authenticated;
