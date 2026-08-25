import ExcelJS from 'exceljs'
import Papa from 'papaparse'

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
}

function cellToString(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  if (typeof value === 'object' && value && 'text' in value) {
    return String((value as { text?: unknown }).text ?? '')
  }
  if (typeof value === 'object' && value && 'result' in value) {
    return cellToString((value as { result?: unknown }).result)
  }
  return String(value)
}

function sheetToParsed(sheet: ExcelJS.Worksheet, source: 'xlsx' | 'xls'): ParsedSpreadsheet {
  const headerRow = sheet.getRow(1)
  const headersByCol: string[] = []
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const label = cellToString(cell.value).replace(/^\uFEFF/, '').trim()
    if (label) headersByCol[col] = label
  })
  const headers = headersByCol.filter(Boolean)
  if (!headers.length) throw new Error(`Sheet “${sheet.name}” has no header row.`)

  const rows: Record<string, unknown>[] = []
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const obj: Record<string, unknown> = {}
    let any = false
    headers.forEach((header) => {
      const col = headersByCol.indexOf(header)
      const raw = col >= 0 ? row.getCell(col).value : null
      const text = cellToString(raw)
      obj[header] = raw instanceof Date ? raw : text
      if (text.trim()) any = true
    })
    if (any) rows.push(obj)
  })
  return { headers, rows, sheetName: sheet.name, delimiter: null, source }
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

/** List worksheets with approximate data row counts (excludes header). */
export async function listWorkbookSheets(file: File): Promise<WorkbookSheetInfo[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt') || file.type === 'text/csv' || file.type === 'text/plain') {
    return [{ index: 0, name: file.name || 'Text', rowCount: -1 }]
  }
  if (!(name.endsWith('.xlsx') || name.endsWith('.xls'))) {
    throw new Error('Unsupported file type. Use CSV, TXT, XLSX, or XLS.')
  }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  return workbook.worksheets.map((sheet, index) => ({
    index,
    name: sheet.name,
    rowCount: Math.max(0, sheet.rowCount - 1),
  }))
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
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await file.arrayBuffer())
    let sheet: ExcelJS.Worksheet | undefined
    if (options?.sheetName) {
      sheet = workbook.worksheets.find((s) => s.name === options.sheetName)
      if (!sheet) throw new Error(`Sheet “${options.sheetName}” was not found.`)
    } else {
      const idx = options?.sheetIndex ?? 0
      sheet = workbook.worksheets[idx]
      if (!sheet) throw new Error('Workbook has no worksheets at that index.')
    }
    return sheetToParsed(sheet, name.endsWith('.xls') ? 'xls' : 'xlsx')
  }

  throw new Error('Unsupported file type. Use CSV, TXT, XLSX, or XLS.')
}
