-- ALZA Flow — Support Center grant hardening (defense-in-depth)
-- Supabase default privileges can grant ALL to anon/authenticated on new tables.
-- Intended client surface: authenticated SELECT/INSERT only; no anon access.

REVOKE ALL ON TABLE public.support_conversations FROM anon;
REVOKE ALL ON TABLE public.support_conversations FROM authenticated;
REVOKE ALL ON TABLE public.support_messages FROM anon;
REVOKE ALL ON TABLE public.support_messages FROM authenticated;

GRANT SELECT, INSERT ON TABLE public.support_conversations TO authenticated;
GRANT SELECT, INSERT ON TABLE public.support_messages TO authenticated;

GRANT ALL ON TABLE public.support_conversations TO service_role;
GRANT ALL ON TABLE public.support_messages TO service_role;
