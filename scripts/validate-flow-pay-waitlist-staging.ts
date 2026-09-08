/**
 * STAGING ONLY — Flow Pay waitlist V1.
 * Target uzckhxpqnipnovplohpf. Aborts on production.
 *
 * Run: npx tsx scripts/validate-flow-pay-waitlist-staging.ts
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BILLING_CHECKOUT_SKUS,
  quoteCheckoutSelection,
} from '../src/lib/billingCatalog.ts'

const STAGING_REF = 'uzckhxpqnipnovplohpf'
const PRODUCTION_REF = 'rwxhqvrpqbkrrfamizgn'
const AGENCY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const AGENCY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
const PASSWORD = 'StagingTest!PayoutV1-2026'
const SUPPORT_PASSWORD = 'StagingTest!SupportV1-2026'

const A_OWNER = { email: 'owner.payout.v1@example.invalid', password: PASSWORD }
const B_OWNER = { email: 'owner.2ag.b@example.invalid', password: PASSWORD }
const SUPPORT = { email: 'alza.support.staging@example.invalid', password: SUPPORT_PASSWORD }

let passed = 0
let failed = 0

function assert(condition: unknown, message: string) {
  if (condition) {
    passed += 1
    console.log(`  OK: ${message}`)
    return
  }
  failed += 1
  console.error(`  FAIL: ${message}`)
}

function loadKeys(): { url: string; anon: string } {
  const linked = readFileSync(resolve('supabase/.temp/linked-project.json'), 'utf8')
  const ref = JSON.parse(linked).ref as string
  if (ref !== STAGING_REF) throw new Error(`ABORT: linked ${ref} is not staging`)
  if (ref === PRODUCTION_REF) throw new Error('ABORT: production')
  const json = execSync(`npx supabase projects api-keys --project-ref ${STAGING_REF} -o json`, {
    encoding: 'utf8',
  })
  const raw = JSON.parse(json.replace(/^\uFEFF/, ''))
  const list = Array.isArray(raw) ? raw : raw?.api_keys ?? []
  let anon = ''
  for (const row of list) {
    const name = String(row.name ?? row.id ?? '').toLowerCase()
    const key = String(row.api_key ?? row.key ?? '')
    if (name.includes('anon')) anon = key
  }
  if (!anon) throw new Error('missing staging anon key')
  return { url: `https://${STAGING_REF}.supabase.co`, anon }
}

async function signIn(url: string, anon: string, creds: { email: string; password: string }) {
  const c: SupabaseClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await c.auth.signInWithPassword(creds)
  if (error) throw new Error(`sign-in failed ${creds.email}: ${error.message}`)
  return c
}

async function main() {
  console.log('Flow Pay waitlist staging (uzckhxpqnipnovplohpf only)')
  const { url, anon } = loadKeys()
  if (url.includes(PRODUCTION_REF)) throw new Error('ABORT: production URL')

  const pay = quoteCheckoutSelection({
    product: 'alza_flow_pay',
    userBand: 'users_1_3',
    interval: 'monthly',
  })
  assert('error' in pay, 'Flow Pay still cannot checkout')
  assert(BILLING_CHECKOUT_SKUS.includes('flow_1_3_monthly'), 'ALZA Flow SKU unchanged')

  const stamp = Date.now()
  const aEmail = `flowpay.waitlist.a.${stamp}@example.invalid`
  const bEmail = `flowpay.waitlist.b.${stamp}@example.invalid`

  const aOwner = await signIn(url, anon, A_OWNER)
  const bOwner = await signIn(url, anon, B_OWNER)
  const support = await signIn(url, anon, SUPPORT)

  const aJoin = await aOwner.rpc('join_flow_pay_waitlist', {
    p_name: 'Agency A Waitlist Tester',
    p_work_email: aEmail,
    p_agency_name: 'Agency A Staging',
  })
  assert(!aJoin.error, `Agency A join: ${aJoin.error?.message ?? 'ok'}`)
  const aId = String(aJoin.data ?? '')
  assert(/^[0-9a-f-]{36}$/i.test(aId), `Agency A waitlist row id returned (${aId})`)

  const aSaved = await aOwner
    .from('flow_pay_waitlist')
    .select('id, agency_profile_id, submitted_by_user_id, created_at, status')
    .eq('id', aId)
    .maybeSingle()
  assert(aSaved.data?.agency_profile_id === AGENCY_A, 'Agency A row stamped to Agency A')
  assert(aSaved.data?.status === 'interested', 'Agency A status is interested')
  assert(Boolean(aSaved.data?.submitted_by_user_id), 'Agency A submitting user stored')
  assert(Boolean(aSaved.data?.created_at), 'Agency A created_at stored')

  const aDup = await aOwner.rpc('join_flow_pay_waitlist', {
    p_name: 'Agency A Waitlist Tester Again',
    p_work_email: aEmail.toUpperCase(),
    p_agency_name: 'Agency A Staging',
  })
  assert(!aDup.error, `Agency A duplicate join: ${aDup.error?.message ?? 'ok'}`)
  const aDupId = String(aDup.data ?? '')
  assert(Boolean(aId) && aDupId === aId, 'duplicate agency+email reuses the same row')

  const aOwn = await aOwner.from('flow_pay_waitlist').select('id').eq('id', aId)
  assert((aOwn.data?.length ?? 0) === 1, 'Agency A can read own waitlist row')

  const bJoin = await bOwner.rpc('join_flow_pay_waitlist', {
    p_name: '2AG-B Owner',
    p_work_email: bEmail,
    p_agency_name: '2AG-B Staging Agency',
  })
  assert(!bJoin.error, `Agency B join: ${bJoin.error?.message ?? 'ok'}`)
  const bId = String(bJoin.data ?? '')
  assert(/^[0-9a-f-]{36}$/i.test(bId), `Agency B waitlist row id returned (${bId})`)
  const bSaved = await bOwner
    .from('flow_pay_waitlist')
    .select('agency_profile_id')
    .eq('id', bId)
    .maybeSingle()
  assert(bSaved.data?.agency_profile_id === AGENCY_B, 'Agency B row stamped to Agency B')

  const bSeesA = await bOwner.from('flow_pay_waitlist').select('id, agency_profile_id').eq('id', aId)
  assert(!bSeesA.error, `Agency B select own-policy query: ${bSeesA.error?.message ?? 'ok'}`)
  assert((bSeesA.data?.length ?? 0) === 0, 'Agency B cannot see Agency A waitlist row')

  const aSeesB = await aOwner.from('flow_pay_waitlist').select('id, agency_profile_id').eq('id', bId)
  assert((aSeesB.data?.length ?? 0) === 0, 'Agency A cannot see Agency B waitlist row')

  const bDirectInsert = await bOwner.from('flow_pay_waitlist').insert({
    agency_profile_id: AGENCY_A,
    submitted_by_user_id: '00000000-0000-4000-8000-000000000001',
    name: 'forged',
    work_email: `forged.${stamp}@example.invalid`,
    agency_name: 'forged',
  })
  assert(Boolean(bDirectInsert.error), 'direct table INSERT is denied')

  const supportSeesA = await support.from('flow_pay_waitlist').select('id, agency_profile_id').eq('id', aId)
  const supportSeesB = await support.from('flow_pay_waitlist').select('id, agency_profile_id').eq('id', bId)
  assert((supportSeesA.data?.length ?? 0) === 1, 'ALZA Support can read Agency A waitlist')
  assert((supportSeesB.data?.length ?? 0) === 1, 'ALZA Support can read Agency B waitlist')

  const supportJoin = await support.rpc('join_flow_pay_waitlist', {
    p_name: 'Support',
    p_work_email: `support.${stamp}@example.invalid`,
    p_agency_name: 'ALZA',
  })
  assert(Boolean(supportJoin.error), 'ALZA Support cannot create a waitlist row')

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
  console.log('validate-flow-pay-waitlist-staging: ALL GREEN')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
