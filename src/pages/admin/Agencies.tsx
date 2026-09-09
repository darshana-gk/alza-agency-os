import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../../lib/auth'
import { isPurePlatformSupport, roleInputFromProfile } from '../../lib/permissions'
import {
  activateManualSubscription,
  createProvisionedCustomer,
  listPlatformAgencies,
  PROVISION_PLAN_OPTIONS,
  resendOwnerInvitation,
  type AgencyDirectoryRow,
} from '../../lib/customerProvisioning'

const fieldClass =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

export function AgenciesPage() {
  const { profile } = useAuth()
  const allowed = isPurePlatformSupport(roleInputFromProfile(profile))
  const [rows, setRows] = useState<AgencyDirectoryRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    agencyName: '',
    agencyEmail: '',
    agencyPhone: '',
    website: '',
    ownerFirstName: '',
    ownerLastName: '',
    ownerEmail: '',
    intendedPlan: 'users_1_3',
    billingInterval: 'monthly' as 'monthly' | 'annual',
  })
  const [activateFor, setActivateFor] = useState<AgencyDirectoryRow | null>(null)
  const [activate, setActivate] = useState({
    userBand: 'users_1_3',
    billingInterval: 'monthly' as 'monthly' | 'annual',
    periodStart: '',
    periodEnd: '',
    externalReference: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    const result = await listPlatformAgencies()
    setLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setRows(result.data)
  }, [])

  useEffect(() => {
    if (allowed) void load()
  }, [allowed, load])

  if (!allowed) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Agencies is only available to ALZA platform support staff.
      </div>
    )
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setBusy(true)
    const result = await createProvisionedCustomer(form)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    const warning = Boolean((result.data?.result as { same_agency_name_warning?: boolean } | undefined)?.same_agency_name_warning)
    setNotice(
      `Agency created. Owner invited at ${form.ownerEmail}. Invitation status: pending. Next step: the Owner sets a password from the invitation email, then signs in.${
        warning ? ' Another agency already uses this name; this customer was not merged.' : ''
      }`,
    )
    setForm((current) => ({
      ...current,
      agencyName: '',
      agencyEmail: '',
      agencyPhone: '',
      website: '',
      ownerFirstName: '',
      ownerLastName: '',
      ownerEmail: '',
    }))
    await load()
  }

  async function handleResend(row: AgencyDirectoryRow) {
    if (!row.owner_user_id) return
    setError(null)
    setNotice(null)
    setBusy(true)
    const result = await resendOwnerInvitation(row.owner_user_id)
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setNotice(`Invitation resent to ${row.owner_email}.`)
  }

  async function handleActivate(event: FormEvent) {
    event.preventDefault()
    if (!activateFor) return
    setError(null)
    setNotice(null)
    setBusy(true)
    const result = await activateManualSubscription({
      agencyId: activateFor.id,
      userBand: activate.userBand,
      billingInterval: activate.billingInterval,
      periodStart: activate.periodStart,
      periodEnd: activate.periodEnd,
      externalReference: activate.externalReference,
    })
    setBusy(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setNotice(`Manual subscription activated for ${activateFor.agency_name}. No Razorpay ids were created.`)
    setActivateFor(null)
    await load()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Agencies</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create a customer agency and invite the first Owner. This does not start a paid subscription.
        </p>
      </div>

      {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice ? (
        <p className="rounded-lg border border-alza-blue-100 bg-alza-blue-50 px-3 py-2 text-sm text-alza-blue-900">{notice}</p>
      ) : null}

      <form onSubmit={(event) => void handleCreate(event)} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Create Customer</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-700">
            Agency Name *
            <input className={fieldClass} required value={form.agencyName} onChange={(e) => setForm((f) => ({ ...f, agencyName: e.target.value }))} />
          </label>
          <label className="text-sm text-slate-700">
            Agency Email *
            <input type="email" className={fieldClass} required value={form.agencyEmail} onChange={(e) => setForm((f) => ({ ...f, agencyEmail: e.target.value }))} />
          </label>
          <label className="text-sm text-slate-700">
            Agency Phone
            <input className={fieldClass} value={form.agencyPhone} onChange={(e) => setForm((f) => ({ ...f, agencyPhone: e.target.value }))} />
          </label>
          <label className="text-sm text-slate-700">
            Website
            <input className={fieldClass} value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
          </label>
          <label className="text-sm text-slate-700">
            Owner First Name *
            <input className={fieldClass} required value={form.ownerFirstName} onChange={(e) => setForm((f) => ({ ...f, ownerFirstName: e.target.value }))} />
          </label>
          <label className="text-sm text-slate-700">
            Owner Last Name *
            <input className={fieldClass} required value={form.ownerLastName} onChange={(e) => setForm((f) => ({ ...f, ownerLastName: e.target.value }))} />
          </label>
          <label className="text-sm text-slate-700">
            Owner Email *
            <input type="email" className={fieldClass} required value={form.ownerEmail} onChange={(e) => setForm((f) => ({ ...f, ownerEmail: e.target.value }))} />
          </label>
          <label className="text-sm text-slate-700">
            Intended plan
            <select className={fieldClass} value={form.intendedPlan} onChange={(e) => setForm((f) => ({ ...f, intendedPlan: e.target.value }))}>
              {PROVISION_PLAN_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Billing interval
            <select className={fieldClass} value={form.billingInterval} onChange={(e) => setForm((f) => ({ ...f, billingInterval: e.target.value as 'monthly' | 'annual' }))}>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
          </label>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="mt-4 inline-flex h-10 items-center rounded-lg gradient-alza px-4 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create Customer'}
        </button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Agency</th>
              <th className="px-3 py-2">Agency Email</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Owner Email</th>
              <th className="px-3 py-2">Invitation</th>
              <th className="px-3 py-2">Subscription</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-3 py-3 text-slate-500" colSpan={8}>Loading agencies…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="px-3 py-3 text-slate-500" colSpan={8}>No agencies yet.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-900">{row.agency_name}</td>
                <td className="px-3 py-2">{row.agency_email || '—'}</td>
                <td className="px-3 py-2">{row.owner_name || '—'}</td>
                <td className="px-3 py-2">{row.owner_email || '—'}</td>
                <td className="px-3 py-2">{row.invite_status || '—'}</td>
                <td className="px-3 py-2">{row.subscription_status || 'None'}</td>
                <td className="px-3 py-2">{row.created_at ? String(row.created_at).slice(0, 10) : '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {row.invite_status === 'pending' && row.owner_user_id ? (
                      <button type="button" className="text-alza-blue-700 hover:underline" onClick={() => void handleResend(row)}>
                        Resend invitation
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="text-alza-blue-700 hover:underline"
                      onClick={() => {
                        setActivateFor(row)
                        setActivate((current) => ({
                          ...current,
                          userBand: row.user_band_key || 'users_1_3',
                          billingInterval: row.billing_interval === 'annual' ? 'annual' : 'monthly',
                        }))
                      }}
                    >
                      Activate manual subscription
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activateFor ? (
        <form onSubmit={(event) => void handleActivate(event)} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Activate manual subscription — {activateFor.agency_name}</h2>
          <p className="mt-1 text-xs text-slate-500">Use only after external payment is confirmed. This does not create Razorpay ids.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-700">
              Plan
              <select className={fieldClass} value={activate.userBand} onChange={(e) => setActivate((f) => ({ ...f, userBand: e.target.value }))}>
                {PROVISION_PLAN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-700">
              Interval
              <select className={fieldClass} value={activate.billingInterval} onChange={(e) => setActivate((f) => ({ ...f, billingInterval: e.target.value as 'monthly' | 'annual' }))}>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
              </select>
            </label>
            <label className="text-sm text-slate-700">
              Start date
              <input type="date" required className={fieldClass} value={activate.periodStart} onChange={(e) => setActivate((f) => ({ ...f, periodStart: e.target.value }))} />
            </label>
            <label className="text-sm text-slate-700">
              Period end
              <input type="date" required className={fieldClass} value={activate.periodEnd} onChange={(e) => setActivate((f) => ({ ...f, periodEnd: e.target.value }))} />
            </label>
            <label className="text-sm text-slate-700 sm:col-span-2">
              External reference
              <input className={fieldClass} value={activate.externalReference} onChange={(e) => setActivate((f) => ({ ...f, externalReference: e.target.value }))} />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={busy} className="inline-flex h-10 items-center rounded-lg gradient-alza px-4 text-sm font-medium text-white disabled:opacity-50">
              Confirm activation
            </button>
            <button type="button" className="text-sm text-slate-600" onClick={() => setActivateFor(null)}>Cancel</button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
