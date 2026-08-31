/**
 * STAGING ONLY — restore Agency B UAT branding after Phase 4E JWT cleanup.
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const PRODUCTION_REF = 'rwxhqvrpqbkrrfamizgn'
const AGENCY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const B_TXN_MATCH = 'b7000000-0000-4000-8000-0000000000b7'
const B_STMT = 'b9000000-0000-4000-8000-0000000000b9'
const PASSWORD = 'StagingTest!PayoutV1-2026'

function readLinkedRef(): string {
  return readFileSync(resolve('supabase/.temp/project-ref'), 'utf8').trim()
}

function loadKeys() {
  const json = execSync(`npx supabase projects api-keys --project-ref ${STAGING_REF} -o json`, { encoding: 'utf8' })
  const raw = JSON.parse(json.replace(/^\uFEFF/, ''))
  const list = Array.isArray(raw) ? raw : raw?.api_keys ?? []
  let anon = ''
  for (const row of list) {
    const name = String(row.name ?? row.id ?? '').toLowerCase()
    const key = String(row.api_key ?? row.key ?? '')
    if (name.includes('anon')) anon = key
  }
  if (!anon) throw new Error('missing anon')
  return { url: `https://${STAGING_REF}.supabase.co`, anon }
}

async function main() {
  const linked = readLinkedRef()
  if (linked !== STAGING_REF || linked === PRODUCTION_REF) throw new Error(`ABORT ${linked}`)
  const { url, anon } = loadKeys()
  const b = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error } = await b.auth.signInWithPassword({ email: 'owner.2ag.b@example.invalid', password: PASSWORD })
  if (error) throw error
  const png = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  )
  const brand = await b.storage.from('agency-branding').upload(`${AGENCY_B}/logo.png`, png, { upsert: true, contentType: 'image/png' })
  const doc = await b.storage.from('supporting-documents').upload(`${AGENCY_B}/transaction/${B_TXN_MATCH}/2ag-b-doc.txt`, new Blob(['2AG-B doc']), { upsert: true })
  const recon = await b.storage.from('reconciliation-statements').upload(`${AGENCY_B}/${B_STMT}/2AG-B-statement.csv`, new Blob(['2AG-B stmt']), { upsert: true })
  if (brand.error) throw brand.error
  if (doc.error) throw doc.error
  if (recon.error) throw recon.error
  console.log('reseeded Agency B storage for UAT')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
