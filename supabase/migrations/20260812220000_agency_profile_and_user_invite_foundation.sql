-- ALZA Flow — Agency profile + invite metadata + branding storage foundation
-- Created only (not applied by this step).
-- Does NOT weaken existing RLS on operational tables.
-- Does NOT add producer_id (recommended separately).
-- Does NOT introduce multi-tenant agency_id on operational tables.

-- ---------------------------------------------------------------------------
-- 1) Invite metadata on public.users (for UI status only; auth remains source of login)
-- ---------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS invited_at timestamptz;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS invite_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_invite_status_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_invite_status_check
      CHECK (invite_status IS NULL OR invite_status IN ('pending', 'accepted'));
  END IF;
END $$;

COMMENT ON COLUMN public.users.invited_at IS
  'Set when an Owner/Admin invites the user via invite-alza-user Edge Function.';
COMMENT ON COLUMN public.users.invite_status IS
  'pending = invite sent; accepted = user has signed in at least once (or manually cleared).';

-- ---------------------------------------------------------------------------
-- 2) Admin-directory helper (owner | admin) — used by agency settings / storage
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin_directory_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.archived_at IS NULL
      AND lower(coalesce(u.status, '')) = 'active'
      AND lower(coalesce(u.role, '')) IN ('owner', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_directory_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_directory_role() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Single-agency organization profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agency_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton_key boolean NOT NULL DEFAULT true,
  agency_name text NOT NULL,
  legal_name text,
  logo_url text,
  phone text,
  email text,
  website text,
  address text,
  timezone text DEFAULT 'America/New_York',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_profile_singleton UNIQUE (singleton_key)
);

COMMENT ON TABLE public.agency_profile IS
  'Single-customer agency/workspace profile for ALZA Flow branding personalization.';

ALTER TABLE public.agency_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agency_profile_select_authenticated ON public.agency_profile;
CREATE POLICY agency_profile_select_authenticated
  ON public.agency_profile
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS agency_profile_insert_admin ON public.agency_profile;
CREATE POLICY agency_profile_insert_admin
  ON public.agency_profile
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_directory_role());

DROP POLICY IF EXISTS agency_profile_update_admin ON public.agency_profile;
CREATE POLICY agency_profile_update_admin
  ON public.agency_profile
  FOR UPDATE
  TO authenticated
  USING (public.is_admin_directory_role())
  WITH CHECK (public.is_admin_directory_role());

DROP POLICY IF EXISTS agency_profile_delete_admin ON public.agency_profile;
CREATE POLICY agency_profile_delete_admin
  ON public.agency_profile
  FOR DELETE
  TO authenticated
  USING (public.is_admin_directory_role());

-- Seed one blank-ready row only if table empty (safe; name placeholder editable in UI)
INSERT INTO public.agency_profile (agency_name)
SELECT 'Agency Workspace'
WHERE NOT EXISTS (SELECT 1 FROM public.agency_profile);

-- ---------------------------------------------------------------------------
-- 4) Storage bucket for agency logos (public read, admin write)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'agency-branding',
  'agency-branding',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS agency_branding_public_read ON storage.objects;
CREATE POLICY agency_branding_public_read
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'agency-branding');

DROP POLICY IF EXISTS agency_branding_admin_insert ON storage.objects;
CREATE POLICY agency_branding_admin_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'agency-branding'
    AND public.is_admin_directory_role()
  );

DROP POLICY IF EXISTS agency_branding_admin_update ON storage.objects;
CREATE POLICY agency_branding_admin_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'agency-branding'
    AND public.is_admin_directory_role()
  )
  WITH CHECK (
    bucket_id = 'agency-branding'
    AND public.is_admin_directory_role()
  );

DROP POLICY IF EXISTS agency_branding_admin_delete ON storage.objects;
CREATE POLICY agency_branding_admin_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'agency-branding'
    AND public.is_admin_directory_role()
  );
