import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Cable,
  Search,
  Upload,
  Filter,
  AlertCircle,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { roleInputFromProfile } from '../lib/permissions'
import {
  INTEGRATION_CATEGORIES,
  INTEGRATION_CATEGORY_LABELS,
  INTEGRATION_PROVIDER_CATALOG,
  INTEGRATION_STATUS_LABELS,
  ONBOARDING_FALLBACK_PATH,
  canAccessIntegrations,
  resolveProviderCardStatus,
  type IntegrationCategory,
  type IntegrationStatus,
  type ResolvedProviderCard,
} from '../lib/integrations'

const STATUS_STYLES: Record<IntegrationStatus, string> = {
  available: 'bg-sky-50 text-sky-800 ring-sky-600/20',
  connected: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  action_required: 'bg-amber-50 text-amber-900 ring-amber-600/20',
  syncing: 'bg-indigo-50 text-indigo-800 ring-indigo-600/20',
  error: 'bg-rose-50 text-rose-800 ring-rose-600/20',
  coming_soon: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  requested: 'bg-violet-50 text-violet-800 ring-violet-600/20',
}

type AvailabilityFilter = 'all' | 'available_now' | 'coming_soon' | 'request'

function matchesSearch(card: ResolvedProviderCard, q: string): boolean {
  if (!q) return true
  const hay = [
    card.provider.name,
    card.provider.description,
    INTEGRATION_CATEGORY_LABELS[card.provider.category],
    ...(card.provider.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

export function Integrations() {
  const { profile } = useAuth()
  const canAccess = canAccessIntegrations(roleInputFromProfile(profile))
  const [category, setCategory] = useState<IntegrationCategory | 'all'>('all')
  const [availability, setAvailability] = useState<AvailabilityFilter>('all')
  const [query, setQuery] = useState('')
  const [requestedIds, setRequestedIds] = useState<Set<string>>(() => new Set())
  const [requestNote, setRequestNote] = useState<string | null>(null)

  const cards = useMemo(() => {
    return INTEGRATION_PROVIDER_CATALOG.map((provider) =>
      resolveProviderCardStatus(provider, null, {
        locallyRequested: requestedIds.has(provider.id),
      }),
    )
  }, [requestedIds])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return cards.filter((card) => {
      if (category !== 'all' && card.provider.category !== category) return false
      if (availability === 'available_now') {
        // Import Agency Data + any truly available catalog rows (not Coming Soon / Request placeholders)
        if (card.provider.availability === 'coming_soon') return false
        if (card.provider.isRequestPlaceholder || card.provider.availability === 'request') {
          return false
        }
        return card.provider.availability === 'available' || Boolean(card.provider.fallbackPath)
      }
      if (availability === 'coming_soon' && card.provider.availability !== 'coming_soon') {
        return false
      }
      if (
        availability === 'request' &&
        !(card.provider.availability === 'request' || card.provider.isRequestPlaceholder)
      ) {
        return false
      }
      return matchesSearch(card, q)
    })
  }, [cards, category, availability, query])

  function onRequest(providerId: string, name: string) {
    setRequestedIds((prev) => {
      const next = new Set(prev)
      next.add(providerId)
      return next
    })
    setRequestNote(
      `Request recorded for ${name}. ALZA will use this to prioritize connectors — no credentials were collected.`,
    )
  }

  if (!canAccess) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
        You do not have permission to manage Integrations. Owner or Admin access is required.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Integrations</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Connect the systems your agency already uses to ALZA Flow.
        </p>
      </div>

      {/* Onboarding fallback — prominent */}
      <div className="rounded-xl border border-alza-blue-200 bg-gradient-to-r from-alza-blue-50 to-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-alza-blue-900">
              Don&apos;t see your system or not ready to connect?
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Use <span className="font-medium">Import Agency Data</span> for Master Agency Data,
              Clients, Policies, Carriers, MGAs, Producers, and CSRs. This opens the existing Onboarding
              Import — it does not duplicate that engine.
            </p>
          </div>
          <Link
            to={ONBOARDING_FALLBACK_PATH}
            className="inline-flex items-center gap-2 rounded-lg bg-alza-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-alza-blue-800"
          >
            <Upload className="h-4 w-4" />
            Import Agency Data
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search providers…"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
          />
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <Filter className="h-3.5 w-3.5" />
          Filters
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as IntegrationCategory | 'all')}
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
        >
          <option value="all">All categories</option>
          {INTEGRATION_CATEGORIES.map((id) => (
            <option key={id} value={id}>
              {INTEGRATION_CATEGORY_LABELS[id]}
            </option>
          ))}
        </select>
        <select
          value={availability}
          onChange={(e) => setAvailability(e.target.value as AvailabilityFilter)}
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
        >
          <option value="all">All availability</option>
          <option value="available_now">Available now</option>
          <option value="coming_soon">Coming soon</option>
          <option value="request">Request integration</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-800 ring-1 ring-sky-600/20">
          Available now
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-500/20">
          Coming soon
        </span>
        <span className="rounded-full bg-violet-50 px-2.5 py-1 font-medium text-violet-800 ring-1 ring-violet-600/20">
          Request integration
        </span>
        <span className="ml-auto text-slate-500">
          {filtered.length} provider{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {requestNote && (
        <div className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{requestNote}</p>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          No providers match your filters.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((card) => (
            <ProviderCard
              key={card.provider.id}
              card={card}
              onRequest={() => onRequest(card.provider.id, card.provider.name)}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400">
        Vendor connectors are not live in this foundation. Status Connected appears only after a real
        authenticated connection. Manual commission statement upload in Reconciliation remains supported.
      </p>
    </div>
  )
}

function ProviderCard({
  card,
  onRequest,
}: {
  card: ResolvedProviderCard
  onRequest: () => void
}) {
  const { provider, status, statusLabel, lastSuccessfulSyncAt, action, actionLabel, connectAllowed } =
    card

  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-alza-blue-50 text-alza-blue-700">
            <Cable className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{provider.name}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {INTEGRATION_CATEGORY_LABELS[provider.category]}
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
        >
          {statusLabel}
        </span>
      </div>

      <p className="mt-3 flex-1 text-sm text-slate-600">{provider.description}</p>

      {lastSuccessfulSyncAt && (
        <p className="mt-2 text-xs text-slate-400">
          Last sync: {new Date(lastSuccessfulSyncAt).toLocaleString()}
        </p>
      )}

      {provider.feedKinds && provider.feedKinds.length > 0 && (
        <p className="mt-2 text-[11px] text-slate-400">
          Feed architecture: {provider.feedKinds.join(' · ')}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {action === 'import_agency_data' && provider.fallbackPath && (
          <Link
            to={provider.fallbackPath}
            className="inline-flex items-center gap-1.5 rounded-lg bg-alza-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-alza-blue-800"
          >
            <Upload className="h-3.5 w-3.5" />
            {actionLabel}
          </Link>
        )}
        {action === 'request' && (
          <button
            type="button"
            disabled={status === 'requested'}
            onClick={onRequest}
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-default disabled:opacity-60"
          >
            {actionLabel}
          </button>
        )}
        {action === 'manage' && (
          <button
            type="button"
            className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
          >
            {actionLabel}
          </button>
        )}
        {action === 'connect' && connectAllowed && (
          <button
            type="button"
            className="inline-flex items-center rounded-lg bg-alza-blue-700 px-3 py-1.5 text-xs font-medium text-white"
          >
            Connect
          </button>
        )}
        {status === 'coming_soon' && action === 'none' && (
          <span className="text-xs text-slate-400">{INTEGRATION_STATUS_LABELS.coming_soon}</span>
        )}
      </div>
    </article>
  )
}
