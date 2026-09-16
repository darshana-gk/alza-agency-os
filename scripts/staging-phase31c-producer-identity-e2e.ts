/**
 * STAGING ONLY — producer identity security (does NOT touch Phase31C data).
 * Uses existing payout-v1 producer login. Aborts on production.
 *
 * Run: npx tsx scripts/staging-phase31c-producer-identity-e2e.ts
 */
import { createClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const PRODUCTION_REF = 'rwxhqvrpqbkrrfamizgn'
const PHASE31C_USER = '85954e2c-06b8-4af9-9083-3dd666aba3d3'
const PHASE31C_PRODUCER_ID = '2c273a9c-a180-4878-b007-6da9dfcd3ac2'
const PAYOUT_PRODUCER_EMAIL = 'producer.payout.v1@example.invalid'
const PAYOUT_PASSWORD = 'StagingTest!PayoutV1-2026'
const FORGED_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'

type Check = { id: string; passed: boolean; detail: string }
const checks: Check[] = []

function assert(id: string, passed: boolean, detail: string) {
  checks.push({ id, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} ${id} — ${detail}`)
}

function loadKeys(): { url: string; anon: string; service: string } {
  const path = resolve('tmp-staging-api-keys.json')
  if (!existsSync(path)) {
    const json = execSync(`npx supabase projects api-keys --project-ref ${STAGING_REF} -o json`, {
      encoding: 'utf8',
    })
    writeFileSync(path, json.replace(/^\uFEFF/, '').trim(), 'utf8')
  }
  const raw = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  const list = Array.isArray(raw) ? raw : raw?.api_keys ?? []
  let anon = ''
  let service = ''
  for (const row of list) {
    const name = String(row.name ?? row.id ?? row.description ?? '').toLowerCase()
    const key = String(row.api_key ?? row.key ?? '')
    if (name.includes('anon')) anon = key
    if (name.includes('service')) service = key
  }
  if (!anon || !service) throw new Error('missing staging keys')
  const url = `https://${STAGING_REF}.supabase.co`
  if (url.includes(PRODUCTION_REF)) throw new Error('ABORT production')
  return { url, anon, service }
}

async function main() {
  if (STAGING_REF === PRODUCTION_REF) throw new Error('ABORT production')
  const { url, anon, service } = loadKeys()
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })

  const phase31c = await admin
    .from('users')
    .select('id, producer_id, full_name')
    .eq('id', PHASE31C_USER)
    .maybeSingle()
  assert(
    'phase31c_link_untouched',
    String(phase31c.data?.producer_id) === PHASE31C_PRODUCER_ID,
    `producer_id=${phase31c.data?.producer_id}`,
  )

  const producer = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const signIn = await producer.auth.signInWithPassword({
    email: PAYOUT_PRODUCER_EMAIL,
    password: PAYOUT_PASSWORD,
  })
  assert('payout_producer_signin', !signIn.error, signIn.error?.message ?? 'signed in')
  if (signIn.error) throw new Error(signIn.error.message)

  const me = await producer.from('users').select('id, producer_id, full_name, invite_status').maybeSingle()
  const originalId = (me.data?.producer_id as string | null) ?? null
  assert('producer_profile_has_id_column', Object.prototype.hasOwnProperty.call(me.data ?? {}, 'producer_id'), 'producer_id selected')

  const rpc = await producer.rpc('current_producer_name')
  assert('rpc_current_producer_name', !rpc.error && Boolean(String(rpc.data ?? '').trim()), rpc.error?.message ?? String(rpc.data))

  const forged = await producer
    .from('users')
    .update({ producer_id: FORGED_ID })
    .eq('id', me.data?.id)
    .select('id, producer_id')
  assert(
    'producer_cannot_self_change_producer_id',
    Boolean(forged.error) || (forged.data ?? []).length === 0,
    forged.error?.message ?? `n=${forged.data?.length}`,
  )

  if (originalId) {
    const swap = await producer
      .from('users')
      .update({ producer_id: PHASE31C_PRODUCER_ID })
      .eq('id', me.data?.id)
      .select('id, producer_id')
    assert(
      'producer_cannot_point_at_other_producer',
      Boolean(swap.error) || String(swap.data?.[0]?.producer_id) === originalId,
      swap.error?.message ?? `producer_id=${swap.data?.[0]?.producer_id}`,
    )
  }

  const txs = await producer.from('transactions').select('id, producer')
  const other = (txs.data ?? []).filter((r) => String(r.producer ?? '') === 'Alex Morgan')
  assert(
    'payout_producer_does_not_see_alex_morgan_book',
    other.length === 0,
    `alexRows=${other.length} total=${txs.data?.length ?? 0}`,
  )

  const after = await admin.from('users').select('producer_id').eq('id', PHASE31C_USER).maybeSingle()
  assert(
    'phase31c_still_alex_morgan',
    String(after.data?.producer_id) === PHASE31C_PRODUCER_ID,
    `producer_id=${after.data?.producer_id}`,
  )

  const failed = checks.filter((c) => !c.passed).length
  console.log(`\n${checks.length - failed} passed, ${failed} failed`)
  if (existsSync(resolve('tmp-staging-api-keys.json'))) unlinkSync(resolve('tmp-staging-api-keys.json'))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  if (existsSync(resolve('tmp-staging-api-keys.json'))) unlinkSync(resolve('tmp-staging-api-keys.json'))
  process.exit(1)
})
