import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { DirectoryNameSelect } from '../directory/DirectoryNameSelect'
import { POLICY_STATUSES, type PolicyStatusValue } from '../../lib/directory'
import {
  formatCommissionTypeLabel,
  normalizeCommissionType,
  type CommissionType,
} from '../../lib/commission'
import { parseProducerSplitPercentage } from '../../lib/producerSplitValidation'
import { fetchProducerDefaultSplit } from '../../lib/producerSplit'
import { fetchActiveReviewers, type ReviewerOption } from '../../lib/reviewers'
import {
  loadPolicySnapshot,
  rewritePolicy,
  rewritePrefillFromPolicy,
} from '../../lib/policyRenewRewrite'
import { supabase } from '../../lib/supabase'

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const textareaClassName =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

export interface RewritePolicyModalProps {
  open: boolean
  sourcePolicyId: string
  onClose: () => void
  onCreated: (policyId: string) => void
}

export function RewritePolicyModal({
  open,
  sourcePolicyId,
  onClose,
  onCreated,
}: RewritePolicyModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sourceNumber, setSourceNumber] = useState('')
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([])
  const [reviewers, setReviewers] = useState<ReviewerOption[]>([])
  const [form, setForm] = useState({
    clientId: '',
    policyNumber: '',
    policyType: '',
    carrier: '',
    mga: '',
    producer: '',
    csr: '',
    reviewerUserId: '',
    effectiveDate: '',
    expirationDate: '',
    status: 'active' as PolicyStatusValue,
    notes: '',
    remarks: '',
    commissionType: 'percentage' as CommissionType,
    agencyCommissionPercentage: '',
    agencyCommissionAmount: '',
    brokerFee: '0',
    producerSplitPercentage: '',
    premiumAmount: '',
  })

  useEffect(() => {
    if (!open || !sourcePolicyId) return
    setError(null)
    setSaving(false)
    let cancelled = false
    async function load() {
      const [loaded, reviewerRes] = await Promise.all([
        loadPolicySnapshot(sourcePolicyId),
        fetchActiveReviewers(),
      ])
      if (cancelled) return
      if (loaded.error || !loaded.data) {
        setError(loaded.error || 'Source policy was not found.')
        return
      }
      if (reviewerRes.error) {
        setError(reviewerRes.error.message)
      }
      const prefill = rewritePrefillFromPolicy(loaded.data)
      const reviewerList = reviewerRes.data
      setReviewers(reviewerList)
      setSourceNumber(prefill.rewrittenFromPolicyNumber)
      setForm({
        clientId: prefill.clientId,
        policyNumber: '',
        policyType: prefill.policyType,
        carrier: prefill.carrier,
        mga: prefill.mga,
        producer: prefill.producer,
        csr: prefill.csr,
        reviewerUserId: reviewerList.length === 1 ? reviewerList[0].id : '',
        effectiveDate: prefill.effectiveDate,
        expirationDate: prefill.expirationDate,
        status: prefill.status,
        notes: prefill.notes,
        remarks: '',
        commissionType: prefill.commissionType,
        agencyCommissionPercentage: prefill.agencyCommissionPercentage,
        agencyCommissionAmount: '',
        brokerFee: prefill.brokerFee,
        producerSplitPercentage: prefill.producerSplitPercentage,
        premiumAmount: '',
      })
    }
    void load()

    let clientsCancelled = false
    void supabase
      .from('clients')
      .select('id, business_name')
      .is('archived_at', null)
      .order('business_name')
      .then(({ data, error: clientError }) => {
        if (clientsCancelled) return
        if (clientError) {
          setError(clientError.message)
          setClients([])
          return
        }
        setClients(
          (data ?? []).map((row) => ({
            id: String(row.id),
            name: String(row.business_name ?? row.id),
          })),
        )
      })

    return () => {
      cancelled = true
      clientsCancelled = true
    }
  }, [open, sourcePolicyId])

  if (!open) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    const splitParsed = parseProducerSplitPercentage(form.producerSplitPercentage)
    if (!splitParsed.ok) {
      setError(splitParsed.error)
      return
    }
    if (!form.policyNumber.trim()) {
      setError('Enter the new policy number.')
      return
    }
    if (form.premiumAmount.trim() === '') {
      setError('Enter the new policy premium. It is not copied from the original policy.')
      return
    }
    const premiumAmount = Number(form.premiumAmount)
    if (!Number.isFinite(premiumAmount) || !(premiumAmount > 0)) {
      setError('Enter a valid new policy premium greater than zero.')
      return
    }
    const commissionType = normalizeCommissionType(form.commissionType)
    let agencyCommissionPercentage: number | null = null
    let agencyCommissionAmount: number | null = null
    if (commissionType === 'percentage') {
      const agencyPct = Number(form.agencyCommissionPercentage)
      if (!Number.isFinite(agencyPct) || agencyPct < 0) {
        setError('Agency commission % must be zero or greater.')
        return
      }
      agencyCommissionPercentage = agencyPct
    } else {
      const flat = Number(form.agencyCommissionAmount)
      if (!Number.isFinite(flat)) {
        setError('Enter the new flat agency commission amount. It is not copied from the original policy.')
        return
      }
      agencyCommissionAmount = flat
    }
    const brokerFee = Number(form.brokerFee)
    if (!Number.isFinite(brokerFee)) {
      setError('Enter a valid broker fee.')
      return
    }

    setSaving(true)
    setError(null)
    const result = await rewritePolicy({
      sourcePolicyId,
      clientId: form.clientId,
      policyNumber: form.policyNumber,
      policyType: form.policyType,
      carrier: form.carrier,
      mga: form.mga,
      producer: form.producer,
      csr: form.csr,
      effectiveDate: form.effectiveDate,
      expirationDate: form.expirationDate,
      status: form.status,
      notes: form.notes,
      remarks: form.remarks,
      premiumAmount,
      commissionType,
      agencyCommissionPercentage,
      agencyCommissionAmount,
      brokerFee,
      producerSplitPercentage: splitParsed.value,
      reviewerUserId: form.reviewerUserId.trim() || null,
    })
    setSaving(false)
    if (result.error || !result.data) {
      setError(result.error || 'Could not rewrite this policy.')
      return
    }
    onCreated(result.data.policyId)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40"
        onClick={() => !saving && onClose()}
        aria-label="Close"
      />
      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Rewrite Policy</h3>
            <p className="mt-1 text-sm text-slate-500">
              Creates a replacement Policy File. The existing policy and all of its historical terms and transactions remain unchanged.
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

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">Rewritten From</span>
            <div className={`${inputClassName} flex items-center bg-slate-50`}>
              {sourcePolicyId && sourceNumber ? (
                <Link
                  to={`/policies/${sourcePolicyId}`}
                  className="font-medium text-alza-blue-700 hover:text-alza-blue-800"
                >
                  {sourceNumber}
                </Link>
              ) : (
                <span>{sourceNumber || '—'}</span>
              )}
            </div>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">Client</span>
            <select
              required
              value={form.clientId}
              onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))}
              className={selectClassName}
            >
              <option value="">Select client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">New Policy #</span>
              <input
                required
                value={form.policyNumber}
                onChange={(e) => setForm((p) => ({ ...p, policyNumber: e.target.value }))}
                className={inputClassName}
                placeholder="Enter the replacement policy number"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">LOB</span>
              <input
                value={form.policyType}
                onChange={(e) => setForm((p) => ({ ...p, policyType: e.target.value }))}
                className={inputClassName}
              />
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
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Producer</span>
              <DirectoryNameSelect
                kind="producer"
                value={form.producer}
                onChange={(v) => {
                  setForm((p) => ({ ...p, producer: v }))
                  void fetchProducerDefaultSplit(v).then((res) => {
                    if (res.split === null) return
                    setForm((p) =>
                      p.producer === v ? { ...p, producerSplitPercentage: String(res.split) } : p,
                    )
                  })
                }}
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
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Effective Date</span>
              <input
                required
                type="date"
                value={form.effectiveDate}
                onChange={(e) => setForm((p) => ({ ...p, effectiveDate: e.target.value }))}
                className={inputClassName}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Expiration Date</span>
              <input
                required
                type="date"
                value={form.expirationDate}
                onChange={(e) => setForm((p) => ({ ...p, expirationDate: e.target.value }))}
                className={inputClassName}
              />
            </label>
            <p className="sm:col-span-2 text-xs text-slate-500">
              Effective and expiration dates are independent. They are not rolled to the next renewal
              term. A rewrite may start mid-term.
            </p>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Status</span>
              <select
                value={form.status}
                onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as PolicyStatusValue }))}
                className={selectClassName}
              >
                {POLICY_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
            <p className="mb-1 text-sm font-semibold text-slate-900">New premium and commission</p>
            <p className="mb-3 text-xs text-slate-500">
              Setup rates are copied. Premium and actual commission amounts are not inherited.
            </p>
            <label className="mb-3 block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Premium</span>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={form.premiumAmount}
                onChange={(e) => setForm((p) => ({ ...p, premiumAmount: e.target.value }))}
                className={inputClassName}
              />
            </label>
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
              {form.commissionType === 'percentage' ? (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Agency Commission %</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.agencyCommissionPercentage}
                    onChange={(e) => setForm((p) => ({ ...p, agencyCommissionPercentage: e.target.value }))}
                    className={inputClassName}
                  />
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">
                    Agency Commission Amount
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    value={form.agencyCommissionAmount}
                    onChange={(e) => setForm((p) => ({ ...p, agencyCommissionAmount: e.target.value }))}
                    className={inputClassName}
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Broker Fee</span>
                <input
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
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.producerSplitPercentage}
                  onChange={(e) => setForm((p) => ({ ...p, producerSplitPercentage: e.target.value }))}
                  className={inputClassName}
                />
              </label>
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              rows={3}
              className={textareaClassName}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">Remarks</span>
            <textarea
              value={form.remarks}
              onChange={(e) => setForm((p) => ({ ...p, remarks: e.target.value }))}
              rows={2}
              className={textareaClassName}
            />
          </label>

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
              className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Create rewritten policy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
