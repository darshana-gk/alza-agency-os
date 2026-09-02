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
  transactionTypesForPolicyTerm,
  validateTransactionPremiumAmount,
  type CommissionType,
  type TransactionType,
} from '../../lib/commission'
import {
  fetchProducerDefaultSplit,
  resolveTransactionSplitSource,
  splitPercentForNewTransaction,
} from '../../lib/producerSplit'
import { parseProducerSplitPercentage } from '../../lib/producerSplitValidation'
import { fetchActiveReviewers, type ReviewerOption } from '../../lib/reviewers'
import { supabase } from '../../lib/supabase'
import {
  transactionDateSemantics,
  validateTransactionDateInputs,
} from '../../lib/transactionDateSemantics'
import {
  EXPIRED_TERM_ADD_WARNING,
  displayValueOrEmpty,
  type PolicyTermCreateAnchor,
} from '../../lib/policyPremium'
import { defaultNextTermDates, renewPolicy } from '../../lib/policyRenewRewrite'

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
  /** Selected policy term. Historical terms prefill snapshots instead of the live Policy File. */
  termAnchor?: PolicyTermCreateAnchor | null
  /** Renew Policy: lock type to Renewal and default the next term dates. */
  mode?: 'create' | 'renew'
}

interface ClientOption {
  id: string
  name: string
}

interface PolicyOption {
  id: string
  clientId: string
  number: string
  policyType: string
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
  return transactionDateSemantics(type).snapshotTxnDatesFromPolicyTerm
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
  termAnchor = null,
  mode = 'create',
}: AddTransactionModalProps) {
  const historicalTerm = Boolean(termAnchor && !termAnchor.isCurrent)
  const createTypes = transactionTypesForPolicyTerm(!historicalTerm)
  const defaultCreateType: TransactionType = historicalTerm
    ? 'endorsement_premium'
    : 'new_policy_premium'
  const [clients, setClients] = useState<ClientOption[]>([])
  const [policies, setPolicies] = useState<PolicyOption[]>([])
  const [reviewers, setReviewers] = useState<ReviewerOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    clientId: '',
    policyId: '',
    policyNumber: '',
    policyType: '',
    transactionDate: todayIsoDate(),
    transactionEffectiveDate: '',
    transactionExpirationDate: '',
    policyEffectiveDate: '',
    policyExpirationDate: '',
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
      policyNumber: displayValueOrEmpty(termAnchor?.policyNumber),
      policyType: '',
      transactionDate: todayIsoDate(),
      transactionEffectiveDate: historicalTerm ? termAnchor?.effectiveDate ?? '' : '',
      transactionExpirationDate: historicalTerm ? termAnchor?.expirationDate ?? '' : '',
      policyEffectiveDate: termAnchor?.effectiveDate ?? '',
      policyExpirationDate: termAnchor?.expirationDate ?? '',
      transactionType: mode === 'renew' ? 'renewal_premium' : defaultCreateType,
      description: '',
      notes: '',
      remarks: '',
      producer: displayValueOrEmpty(termAnchor?.producer),
      csr: displayValueOrEmpty(termAnchor?.csr),
      carrier: displayValueOrEmpty(termAnchor?.carrier),
      mga: displayValueOrEmpty(termAnchor?.mga),
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
            'id, client_id, policy_number, policy_type, producer, csr, carrier, mga, premium, effective_date, expiration_date, commission_type, agency_commission_percentage, agency_commission_amount, broker_fee, producer_split_percentage, override_split, archived_at',
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
          policyType: String(row.policy_type ?? '').trim(),
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
        // Same split/broker defaults as choosing the policy from the dropdown.
        await applyPolicyDefaults(selected)
        if (cancelled) return
        if (defaultReviewerId) {
          setForm((prev) => ({ ...prev, reviewerUserId: defaultReviewerId }))
        }
      } else if (defaultReviewerId) {
        setForm((prev) => ({ ...prev, reviewerUserId: defaultReviewerId }))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open, lockedClientId, lockedPolicyId, mode, termAnchor, defaultCreateType, historicalTerm])

  const clientPolicies = useMemo(
    () => policies.filter((p) => !form.clientId || p.clientId === form.clientId),
    [policies, form.clientId],
  )

  const clientLabel = useMemo(() => {
    if (lockedClientLabel) return lockedClientLabel
    return clients.find((c) => c.id === form.clientId)?.name ?? ''
  }, [clients, form.clientId, lockedClientLabel])

  const policyLabel = useMemo(() => {
    if (termAnchor?.policyNumber) return termAnchor.policyNumber
    if (lockedPolicyLabel) return lockedPolicyLabel
    return policies.find((p) => p.id === form.policyId)?.number ?? ''
  }, [policies, form.policyId, lockedPolicyLabel, termAnchor?.policyNumber])

  const selectedPolicy = useMemo(
    () => policies.find((p) => p.id === form.policyId) ?? null,
    [policies, form.policyId],
  )

  const dateSemantics = useMemo(
    () => transactionDateSemantics(form.transactionType),
    [form.transactionType],
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

  async function applyPolicyDefaults(policy: PolicyOption) {
    const producerDefault = policy.producer
      ? await fetchProducerDefaultSplit(policy.producer)
      : { split: null, error: null }
    const defaultSplit =
      producerDefault.split !== null && Number.isFinite(producerDefault.split)
        ? producerDefault.split
        : null
    const splitToUse = splitPercentForNewTransaction({
      policySplit: policy.producerSplitPercentage,
      policyOverride: policy.overrideSplit,
      producerDefault: defaultSplit,
    })
    setForm((prev) => {
      const usePolicyTerm = defaultsTransactionDatesFromPolicy(prev.transactionType)
      const isRenewal = prev.transactionType === 'renewal_premium'
      const nextTerm = isRenewal ? defaultNextTermDates(policy.expirationDate) : null
      const anchorNumber = displayValueOrEmpty(termAnchor?.policyNumber)
      const anchorEff = termAnchor?.effectiveDate || ''
      const anchorExp = termAnchor?.expirationDate || ''
      const policyEffectiveDate = isRenewal
        ? nextTerm?.effectiveDate || policy.effectiveDate || ''
        : historicalTerm
          ? anchorEff || policy.effectiveDate || ''
          : policy.effectiveDate || ''
      const policyExpirationDate = isRenewal
        ? nextTerm?.expirationDate || policy.expirationDate || ''
        : historicalTerm
          ? anchorExp || policy.expirationDate || ''
          : policy.expirationDate || ''
      const producer = historicalTerm
        ? displayValueOrEmpty(termAnchor?.producer) || policy.producer
        : policy.producer
      const csr = historicalTerm ? displayValueOrEmpty(termAnchor?.csr) || policy.csr : policy.csr
      const carrier = historicalTerm
        ? displayValueOrEmpty(termAnchor?.carrier) || policy.carrier
        : policy.carrier
      const mga = historicalTerm ? displayValueOrEmpty(termAnchor?.mga) || policy.mga : policy.mga
      const commissionType = historicalTerm
        ? normalizeCommissionType(termAnchor?.commissionType || policy.commissionType)
        : policy.commissionType
      const agencyPct =
        historicalTerm && termAnchor?.agencyCommissionPercentage != null
          ? termAnchor.agencyCommissionPercentage
          : policy.agencyCommissionPercentage
      const agencyAmt =
        historicalTerm && termAnchor
          ? termAnchor.agencyCommissionAmount
          : policy.agencyCommissionAmount
      const brokerFee =
        historicalTerm && termAnchor ? termAnchor.brokerFee : policy.brokerFee
      const split =
        historicalTerm && termAnchor?.producerSplitPercentage != null
          ? termAnchor.producerSplitPercentage
          : splitToUse
      const txnEff = historicalTerm
        ? prev.transactionEffectiveDate || policyEffectiveDate
        : usePolicyTerm
          ? policyEffectiveDate
          : prev.transactionEffectiveDate
      const txnExp = historicalTerm
        ? prev.transactionExpirationDate || policyExpirationDate
        : usePolicyTerm
          ? policyExpirationDate
          : prev.transactionExpirationDate
      return {
        ...prev,
        policyId: policy.id,
        clientId: isRenewal ? prev.clientId || policy.clientId : lockedClientId || policy.clientId,
        policyNumber: isRenewal
          ? prev.policyNumber || policy.number
          : historicalTerm
            ? anchorNumber
            : prev.policyNumber || (termAnchor?.isCurrent ? anchorNumber : ''),
        policyType: isRenewal ? prev.policyType || policy.policyType : prev.policyType,
        producer,
        csr,
        carrier,
        mga,
        policyEffectiveDate,
        policyExpirationDate,
        transactionEffectiveDate: txnEff,
        transactionExpirationDate: txnExp,
        // Do not touch premiumAmount — never copy policies.premium.
        commissionType,
        agencyCommissionPercentage: agencyPct === null ? '' : String(agencyPct),
        // Renew: do not carry the old actual commission amount.
        agencyCommissionAmount: isRenewal ? '' : String(agencyAmt),
        brokerFee: String(brokerFee),
        producerSplitPercentage: String(split),
        producerDefaultSplit: defaultSplit,
        splitTouched: false,
        description:
          isRenewal && !prev.description.trim() ? `Renewal of ${policy.number}` : prev.description,
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
    const dateError = validateTransactionDateInputs({
      type: form.transactionType,
      policyEffectiveDate: form.policyEffectiveDate,
      policyExpirationDate: form.policyExpirationDate,
      transactionEffectiveDate: form.transactionEffectiveDate,
      transactionExpirationDate: form.transactionExpirationDate,
    })
    if (dateError) {
      setError(dateError)
      return
    }
    if (mode === 'renew' && !form.clientId.trim()) {
      setError('Client is required.')
      return
    }
    if (mode === 'renew' && !form.policyNumber.trim()) {
      setError('Policy number is required.')
      return
    }
    const commissionType = normalizeCommissionType(form.commissionType)
    setSaving(true)
    setError(null)
    const result =
      mode === 'renew'
        ? await renewPolicy({
            sourcePolicyId: form.policyId,
            clientId: form.clientId,
            policyNumber: form.policyNumber,
            policyType: form.policyType,
            carrier: form.carrier,
            mga: form.mga,
            producer: form.producer,
            csr: form.csr,
            effectiveDate: form.policyEffectiveDate,
            expirationDate: form.policyExpirationDate,
            description: form.description,
            notes: form.notes,
            remarks: form.remarks,
            premiumAmount,
            commissionType,
            agencyCommissionPercentage:
              commissionType === 'percentage' ? Number(form.agencyCommissionPercentage) : null,
            agencyCommissionAmount:
              commissionType === 'flat' ? Number(form.agencyCommissionAmount) : null,
            brokerFee: Number(form.brokerFee),
            producerSplitPercentage: splitParsed.value,
            reviewerUserId: form.reviewerUserId.trim() || null,
            transactionDate: form.transactionDate,
            producerSplitSource: splitSource,
          }).then((renewed) =>
            renewed.error || !renewed.data
              ? { error: { message: renewed.error || 'Could not save renewal.' }, data: undefined }
              : { error: null, data: { id: renewed.data.transactionId } },
          )
        : await createTransaction({
            clientId: form.clientId,
            policyId: form.policyId,
            transactionDate: form.transactionDate,
            transactionEffectiveDate: form.transactionEffectiveDate || null,
            transactionExpirationDate: form.transactionExpirationDate || null,
            policyEffectiveDate: form.policyEffectiveDate || null,
            policyExpirationDate: form.policyExpirationDate || null,
            policyNumber: form.policyNumber || termAnchor?.policyNumber || null,
            lockPolicyIdentitySnapshot: historicalTerm,
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
            <h3 className="text-lg font-semibold text-slate-900">
              {mode === 'renew' ? 'Renew Policy' : 'Add Transaction'}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {mode === 'renew'
                ? 'Prefills this Policy File as a starting point. You can edit setup before saving. This stays a Renewal on the same file — even if you change the policy number. Prior-term amounts are not copied.'
                : 'Creates an unconfirmed transaction. Number is assigned by the database on insert.'}
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
          {historicalTerm ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {EXPIRED_TERM_ADD_WARNING} Save is still allowed. This transaction will belong to{' '}
              {termAnchor?.policyNumber || 'this term'} only.
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Transaction type</span>
              <select
                required
                disabled={mode === 'renew'}
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
                    const nextSemantics = transactionDateSemantics(nextType)
                    let nextEffective = prev.transactionEffectiveDate
                    let nextExpiration = prev.transactionExpirationDate
                    let nextPolicyEffective = prev.policyEffectiveDate
                    let nextPolicyExpiration = prev.policyExpirationDate
                    if (historicalTerm && termAnchor) {
                      nextPolicyEffective = termAnchor.effectiveDate || prev.policyEffectiveDate
                      nextPolicyExpiration = termAnchor.expirationDate || prev.policyExpirationDate
                      if (!nextEffective) nextEffective = nextPolicyEffective
                      if (!nextExpiration) nextExpiration = nextPolicyExpiration
                    } else if (nextSemantics.snapshotTxnDatesFromPolicyTerm && policy) {
                      if (nextType === 'renewal_premium') {
                        const nextTerm = defaultNextTermDates(policy.expirationDate)
                        nextPolicyEffective = nextTerm.effectiveDate || policy.effectiveDate || ''
                        nextPolicyExpiration = nextTerm.expirationDate || policy.expirationDate || ''
                      } else {
                        nextPolicyEffective = prev.policyEffectiveDate || policy.effectiveDate || ''
                        nextPolicyExpiration = prev.policyExpirationDate || policy.expirationDate || ''
                      }
                      nextEffective = ''
                      nextExpiration = ''
                    } else if (!nextSemantics.showTxnEffective) {
                      nextEffective = ''
                    }
                    if (!historicalTerm && !nextSemantics.showTxnExpiration) {
                      nextExpiration = ''
                    }
                    return {
                      ...prev,
                      transactionType: nextType,
                      premiumAmount: nextPremium,
                      transactionEffectiveDate: nextEffective,
                      transactionExpirationDate: nextExpiration,
                      policyEffectiveDate: nextPolicyEffective,
                      policyExpirationDate: nextPolicyExpiration,
                      agencyCommissionAmount:
                        nextType === 'renewal_premium' ? '' : prev.agencyCommissionAmount,
                    }
                  })
                }}
                className={selectClassName}
              >
                {createTypes.map((type) => (
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
              {mode !== 'renew' && lockedClientId ? (
                <input disabled value={clientLabel || lockedClientId} className={`${inputClassName} bg-slate-50`} />
              ) : (
                <select
                  required
                  value={form.clientId}
                  onChange={(e) => {
                    const nextClient = e.target.value
                    if (mode === 'renew') {
                      setForm((prev) => ({ ...prev, clientId: nextClient }))
                      return
                    }
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
                      policyEffectiveDate: '',
                      policyExpirationDate: '',
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
              {mode === 'renew' ? (
                <input
                  required
                  value={form.policyNumber}
                  onChange={(e) => setForm((p) => ({ ...p, policyNumber: e.target.value }))}
                  className={inputClassName}
                />
              ) : lockedPolicyId ? (
                <input disabled value={policyLabel || lockedPolicyId} className={`${inputClassName} bg-slate-50`} />
              ) : (
                <select
                  required
                  value={form.policyId}
                  disabled={!form.clientId}
                  onChange={(e) => {
                    const policy = clientPolicies.find((p) => p.id === e.target.value)
                    if (policy) void applyPolicyDefaults(policy)
                  }}
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
            {mode === 'renew' ? (
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Policy Type / LOB</span>
                <input
                  value={form.policyType}
                  onChange={(e) => setForm((p) => ({ ...p, policyType: e.target.value }))}
                  className={inputClassName}
                />
              </label>
            ) : null}
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                {dateSemantics.policyEffectiveLabel}
                {dateSemantics.policyTerm === 'read_only' && (
                  <span className="ml-1 font-normal text-slate-400">(read-only)</span>
                )}
              </span>
              <input
                required={dateSemantics.policyTerm === 'editable_required'}
                disabled={dateSemantics.policyTerm === 'read_only'}
                type="date"
                value={
                  dateSemantics.policyTerm === 'editable_required'
                    ? form.policyEffectiveDate
                    : selectedPolicy?.effectiveDate || ''
                }
                onChange={(e) =>
                  setForm((p) => ({ ...p, policyEffectiveDate: e.target.value }))
                }
                className={
                  dateSemantics.policyTerm === 'read_only'
                    ? `${inputClassName} bg-slate-50`
                    : inputClassName
                }
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">
                {dateSemantics.policyExpirationLabel}
                {dateSemantics.policyTerm === 'read_only' && (
                  <span className="ml-1 font-normal text-slate-400">(read-only)</span>
                )}
              </span>
              <input
                required={dateSemantics.policyTerm === 'editable_required'}
                disabled={dateSemantics.policyTerm === 'read_only'}
                type="date"
                value={
                  dateSemantics.policyTerm === 'editable_required'
                    ? form.policyExpirationDate
                    : selectedPolicy?.expirationDate || ''
                }
                onChange={(e) =>
                  setForm((p) => ({ ...p, policyExpirationDate: e.target.value }))
                }
                className={
                  dateSemantics.policyTerm === 'read_only'
                    ? `${inputClassName} bg-slate-50`
                    : inputClassName
                }
              />
            </label>
            {dateSemantics.showTxnEffective && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">
                  {dateSemantics.txnEffectiveLabel}
                </span>
                <input
                  required={dateSemantics.txnEffectiveRequired}
                  type="date"
                  value={form.transactionEffectiveDate}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, transactionEffectiveDate: e.target.value }))
                  }
                  className={inputClassName}
                />
              </label>
            )}
            {dateSemantics.showTxnExpiration && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">
                  {dateSemantics.txnExpirationLabel}
                </span>
                <input
                  required={dateSemantics.txnExpirationRequired}
                  type="date"
                  value={form.transactionExpirationDate}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, transactionExpirationDate: e.target.value }))
                  }
                  className={inputClassName}
                />
              </label>
            )}
            <p className="sm:col-span-2 text-xs text-slate-500">{dateSemantics.notes}</p>
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
              Producer commission = (agency commission + broker fee) × producer split %. Broker fee
              is shared with the producer. Amounts are snapshotted on save and are not re-read from
              the policy later.
              {derived
                ? ` (${formatCurrency(derived.agencyCommissionAmount)} + ${formatCurrency(derived.brokerFee)}) × ${formatPercent(derived.producerSplitPercentage)} = ${formatCurrency(derived.producerCommissionAmount)}.`
                : ''}
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
