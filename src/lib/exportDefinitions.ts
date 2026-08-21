import {
  formatActivityActionLabel,
  formatActivityDetailsSummary,
  formatActivityEntityLabel,
} from './activityPresentation'
import { formatLabel, formatTypeLabel, type CommissionTransaction } from './commission'
import {
  formatReconciliationMatchLabel,
  formatReconciliationStatus,
  statementSourceLabel,
  type ReconciliationStatement,
  type ReconciliationStatementRow,
} from './reconciliation'
import type { ExportColumn } from './tableExport'

export const clientExportColumns: ExportColumn<{
  clientNumber?: string
  name: string
  dba?: string
  contact: string
  email: string
  phone: string
  status: string
  producer: string
  csr: string
  policies: number
  totalPremium: number
}>[] = [
  { header: 'Client #', value: (r) => r.clientNumber ?? '' },
  { header: 'Business Name', value: (r) => r.name },
  { header: 'DBA', value: (r) => r.dba ?? '' },
  { header: 'Contact', value: (r) => r.contact },
  { header: 'Email', value: (r) => r.email },
  { header: 'Phone', value: (r) => r.phone },
  { header: 'Status', value: (r) => formatLabel(r.status) },
  { header: 'Producer', value: (r) => r.producer },
  { header: 'CSR', value: (r) => r.csr },
  { header: 'Policy Count', value: (r) => r.policies, type: 'number' },
  { header: 'Total Premium', value: (r) => r.totalPremium, type: 'currency' },
]

export const policyExportColumns: ExportColumn<{
  clientName: string
  policyNumber: string
  policyType: string
  carrier: string
  mga: string
  producer: string
  csr: string
  status: string
  effectiveDate: string
  expirationDate: string
  agencyCommissionPercentage?: number | null
  /** Raw policies.premium */
  filePremium?: number
  premium: number
}>[] = [
  { header: 'Client', value: (r) => r.clientName },
  { header: 'Policy #', value: (r) => r.policyNumber },
  { header: 'Policy Type', value: (r) => r.policyType },
  { header: 'Carrier', value: (r) => r.carrier },
  { header: 'MGA', value: (r) => r.mga },
  { header: 'Producer', value: (r) => r.producer },
  { header: 'CSR', value: (r) => r.csr },
  { header: 'Status', value: (r) => formatLabel(r.status) },
  { header: 'Effective Date', value: (r) => r.effectiveDate, type: 'date' },
  { header: 'Expiration Date', value: (r) => r.expirationDate, type: 'date' },
  {
    header: 'Agency Commission %',
    value: (r) => r.agencyCommissionPercentage ?? '',
    type: 'percent',
  },
  {
    header: 'Current Policy Premium',
    value: (r) => (r.filePremium != null ? r.filePremium : r.premium),
    type: 'currency',
  },
]

export const transactionExportColumns: ExportColumn<CommissionTransaction>[] = [
  { header: 'Date', value: (r) => r.transactionDate, type: 'date' },
  { header: 'Transaction #', value: (r) => r.transactionNumber },
  { header: 'Client', value: (r) => r.clientName },
  { header: 'Policy #', value: (r) => r.policyNumber },
  { header: 'Transaction Type', value: (r) => formatTypeLabel(r.type) },
  { header: 'Premium', value: (r) => r.amount, type: 'currency' },
  { header: 'Agency Commission', value: (r) => r.agencyCommissionAmount, type: 'currency' },
  { header: 'Producer Commission', value: (r) => r.producerCommissionAmount, type: 'currency' },
  { header: 'Broker Fee', value: (r) => r.brokerFee, type: 'currency' },
  { header: 'Agency Net', value: (r) => r.agencyNetCommission, type: 'currency' },
  { header: 'Producer', value: (r) => r.producer },
  { header: 'CSR', value: (r) => r.csr },
  { header: 'Review Status', value: (r) => formatLabel(r.reviewStatus) },
  { header: 'Payment Status', value: (r) => formatLabel(r.producerPaymentStatus) },
  {
    header: 'Commission Confirmed',
    value: (r) => (r.agencyCommissionConfirmed ? 'Yes' : 'No'),
  },
]

export const receiptExportColumns: ExportColumn<{
  settlementDate: string | null
  clientName: string
  policyNumber: string
  transactionNumber: string
  amountReceived: number | null
  source: string
  depositReference: string
  producer: string
  reconciliationStatus: string
}>[] = [
  { header: 'Settlement Date', value: (r) => r.settlementDate ?? '', type: 'date' },
  { header: 'Client', value: (r) => r.clientName },
  { header: 'Policy #', value: (r) => r.policyNumber },
  { header: 'Transaction #', value: (r) => r.transactionNumber },
  { header: 'Amount Received', value: (r) => r.amountReceived, type: 'currency' },
  { header: 'Source', value: (r) => r.source },
  { header: 'Deposit Reference', value: (r) => r.depositReference },
  { header: 'Producer', value: (r) => r.producer },
  { header: 'Status', value: (r) => formatLabel(r.reconciliationStatus) },
]

export const producerPaymentExportColumns: ExportColumn<{
  batchNumber: string
  producer: string
  paymentDate: string | null
  netPayment: number
  paymentMethod: string
  paymentReference: string
  status: string
}>[] = [
  { header: 'Batch #', value: (r) => r.batchNumber },
  { header: 'Producer', value: (r) => r.producer },
  { header: 'Payment Date', value: (r) => r.paymentDate ?? '', type: 'date' },
  { header: 'Amount', value: (r) => r.netPayment, type: 'currency' },
  { header: 'Method', value: (r) => formatLabel(r.paymentMethod) },
  { header: 'Reference', value: (r) => r.paymentReference },
  { header: 'Status', value: (r) => formatLabel(r.status) },
]

export const recoveryExportColumns: ExportColumn<{
  recoveryNumber: string | null
  producer: string
  transactionNumber: string
  amount: number
  status: string
  notes: string
  createdAt: string
}>[] = [
  { header: 'Recovery #', value: (r) => r.recoveryNumber ?? '' },
  { header: 'Producer', value: (r) => r.producer },
  { header: 'Transaction #', value: (r) => r.transactionNumber },
  { header: 'Amount', value: (r) => r.amount, type: 'currency' },
  { header: 'Status', value: (r) => formatLabel(r.status) },
  { header: 'Notes', value: (r) => r.notes },
  { header: 'Created Date', value: (r) => r.createdAt, type: 'datetime' },
]

export type ReconExportRow = ReconciliationStatementRow & {
  statement?: ReconciliationStatement | null
  statementFileName?: string | null
}

export const reconciliationExportColumns: ExportColumn<ReconExportRow>[] = [
  {
    header: 'Statement',
    value: (r) => r.statementFileName || r.statement?.fileName || '',
  },
  {
    header: 'Source',
    value: (r) =>
      r.statement
        ? statementSourceLabel(r.statement)
        : [r.carrierName, r.mgaName].filter(Boolean).join(' · ') || '',
  },
  { header: 'Row #', value: (r) => r.rowIndex, type: 'number' },
  { header: 'Policy #', value: (r) => r.policyNumber ?? '' },
  { header: 'Client', value: (r) => r.clientName ?? '' },
  { header: 'Premium', value: (r) => r.premiumAmount, type: 'currency' },
  { header: 'Commission', value: (r) => r.commissionAmount, type: 'currency' },
  {
    header: 'Transaction Type',
    value: (r) => (r.transactionType ? formatTypeLabel(r.transactionType) : ''),
  },
  { header: 'Match Status', value: (r) => formatReconciliationMatchLabel(r) },
  { header: 'Variance', value: (r) => r.variance, type: 'currency' },
  {
    header: 'Discrepancy',
    value: (r) => (r.discrepancyType ? formatReconciliationStatus(r.discrepancyType) : ''),
  },
  { header: 'Matched Transaction #', value: (r) => r.transactionNumber ?? '' },
  { header: 'Resolution', value: (r) => formatLabel(r.resolutionStatus) },
]

export const activityExportColumns: ExportColumn<{
  createdAt: string
  actorName: string | null
  actorRole: string | null
  action: string
  entityType: string
  recordReference: string | null
  summary: string
}>[] = [
  { header: 'Date/Time', value: (r) => r.createdAt, type: 'datetime' },
  { header: 'Actor', value: (r) => r.actorName ?? '' },
  { header: 'Role', value: (r) => r.actorRole ?? '' },
  { header: 'Action', value: (r) => formatActivityActionLabel(r.action) },
  { header: 'Entity', value: (r) => formatActivityEntityLabel(r.entityType) },
  { header: 'Reference', value: (r) => r.recordReference ?? '' },
  { header: 'Readable Summary', value: (r) => r.summary },
]

export function activityRowForExport(row: Parameters<typeof formatActivityDetailsSummary>[0]) {
  return {
    createdAt: row.createdAt,
    actorName: row.actorName,
    actorRole: row.actorRole,
    action: row.action,
    entityType: row.entityType,
    recordReference: row.recordReference,
    summary: formatActivityDetailsSummary(row),
  }
}

export const producerExportColumns: ExportColumn<{
  name: string
  email: string
  phone: string
  licenseNumber?: string | null
  defaultSplitPercentage?: number | null
  status: string
}>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Email', value: (r) => r.email },
  { header: 'Phone', value: (r) => r.phone },
  { header: 'License #', value: (r) => r.licenseNumber ?? '' },
  { header: 'Default Split %', value: (r) => r.defaultSplitPercentage ?? '', type: 'percent' },
  { header: 'Status', value: (r) => formatLabel(r.status) },
]

export const csrExportColumns: ExportColumn<{
  name: string
  email: string
  phone: string
  status: string
}>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Email', value: (r) => r.email },
  { header: 'Phone', value: (r) => r.phone },
  { header: 'Status', value: (r) => formatLabel(r.status) },
]

export const mgaExportColumns: ExportColumn<{
  name: string
  contactPerson?: string | null
  email: string
  phone: string
  states?: string | null
  linesOfBusiness?: string | null
  status: string
}>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Contact', value: (r) => r.contactPerson ?? '' },
  { header: 'Email', value: (r) => r.email },
  { header: 'Phone', value: (r) => r.phone },
  { header: 'States', value: (r) => r.states ?? '' },
  { header: 'Lines', value: (r) => r.linesOfBusiness ?? '' },
  { header: 'Status', value: (r) => formatLabel(r.status) },
]

export const carrierExportColumns: ExportColumn<{
  name: string
  naic?: string | null
  appointmentStatus?: string | null
  billingType?: string | null
  linesOfBusiness?: string | null
  status: string
}>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'NAIC', value: (r) => r.naic ?? '' },
  { header: 'Appointment', value: (r) => r.appointmentStatus ?? '' },
  { header: 'Billing Type', value: (r) => r.billingType ?? '' },
  { header: 'Lines', value: (r) => r.linesOfBusiness ?? '' },
  { header: 'Status', value: (r) => formatLabel(r.status) },
]

export const userExportColumns: ExportColumn<{
  fullName: string
  email: string
  role: string
  roles?: string[] | null
  status: string
  inviteStatus?: string | null
}>[] = [
  { header: 'Full Name', value: (r) => r.fullName },
  { header: 'Email', value: (r) => r.email },
  {
    header: 'Role',
    value: (r) => (r.roles?.length ? r.roles.join(', ') : r.role),
  },
  { header: 'Status', value: (r) => formatLabel(r.status) },
  { header: 'Invite Status', value: (r) => formatLabel(r.inviteStatus ?? '') },
]

export const reportDetailCsvColumns: ExportColumn<CommissionTransaction>[] = [
  { header: 'Date', value: (r) => r.transactionDate, type: 'date' },
  { header: 'Transaction #', value: (r) => r.transactionNumber },
  { header: 'Client', value: (r) => r.clientName },
  { header: 'Policy', value: (r) => r.policyNumber },
  { header: 'Type', value: (r) => formatTypeLabel(r.type) },
  { header: 'Premium', value: (r) => r.amount, type: 'currency' },
  { header: 'Producer', value: (r) => r.producer },
  { header: 'Agency Commission', value: (r) => r.agencyCommissionAmount, type: 'currency' },
  { header: 'Broker Fee', value: (r) => r.brokerFee, type: 'currency' },
  { header: 'Producer Commission', value: (r) => r.producerCommissionAmount, type: 'currency' },
  { header: 'Agency Net', value: (r) => r.agencyNetCommission, type: 'currency' },
  { header: 'Payment Status', value: (r) => formatLabel(r.producerPaymentStatus) },
]
