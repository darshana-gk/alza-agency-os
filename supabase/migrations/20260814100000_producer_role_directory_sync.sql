-- ALZA Flow — Multi-role Producer directory sync
-- Ensures users with Producer role (including CSR+Producer) have a linked producers row
-- for assignment dropdowns and default split %. Does NOT loosen financial RLS.
-- Does NOT create/consume recoveries or producer payments.

-- 1) Create missing producers rows for Producer-role users (no duplicate by name or email)
INSERT INTO public.producers (producer_name, email, status, notes)
SELECT
  u.full_name,
  nullif(lower(trim(u.email)), ''),
  CASE WHEN lower(coalesce(u.status, '')) = 'active' THEN 'active' ELSE 'inactive' END,
  'Synced from users with Producer role for assignment dropdowns'
FROM public.users u
WHERE u.archived_at IS NULL
  AND coalesce(nullif(trim(u.full_name), ''), '') <> ''
  AND (
    lower(coalesce(u.role, '')) = 'producer'
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = u.id AND lower(ur.role) = 'producer'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.producers p
    WHERE p.archived_at IS NULL
      AND (
        lower(trim(p.producer_name)) = lower(trim(u.full_name))
        OR (
          nullif(lower(trim(u.email)), '') IS NOT NULL
          AND nullif(lower(trim(p.email)), '') IS NOT NULL
          AND lower(trim(p.email)) = lower(trim(u.email))
        )
      )
  );

-- 2) Reactivate existing matching producer rows when user has Producer role + active status
UPDATE public.producers p
SET status = 'active',
    email = COALESCE(nullif(lower(trim(u.email)), ''), p.email),
    updated_at = now()
FROM public.users u
WHERE u.archived_at IS NULL
  AND lower(coalesce(u.status, '')) = 'active'
  AND p.archived_at IS NULL
  AND (
    lower(coalesce(u.role, '')) = 'producer'
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = u.id AND lower(ur.role) = 'producer'
    )
  )
  AND (
    lower(trim(p.producer_name)) = lower(trim(u.full_name))
    OR (
      nullif(lower(trim(u.email)), '') IS NOT NULL
      AND nullif(lower(trim(p.email)), '') IS NOT NULL
      AND lower(trim(p.email)) = lower(trim(u.email))
    )
  )
  AND lower(coalesce(p.status, '')) <> 'active';

-- 3) Link users.producer_id when missing (prefer exact name, then email)
UPDATE public.users u
SET producer_id = p.id
FROM public.producers p
WHERE u.archived_at IS NULL
  AND u.producer_id IS NULL
  AND p.archived_at IS NULL
  AND (
    lower(coalesce(u.role, '')) = 'producer'
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = u.id AND lower(ur.role) = 'producer'
    )
  )
  AND (
    lower(trim(p.producer_name)) = lower(trim(u.full_name))
    OR (
      nullif(lower(trim(u.email)), '') IS NOT NULL
      AND nullif(lower(trim(p.email)), '') IS NOT NULL
      AND lower(trim(p.email)) = lower(trim(u.email))
    )
  );

-- 4) Deactivate producer directory rows for users who no longer have Producer role
--    (keep the row + users.producer_id for historical TEXT / linkage)
UPDATE public.producers p
SET status = 'inactive',
    updated_at = now()
FROM public.users u
WHERE u.producer_id = p.id
  AND u.archived_at IS NULL
  AND p.archived_at IS NULL
  AND lower(coalesce(u.role, '')) <> 'producer'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = u.id AND lower(ur.role) = 'producer'
  )
  AND lower(coalesce(p.status, '')) = 'active'
  -- Do not deactivate standalone directory producers that are not linked to a user
  AND u.producer_id IS NOT NULL;

COMMENT ON TABLE public.producers IS
  'Producer directory for TEXT assignment + default split. Multi-role users with Producer are synced/linked here.';
