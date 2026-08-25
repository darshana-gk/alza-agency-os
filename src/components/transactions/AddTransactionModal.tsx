import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { X } from 'lucide-react'
import { DirectoryNameSelect } from '../directory/DirectoryNameSelect'
import {
  createTransaction,
  deriveCommission,
  formatCommissionTypeLabel,
  formatCurrency,
  formatPercent,
  formatProducerSplitSourceLabel,
  formatTypeLabel,
  normalizeCommissionType,
  normalizePremiumAmountForType,
  todayIsoDate,
  TRANSACTION_TYPES_FOR_CREATE,
  validateTransactionPremiumAmount,
  type CommissionType,
  type TransactionType,
} from '../../lib/commission'
import {
  fetchProducerDefaultSplit,
  resolveTransactionSplitSource,
} from '../../lib/producerSplit'
import { parseProducerSplitPercentage } from '../../lib/producerSplitValidation'
import { fetchActiveReviewers, type ReviewerOption } from '../../lib/reviewers'
import { supabase } from '../../lib/supabase'

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const textareaClassName =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

export interface AddTransactionModalProps {
  open: boolean
  onClose: () => void
  onCreated: (transactionId: string) => void
  lockedClientId?: string
  lockedClientLabel?: string
  lockedPolicyId?: string
  lockedPolicyLabel?: string
}

interface ClientOption {
  id: string
  name: string
}

interface PolicyOption {
  id: string
  clientId: string
  number: string
  producer: string
  csr: string
  carrier: string
  mga: string
  premium: number
  effectiveDate: string
  expirationDate: string
  commissionType: CommissionType
  agencyCommissionPercentage: number | null
  agencyCommissionAmount: number
  brokerFee: number
  producerSplitPercentage: number
  overrideSplit: boolean
}

function defaultsTransactionDatesFromPolicy(type: string): boolean {
  return type === 'new_policy_premium' || type === 'renewal_premium'
}

function isAbsoluteNegativeEntryType(type: string): boolean {
  return type === 'cancellation_premium' || type === 'return_premium'
}

function allowsSignedPremiumEntry(type: string): boolean {
  return type === 'endorsement_premium' || type === 'audit_premium'
}

export function AddTransactionModal({
  open,
  onClose,
  onCreated,
  lockedClientId,
  lockedClientLabel,
  lockedPolicyId,
  lockedPolicyLabel,
}: AddTransactionModalProps) {
  const [clients, setClients] = useState<ClientOption[]>([])
  const [policies, setPolicies] = useState<PolicyOption[]>([])
  const [reviewers, setReviewers] = useState<ReviewerOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    clientId: '',
    policyId: '',
    transactionDate: todayIsoDate(),
    transactionEffectiveDate: '',
    transactionExpirationDate: '',
    transactionType: 'new_policy_premium' as TransactionType,
    description: '',
    notes: '',
    remarks: '',
    producer: '',
    csr: '',
    carrier: '',
    mga: '',
    premiumAmount: '',
    commissionType: 'percentage' as CommissionType,
    agencyCommissionPercentage: '',
    agencyCommissionAmount: '',
    brokerFee: '0',
    producerSplitPercentage: '',
    reviewerUserId: '',
    producerDefaultSplit: null as number | null,
    splitTouched: false,
  })

  useEffect(() => {
    if (!open) return
    setError(null)
    setSaving(false)
    setForm({
      clientId: lockedClientId ?? '',
      policyId: lockedPolicyId ?? '',
      transactionDate: todayIsoDate(),
      transactionEffectiveDate: '',
      transactionExpirationDate: '',
      transactionType: 'new_policy_premium',
      description: '',
      notes: '',
      remarks: '',
      producer: '',
      csr: '',
      carrier: '',
      mga: '',
      premiumAmount: '',
      commissionType: 'percentage',
      agencyCommissionPercentage: '',
      agencyCommissionAmount: '',
      brokerFee: '0',
      producerSplitPercentage: '',
      reviewerUserId: '',
      producerDefaultSplit: null,
      splitTouched: false,
    })

    let cancelled = false
    async function load() {
      const [clientRes, policyRes, reviewerRes] = await Promise.all([
        supabase
          .from('clients')
          .select('id, business_name')
          .is('archived_at', null)
          .order('business_name'),
        supabase
          .from('policies')
          .select(
            'id, client_id, policy_number, producer, csr, carrier, mga, premium, effective_date, expiration_date, commission_type, agency_commission_percentage, agency_commission_amount, broker_fee, producer_split_percentage, override_split, archived_at',
          )
          .is('archived_at', null)
          .order('policy_number'),
        fetchActiveReviewers(),
      ])
      if (cancelled) return
      if (clientRes.error) {
        setError(clientRes.error.message)
        setClients([])
      } else {
        setClients(
          (clientRes.data ?? []).map((row) => ({
            id: String(row.id),
            name: String(row.business_name ?? row.id),
          })),
        )
      }
      if (reviewerRes.error) {
        setError(reviewerRes.error.message)
        setReviewers([])
      } else {
        setReviewers(reviewerRes.data)
      }
      if (policyRes.error) {
        setError(policyRes.error.message)
        setPolicies([])
        return
      }
      const mapped = (policyRes.data ?? []).map((row) => {
        const pctRaw = row.agency_commission_percentage
        return {
          id: String(row.id),
          clientId: String(row.client_id ?? ''),
          number: String(row.policy_number ?? '').trim() || row.id,
          producer: String(row.producer ?? '').trim(),
          csr: String(row.csr ?? '').trim(),
          carrier: String(row.carrier ?? '').trim(),
          mga: String(row.mga ?? '').trim(),
          premium: Number(row.premium ?? 0) || 0,
          effectiveDate: String(row.effective_date ?? '').trim(),
          expirationDate: String(row.expiration_date ?? '').trim(),
          commissionType: normalizeCommissionType(row.commission_type as string | null),
          agencyCommissionPercentage:
            pctRaw === null || pctRaw === undefined ? null : Number(pctRaw) || 0,
          agencyCommissionAmount: Number(row.agency_commission_amount ?? 0) || 0,
          brokerFee: Number(row.broker_fee ?? 0) || 0,
          producerSplitPercentage: Number(row.producer_split_percentage ?? 0) || 0,
          overrideSplit: Boolean(row.override_split),
        }
      })
      setPolicies(mapped)

      const initialPolicyId = lockedPolicyId ?? ''
      const initialClientId = lockedClientId ?? ''
      const selected =
        mapped.find((p) => p.id === initialPolicyId) ??
        (initialClientId
          ? mapped.find((p) => p.clientId === initialClientId)
          : undefined)
      const defaultReviewerId =
        reviewerRes.data.length === 1 ? reviewerRes.data[0].id : ''
      if (selected) {
        // Never auto-fill Transaction Amount from policy.premium — user must enter it.
        // NB/Renewal may default transaction dates from policy term; other types stay blank.
        setForm((prev) => {
          const usePolicyTerm = defaultsTransactionDatesFromPolicy(prev.transactionType)
          return {
            ...prev,
            clientId: lockedClientId || selected.clientId,
            policyId: lockedPolicyId || selected.id,
            producer: selected.producer,
            csr: selected.csr,
            carrier: selected.carrier,
            mga: selected.mga,
            transactionEffectiveDate: usePolicyTerm ? selected.effectiveDate || '' : '',
            transactionExpirationDate: usePolicyTerm ? selected.expirationDate || '' : '',
            premiumAmount: '',
            commissionType: selected.commissionType,
            agencyCommissionPercentage:
              selected.agencyCommissionPercentage === null
                ? ''
                : String(selected.agencyCommissionPercentage),
            agencyCommissionAmount: String(selected.agencyCommissionAmount),
            brokerFee: String(selected.brokerFee),
            producerSplitPercentage: String(selected.producerSplitPercentage || 0),
            reviewerUserId: defaultReviewerId,
          }
        })
      } else if (defaultReviewerId) {
        setForm((prev) => ({ ...prev, reviewerUserId: defaultReviewerId }))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, lockedClientId, lockedPolicyId])

  const clientPolicies = useMemo(
    () => policies.filter((p) => !form.clientId || p.clientId === form.clientId),
    [policies, form.clientId],
  )

  const clientLabel = useMemo(() => {
    if (lockedClientLabel) return lockedClientLabel
    return clients.find((c) => c.id === form.clientId)?.name ?? ''
  }, [clients, form.clientId, lockedClientLabel])

  const policyLabel = useMemo(() => {
    if (lockedPolicyLabel) return lockedPolicyLabel
    return policies.find((p) => p.id === form.policyId)?.number ?? ''
  }, [policies, form.policyId, lockedPolicyLabel])

  const selectedPolicy = useMemo(
    () => policies.find((p) => p.id === form.policyId) ?? null,
    [policies, form.policyId],
  )

  const amountEntered = form.premiumAmount.trim() !== ''
  const isAbsoluteNegativeType = isAbsoluteNegativeEntryType(form.transactionType)
  const isSignedEntryType = allowsSignedPremiumEntry(form.transactionType)

  const signedPremiumAmount = useMemo(() => {
    const raw = Number(form.premiumAmount)
    if (!Number.isFinite(raw)) return NaN
    return normalizePremiumAmountForType(form.transactionType, raw)
  }, [form.premiumAmount, form.transactionType])

  const splitSource = useMemo(() => {
    if (!selectedPolicy) return 'transaction_override' as const
    const split = Number(form.producerSplitPercentage)
    if (!Number.isFinite(split)) return 'transaction_override' as const
    return resolveTransactionSplitSource({
      split,
      policySplit: selectedPolicy.producerSplitPercentage,
      policyOverride: selectedPolicy.overrideSplit,
      producerDefault: form.producerDefaultSplit,
    })
  }, [
    form.producerDefaultSplit,
    form.producerSplitPercentage,
    selectedPolicy,
  ])

  const derived = useMemo(() => {
    // Do not derive commissions until the user enters a transaction amount.
    if (!amountEntered) return null
    const splitParsed = parseProducerSplitPercentage(form.producerSplitPercentage)
    if (!splitParsed.ok) return null
    const premium = signedPremiumAmount
    const splitPct = splitParsed.value
    const brokerFee = Number(form.brokerFee)
    const commissionType = normalizeCommissionType(form.commissionType)
    if (!Number.isFinite(premium) || !Number.isFinite(brokerFee)) return null
    if (commissionType === 'percentage') {
      const agencyPct = Number(form.agencyCommissionPercentage)
      if (!Number.isFinite(agencyPct) || agencyPct < 0) return null
      return deriveCommission({
        commissionType: 'percentage',
        baseAmount: premium,
        agencyCommissionPercentage: agencyPct,
        agencyCommissionAmount: null,
        brokerFee,
        producerSplitPercentage: splitPct,
      })
    }
    const flat = Number(form.agencyCommissionAmount)
    if (!Number.isFinite(flat)) return null
    return deriveCommission({
      commissionType: 'flat',
      baseAmount: premium,
      agencyCommissionPercentage: null,
      agencyCommissionAmount: flat,
      brokerFee,
      producerSplitPercentage: splitPct,
    })
  }, [
    amountEntered,
    signedPremiumAmount,
    form.commissionType,
    form.agencyCommissionPercentage,
    form.agencyCommissionAmount,
    form.brokerFee,
    form.producerSplitPercentage,
  ])

  async function applyPolicyDefaults(policyId: string) {
    const policy = policies.find((p) => p.id === policyId)
    if (!policy) return
    const producerDefault = policy.producer
      ? await fetchProducerDefaultSplit(policy.producer)
      : { split: null, error: null }
    const defaultSplit =
      producerDefault.split !== null && Number.isFinite(producerDefault.split)
        ? producerDefault.split
        : null
    const splitToUse =
      policy.overrideSplit || policy.producerSplitPercentage > 0
        ? policy.producerSplitPercentage
        : defaultSplit ?? policy.producerSplitPercentage
    setForm((prev) => {
      const usePolicyTerm = defaultsTransactionDatesFromPolicy(prev.transactionType)
      return {
        ...prev,
        policyId,
        clientId: lockedClientId || policy.clientId,
        producer: policy.producer,
        csr: policy.csr,
        carrier: policy.carrier,
        mga: policy.mga,
        transactionEffectiveDate: usePolicyTerm
          ? policy.effectiveDate || ''
          : prev.transactionEffectiveDate,
        transactionExpirationDate: usePolicyTerm
          ? policy.expirationDate || ''
          : prev.transactionExpirationDate,
        // Do not touch premiumAmount — never copy policies.premium.
        commissionType: policy.commissionType,
        agencyCommissionPercentage:
          policy.agencyCommissionPercentage === null
            ? ''
            : String(policy.agencyCommissionPercentage),
        agencyCommissionAmount: String(policy.agencyCommissionAmount),
        brokerFee: String(policy.brokerFee),
        producerSplitPercentage: String(splitToUse || 0),
        producerDefaultSplit: defaultSplit,
        splitTouched: false,
      }
    })
  }

  if (!open) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    if (form.premiumAmount.trim() === '') {
      setError('Enter a transaction amount. Policy premium is not used as a default.')
      return
    }
    const rawAmount = Number(form.premiumAmount)
    if (!Number.isFinite(rawAmount)) {
      setError('Enter a valid transaction amount.')
      return
    }
    const premiumAmount = normalizePremiumAmountForType(form.transactionType, rawAmount)
    const amountError = validateTransactionPremiumAmount(form.transactionType, premiumAmount)
    if (amountError) {
      setError(amountError)
      return
    }
    const splitParsed = parseProducerSplitPercentage(form.producerSplitPercentage)
    if (!splitParsed.ok) {
      setError(splitParsed.error)
      return
    }
    const commissionType = normalizeCommissionType(form.commissionType)
    setSaving(true)
    setError(null)
    const result = await createTransaction({
      clientId: form.clientId,
      policyId: form.policyId,
      transactionDate: form.transactionDate,
      transactionEffectiveDate: form.transactionEffectiveDate || null,
      transactionExpirationDate: form.transactionExpirationDate || null,
      transactionType: form.transactionType,
      description: form.description,
      notes: form.notes,
      remarks: form.remarks,
      producer: form.producer,
      csr: form.csr,
      carrier: form.carrier,
      mga: form.mga,
      premiumAmount,
      commissionType,
      agencyCommissionPercentage:
        commissionType === 'percentage' ? Number(form.agencyCommissionPercentage) : null,
      agencyCommissionAmount:
        commissionType === 'flat' ? Number(form.agencyCommissionAmount) : null,
      brokerFee: Number(form.brokerFee),
      producerSplitPercentage: splitParsed.value,
      producerSplitSource: splitSource,
      reviewerUserId: form.reviewerUserId.trim() || null,
      originalTransactionId: null,
    })
    setSaving(false)
    if (result.error) {
      setError(
        result.error.message.includes('premium') ||
          result.error.message.includes('Producer') ||
          result.error.message.includes('amount')
          ? result.error.message
          : `Could not save transaction: ${result.error.message}`,
      )
      return
    }
    onCreated(result.data!.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        aria-label="Close"
        onClick={() => !saving && onClose()}
      />
      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Add Transaction</h3>
            <p className="mt-1 text-sm text-slate-500">
              Creates an unconfirmed transaction. Number is assigned by the database on insert.
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Transaction type</span>
              <select
                required
                value={form.transactionType}
                onChange={(e) => {
                  const nextType = e.target.value as TransactionType
                  setForm((prev) => {
                    const premium = Number(prev.premiumAmount)
                    let nextPremium = prev.premiumAmount
                    // Absolute-entry types keep a positive display value; signed value is derived on save.
                    if (
                      prev.premiumAmount.trim() !== '' &&
                      Number.isFinite(premium) &&
                      isAbsoluteNegativeEntryType(nextType)
                    ) {
                      nextPremium = String(Math.abs(premium))
                    }
                    const policy = policies.find((p) => p.id === prev.policyId)
                    let nextEffective = prev.transactionEffectiveDate
                    let nextExpiration = prev.transactionExpirationDate
                    // NB/Renewal may adopt policy term as transaction-date defaults.
                    if (defaultsTransactionDatesFromPolicy(nextType) && policy) {
                      nextEffective = policy.effectiveDate || prev.transactionEffectiveDate
                      nextExpiration = policy.expirationDate || prev.transactionExpirationDate
                    }
                    return {
                      ...prev,
                      transactionType: nextType,
                      premiumAmount: nextPremium,
                      transactionEffectiveDate: nextEffective,
                      transactionExpirationDate: nextExpiration,
                    }
                  })
                }}
                className={selectClassName}
              >
                {TRANSACTION_TYPES_FOR_CREATE.map((type) => (
                  <option key={type} value={type}>
                    {formatTypeLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Transaction date</span>
              <input
                required
                type="date"
                value={form.transactionDate}
                onChange={(e) => setForm((p) => ({ ...p, transactionDate: e.target.value }))}
                className={inputClassName}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Client</span>
              {lockedClientId ? (
                <input disabled value={clientLabel || lockedClientId} className={`${inputClassName} bg-slate-50`} />
              ) : (
                <select
                  required
                  value={form.clientId}
                  onChange={(e) => {
                    const nextClient = e.target.value
                    setForm((prev) => ({
                      ...prev,
                      clientId: nextClient,
                      policyId: '',
                      producer: '',
                      csr: '',
                      carrier: '',
                      mga: '',
                      transactionEffectiveDate: '',
                      transactionExpirationDate: '',
                      premiumAmount: '',
                      commissionType: 'percentage',
                      agencyCommissionPercentage: '',
                      agencyCommissionAmount: '',
                      brokerFee: '0',
                      producerSplitPercentage: '',
                    }))
                  }}
                  className={selectClassName}
                >
                  <option value="">Select client…</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Policy #</span>
              {lockedPolicyId ? (
                <input disabled value={policyLabel || lockedPolicyId} className={`${inputClassName} bg-slate-50`} />
              ) : (
                <select
                  required
                  value={form.policyId}
                  disabled={!form.clientId}
                  onChange={(e) => applyPolicyDefaults(e.target.value)}
                  className={selectClassName}
                >
                  <option value="">Select policy…</option>
                  {clientPolicies.map((policy) => (
                    <option key={policy.id} value={policy.id}>
                      {policy.number}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                Policy Effective Date
                <span className="ml-1 font-normal text-slate-400">(read-only)</span>
              </span>
              <input
                disabled
                type="date"
                value={selectedPolicy?.effectiveDate || ''}
                className={`${inputClassName} bg-slate-50`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                Policy Expiration Date
                <span className="ml-1 font-normal text-slate-400">(read-only)</span>
              </span>
              <input
                disabled
                type="date"
                value={selectedPolicy?.expirationDate || ''}
                className={`${inputClassName} bg-slate-50`}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                Transaction Effective Date
              </span>
              <input
                type="date"
                value={form.transactionEffectiveDate}
                onChange={(e) =>
                  setForm((p) => ({ ...p, transactionEffectiveDate: e.target.value }))
                }
                className={inputClassName}
              />
              <span className="mt-1 block text-xs text-slate-500">
                Transaction-level snapshot — does not change the policy term.
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                Transaction Expiration Date
              </span>
              <input
                type="date"
                value={form.transactionExpirationDate}
                onChange={(e) =>
                  setForm((p) => ({ ...p, transactionExpirationDate: e.target.value }))
                }
                className={inputClassName}
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">Description</span>
            <input
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              className={inputClassName}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Producer</span>
              <DirectoryNameSelect
                kind="producer"
                value={form.producer}
                onChange={(v) => setForm((p) => ({ ...p, producer: v }))}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">CSR</span>
              <DirectoryNameSelect
                kind="csr"
                value={form.csr}
                onChange={(v) => setForm((p) => ({ ...p, csr: v }))}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Reviewer</span>
              <select
                value={form.reviewerUserId}
                onChange={(e) => setForm((p) => ({ ...p, reviewerUserId: e.target.value }))}
                className={selectClassName}
              >
                <option value="">Select Owner/Admin reviewer…</option>
                {reviewers.map((reviewer) => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Required before Submit for Review. Only active Owner/Admin users are eligible.
              </p>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Carrier</span>
              <input
                value={form.carrier}
                onChange={(e) => setForm((p) => ({ ...p, carrier: e.target.value }))}
                className={inputClassName}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">MGA</span>
              <input
                value={form.mga}
                onChange={(e) => setForm((p) => ({ ...p, mga: e.target.value }))}
                className={inputClassName}
              />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
            <p className="mb-3 text-sm font-semibold text-slate-900">Amount & commission</p>
            <div className="mb-3">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Commission Basis</span>
              <div className="flex flex-wrap gap-2">
                {(['percentage', 'flat'] as CommissionType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, commissionType: type }))}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                      form.commissionType === type
                        ? 'border-alza-blue-300 bg-alza-blue-50 text-alza-blue-800'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {formatCommissionTypeLabel(type)}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">
                  {isAbsoluteNegativeType
                    ? form.transactionType === 'cancellation_premium'
                      ? 'Cancellation Amount (enter as positive)'
                      : 'Return Amount (enter as positive)'
                    : isSignedEntryType
                      ? 'Transaction Amount (positive or negative)'
                      : 'Transaction Amount'}
                </span>
                <input
                  required
                  type="number"
                  step="0.01"
                  min={isAbsoluteNegativeType ? '0.01' : undefined}
                  value={form.premiumAmount}
                  onChange={(e) => setForm((p) => ({ ...p, premiumAmount: e.target.value }))}
                  placeholder={
                    isAbsoluteNegativeType
                      ? 'e.g. 500.00'
                      : isSignedEntryType
                        ? 'e.g. 250.00 or -125.00'
                        : 'Enter amount'
                  }
                  className={inputClassName}
                />
                {isAbsoluteNegativeType && amountEntered && Number.isFinite(signedPremiumAmount) && (
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    {form.transactionType === 'cancellation_premium'
                      ? 'Cancellation Premium'
                      : 'Return Premium'}
                    :{' '}
                    <span className="tabular-nums text-red-700">
                      {formatCurrency(signedPremiumAmount)}
                    </span>
                  </p>
                )}
                {selectedPolicy && (
                  <p className="mt-1 text-xs text-slate-500">
                    Policy written premium (context only):{' '}
                    <span className="font-medium tabular-nums text-slate-600">
                      {formatCurrency(selectedPolicy.premium)}
                    </span>
                    — not used as the transaction amount.
                  </p>
                )}
                {isAbsoluteNegativeType ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Enter the absolute amount. It is saved as a negative premium. Broker fee is not
                    auto-reversed — set it explicitly.
                  </p>
                ) : isSignedEntryType ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Enter a positive or negative amount. Zero is not allowed.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">
                    Enter the transaction amount explicitly. Policy premium is never auto-filled.
                  </p>
                )}
              </label>
              {form.commissionType === 'percentage' ? (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Agency Commission %</span>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.agencyCommissionPercentage}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, agencyCommissionPercentage: e.target.value }))
                    }
                    className={inputClassName}
                  />
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Agency Commission Amount</span>
                  <input
                    required
                    type="number"
                    step="0.01"
                    value={form.agencyCommissionAmount}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, agencyCommissionAmount: e.target.value }))
                    }
                    className={inputClassName}
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Broker Fee</span>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={form.brokerFee}
                  onChange={(e) => setForm((p) => ({ ...p, brokerFee: e.target.value }))}
                  className={inputClassName}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">
                  Producer Split % <span className="text-red-500">*</span>
                </span>
                <input
                  required
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.producerSplitPercentage}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      producerSplitPercentage: e.target.value,
                      splitTouched: true,
                    }))
                  }
                  className={inputClassName}
                />
                {form.producerSplitPercentage.trim() !== '' && (
                  <p className="mt-1 text-xs text-slate-600">
                    {formatProducerSplitSourceLabel(
                      splitSource,
                      Number(form.producerSplitPercentage) || 0,
                    )}
                  </p>
                )}
              </label>
            </div>
            <div className="mt-3 grid gap-1.5 text-sm text-slate-700 sm:grid-cols-2">
              <p>Agency Commission Amount:{' '}
                <span className="font-semibold tabular-nums">
                  {derived ? formatCurrency(derived.agencyCommissionAmount) : formatCurrency(0)}
                </span>
              </p>
              <p>Broker Fee:{' '}
                <span className="font-semibold tabular-nums">
                  {derived
                    ? formatCurrency(derived.brokerFee)
                    : Number.isFinite(Number(form.brokerFee))
                      ? formatCurrency(Number(form.brokerFee))
                      : formatCurrency(0)}
                </span>
              </p>
              <p>Commission Pool:{' '}
                <span className="font-semibold tabular-nums">
                  {derived ? formatCurrency(derived.commissionPool) : formatCurrency(0)}
                </span>
              </p>
              <p>
                Producer Commission (
                {derived
                  ? formatPercent(derived.producerSplitPercentage)
                  : form.producerSplitPercentage.trim()
                    ? formatPercent(Number(form.producerSplitPercentage) || 0)
                    : '—'}
                ):{' '}
                <span className="font-semibold tabular-nums">
                  {derived ? formatCurrency(derived.producerCommissionAmount) : formatCurrency(0)}
                </span>
              </p>
              <p className="sm:col-span-2">
                Agency Net Commission:{' '}
                <span className="font-semibold tabular-nums">
                  {derived ? formatCurrency(derived.agencyNetCommission) : formatCurrency(0)}
                </span>
              </p>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Derived amounts are read-only. expected_amount is set to agency commission amount.
              Broker fee is snapshotted on the transaction (not re-read from policy later).
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Notes</span>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                className={textareaClassName}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Remarks</span>
              <textarea
                rows={2}
                value={form.remarks}
                onChange={(e) => setForm((p) => ({ ...p, remarks: e.target.value }))}
                className={textareaClassName}
              />
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Create Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
