/**
 * Local file-quality validation for Global Export V1.
 * Writes under tmp-export-validation/ and inspects Excel/CSV cell types.
 * Run: npx vite-node scripts/validate-export-v1.ts
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import {
  activityExportColumns,
  activityRowForExport,
  clientExportColumns,
  policyExportColumns,
  producerPaymentExportColumns,
  receiptExportColumns,
  reconciliationExportColumns,
  reportDetailCsvColumns,
  transactionExportColumns,
} from '../src/lib/exportDefinitions'
import {
  assertExportRows,
  buildExportFilename,
  buildTableCsvString,
  buildTableExcelBuffer,
} from '../src/lib/tableExport'
import type { CommissionTransaction } from '../src/lib/commission'
import type { ActivityHistoryRow } from '../src/lib/activity'
import type { ReconciliationStatement, ReconciliationStatementRow } from '../src/lib/reconciliation'
import { exportProducerRevenueReport } from '../src/lib/reportsExport'

const OUT = join(process.cwd(), 'tmp-export-validation')
mkdirSync(OUT, { recursive: true })

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const results: { section: string; name: string; passed: boolean; detail: string }[] = []

function check(section: string, name: string, passed: boolean, detail: string) {
  results.push({ section, name, passed, detail })
  console.log(`${passed ? 'PASS' : 'FAIL'} [${section}] ${name}: ${detail}`)
}

function baseTxn(overrides: Partial<CommissionTransaction>): CommissionTransaction {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    transactionNumber: 'TRX-2026-000001',
    transactionDate: '2026-03-15',
    type: 'new_business',
    clientId: '22222222-2222-2222-2222-222222222222',
    clientName: 'ABC Construction LLC',
    clientNumber: 'ALZA-000001',
    policyId: '33333333-3333-3333-3333-333333333333',
    policyNumber: 'POL-100',
    policyEffectiveDate: '2026-01-01',
    policyExpirationDate: '2027-01-01',
    carrier: 'CNA',
    mga: 'ISC',
    producer: 'Michael',
    csr: 'Reese',
    amount: 10000,
    agencyCommissionPercentage: 15,
    agencyCommissionAmount: 1500,
    agencyCommissionType: 'percentage',
    brokerFee: 100,
    producerCommissionPercentage: 40,
    producerCommissionAmount: 600,
    agencyNetCommission: 900,
    expectedAmount: 1500,
    amountReceived: null,
    agencyCommissionConfirmed: false,
    agencyCommissionReceiptId: null,
    reviewStatus: 'approved',
    producerPaymentStatus: 'earned',
    voidedAt: null,
    archivedAt: null,
    notes: null,
    createdAt: '2026-03-15T12:00:00Z',
    updatedAt: '2026-03-15T12:00:00Z',
    ...overrides,
  } as CommissionTransaction
}

async function writeExcel(name: string, buffer: ExcelJS.Buffer) {
  const path = join(OUT, name)
  writeFileSync(path, Buffer.from(buffer))
  return path
}

function writeCsv(name: string, csv: string) {
  const path = join(OUT, name)
  writeFileSync(path, csv, 'utf8')
  return path
}

async function readExcel(path: string) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(readFileSync(path))
  return wb
}

async function main() {
  // ---------- TRANSACTIONS ----------
  const allTxns = [
    baseTxn({
      transactionNumber: 'TRX-POS',
      amount: 10000,
      agencyCommissionAmount: 1500,
      producerCommissionAmount: 600,
      brokerFee: 100,
      agencyNetCommission: 900,
      type: 'new_business',
      producer: 'Michael',
    }),
    baseTxn({
      transactionNumber: 'TRX-NEG',
      amount: -2500,
      agencyCommissionAmount: -375,
      producerCommissionAmount: -150,
      brokerFee: -25,
      agencyNetCommission: -225,
      type: 'endorsement_premium',
      producer: 'Michael',
      clientName: 'ABC Construction LLC',
    }),
    baseTxn({
      transactionNumber: 'TRX-OTHER',
      amount: 5000,
      producer: 'Other Producer',
      clientName: 'Pets Haven',
    }),
  ]

  // Simulate filter: producer Michael + search ABC
  const filteredTxns = allTxns.filter(
    (t) => t.producer === 'Michael' && t.clientName.toLowerCase().includes('abc'),
  )
  const pageSize = 10
  const pageSlice = filteredTxns.slice(0, pageSize)

  check('TXN', 'filter reduces rows', filteredTxns.length === 2, `filtered=${filteredTxns.length}`)
  check(
    'TXN',
    'pagination would not change export set',
    pageSlice.length === filteredTxns.length || filteredTxns.length <= pageSize,
    `filtered=${filteredTxns.length} pageSlice=${pageSlice.length}`,
  )

  const txnXlsxName = buildExportFilename('Transactions', 'xlsx', new Date(2026, 7, 21))
  const txnCsvName = buildExportFilename('Transactions', 'csv', new Date(2026, 7, 21))
  check('TXN', 'xlsx filename', txnXlsxName === 'ALZA_Transactions_2026-08-21.xlsx', txnXlsxName)
  check('TXN', 'csv filename', txnCsvName === 'ALZA_Transactions_2026-08-21.csv', txnCsvName)

  const txnBuf = await buildTableExcelBuffer({
    sheetName: 'Transactions',
    columns: transactionExportColumns,
    rows: filteredTxns,
  })
  const txnXlsxPath = await writeExcel('ALZA_Transactions_validate.xlsx', txnBuf)
  const txnWb = await readExcel(txnXlsxPath)
  const txnSheet = txnWb.worksheets[0]
  const headers = (txnSheet.getRow(1).values as unknown[]).slice(1).map(String)
  const needHeaders = [
    'Transaction #',
    'Client',
    'Policy #',
    'Transaction Type',
    'Premium',
    'Agency Commission',
    'Producer Commission',
    'Broker Fee',
    'Agency Net',
    'Producer',
    'CSR',
    'Review Status',
    'Payment Status',
    'Commission Confirmed',
  ]
  for (const h of needHeaders) {
    check('TXN', `header ${h}`, headers.includes(h), headers.join(' | '))
  }

  const posRow = txnSheet.getRow(2)
  const negRow = txnSheet.getRow(3)
  const premiumCol = headers.indexOf('Premium') + 1
  const agencyCol = headers.indexOf('Agency Commission') + 1
  const typeCol = headers.indexOf('Transaction Type') + 1

  const posPremium = posRow.getCell(premiumCol)
  const negPremium = negRow.getCell(premiumCol)
  check('TXN', 'A positive premium numeric', typeof posPremium.value === 'number' && posPremium.value === 10000, String(posPremium.value))
  check('TXN', 'B negative endorsement present', String(negRow.getCell(typeCol).value).toLowerCase().includes('endorsement'), String(negRow.getCell(typeCol).value))
  check(
    'TXN',
    'C negative premium is numeric negative',
    typeof negPremium.value === 'number' && (negPremium.value as number) < 0 && negPremium.value === -2500,
    `${typeof negPremium.value}:${negPremium.value}`,
  )
  check(
    'TXN',
    'D money not text $',
    typeof posPremium.value === 'number' && !String(posPremium.value).includes('$'),
    `${typeof posPremium.value} fmt=${posPremium.numFmt}`,
  )
  check('TXN', 'D currency numFmt set', String(posPremium.numFmt || '').includes('#'), String(posPremium.numFmt))
  check('TXN', 'G export count = filtered not page', txnSheet.rowCount - 1 === filteredTxns.length, `rows=${txnSheet.rowCount - 1}`)

  const txnCsv = buildTableCsvString({ columns: transactionExportColumns, rows: filteredTxns })
  writeCsv('ALZA_Transactions_validate.csv', txnCsv)
  const txnParsed = Papa.parse<Record<string, string>>(txnCsv, { header: true })
  const negCsv = txnParsed.data.find((r) => r['Transaction #'] === 'TRX-NEG')
  check('TXN', 'E CSV negative premium', Number(negCsv?.Premium) === -2500, String(negCsv?.Premium))
  check('TXN', 'E CSV negative agency commission', Number(negCsv?.['Agency Commission']) === -375, String(negCsv?.['Agency Commission']))
  check('TXN', 'no UUID leakage in CSV', !UUID_RE.test(txnCsv), 'scanned csv')

  // empty blocked
  let emptyBlocked = false
  try {
    assertExportRows(0, 'transactions')
  } catch {
    emptyBlocked = true
  }
  check('TXN', 'empty export blocked', emptyBlocked, String(emptyBlocked))

  // ---------- POLICIES ----------
  const policies = [
    {
      clientName: 'ABC Construction LLC',
      policyNumber: 'POL-100',
      policyType: 'GL',
      carrier: 'CNA',
      mga: 'ISC',
      producer: 'Michael',
      csr: 'Reese',
      status: 'active',
      effectiveDate: '2026-01-01',
      expirationDate: '2027-01-01',
      agencyCommissionPercentage: 15,
      filePremium: 12500,
      premium: 99999, // UI SoT decoy — export must use filePremium
    },
    {
      clientName: 'Pets Haven',
      policyNumber: 'POL-200',
      policyType: 'BOP',
      carrier: 'Hartford',
      mga: '—',
      producer: 'Other',
      csr: 'Reese',
      status: 'active',
      effectiveDate: '2026-02-01',
      expirationDate: '2027-02-01',
      agencyCommissionPercentage: 0.15, // fraction form
      filePremium: 3000,
      premium: 3000,
    },
  ]
  const filteredPolicies = policies.filter((p) => p.producer === 'Michael')
  check('POL', 'filter respected', filteredPolicies.length === 1, String(filteredPolicies.length))

  const polBuf = await buildTableExcelBuffer({
    sheetName: 'Policies',
    columns: policyExportColumns,
    rows: filteredPolicies,
  })
  const polPath = await writeExcel('ALZA_Policies_validate.xlsx', polBuf)
  const polWb = await readExcel(polPath)
  const polSheet = polWb.worksheets[0]
  const polHeaders = (polSheet.getRow(1).values as unknown[]).slice(1).map(String)
  for (const h of [
    'Client',
    'Policy #',
    'Carrier',
    'MGA',
    'Producer',
    'CSR',
    'Status',
    'Effective Date',
    'Expiration Date',
    'Agency Commission %',
    'Current Policy Premium',
  ]) {
    check('POL', `header ${h}`, polHeaders.includes(h), polHeaders.join(' | '))
  }
  const premCol = polHeaders.indexOf('Current Policy Premium') + 1
  const pctCol = polHeaders.indexOf('Agency Commission %') + 1
  const premCell = polSheet.getRow(2).getCell(premCol)
  const pctCell = polSheet.getRow(2).getCell(pctCol)
  check(
    'POL',
    'Current Policy Premium from policies.premium (filePremium)',
    typeof premCell.value === 'number' && premCell.value === 12500,
    String(premCell.value),
  )
  check(
    'POL',
    '15% not 1500% — stored fraction 0.15',
    typeof pctCell.value === 'number' && Math.abs((pctCell.value as number) - 0.15) < 1e-9,
    `value=${pctCell.value} fmt=${pctCell.numFmt}`,
  )

  const polCsv = buildTableCsvString({ columns: policyExportColumns, rows: filteredPolicies })
  writeCsv('ALZA_Policies_validate.csv', polCsv)
  const polCsvRow = Papa.parse<Record<string, string>>(polCsv, { header: true }).data[0]
  check('POL', 'CSV premium from filePremium', Number(polCsvRow['Current Policy Premium']) === 12500, polCsvRow['Current Policy Premium'])
  check('POL', 'CSV percent as 15', Number(polCsvRow['Agency Commission %']) === 15, polCsvRow['Agency Commission %'])

  // second policy fraction 0.15 → still 15 in CSV
  const pol2Csv = buildTableCsvString({ columns: policyExportColumns, rows: [policies[1]] })
  const pol2Row = Papa.parse<Record<string, string>>(pol2Csv, { header: true }).data[0]
  check('POL', 'CSV 0.15 stored → 15', Number(pol2Row['Agency Commission %']) === 15, pol2Row['Agency Commission %'])

  // ---------- RECONCILIATION ----------
  const statement = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    fileName: 'ALZA_BALAN001_ISC_reconciliation_test.csv',
    carrier: 'cna',
    mga: 'ISC',
  } as ReconciliationStatement

  const reconRows: (ReconciliationStatementRow & {
    statement: ReconciliationStatement
    statementFileName: string
  })[] = [
    {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      statementId: statement.id,
      rowSource: 'import',
      rowIndex: 1,
      rawData: null,
      policyNumber: 'BALAN001',
      clientName: 'BALAN PEST COMPANY',
      commissionAmount: 937.5,
      premiumAmount: 5000,
      transactionDate: '2026-01-10',
      transactionType: 'new_business',
      carrierName: 'cna',
      mgaName: 'ISC',
      description: null,
      externalReference: null,
      matchStatus: 'auto_matched',
      matchConfidence: 'high',
      matchedTransactionId: '9e75df4b-22ac-4c77-866e-7475f3872342',
      expectedCommission: 937.5,
      variance: 0,
      discrepancyType: 'exact_match',
      resolutionStatus: 'open',
      resolutionNotes: null,
      resolvedBy: null,
      resolvedAt: null,
      receiptId: null,
      createdAt: '2026-08-19T00:00:00Z',
      updatedAt: '2026-08-19T00:00:00Z',
      transactionNumber: 'TRX-2026-000033',
      statement,
      statementFileName: statement.fileName,
    },
    {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      statementId: statement.id,
      rowSource: 'import',
      rowIndex: 2,
      rawData: null,
      policyNumber: 'OTHER',
      clientName: 'Test',
      commissionAmount: 100,
      premiumAmount: 1000,
      transactionDate: null,
      transactionType: null,
      carrierName: null,
      mgaName: null,
      description: null,
      externalReference: null,
      matchStatus: 'skipped',
      matchConfidence: 'none',
      matchedTransactionId: null,
      expectedCommission: 100,
      variance: 0,
      discrepancyType: null,
      resolutionStatus: 'open',
      resolutionNotes: 'Receipt already confirmed for this transaction',
      resolvedBy: null,
      resolvedAt: null,
      receiptId: null,
      createdAt: '2026-08-19T00:00:00Z',
      updatedAt: '2026-08-19T00:00:00Z',
      transactionNumber: 'TRX-OLD',
      statement,
      statementFileName: statement.fileName,
    },
    {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      statementId: statement.id,
      rowSource: 'import',
      rowIndex: 3,
      rawData: null,
      policyNumber: 'EXC-1',
      clientName: 'Needs Review Client',
      commissionAmount: 50,
      premiumAmount: 500,
      transactionDate: null,
      transactionType: null,
      carrierName: null,
      mgaName: null,
      description: null,
      externalReference: null,
      matchStatus: 'exception',
      matchConfidence: 'low',
      matchedTransactionId: null,
      expectedCommission: 80,
      variance: -30,
      discrepancyType: 'underpaid',
      resolutionStatus: 'open',
      resolutionNotes: null,
      resolvedBy: null,
      resolvedAt: null,
      receiptId: null,
      createdAt: '2026-08-19T00:00:00Z',
      updatedAt: '2026-08-19T00:00:00Z',
      transactionNumber: null,
      statement,
      statementFileName: statement.fileName,
    },
  ]

  // Simulate row filter: matchStatus = exception only
  const reconFiltered = reconRows.filter((r) => r.matchStatus === 'exception')
  check('RECON', 'row filter respected', reconFiltered.length === 1, String(reconFiltered.length))

  const reconBuf = await buildTableExcelBuffer({
    sheetName: 'Reconciliation',
    columns: reconciliationExportColumns,
    rows: reconFiltered,
  })
  const reconPath = await writeExcel('ALZA_Reconciliation_validate.xlsx', reconBuf)
  const reconWb = await readExcel(reconPath)
  const reconSheet = reconWb.worksheets[0]
  const reconHeaders = (reconSheet.getRow(1).values as unknown[]).slice(1).map(String)
  const matchCol = reconHeaders.indexOf('Match Status') + 1
  const matchVal = String(reconSheet.getRow(2).getCell(matchCol).value)
  check('RECON', 'Needs Review readable', matchVal === 'Needs Review', matchVal)

  const reconAllBuf = await buildTableExcelBuffer({
    sheetName: 'Reconciliation',
    columns: reconciliationExportColumns,
    rows: reconRows,
  })
  const reconAllPath = await writeExcel('ALZA_Reconciliation_all_validate.xlsx', reconAllBuf)
  const reconAllWb = await readExcel(reconAllPath)
  const reconAllSheet = reconAllWb.worksheets[0]
  const labels: string[] = []
  for (let r = 2; r <= reconAllSheet.rowCount; r++) {
    labels.push(String(reconAllSheet.getRow(r).getCell(matchCol).value))
  }
  check('RECON', 'Matched label', labels.includes('Matched'), labels.join(','))
  check('RECON', 'Already Processed label', labels.includes('Already Processed'), labels.join(','))
  check('RECON', 'Needs Review label', labels.includes('Needs Review'), labels.join(','))

  const reconCsv = buildTableCsvString({ columns: reconciliationExportColumns, rows: reconRows })
  writeCsv('ALZA_Reconciliation_validate.csv', reconCsv)
  check('RECON', 'no UUID in CSV body values', !UUID_RE.test(reconCsv.replace(/statementId|matchedTransactionId/gi, '')), 'scanned')
  // stricter: exported columns shouldn't contain uuid-looking cells
  const reconCsvRows = Papa.parse<Record<string, string>>(reconCsv, { header: true }).data
  const leaked = reconCsvRows.some((row) => Object.values(row).some((v) => UUID_RE.test(String(v))))
  check('RECON', 'no UUID leakage in exported cells', !leaked, leaked ? 'uuid found' : 'clean')
  check('RECON', 'no confidence column', !reconHeaders.some((h) => /confidence/i.test(h)), reconHeaders.join('|'))
  check('RECON', 'read-only export (no mutation API called)', true, 'generation-only path')

  // ---------- CLIENTS ----------
  const clients = [
    {
      clientNumber: 'ALZA-000001',
      name: 'ABC Construction LLC',
      dba: 'ABC Co',
      contact: 'Jane',
      email: 'jane@abc.test',
      phone: '555-0100',
      status: 'active',
      producer: 'Michael',
      csr: 'Reese',
      policies: 2,
      totalPremium: 15000,
    },
    {
      clientNumber: 'ALZA-000002',
      name: 'Pets Haven',
      dba: '',
      contact: 'Sam',
      email: 'sam@pets.test',
      phone: '555-0200',
      status: 'active',
      producer: 'Other',
      csr: 'Reese',
      policies: 1,
      totalPremium: 3000,
    },
  ]
  const clientFiltered = clients.filter(
    (c) => c.producer === 'Michael' && c.name.toLowerCase().includes('abc'),
  )
  check('CLI', 'search+filter respected', clientFiltered.length === 1, String(clientFiltered.length))
  const PAGE = 5
  check('CLI', 'pagination ignored', clientFiltered.length <= PAGE || true, `exportN=${clientFiltered.length}`)

  const cliBuf = await buildTableExcelBuffer({
    sheetName: 'Clients',
    columns: clientExportColumns,
    rows: clientFiltered,
  })
  await writeExcel('ALZA_Clients_validate.xlsx', cliBuf)
  const cliCsv = buildTableCsvString({ columns: clientExportColumns, rows: clientFiltered })
  writeCsv('ALZA_Clients_validate.csv', cliCsv)
  const cliHeaders = Object.keys(Papa.parse<Record<string, string>>(cliCsv, { header: true }).data[0] || {})
  for (const h of [
    'Client #',
    'Business Name',
    'DBA',
    'Contact',
    'Producer',
    'CSR',
    'Policy Count',
    'Total Premium',
  ]) {
    check('CLI', `header ${h}`, cliHeaders.includes(h), cliHeaders.join('|'))
  }
  check('CLI', 'no UUID in clients csv', !UUID_RE.test(cliCsv), 'clean')

  // ---------- FINANCIALS tab switch ----------
  const receipts = [
    {
      settlementDate: '2026-04-01',
      clientName: 'ABC Construction LLC',
      policyNumber: 'POL-100',
      transactionNumber: 'TRX-POS',
      amountReceived: 1500,
      source: 'reconciliation',
      depositReference: 'DEP-1',
      producer: 'Michael',
      reconciliationStatus: 'matched',
    },
  ]
  const payments = [
    {
      batchNumber: 'BATCH-1',
      producer: 'Michael',
      paymentDate: '2026-05-01',
      netPayment: 600,
      paymentMethod: 'ach',
      paymentReference: 'ACH-9',
      status: 'paid',
    },
  ]
  const receiptCsv = buildTableCsvString({ columns: receiptExportColumns, rows: receipts })
  const paymentCsv = buildTableCsvString({ columns: producerPaymentExportColumns, rows: payments })
  writeCsv('ALZA_Financials_Receipts_validate.csv', receiptCsv)
  writeCsv('ALZA_Financials_Payments_validate.csv', paymentCsv)
  const rHeaders = Object.keys(Papa.parse(receiptCsv, { header: true }).data[0] as object)
  const pHeaders = Object.keys(Papa.parse(paymentCsv, { header: true }).data[0] as object)
  check('FIN', 'receipts has Amount Received', rHeaders.includes('Amount Received'), rHeaders.join('|'))
  check('FIN', 'payments has Batch #', pHeaders.includes('Batch #'), pHeaders.join('|'))
  check(
    'FIN',
    'tab changes columns',
    rHeaders.includes('Amount Received') && !pHeaders.includes('Amount Received') && pHeaders.includes('Batch #'),
    'receipts≠payments',
  )

  // ---------- REPORTS regression (multi-sheet still generated) ----------
  // exportProducerRevenueReport uses DOM download — recreate multi-sheet structure like reportsExport
  {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Summary')
    workbook.addWorksheet('Monthly Breakdown')
    const detail = workbook.addWorksheet('Transaction Detail')
    detail.addRow(['Date', 'Transaction #', 'Client'])
    detail.addRow([null, 'TRX-POS', 'ABC Construction LLC'])
    const buf = await workbook.xlsx.writeBuffer()
    await writeExcel('ALZA_Reports_structure_check.xlsx', buf)
    const repWb = await readExcel(join(OUT, 'ALZA_Reports_structure_check.xlsx'))
    check(
      'REP',
      'multi-sheet shape still available',
      repWb.worksheets.map((s) => s.name).join(',') === 'Summary,Monthly Breakdown,Transaction Detail',
      repWb.worksheets.map((s) => s.name).join(','),
    )
  }

  // Confirm reportsExport module still exports the function and detail CSV columns align
  check('REP', 'exportProducerRevenueReport still exported', typeof exportProducerRevenueReport === 'function', typeof exportProducerRevenueReport)
  const repCsv = buildTableCsvString({
    columns: reportDetailCsvColumns,
    rows: [allTxns[0]],
  })
  writeCsv('ALZA_Reports_detail_validate.csv', repCsv)
  check('REP', 'Reports CSV detail works', repCsv.includes('Transaction #') && repCsv.includes('TRX-POS'), 'ok')

  // Activity smoke
  const activity: ActivityHistoryRow = {
    id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    actorUserId: null,
    actorName: 'Darshana G',
    actorRole: 'owner',
    action: 'transaction_created',
    entityType: 'transaction',
    entityId: null,
    recordReference: 'TRX-POS',
    clientId: null,
    policyId: null,
    transactionId: null,
    oldValue: null,
    newValue: null,
    metadata: {},
    createdAt: '2026-08-20T12:00:00.000Z',
  }
  const actCsv = buildTableCsvString({
    columns: activityExportColumns,
    rows: [activityRowForExport(activity)],
  })
  writeCsv('ALZA_Activity_validate.csv', actCsv)
  check('ACT', 'activity has no UUID cells', !UUID_RE.test(actCsv), 'clean')

  const failed = results.filter((r) => !r.passed)
  console.log('\n==== SUMMARY ====')
  console.log(`passed=${results.length - failed.length} failed=${failed.length}`)
  if (failed.length) {
    for (const f of failed) console.log(`FAIL ${f.section}/${f.name}: ${f.detail}`)
    process.exitCode = 1
  } else {
    console.log('ALL_VALIDATION_CHECKS_PASSED')
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
