/**
 * Multi-tenancy V1 Phase 4B — frontend workflow RPC cutover (source-only).
 * Run: npx tsx scripts/validate-multitenancy-phase4b.ts
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const srcRoot = join(root, 'src')

const PROTECTED_TXN_FIELDS = [
  'review_status',
  'reviewed_by',
  'reviewed_date',
  'review_return_reason',
  'review_returned_at',
  'review_returned_by',
  'producer_payment_status',
  'payment_batch_id',
  'paid_date',
  'paid_amount',
  'payment_method',
  'payment_reference',
  'voided_at',
  'voided_by',
  'void_reason',
  'agency_commission_confirmed',
  'agency_commission_receipt_id',
  'amount_received',
  'received_date',
] as const

const WORKFLOW_RPC_BINDINGS: Array<{ fn: string; rpc: string; constant: string }> = [
  { fn: 'voidTransaction', rpc: 'void_transaction', constant: 'VOID_TRANSACTION_RPC' },
  { fn: 'approveTransactionReview', rpc: 'approve_transaction_review', constant: 'APPROVE_TRANSACTION_REVIEW_RPC' },
  { fn: 'submitTransactionForReview', rpc: 'submit_transaction_for_review', constant: 'SUBMIT_TRANSACTION_FOR_REVIEW_RPC' },
  { fn: 'returnTransactionForCorrection', rpc: 'return_transaction_for_correction', constant: 'RETURN_TRANSACTION_FOR_CORRECTION_RPC' },
  { fn: 'confirmAgencyCommissionReceived', rpc: 'confirm_agency_commission_received', constant: 'CONFIRM_AGENCY_COMMISSION_RECEIVED_RPC' },
  { fn: 'markProducerCommissionReady', rpc: 'mark_producer_commission_ready', constant: 'MARK_PRODUCER_COMMISSION_READY_RPC' },
]

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

function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full))
      continue
    }
    if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

function sliceFunctionBody(source: string, fnName: string): string {
  const start = source.indexOf(`export async function ${fnName}`)
  if (start < 0) return ''
  const nextExport = source.indexOf('\nexport ', start + 1)
  return nextExport < 0 ? source.slice(start) : source.slice(start, nextExport)
}

function privilegedUpdateHits(source: string, relPath: string): string[] {
  const hits: string[] = []
  const updateRe = /\.from\(\s*['"]transactions['"]\s*\)[\s\S]{0,200}?\.update\(\s*\{([\s\S]*?)\}\s*\)/g
  let match: RegExpExecArray | null
  while ((match = updateRe.exec(source)) !== null) {
    const block = match[1]
    for (const field of PROTECTED_TXN_FIELDS) {
      const keyRe = new RegExp(`\\b${field}\\s*:`)
      if (keyRe.test(block)) {
        hits.push(`${relPath}: privileged field ${field} in transactions.update()`)
      }
    }
  }
  return hits
}

const commission = readSrc('src/lib/commission.ts')

console.log('A. Workflow functions call Phase 3C RPCs')
{
  for (const { fn, rpc, constant } of WORKFLOW_RPC_BINDINGS) {
    const body = sliceFunctionBody(commission, fn)
    assert(
      body.includes(`supabase.rpc(${constant}`) || body.includes(`supabase.rpc('${rpc}'`),
      `${fn} invokes ${rpc}`,
    )
    assert(!/\.from\('transactions'\)[\s\S]{0,120}\.update\([\s\S]{0,400}review_status/.test(body), `${fn} does not patch review_status`)
    assert(!/\.from\('transactions'\)[\s\S]{0,120}\.update\([\s\S]{0,400}voided_at/.test(body), `${fn} does not patch voided_at`)
    assert(!/\.from\('transactions'\)[\s\S]{0,120}\.update\([\s\S]{0,400}producer_payment_status/.test(body), `${fn} does not patch producer_payment_status`)
    assert(!/\.from\('transactions'\)[\s\S]{0,120}\.update\([\s\S]{0,400}agency_commission_confirmed/.test(body), `${fn} does not patch agency_commission_confirmed`)
  }
}

console.log('B. Receipt confirm is atomic via RPC (no receipt insert + txn patch)')
{
  const body = sliceFunctionBody(commission, 'confirmAgencyCommissionReceived')
  assert(
    body.includes('CONFIRM_AGENCY_COMMISSION_RECEIVED_RPC') ||
      body.includes('confirm_agency_commission_received'),
    'confirm uses RPC',
  )
  assert(!body.includes(".from('agency_commission_receipts')"), 'confirm does not insert receipts directly')
  assert(!body.includes('update_after_receipt_insert'), 'confirm does not patch transaction after receipt insert')
}

console.log('C. Payment batching still uses RPCs')
{
  assert(commission.includes("supabase.rpc('create_producer_payment_batch_with_recoveries'"), 'batch create RPC retained')
  assert(commission.includes('CONFIRM_PRODUCER_PAID_RPC'), 'confirm paid RPC retained')
  assert(commission.includes("supabase.rpc(CONFIRM_PRODUCER_PAID_RPC"), 'confirm paid invokes RPC')
}

console.log('D. Protected-field src/ audit — category 4 must be zero')
{
  const category4: string[] = []

  for (const file of listSourceFiles(srcRoot)) {
    const rel = file.slice(root.length + 1).replace(/\\/g, '/')
    const source = readFileSync(file, 'utf8')
    category4.push(...privilegedUpdateHits(source, rel))
  }

  const uniqueCat4 = [...new Set(category4)]
  assert(uniqueCat4.length === 0, `zero direct privileged transaction UPDATEs (found ${uniqueCat4.length})`)
  if (uniqueCat4.length > 0) {
    for (const hit of uniqueCat4) console.error(`    CAT4: ${hit}`)
  }
  assert(commission.includes('submit_transaction_for_review'), 'RPC names present in commission.ts')
  assert(
    /review_status/.test(readSrc('src/pages/Transactions.tsx')),
    'read/display usages remain in Transactions page',
  )
}

console.log('E. RPC constants exported for workflow cutover')
{
  assert(commission.includes('SUBMIT_TRANSACTION_FOR_REVIEW_RPC'), 'submit RPC constant')
  assert(commission.includes('CONFIRM_AGENCY_COMMISSION_RECEIVED_RPC'), 'confirm receipt RPC constant')
  assert(commission.includes('formatWorkflowRpcError'), 'workflow RPC error formatter')
}

console.log('')
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
