import Papa from 'papaparse'
import * as XLSX from 'xlsx'

export interface ParsedSpreadsheet {
  headers: string[]
  rows: Record<string, unknown>[]
  sheetName: string | null
  delimiter?: ',' | '\t' | ';' | null
  source: 'csv' | 'xlsx' | 'xls' | 'txt' | 'paste'
}

export interface WorkbookSheetInfo {
  index: number
  name: string
  rowCount: number
  columnCount: number
}

export const ONBOARDING_EXCEL_UNREADABLE =
  'This Excel workbook could not be read. Save the file as .xlsx or .xls, or upload a CSV instead.'

export const ONBOARDING_EXCEL_NO_SHEET =
  'This workbook has no visible worksheet with a header row. Use the sheet that contains your import data, or upload a CSV.'

function cellToString(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    // Excel often stores bold/styled headers as richText — must not String(object).
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: unknown }>)
        .map((part) => String(part?.text ?? ''))
        .join('')
    }
    if ('result' in v) return cellToString(v.result)
    if ('text' in v && v.text != null) return String(v.text)
    if ('v' in v && v.v != null) return cellToString(v.v)
    if ('w' in v && v.w != null) return String(v.w)
  }
  return String(value)
}

function isExcelWorkbookName(name: string): boolean {
  return name.endsWith('.xlsx') || name.endsWith('.xls')
}

function isWorksheetHidden(workbook: XLSX.WorkBook, sheetIndex: number): boolean {
  const meta = workbook.Workbook?.Sheets?.[sheetIndex]
  const hidden = Number(meta?.Hidden ?? 0)
  return hidden !== 0
}

function sheetAoa(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: true,
  }) as unknown[][]
}

function inspectOnboardingSheet(sheet: XLSX.WorkSheet): { headers: string[]; rowCount: number; columnCount: number } {
  const aoa = sheetAoa(sheet)
  const headerRow = Array.isArray(aoa[0]) ? aoa[0] : []
  const headers = headerRow.map((cell) => cellToString(cell).replace(/^\uFEFF/, '').trim()).filter(Boolean)
  let rowCount = 0
  for (let r = 1; r < aoa.length; r += 1) {
    const row = Array.isArray(aoa[r]) ? aoa[r] : []
    const any = row.some((cell) => cellToString(cell).trim() !== '')
    if (any) rowCount += 1
  }
  return { headers, rowCount, columnCount: headers.length }
}

function isUsableOnboardingSheet(sheet: XLSX.WorkSheet | undefined): boolean {
  if (!sheet) return false
  return inspectOnboardingSheet(sheet).columnCount > 0
}

function readOnboardingWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  try {
    return XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/sheets/i.test(message) || error instanceof TypeError) {
      throw new Error(ONBOARDING_EXCEL_UNREADABLE)
    }
    throw new Error(ONBOARDING_EXCEL_UNREADABLE)
  }
}

function collectUsableOnboardingSheets(workbook: XLSX.WorkBook): WorkbookSheetInfo[] {
  const names = workbook.SheetNames ?? []
  const out: WorkbookSheetInfo[] = []
  names.forEach((name, workbookIndex) => {
    if (isWorksheetHidden(workbook, workbookIndex)) return
    const sheet = workbook.Sheets?.[name]
    if (!isUsableOnboardingSheet(sheet)) return
    const info = inspectOnboardingSheet(sheet)
    out.push({
      index: out.length,
      name,
      rowCount: info.rowCount,
      columnCount: info.columnCount,
    })
  })
  return out
}

/** Prefer a real data table (2+ columns) over a 1-column notes sheet. */
export function preferredOnboardingSheetIndex(sheets: WorkbookSheetInfo[]): number {
  if (sheets.length === 0) return 0
  const tabularWithData = sheets.findIndex((s) => s.columnCount >= 2 && s.rowCount > 0)
  if (tabularWithData >= 0) return tabularWithData
  const withData = sheets.findIndex((s) => s.rowCount > 0)
  if (withData >= 0) return withData
  const tabular = sheets.findIndex((s) => s.columnCount >= 2)
  return tabular >= 0 ? tabular : 0
}

function sheetToParsed(sheet: XLSX.WorkSheet, sheetName: string, source: 'xlsx' | 'xls'): ParsedSpreadsheet {
  const aoa = sheetAoa(sheet)
  const headerRow = Array.isArray(aoa[0]) ? aoa[0] : []
  const headersByCol: string[] = []
  headerRow.forEach((cell, idx) => {
    const label = cellToString(cell).replace(/^\uFEFF/, '').trim()
    if (label) headersByCol[idx] = label
  })
  const headers = headersByCol.filter(Boolean)
  if (!headers.length) throw new Error(`Sheet “${sheetName}” has no header row.`)

  const rows: Record<string, unknown>[] = []
  for (let r = 1; r < aoa.length; r += 1) {
    const row = Array.isArray(aoa[r]) ? aoa[r] : []
    const obj: Record<string, unknown> = {}
    let any = false
    headers.forEach((header) => {
      const col = headersByCol.indexOf(header)
      const raw = col >= 0 ? row[col] : null
      const text = cellToString(raw)
      obj[header] = raw instanceof Date ? raw : text
      if (text.trim()) any = true
    })
    if (any) rows.push(obj)
  }
  return { headers, rows, sheetName, delimiter: null, source }
}

function resolveOnboardingWorksheet(
  workbook: XLSX.WorkBook,
  options?: { sheetIndex?: number; sheetName?: string | null },
): { name: string; sheet: XLSX.WorkSheet } {
  const usable = collectUsableOnboardingSheets(workbook)
  if (options?.sheetName) {
    const named = usable.find((s) => s.name === options.sheetName)
    const sheet = workbook.Sheets?.[options.sheetName]
    if (!named || !sheet) {
      throw new Error(
        `Sheet “${options.sheetName}” was not found or has no header row. Choose a worksheet that contains your import data.`,
      )
    }
    return { name: options.sheetName, sheet }
  }
  if (usable.length === 0) throw new Error(ONBOARDING_EXCEL_NO_SHEET)
  const idx =
    typeof options?.sheetIndex === 'number' && options.sheetIndex >= 0
      ? options.sheetIndex
      : preferredOnboardingSheetIndex(usable)
  const chosen = usable[idx] ?? usable[preferredOnboardingSheetIndex(usable)]
  const sheet = workbook.Sheets?.[chosen.name]
  if (!sheet) throw new Error(ONBOARDING_EXCEL_NO_SHEET)
  return { name: chosen.name, sheet }
}

export function normalizeOnboardingText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

export type OnboardingDelimiter = ',' | '\t' | ';'

/** Detect comma, tab, or semicolon from the first non-empty line. */
export function detectOnboardingDelimiter(text: string): OnboardingDelimiter | null {
  const line =
    normalizeOnboardingText(text)
      .split('\n')
      .find((row) => row.trim()) ?? ''
  if (!line) return null
  const comma = (line.match(/,/g) ?? []).length
  const tab = (line.match(/\t/g) ?? []).length
  const semi = (line.match(/;/g) ?? []).length
  const best = Math.max(comma, tab, semi)
  if (best < 1) return null
  if (tab === best) return '\t'
  if (comma === best) return ','
  return ';'
}

function parsePapaTable(
  text: string,
  delimiter: string | undefined,
  emptyHeaderMessage: string,
  parseFailedMessage: string,
  source: ParsedSpreadsheet['source'],
): ParsedSpreadsheet {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.replace(/^\uFEFF/, '').trim(),
    ...(delimiter ? { delimiter } : {}),
  })
  if (parsed.errors.length && !parsed.data.length) {
    throw new Error(parsed.errors[0]?.message || parseFailedMessage)
  }
  const headers = (parsed.meta.fields ?? []).map((h) => String(h).trim()).filter(Boolean)
  const rows = parsed.data
    .map((row) => {
      const next: Record<string, unknown> = {}
      for (const key of headers) next[key] = row[key]
      return next
    })
    .filter((row) => Object.values(row).some((v) => String(v ?? '').trim() !== ''))
  if (!headers.length) throw new Error(emptyHeaderMessage)
  return {
    headers,
    rows,
    sheetName: null,
    delimiter: (delimiter as OnboardingDelimiter | undefined) ?? null,
    source,
  }
}

/** Parse pasted or .txt table text (comma / tab / semicolon). */
export function parseOnboardingDelimitedText(
  text: string,
  source: 'txt' | 'paste' = 'paste',
): ParsedSpreadsheet {
  const normalized = normalizeOnboardingText(text)
  const pasteError =
    'Pasted text could not be interpreted as a table. Paste comma-, tab-, or semicolon-delimited data with a header row.'
  const txtError =
    'Text file could not be interpreted as a table. Use comma, tab, or semicolon delimiters and a header row.'
  if (!normalized) {
    throw new Error(source === 'paste' ? pasteError : txtError)
  }
  const delimiter = detectOnboardingDelimiter(normalized)
  if (!delimiter) {
    throw new Error(source === 'paste' ? pasteError : txtError)
  }
  return parsePapaTable(
    normalized,
    delimiter,
    source === 'paste' ? pasteError : 'Text file has no header row.',
    source === 'paste' ? pasteError : 'Unable to parse text file.',
    source,
  )
}

/** List visible worksheets that have a header row (excludes empty auxiliary sheets). */
export async function listWorkbookSheets(file: File): Promise<WorkbookSheetInfo[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv' || file.type === 'text/plain') {
    return [{ index: 0, name: file.name || 'Text', rowCount: -1, columnCount: 0 }]
  }
  if (!isExcelWorkbookName(name)) {
    throw new Error('Unsupported file type. Use CSV, TXT, XLSX, or XLS.')
  }
  const workbook = readOnboardingWorkbook(await file.arrayBuffer())
  const sheets = collectUsableOnboardingSheets(workbook)
  if (sheets.length === 0) throw new Error(ONBOARDING_EXCEL_NO_SHEET)
  return sheets
}

/**
 * Parse a CSV/TXT or a specific Excel worksheet.
 * sheetIndex defaults to 0. sheetName takes precedence when provided.
 */
export async function parseOnboardingSpreadsheet(
  file: File,
  options?: { sheetIndex?: number; sheetName?: string | null },
): Promise<ParsedSpreadsheet> {
  const name = file.name.toLowerCase()

  if (name.endsWith('.csv') || file.type === 'text/csv') {
    const text = await file.text()
    const delimiter = detectOnboardingDelimiter(text) ?? ','
    return parsePapaTable(
      text,
      delimiter,
      'CSV has no header row.',
      'Unable to parse CSV.',
      'csv',
    )
  }

  if (name.endsWith('.txt') || file.type === 'text/plain') {
    return parseOnboardingDelimitedText(await file.text(), 'txt')
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    try {
      const workbook = readOnboardingWorkbook(await file.arrayBuffer())
      const resolved = resolveOnboardingWorksheet(workbook, options)
      return sheetToParsed(resolved.sheet, resolved.name, name.endsWith('.xls') ? 'xls' : 'xlsx')
    } catch (error) {
      if (error instanceof Error && error.message && !/Cannot read propert/i.test(error.message)) {
        throw error
      }
      throw new Error(ONBOARDING_EXCEL_UNREADABLE)
    }
  }

  throw new Error('Unsupported file type. Use CSV, TXT, XLSX, or XLS.')
}
