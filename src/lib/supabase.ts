import { createClient } from '@supabase/supabase-js'

const viteEnv =
  typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : ({} as ImportMetaEnv)

const supabaseUrl = String(viteEnv.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '')
const supabaseAnonKey = String(viteEnv.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '')

// Placeholder allows Node validators to import modules that transitively load this file.
// Browser builds always inject real VITE_* values; empty placeholders never talk to production.
export const supabase = createClient(
  supabaseUrl || 'http://127.0.0.1:54321',
  supabaseAnonKey || 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
