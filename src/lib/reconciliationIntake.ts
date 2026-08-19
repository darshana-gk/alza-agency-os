import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import { parseMoney } from './reconciliationMatching'

export interface ParsedStatementFile {
  headers: string[]
  rows: Record<string, unknown>[]
}

export async function hashUtf8Sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Trim, strip BOM, and unify newlines so re-pasted statements hash the same. */
export function normalizePastedStatementText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

export function pastedStatementFileName(at = new Date()): string {
  const y = at.getFullYear()
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const d = String(at.getDate()).padStart(2, '0')
  const h = String(at.getHours()).padStart(2, '0')
  const min = String(at.getMinutes()).padStart(2, '0')
  return `pasted_statement_${y}${m}${d}_${h}${min}.txt`
}

export type StatementDelimiter = ',' | '\t' | ';'

export function detectStatementDelimiter(text: string): StatementDelimiter | null {
  const line =
    normalizePastedStatementText(text)
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
): ParsedStatementFile {
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
  return { headers, rows }
}

export function parseDelimitedStatementText(
  text: string,
  source: 'txt' | 'paste' = 'txt',
): ParsedStatementFile {
  const normalized = normalizePastedStatementText(text)
  const pasteError =
    'Pasted text could not be interpreted as a table. Paste comma-, tab-, or semicolon-delimited data with a header row.'
  const txtError =
    'Text file could not be interpreted as a table. Use comma, tab, or semicolon delimiters and a header row.'
  if (!normalized) {
    throw new Error(source === 'paste' ? pasteError : txtError)
  }
  const delimiter = detectStatementDelimiter(normalized)
  if (!delimiter) {
    throw new Error(source === 'paste' ? pasteError : txtError)
  }
  const parsed = parsePapaTable(
    normalized,
    delimiter,
    source === 'paste' ? pasteError : 'Text file has no header row.',
    source === 'paste' ? pasteError : 'Unable to parse text file.',
  )
  if (parsed.headers.length < 2) {
    throw new Error(source === 'paste' ? pasteError : txtError)
  }
  return parsed
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

export async function parseStatementFile(file: File): Promise<ParsedStatementFile> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    const text = await file.text()
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.replace(/^\uFEFF/, '').trim(),
    })
    if (parsed.errors.length && !parsed.data.length) {
      throw new Error(parsed.errors[0]?.message || 'Unable to parse CSV.')
    }
    const headers = (parsed.meta.fields ?? []).map((h) => String(h).trim()).filter(Boolean)
    const rows = parsed.data
      .map((row) => {
        const next: Record<string, unknown> = {}
        for (const key of headers) next[key] = row[key]
        return next
      })
      .filter((row) => Object.values(row).some((v) => String(v ?? '').trim() !== ''))
    if (!headers.length) throw new Error('CSV has no header row.')
    return { headers, rows }
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await file.arrayBuffer())
    const sheet = workbook.worksheets[0]
    if (!sheet) throw new Error('Workbook has no worksheets.')
    const headerRow = sheet.getRow(1)
    const headers: string[] = []
    headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
      const label = cellToString(cell.value).replace(/^\uFEFF/, '').trim()
      if (label) headers[col] = label
    })
    const compact = headers.filter(Boolean)
    if (!compact.length) throw new Error('Spreadsheet has no header row.')
    const rows: Record<string, unknown>[] = []
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return
      const obj: Record<string, unknown> = {}
      let any = false
      compact.forEach((header) => {
        const col = headers.indexOf(header)
        const raw = col >= 0 ? row.getCell(col).value : null
        const text = cellToString(raw)
        obj[header] = raw instanceof Date ? raw : text
        if (text.trim()) any = true
      })
      if (any) rows.push(obj)
    })
    return { headers: compact, rows }
  }

  if (name.endsWith('.txt') || file.type === 'text/plain') {
    return parseDelimitedStatementText(await file.text(), 'txt')
  }

  throw new Error('Unsupported file type. Use CSV, XLSX, or TXT.')
}

export async function runStatementIntakeChecks(): Promise<
  Array<{ id: string; name: string; passed: boolean; detail: string }>
> {
  const csvText = 'Policy Number,Commission Amount,Type\nBALAN001,937.50,endorsement_premium\n'
  const tabText = 'Policy Number\tCommission Amount\tType\nBALAN001\t937.50\tendorsement_premium\n'
  const pasteText = 'Policy Number,Commission Amount\r\nBALAN001,937.50\r\n'
  const invalidPaste = 'This is a commission statement for BALAN PEST with no table.'
  const results: Array<{ id: string; name: string; passed: boolean; detail: string }> = []

  function add(id: string, name: string, passed: boolean, detail: string) {
    results.push({ id, name, passed, detail })
  }

  const csv = await parseStatementFile(new File([csvText], 'statement.csv', { type: 'text/csv' }))
  add(
    '1',
    'Existing CSV still parses',
    csv.headers.includes('Policy Number') &&
      csv.rows.length === 1 &&
      String(csv.rows[0]?.['Commission Amount']) === '937.50',
    `headers=${csv.headers.join('|')} rows=${csv.rows.length}`,
  )

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Statement')
  sheet.addRow(['Policy Number', 'Commission Amount', 'Type'])
  sheet.addRow(['BALAN001', 937.5, 'endorsement_premium'])
  const xlsxBuf = await workbook.xlsx.writeBuffer()
  const xlsx = await parseStatementFile(new File([xlsxBuf], 'statement.xlsx'))
  add(
    '2',
    'Existing XLSX still parses',
    xlsx.headers.includes('Policy Number') && xlsx.rows.length === 1,
    `headers=${xlsx.headers.join('|')} rows=${xlsx.rows.length}`,
  )

  const tab = await parseStatementFile(new File([tabText], 'statement.txt', { type: 'text/plain' }))
  add(
    '3',
    'Tab-delimited .txt parses',
    tab.headers.length === 3 && tab.rows.length === 1 && String(tab.rows[0]?.['Policy Number']) === 'BALAN001',
    `headers=${tab.headers.join('|')} rows=${tab.rows.length}`,
  )

  const commaTxt = await parseStatementFile(new File([csvText], 'statement.txt', { type: 'text/plain' }))
  add(
    '4',
    'Comma-delimited .txt parses',
    commaTxt.headers.includes('Policy Number') && commaTxt.rows.length === 1,
    `headers=${commaTxt.headers.join('|')} rows=${commaTxt.rows.length}`,
  )

  const semi = parseDelimitedStatementText('Policy Number;Commission Amount\nBALAN001;937.50\n', 'txt')
  add(
    '4b',
    'Semicolon-delimited text parses',
    semi.headers.length === 2 && String(semi.rows[0]?.['Policy Number']) === 'BALAN001',
    `headers=${semi.headers.join('|')}`,
  )

  const pasted = parseDelimitedStatementText(pasteText, 'paste')
  const commission = parseMoney(pasted.rows[0]?.['Commission Amount'])
  add(
    '5',
    'Paste tabular text parses',
    pasted.rows.length === 1 && String(pasted.rows[0]?.['Policy Number']) === 'BALAN001' && commission === 937.5,
    `policy=${String(pasted.rows[0]?.['Policy Number'])} commission=${commission}`,
  )

  const hashA = await hashUtf8Sha256(normalizePastedStatementText(pasteText))
  const hashB = await hashUtf8Sha256(
    normalizePastedStatementText('  Policy Number,Commission Amount\nBALAN001,937.50\n  '),
  )
  add('6', 'Exact pasted content is duplicate-detectable', hashA === hashB && hashA.length === 64, `match=${hashA === hashB}`)

  let invalidMessage = ''
  try {
    parseDelimitedStatementText(invalidPaste, 'paste')
  } catch (err) {
    invalidMessage = err instanceof Error ? err.message : String(err)
  }
  add(
    '7',
    'Invalid paste shows validation error',
    invalidMessage.toLowerCase().includes('table'),
    invalidMessage || 'no error',
  )

  const mappable =
    pasted.headers.some((h) => h.toLowerCase().includes('policy')) &&
    pasted.headers.some((h) => h.toLowerCase().includes('commission'))
  add('8', 'Mapping + preview still work', mappable && pasted.rows.length === 1, `headers=${pasted.headers.join('|')}`)

  return results
}
