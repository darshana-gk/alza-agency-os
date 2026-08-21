import ExcelJS from 'exceljs'
import Papa from 'papaparse'

const CURRENCY_FMT = '$#,##0.00;($#,##0.00)'
const DATE_FMT = 'yyyy-mm-dd'
const DATETIME_FMT = 'yyyy-mm-dd hh:mm:ss'
const PERCENT_FMT = '0.00%'

export type ExportCellValue = string | number | Date | boolean | null | undefined

export type ExportColumnType = 'text' | 'number' | 'currency' | 'date' | 'datetime' | 'percent'

export type ExportColumn<T> = {
  header: string
  value: (row: T) => ExportCellValue
  type?: ExportColumnType
}

export type TableExportFormat = 'xlsx' | 'csv'

function downloadBlob(blob: Blob, filename: string) {
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

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** ALZA_Transactions_2026-08-21.xlsx */
export function buildExportFilename(
  entity: string,
  format: TableExportFormat,
  now = new Date(),
  suffix?: string | null,
): string {
  const y = now.getFullYear()
  const m = pad2(now.getMonth() + 1)
  const d = pad2(now.getDate())
  const safeEntity = entity.replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
  const safeSuffix = suffix
    ? `_${String(suffix).replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')}`
    : ''
  return `ALZA_${safeEntity}${safeSuffix}_${y}-${m}-${d}.${format}`
}

export function assertExportRows(rowCount: number, label = 'records'): void {
  if (rowCount <= 0) {
    throw new Error(`No ${label} to export. Adjust filters or search and try again.`)
  }
}

function isoToExcelDate(iso: string): Date | string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso).trim())
  if (!m) return iso || ''
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

function isoToExcelDateTime(iso: string): Date | string {
  const raw = String(iso ?? '').trim()
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return d
}

function toFiniteNumber(value: ExportCellValue): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.getTime()
  const n = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true }
  row.alignment = { vertical: 'middle' }
}

function autoSizeColumns(sheet: ExcelJS.Worksheet, min = 10, max = 40) {
  sheet.columns.forEach((col) => {
    let width = min
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const raw = cell.value
      let len = 0
      if (raw == null) len = 0
      else if (typeof raw === 'number') len = String(raw).length + 2
      else if (raw instanceof Date) len = 12
      else if (typeof raw === 'object' && raw && 'text' in raw) len = String((raw as { text: string }).text).length
      else len = String(raw).length
      width = Math.min(max, Math.max(width, len + 2))
    })
    col.width = width
  })
}

function applyExcelCell(cell: ExcelJS.Cell, value: ExportCellValue, type: ExportColumnType = 'text') {
  if (value == null || value === '') {
    cell.value = ''
    return
  }

  if (type === 'currency' || type === 'number') {
    const n = toFiniteNumber(value)
    if (n == null) {
      cell.value = String(value)
      return
    }
    cell.value = n
    if (type === 'currency') cell.numFmt = CURRENCY_FMT
    return
  }

  if (type === 'percent') {
    const n = toFiniteNumber(value)
    if (n == null) {
      cell.value = String(value)
      return
    }
    // Values stored as 15 meaning 15% → Excel percent fraction
    cell.value = Math.abs(n) > 1 ? n / 100 : n
    cell.numFmt = PERCENT_FMT
    return
  }

  if (type === 'date') {
    if (value instanceof Date) {
      cell.value = value
      cell.numFmt = DATE_FMT
      return
    }
    const v = isoToExcelDate(String(value))
    if (v instanceof Date) {
      cell.value = v
      cell.numFmt = DATE_FMT
    } else {
      cell.value = v
    }
    return
  }

  if (type === 'datetime') {
    if (value instanceof Date) {
      cell.value = value
      cell.numFmt = DATETIME_FMT
      return
    }
    const v = isoToExcelDateTime(String(value))
    if (v instanceof Date) {
      cell.value = v
      cell.numFmt = DATETIME_FMT
    } else {
      cell.value = v
    }
    return
  }

  if (typeof value === 'boolean') {
    cell.value = value ? 'Yes' : 'No'
    return
  }

  cell.value = value instanceof Date ? value.toISOString() : String(value)
}

function csvCell(value: ExportCellValue, type: ExportColumnType = 'text'): string | number {
  if (value == null || value === '') return ''
  if (type === 'currency' || type === 'number') {
    const n = toFiniteNumber(value)
    return n == null ? String(value) : n
  }
  if (type === 'percent') {
    const n = toFiniteNumber(value)
    if (n == null) return String(value)
    const pct = Math.abs(n) <= 1 ? n * 100 : n
    return pct
  }
  if (type === 'date') {
    if (value instanceof Date) {
      return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`
    }
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(value))
    return m ? m[1] : String(value)
  }
  if (type === 'datetime') {
    if (value instanceof Date) return value.toISOString()
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

export async function buildTableExcelBuffer<T>(params: {
  sheetName: string
  columns: ExportColumn<T>[]
  rows: T[]
  label?: string
}): Promise<ExcelJS.Buffer> {
  assertExportRows(params.rows.length, params.label ?? 'records')

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'ALZA Flow'
  workbook.created = new Date()

  const sheet = workbook.addWorksheet(params.sheetName.slice(0, 31) || 'Export')
  sheet.addRow(params.columns.map((c) => c.header))
  styleHeaderRow(sheet.getRow(1))
  sheet.views = [{ state: 'frozen', ySplit: 1 }]

  for (const row of params.rows) {
    const excelRow = sheet.addRow(params.columns.map(() => null))
    params.columns.forEach((col, i) => {
      applyExcelCell(excelRow.getCell(i + 1), col.value(row), col.type ?? 'text')
    })
  }

  autoSizeColumns(sheet)
  return workbook.xlsx.writeBuffer()
}

export function buildTableCsvString<T>(params: {
  columns: ExportColumn<T>[]
  rows: T[]
  label?: string
}): string {
  assertExportRows(params.rows.length, params.label ?? 'records')

  const data = params.rows.map((row) => {
    const obj: Record<string, string | number> = {}
    for (const col of params.columns) {
      obj[col.header] = csvCell(col.value(row), col.type ?? 'text')
    }
    return obj
  })

  return Papa.unparse(data, { header: true })
}

export async function downloadTableExcel<T>(params: {
  sheetName: string
  columns: ExportColumn<T>[]
  rows: T[]
  filename: string
  label?: string
}): Promise<void> {
  const buffer = await buildTableExcelBuffer(params)
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    params.filename.endsWith('.xlsx') ? params.filename : `${params.filename}.xlsx`,
  )
}

export function downloadTableCsv<T>(params: {
  columns: ExportColumn<T>[]
  rows: T[]
  filename: string
  label?: string
}): void {
  const csv = buildTableCsvString(params)
  downloadBlob(
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    params.filename.endsWith('.csv') ? params.filename : `${params.filename}.csv`,
  )
}

export async function downloadTableExport<T>(params: {
  format: TableExportFormat
  sheetName: string
  columns: ExportColumn<T>[]
  rows: T[]
  filenameBase: string
  label?: string
  suffix?: string | null
}): Promise<void> {
  const filename = buildExportFilename(params.filenameBase, params.format, new Date(), params.suffix)
  if (params.format === 'xlsx') {
    await downloadTableExcel({
      sheetName: params.sheetName,
      columns: params.columns,
      rows: params.rows,
      filename,
      label: params.label,
    })
    return
  }
  downloadTableCsv({
    columns: params.columns,
    rows: params.rows,
    filename,
    label: params.label,
  })
}

/** Local self-checks for export helpers (no DOM download). */
export function runTableExportSelfChecks(): { name: string; passed: boolean; detail: string }[] {
  const checks: { name: string; passed: boolean; detail: string }[] = []

  const name = buildExportFilename('Transactions', 'xlsx', new Date(2026, 7, 21))
  checks.push({
    name: 'filename pattern',
    passed: name === 'ALZA_Transactions_2026-08-21.xlsx',
    detail: name,
  })

  let emptyBlocked = false
  try {
    assertExportRows(0, 'clients')
  } catch (e) {
    emptyBlocked = e instanceof Error && e.message.includes('No clients')
  }
  checks.push({ name: 'empty export blocked', passed: emptyBlocked, detail: String(emptyBlocked) })

  const neg = csvCell(-125.5, 'currency')
  checks.push({
    name: 'negative currency preserved',
    passed: neg === -125.5,
    detail: String(neg),
  })

  const uuidLeakPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  const sampleCols: ExportColumn<{ client: string; amount: number }>[] = [
    { header: 'Client', value: (r) => r.client },
    { header: 'Premium', value: (r) => r.amount, type: 'currency' },
  ]
  const sample = sampleCols.map((c) => c.value({ client: 'ABC Construction', amount: -50 }))
  checks.push({
    name: 'sample export values have no UUID',
    passed: !sample.some((v) => uuidLeakPattern.test(String(v))),
    detail: JSON.stringify(sample),
  })

  return checks
}
