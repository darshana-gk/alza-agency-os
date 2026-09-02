import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { X } from 'lucide-react'
import { displayValueOrEmpty } from '../../lib/policyPremium'
import { repairHistoricalTermSnapshots } from '../../lib/policyTermRepair'

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

export function EditTermDetailsModal({
  open,
  onClose,
  onSaved,
  policyId,
  termId,
  initialPolicyNumber,
  initialEffectiveDate,
  initialExpirationDate,
}: {
  open: boolean
  onClose: () => void
  onSaved: (updatedCount: number) => void
  policyId: string
  termId: string
  initialPolicyNumber?: string | null
  initialEffectiveDate?: string | null
  initialExpirationDate?: string | null
}) {
  const [policyNumber, setPolicyNumber] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [expirationDate, setExpirationDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setSaving(false)
    setPolicyNumber(displayValueOrEmpty(initialPolicyNumber))
    setEffectiveDate(String(initialEffectiveDate ?? '').slice(0, 10))
    setExpirationDate(String(initialExpirationDate ?? '').slice(0, 10))
  }, [open, initialPolicyNumber, initialEffectiveDate, initialExpirationDate])

  if (!open) return null

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    const result = await repairHistoricalTermSnapshots({
      policyId,
      termId,
      policyNumber,
      policyEffectiveDate: effectiveDate || null,
      policyExpirationDate: expirationDate || null,
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onSaved(result.data?.updatedCount ?? 0)
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
      <div className="relative z-10 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Edit Term Details</h3>
            <p className="mt-1 text-sm text-slate-500">
              Repairs missing snapshots on this expired term only. Does not change the current
              Policy File or any other term. Transactions that already have a different policy
              number are left unchanged and will block save.
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={handleSave} className="space-y-4">
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">
              Historical policy number <span className="text-red-500">*</span>
            </span>
            <input
              required
              value={policyNumber}
              onChange={(e) => setPolicyNumber(e.target.value)}
              className={inputClassName}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Effective date</span>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className={inputClassName}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Expiration date</span>
              <input
                type="date"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
                className={inputClassName}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save term details'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
