/**
 * Normalized Carrier/MGA commission-feed contract.
 * Designed to feed EXISTING reconciliation ingestion/staging later.
 * Does NOT alter reconciliation matching logic.
 */

export type CommissionFeedSourceKind =
  | 'carrier'
  | 'mga'
  | 'wholesaler'
  | 'api'
  | 'scheduled_file'
  | 'sftp'
  | 'webhook'
  | 'manual_upload'

/**
 * Minimum normalized statement line for future staging handoff.
 * Maps conceptually → existing ALZA reconciliation staging/mapping path.
 */
export type NormalizedCommissionFeedLine = {
  sourceProviderId: string
  sourceKind: CommissionFeedSourceKind
  carrierName: string | null
  mgaName: string | null
  statementReference: string | null
  statementPeriodStart: string | null
  statementPeriodEnd: string | null
  statementDate: string | null
  policyNumber: string | null
  insuredName: string | null
  transactionReference: string | null
  transactionType: string | null
  premiumAmount: number | null
  commissionAmount: number | null
  commissionRate: number | null
  producerName: string | null
  paymentSettlementDate: string | null
  rawExternalReference: string | null
  /** Non-secret raw metadata bag for replay/debug. */
  rawSourceMetadata: Record<string, string | number | boolean | null>
}

export const NORMALIZED_COMMISSION_FEED_REQUIRED_KEYS = [
  'sourceProviderId',
  'sourceKind',
  'carrierName',
  'mgaName',
  'statementReference',
  'statementPeriodStart',
  'statementPeriodEnd',
  'statementDate',
  'policyNumber',
  'insuredName',
  'transactionReference',
  'transactionType',
  'premiumAmount',
  'commissionAmount',
  'commissionRate',
  'producerName',
  'paymentSettlementDate',
  'rawExternalReference',
  'rawSourceMetadata',
] as const

export const COMMISSION_FEED_TO_RECONCILIATION_PATH = [
  'Carrier/MGA Feed',
  'normalized statement data (this contract)',
  'existing ALZA Reconciliation staging/mapping',
  'existing matching engine',
  'review',
  'receipt confirmation',
] as const

export function emptyNormalizedCommissionFeedLine(
  partial?: Partial<NormalizedCommissionFeedLine>,
): NormalizedCommissionFeedLine {
  return {
    sourceProviderId: '',
    sourceKind: 'manual_upload',
    carrierName: null,
    mgaName: null,
    statementReference: null,
    statementPeriodStart: null,
    statementPeriodEnd: null,
    statementDate: null,
    policyNumber: null,
    insuredName: null,
    transactionReference: null,
    transactionType: null,
    premiumAmount: null,
    commissionAmount: null,
    commissionRate: null,
    producerName: null,
    paymentSettlementDate: null,
    rawExternalReference: null,
    rawSourceMetadata: {},
    ...partial,
  }
}

export function assertNormalizedCommissionFeedContract(
  line: NormalizedCommissionFeedLine,
): string[] {
  const errors: string[] = []
  for (const key of NORMALIZED_COMMISSION_FEED_REQUIRED_KEYS) {
    if (!(key in line)) errors.push(`missing key ${key}`)
  }
  if (!line.sourceProviderId?.trim()) errors.push('sourceProviderId required')
  return errors
}
