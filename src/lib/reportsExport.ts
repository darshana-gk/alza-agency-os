import ExcelJS from 'exceljs'
import {
  formatLabel,
  formatTypeLabel,
  type CommissionTransaction,
} from './commission'
import { producerKeysMatch } from './permissions'

export type ReportExportKpis = {
  total: number
  currentMonth: number
  currentYearTotal: number
  agencyNet: number
  earned: number
  ready: number
  paid: number
}

export type ReportMonthlyBreakdownRow = {
  month: string
  producer: string
  count: number
  premiumVolume: number
  agencyCommission: number
  brokerFees: number
  producerCommission: number
  agencyNet: number
}

export type ReportExportFilters = {
  year: string
  month: string
  dateFrom: string
  dateTo: string
  producer: string
  client: string
  policy: string
  transactionType: string
  producerPaymentStatus: string
}

export type ReportExportSecurity = {
  /** True when lists must be restricted to the caller's own producer book. */
  producerBookScoped: boolean
  /** Canonical producer TEXT for scoped users; null means empty export. */
  lockedProducerName: string | null
}

const CURRENCY_FMT = '$#,##0.00;($#,##0.00)'
const DATE_FMT = 'yyyy-mm-dd'

function displayFilter(value: string, allToken = 'all'): string {
  if (!value || value === allToken) return 'All'
  return value
}

function isoToExcelDate(iso: string): Date | string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso || ''
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  // Local calendar date — avoids UTC day-shift for Excel cells.
  return new Date(y, mo - 1, d)
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true }
  row.alignment = { vertical: 'middle' }
}

function autoSizeColumns(sheet: ExcelJS.Worksheet, min = 10, max = 36) {
  sheet.columns.forEach((col) => {
    let width = min
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const raw = cell.value
      let len = 0
      if (raw == null) len = 0
      else if (typeof raw === 'number') len = String(raw).length + 2
      else if (raw instanceof Date) len = 12
      else if (typeof raw === 'object' && 'text' in raw) len = String((raw as { text: string }).text).length
      else len = String(raw).length
      width = Math.min(max, Math.max(width, len + 2))
    })
    col.width = width
  })
}

function applyCurrency(cell: ExcelJS.Cell, amount: number) {
  cell.value = amount
  cell.numFmt = CURRENCY_FMT
}

function applyDate(cell: ExcelJS.Cell, iso: string) {
  const v = isoToExcelDate(iso)
  if (v instanceof Date) {
    cell.value = v
    cell.numFmt = DATE_FMT
  } else {
    cell.value = v
  }
}

/**
 * Defense-in-depth: book-scoped exports may only contain the locked producer.
 * Does not trust the UI producer filter alone.
 */
function assertProducerBookSecurity(
  detailRows: CommissionTransaction[],
  monthlyBreakdown: ReportMonthlyBreakdownRow[],
  security: ReportExportSecurity,
): void {
  if (!security.producerBookScoped) return
  const locked = (security.lockedProducerName ?? '').trim()
  if (!locked) {
    if (detailRows.length > 0 || monthlyBreakdown.length > 0) {
      throw new Error('Producer export blocked: no authorized producer book match.')
    }
    return
  }
  const badDetail = detailRows.some((tx) => !producerKeysMatch(tx.producer, locked))
  const badMonthly = monthlyBreakdown.some((row) => !producerKeysMatch(row.producer, locked))
  if (badDetail || badMonthly) {
    throw new Error('Producer export blocked: data outside authorized producer book.')
  }
}

function downloadBlob(buffer: ExcelJS.Buffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function buildReportExportFilename(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `ALZA-Flow-Producer-Revenue-${y}-${m}-${d}.xlsx`
}

/**
 * Download Producer Revenue Excel from the same filtered datasets powering Reports.
 * Does not recalculate commissions — writes the provided KPI / monthly / detail values.
 */
export async function exportProducerRevenueReport(params: {
  filters: ReportExportFilters
  kpis: ReportExportKpis
  monthlyBreakdown: ReportMonthlyBreakdownRow[]
  detailRows: CommissionTransaction[]
  security: ReportExportSecurity
}): Promise<void> {
  assertProducerBookSecurity(params.detailRows, params.monthlyBreakdown, params.security)

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'ALZA Flow'
  workbook.created = new Date()

  // ---- Summary ----
  const summary = workbook.addWorksheet('Summary')
  summary.getCell('A1').value = 'ALZA Flow - Producer Revenue Report'
  summary.getCell('A1').font = { bold: true, size: 14 }
  summary.getCell('A2').value = 'Generated'
  summary.getCell('B2').value = new Date()
  summary.getCell('B2').numFmt = 'yyyy-mm-dd hh:mm:ss'

  summary.getCell('A4').value = 'Applied Filters'
  summary.getCell('A4').font = { bold: true }

  const filterRows: Array<[string, string]> = [
    ['Year', displayFilter(params.filters.year)],
    ['Month', displayFilter(params.filters.month)],
    ['Date From', params.filters.dateFrom || 'All'],
    ['Date To', params.filters.dateTo || 'All'],
    ['Producer', displayFilter(params.filters.producer)],
    ['Client', displayFilter(params.filters.client)],
    ['Policy', displayFilter(params.filters.policy)],
    ['Transaction Type', displayFilter(params.filters.transactionType)],
    ['Producer Payment Status', displayFilter(params.filters.producerPaymentStatus)],
  ]
  filterRows.forEach(([label, value], i) => {
    summary.getCell(`A${5 + i}`).value = label
    summary.getCell(`B${5 + i}`).value = value
  })

  const kpiStart = 5 + filterRows.length + 2
  summary.getCell(`A${kpiStart}`).value = 'Key Metrics'
  summary.getCell(`A${kpiStart}`).font = { bold: true }

  const kpiRows: Array<[string, number]> = [
    ['Total Producer Commission', params.kpis.total],
    ['Current Month Producer Commission', params.kpis.currentMonth],
    ['Current Year Producer Commission', params.kpis.currentYearTotal],
    ['Agency Net Commission', params.kpis.agencyNet],
    ['Producer Commission Earned', params.kpis.earned],
    ['Producer Commission Ready', params.kpis.ready],
    ['Producer Commission Paid', params.kpis.paid],
  ]
  kpiRows.forEach(([label, amount], i) => {
    summary.getCell(`A${kpiStart + 1 + i}`).value = label
    applyCurrency(summary.getCell(`B${kpiStart + 1 + i}`), amount)
  })
  autoSizeColumns(summary, 14, 42)

  // ---- Monthly Breakdown ----
  const monthly = workbook.addWorksheet('Monthly Breakdown')
  monthly.addRow([
    'Month',
    'Producer',
    'Transactions',
    'Premium Volume',
    'Agency Commission',
    'Broker Fees',
    'Producer Commission',
    'Agency Net',
  ])
  styleHeaderRow(monthly.getRow(1))
  monthly.views = [{ state: 'frozen', ySplit: 1 }]

  for (const row of params.monthlyBreakdown) {
    const excelRow = monthly.addRow([
      row.month,
      row.producer,
      row.count,
      row.premiumVolume,
      row.agencyCommission,
      row.brokerFees,
      row.producerCommission,
      row.agencyNet,
    ])
    applyCurrency(excelRow.getCell(4), row.premiumVolume)
    applyCurrency(excelRow.getCell(5), row.agencyCommission)
    applyCurrency(excelRow.getCell(6), row.brokerFees)
    applyCurrency(excelRow.getCell(7), row.producerCommission)
    applyCurrency(excelRow.getCell(8), row.agencyNet)
  }
  autoSizeColumns(monthly)

  // ---- Transaction Detail ----
  const detail = workbook.addWorksheet('Transaction Detail')
  detail.addRow([
    'Date',
    'Transaction #',
    'Client',
    'Policy',
    'Type',
    'Amount',
    'Producer',
    'Agency Commission',
    'Broker Fee',
    'Producer Commission',
    'Agency Net',
    'Payment Status',
  ])
  styleHeaderRow(detail.getRow(1))
  detail.views = [{ state: 'frozen', ySplit: 1 }]

  for (const tx of params.detailRows) {
    const excelRow = detail.addRow([
      null,
      tx.transactionNumber || '',
      tx.clientName || '',
      tx.policyNumber || '',
      formatTypeLabel(tx.type),
      tx.amount,
      tx.producer || '',
      tx.agencyCommissionAmount,
      tx.brokerFee,
      tx.producerCommissionAmount,
      tx.agencyNetCommission,
      formatLabel(tx.producerPaymentStatus),
    ])
    applyDate(excelRow.getCell(1), tx.transactionDate)
    applyCurrency(excelRow.getCell(6), tx.amount)
    applyCurrency(excelRow.getCell(8), tx.agencyCommissionAmount)
    applyCurrency(excelRow.getCell(9), tx.brokerFee)
    applyCurrency(excelRow.getCell(10), tx.producerCommissionAmount)
    applyCurrency(excelRow.getCell(11), tx.agencyNetCommission)
  }
  autoSizeColumns(detail)

  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(buffer, buildReportExportFilename())
}
