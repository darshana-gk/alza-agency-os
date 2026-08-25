import { useState } from 'react'
import { Upload } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { canAccessOnboardingImport } from '../lib/onboardingImport'
import { roleInputFromProfile } from '../lib/permissions'
import { OnboardingImportWizard } from '../components/onboarding/OnboardingImportWizard'

export function Onboarding() {
  const { profile } = useAuth()
  const canAccess = canAccessOnboardingImport(roleInputFromProfile(profile))
  const [open, setOpen] = useState(false)

  if (!canAccess) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
        You do not have permission to use Onboarding Import. Owner or Admin access is required.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Onboarding Import</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Import Master Agency Data (one book-of-business file), or individual Carriers, MGAs, Producers,
            CSRs, Clients, or Policies from CSV, TXT, XLSX, XLS, or a pasted table. Map columns, preview
            validation, then insert only ready rows. Existing ALZA data wins — duplicates are skipped, never
            overwritten.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-alza-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-alza-blue-800"
        >
          <Upload className="h-4 w-4" />
          Start import
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        <p className="font-medium text-slate-800">Import order tip</p>
        <p className="mt-1">
          Prefer <span className="font-medium">Master Agency Data</span> when the agency provides one
          spreadsheet covering carriers, MGAs, producers, CSRs, clients, and policies. Otherwise import
          directory data first (Carriers, MGAs, Producers, CSRs), then Clients, then Policies so
          relationships can resolve cleanly.
        </p>
        <p className="mt-3">
          Producer Split % is required on policy imports. Enter <span className="font-medium">0</span>{' '}
          explicitly when no producer commission applies — blank values are rejected.
        </p>
        <p className="mt-3">
          Current Policy Premium is saved on the policy record (
          <span className="font-mono text-xs">policies.premium</span>), the same column{' '}
          <span className="font-medium">Add Policy</span> writes (as 0 when blank). Screens show Current
          Policy Premium as <span className="font-medium">policies.premium + related transaction amounts</span>
          {' '}so onboarded opening premium appears even with zero transactions.
        </p>
      </div>

      <OnboardingImportWizard open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
