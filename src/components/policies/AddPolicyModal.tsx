import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { X } from 'lucide-react'
import { DirectoryNameSelect } from '../directory/DirectoryNameSelect'
import {
  createPolicy,
  POLICY_STATUSES,
  type PolicyStatusValue,
} from '../../lib/directory'
import { fetchProducerDefaultSplit } from '../../lib/producerSplit'
import { parseProducerSplitPercentage } from '../../lib/producerSplitValidation'
import {
  formatCommissionTypeLabel,
  normalizeCommissionType,
  type CommissionType,
} from '../../lib/commission'
import { supabase } from '../../lib/supabase'

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const selectClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const textareaClassName =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

export interface AddPolicyModalProps {
  open: boolean
  onClose: () => void
  onCreated: (policyId: string) => void
  lockedClientId?: string
  lockedClientLabel?: string
}

interface ClientOption {
  id: string
  name: string
}

const emptyForm = {
  clientId: '',
  policyNumber: '',
  policyType: '',
  carrier: '',
  mga: '',
  producer: '',
  csr: '',
  effectiveDate: '',
  expirationDate: '',
  status: 'pending' as PolicyStatusValue,
  notes: '',
  commissionType: 'percentage' as CommissionType,
  agencyCommissionPercentage: '15',
  agencyCommissionAmount: '',
  producerSplitPercentage: '60',
  overrideSplit: false,
}

export function AddPolicyModal({
  open,
  onClose,
  onCreated,
  lockedClientId,
  lockedClientLabel,
}: AddPolicyModalProps) {
  const [form, setForm] = useState(emptyForm)
  const [clients, setClients] = useState<ClientOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setForm({
      ...emptyForm,
      clientId: lockedClientId ?? '',
    })

    if (lockedClientId) return

    let cancelled = false
    async function loadClients() {
      const { data, error: loadError } = await supabase
        .from('clients')
        .select('id, business_name')
        .order('business_name')
      if (cancelled) return
      if (loadError) {
        setError(loadError.message)
        setClients([])
        return
      }
      setClients(
        (data ?? []).map((row) => ({
          id: String(row.id),
          name: String(row.business_name ?? row.id),
        })),
      )
    }
    void loadClients()
    return () => {
      cancelled = true
    }
  }, [open, lockedClientId])

  const clientLabel = useMemo(() => {
    if (lockedClientLabel) return lockedClientLabel
    return clients.find((c) => c.id === form.clientId)?.name ?? ''
  }, [clients, form.clientId, lockedClientLabel])

  if (!open) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const splitParsed = parseProducerSplitPercentage(form.producerSplitPercentage)
    if (!splitParsed.ok) {
      setError(splitParsed.error)
      return
    }
    const splitPct = splitParsed.value
    const commissionType = normalizeCommissionType(form.commissionType)
    if (!form.clientId.trim()) {
      setError('Select a client.')
      return
    }
    if (!form.policyNumber.trim()) {
      setError('Policy number is required.')
      return
    }

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
        setError('Enter a valid flat agency commission amount.')
        return
      }
      agencyCommissionAmount = flat
    }

    setSaving(true)
    setError(null)
    const result = await createPolicy({
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
      commissionType,
      agencyCommissionPercentage,
      agencyCommissionAmount,
      producerSplitPercentage: splitPct,
      overrideSplit: form.overrideSplit,
    })
    setSaving(false)

    if (result.error) {
      setError(`RLS/query error on ${result.error.table} (${result.error.operation}): ${result.error.message}`)
      return
    }

    onCreated(result.data!.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40" onClick={() => !saving && onClose()} aria-label="Close" />
      <div className="relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Add Policy</h3>
            <p className="mt-1 text-sm text-slate-500">
              Creates a policy with commission defaults (Current Policy Premium starts at 0 on the policy
              record). Live Current Policy Premium is policies.premium plus booked transaction amounts.
            </p>
          </div>
          <button type="button" disabled={saving} onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">Client</span>
            {lockedClientId ? (
              <input disabled value={clientLabel || lockedClientId} className={`${inputClassName} bg-slate-50`} />
            ) : (
              <select
                required
                value={form.clientId}
                onChange={(e) => setForm((prev) => ({ ...prev, clientId: e.target.value }))}
                className={selectClassName}
              >
                <option value="">Select client…</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.name}</option>
                ))}
              </select>
            )}
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Policy number</span>
              <input required value={form.policyNumber} onChange={(e) => setForm((p) => ({ ...p, policyNumber: e.target.value }))} className={inputClassName} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Type / line</span>
              <input value={form.policyType} onChange={(e) => setForm((p) => ({ ...p, policyType: e.target.value }))} className={inputClassName} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Carrier</span>
              <input value={form.carrier} onChange={(e) => setForm((p) => ({ ...p, carrier: e.target.value }))} className={inputClassName} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">MGA</span>
              <input value={form.mga} onChange={(e) => setForm((p) => ({ ...p, mga: e.target.value }))} className={inputClassName} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Producer</span>
              <DirectoryNameSelect
                kind="producer"
                value={form.producer}
                onChange={(v) => {
                  setForm((p) => ({ ...p, producer: v }))
                  if (!v.trim() || form.overrideSplit) return
                  void fetchProducerDefaultSplit(v).then((res) => {
                    if (res.split === null) return
                    setForm((p) =>
                      p.producer === v && !p.overrideSplit
                        ? { ...p, producerSplitPercentage: String(res.split) }
                        : p,
                    )
                  })
                }}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">CSR</span>
              <DirectoryNameSelect kind="csr" value={form.csr} onChange={(v) => setForm((p) => ({ ...p, csr: v }))} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Effective date</span>
              <input type="date" value={form.effectiveDate} onChange={(e) => setForm((p) => ({ ...p, effectiveDate: e.target.value }))} className={inputClassName} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Expiration date</span>
              <input type="date" value={form.expirationDate} onChange={(e) => setForm((p) => ({ ...p, expirationDate: e.target.value }))} className={inputClassName} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Status</span>
              <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as PolicyStatusValue }))} className={selectClassName}>
                {POLICY_STATUSES.map((status) => (
                  <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
            <p className="mb-1 text-sm font-semibold text-slate-900">Commission Defaults</p>
            <p className="mb-3 text-xs text-slate-500">
              Inherited by new transactions only. Historical transaction snapshots stay unchanged if these
              defaults are edited later.
            </p>
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
                  <input type="number" min="0" step="0.01" value={form.agencyCommissionPercentage} onChange={(e) => setForm((p) => ({ ...p, agencyCommissionPercentage: e.target.value }))} className={inputClassName} />
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-500">Agency Commission Amount</span>
                  <input type="number" step="0.01" value={form.agencyCommissionAmount} onChange={(e) => setForm((p) => ({ ...p, agencyCommissionAmount: e.target.value }))} className={inputClassName} />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">
                  Producer Split % <span className="text-red-500">*</span>
                </span>
                <input type="number" min="0" max="100" step="0.01" value={form.producerSplitPercentage} onChange={(e) => setForm((p) => ({ ...p, producerSplitPercentage: e.target.value }))} className={inputClassName} />
              </label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.overrideSplit} onChange={(e) => setForm((p) => ({ ...p, overrideSplit: e.target.checked }))} />
              Override split (stores existing override_split flag; no extra calculation)
            </label>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">Notes</span>
            <textarea value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} rows={3} className={textareaClassName} />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" disabled={saving} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving…' : 'Create Policy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
