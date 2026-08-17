import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Building2, ImagePlus, Save } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { useAgency } from '../../lib/agencyContext'
import {
  fetchAgencyProfile,
  saveAgencyProfile,
  uploadAgencyLogo,
  type AgencyProfile,
} from '../../lib/agency'
import { canManageAgencySettings } from '../../lib/permissions'

const inputClassName =
  'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'
const textareaClassName =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20'

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'UTC',
]

export function AgencySettingsPage() {
  const { profile } = useAuth()
  const { refreshAgency } = useAgency()
  const canEdit = canManageAgencySettings(profile?.role)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [missingMigration, setMissingMigration] = useState(false)
  const [agency, setAgency] = useState<AgencyProfile | null>(null)
  const [form, setForm] = useState({
    agencyName: '',
    legalName: '',
    phone: '',
    email: '',
    website: '',
    address: '',
    timezone: 'America/New_York',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchAgencyProfile()
    if (result.missingTable) {
      setMissingMigration(true)
      setAgency(null)
      setError(
        'Agency profile is not installed yet. Apply migration 20260812220000_agency_profile_and_user_invite_foundation.sql, then reload.',
      )
    } else if (result.error) {
      setError(result.error)
    } else if (result.data) {
      setMissingMigration(false)
      setAgency(result.data)
      setForm({
        agencyName: result.data.agencyName,
        legalName: result.data.legalName,
        phone: result.data.phone,
        email: result.data.email,
        website: result.data.website,
        address: result.data.address,
        timezone: result.data.timezone || 'America/New_York',
      })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    if (!canEdit || missingMigration) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    const result = await saveAgencyProfile(form)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setAgency(result.data)
    await refreshAgency()
    setSuccess('Agency profile saved.')
  }

  async function handleLogoChange(file: File | null) {
    if (!file || !canEdit || missingMigration) return
    setUploading(true)
    setError(null)
    setSuccess(null)
    const result = await uploadAgencyLogo(file)
    setUploading(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setAgency((prev) => (prev ? { ...prev, logoUrl: result.logoUrl } : prev))
    await refreshAgency()
    setSuccess('Agency logo updated.')
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-alza-blue-700" />
          <h1 className="text-2xl font-bold text-slate-900">Agency Settings</h1>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Customer workspace identity for this ALZA Flow deployment. Product branding (ALZA FLOW) stays
          separate.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </div>
      )}
      {missingMigration && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Configuration required: agency profile migration is not live yet. Apply{' '}
          <span className="font-medium">20260812220000_agency_profile_and_user_invite_foundation.sql</span> and ensure
          the <span className="font-medium">agency-branding</span> storage bucket exists. Saves are disabled until then
          (nothing is stored locally).
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading agency profile…</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              {agency?.logoUrl ? (
                <img src={agency.logoUrl} alt="" className="h-full w-full object-contain" />
              ) : (
                <Building2 className="h-8 w-8 text-slate-300" />
              )}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-900">Agency logo</p>
              <p className="text-xs text-slate-500">PNG, JPG, or WebP · max 2 MB · stored in Supabase Storage</p>
              {canEdit && (
                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  <ImagePlus className="h-4 w-4" />
                  {uploading ? 'Uploading…' : 'Upload logo'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={uploading || missingMigration}
                    onChange={(e) => void handleLogoChange(e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Agency display name</span>
              <input
                required
                disabled={!canEdit}
                value={form.agencyName}
                onChange={(e) => setForm((f) => ({ ...f, agencyName: e.target.value }))}
                className={inputClassName}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Legal name</span>
              <input
                disabled={!canEdit}
                value={form.legalName}
                onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value }))}
                className={inputClassName}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Email</span>
              <input
                type="email"
                disabled={!canEdit}
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className={inputClassName}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Phone</span>
              <input
                disabled={!canEdit}
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className={inputClassName}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Website</span>
              <input
                disabled={!canEdit}
                value={form.website}
                onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                className={inputClassName}
                placeholder="https://"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Address</span>
              <textarea
                disabled={!canEdit}
                rows={3}
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className={textareaClassName}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Timezone</span>
              <select
                disabled={!canEdit}
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                className={inputClassName}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {canEdit && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving || missingMigration}
                className="inline-flex items-center gap-2 rounded-lg gradient-alza px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Saving…' : 'Save agency profile'}
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  )
}
