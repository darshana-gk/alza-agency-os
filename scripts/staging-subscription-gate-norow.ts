/**
 * STAGING ONLY. Temporarily removes one disposable billing row, confirms
 * the Owner read is empty, then restores the exact row.
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const BILLING_ID = 'd165e16b-6058-45ec-ac2c-b90f48ba0ae3'
const AGENCY = '022cfd8d-870d-4c4d-a218-5c0ceb870e65'
const OWNER = { email: 'owner.provision.v1.1788940430548@example.com', password: 'StagingTest!ProvisionV1-2026' }

function dbQuery(sql: string) {
  const path = resolve('tmp-subscription-gate-norow.sql')
  writeFileSync(path, sql, 'utf8')
  const captured = execSync(`npx supabase db query --linked --project-ref ${STAGING_REF} -f ${path}`, {
    encoding: 'utf8',
  })
  const start = captured.indexOf('{')
  const end = captured.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(captured.slice(0, 500))
  return JSON.parse(captured.slice(start, end + 1)) as { rows?: Array<Record<string, unknown>> }
}

function loadAnon() {
  const json = execSync(`npx supabase projects api-keys --project-ref ${STAGING_REF} -o json`, { encoding: 'utf8' })
  const raw = JSON.parse(json.replace(/^\uFEFF/, ''))
  const list = Array.isArray(raw) ? raw : raw?.api_keys ?? []
  let anon = ''
  for (const row of list) {
    const name = String(row.name ?? row.id ?? '').toLowerCase()
    const key = String(row.api_key ?? row.key ?? '')
    if (name.includes('anon') || name.includes('publishable')) anon = anon || key
  }
  if (!anon) throw new Error('anon missing')
  return { url: `https://${STAGING_REF}.supabase.co`, anon }
}

async function main() {
  const before = dbQuery(`
    SELECT to_jsonb(bs) AS row
    FROM public.billing_subscriptions bs
    WHERE id = '${BILLING_ID}'::uuid;
  `)
  const row = before.rows?.[0]?.row
  if (!row) throw new Error('disposable billing row missing')

  dbQuery(`DELETE FROM public.billing_subscriptions WHERE id = '${BILLING_ID}'::uuid AND agency_profile_id = '${AGENCY}'::uuid;`)
  try {
    const { url, anon } = loadAnon()
    const owner = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const signed = await owner.auth.signInWithPassword(OWNER)
    if (signed.error) throw signed.error
    const read = await owner
      .from('billing_subscriptions')
      .select('status, current_period_end')
      .eq('agency_profile_id', AGENCY)
      .maybeSingle()
    if (read.error) throw new Error(read.error.message)
    if (read.data) throw new Error('expected no billing row')
    console.log(JSON.stringify({ no_billing_row: 'PASS', owner_read: null }))
  } finally {
    const payload = JSON.stringify(row).replace(/'/g, "''")
    dbQuery(`
      INSERT INTO public.billing_subscriptions
      SELECT * FROM jsonb_populate_record(NULL::public.billing_subscriptions, '${payload}'::jsonb)
      ON CONFLICT (id) DO NOTHING;
    `)
    const after = dbQuery(`
      SELECT jsonb_build_object('status', status, 'current_period_end', current_period_end) AS row
      FROM public.billing_subscriptions WHERE id = '${BILLING_ID}'::uuid;
    `)
    const restored = after.rows?.[0]?.row as { status?: string } | null
    if (restored?.status !== 'active') throw new Error('restore failed')
    console.log(JSON.stringify({ restore: 'PASS', row: restored }))
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
