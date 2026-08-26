import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Cable,
  Search,
  Upload,
  Filter,
  AlertCircle,
  X,
  ChevronRight,
} from 'lucide-react'
import { useAuth } from '../lib/auth'
import { roleInputFromProfile } from '../lib/permissions'
import {
  CONNECTOR_CAPABILITIES,
  CONNECTOR_SYNC_PIPELINE,
  INTEGRATION_CATEGORIES,
  INTEGRATION_CATEGORY_LABELS,
  INTEGRATION_PROVIDER_CATALOG,
  ONBOARDING_FALLBACK_PATH,
  canAccessIntegrations,
  groupProvidersByCategory,
  oneLineProviderBlurb,
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
  const [detailId, setDetailId] = useState<string | null>(null)

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

  const sections = useMemo(() => {
    const byId = new Map(filtered.map((c) => [c.provider.id, c]))
    const providers = filtered.map((c) => c.provider)
    return groupProvidersByCategory(providers).map((section) => ({
      category: section.category,
      cards: section.providers
        .map((p) => byId.get(p.id))
        .filter((c): c is ResolvedProviderCard => Boolean(c)),
    }))
  }, [filtered])

  const detailCard = useMemo(
    () => (detailId ? filtered.find((c) => c.provider.id === detailId) ?? cards.find((c) => c.provider.id === detailId) : null),
    [detailId, filtered, cards],
  )

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
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Integrations</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-500">
          Connect the systems your agency already uses to ALZA Flow.
        </p>
      </div>

      <div className="rounded-2xl border border-alza-blue-200/80 bg-gradient-to-r from-alza-blue-50 via-white to-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl space-y-1.5">
            <p className="text-sm font-semibold text-alza-blue-900">
              Don&apos;t see your system or not ready to connect?
            </p>
            <p className="text-sm leading-relaxed text-slate-600">
              Use <span className="font-medium text-slate-800">Import Agency Data</span> for Master Agency
              Data, Clients, Policies, Carriers, MGAs, Producers, and CSRs via Onboarding Import.
            </p>
          </div>
          <Link
            to={ONBOARDING_FALLBACK_PATH}
            className="inline-flex items-center gap-2 rounded-lg bg-alza-blue-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-alza-blue-800"
          >
            <Upload className="h-4 w-4" />
            Import Agency Data
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search providers…"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 shadow-sm focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Filter className="h-3.5 w-3.5" />
            Filters
          </span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as IntegrationCategory | 'all')}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
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
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-alza-blue-500 focus:outline-none focus:ring-2 focus:ring-alza-blue-500/20"
          >
            <option value="all">All availability</option>
            <option value="available_now">Available now</option>
            <option value="coming_soon">Coming soon</option>
            <option value="request">Request integration</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-sky-50 px-2.5 py-1 font-medium text-sky-800 ring-1 ring-sky-600/15">
          Available now
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600 ring-1 ring-slate-500/15">
          Coming soon
        </span>
        <span className="rounded-full bg-violet-50 px-2.5 py-1 font-medium text-violet-800 ring-1 ring-violet-600/15">
          Request integration
        </span>
        <span className="ml-auto tabular-nums text-slate-500">
          {filtered.length} of {INTEGRATION_PROVIDER_CATALOG.length} providers
        </span>
      </div>

      {requestNote && (
        <div className="flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{requestNote}</p>
        </div>
      )}

      {sections.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center text-sm text-slate-500">
          No providers match your filters.
        </div>
      ) : (
        <div className="space-y-10">
          {sections.map((section) => (
            <section key={section.category} className="space-y-4">
              <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    {INTEGRATION_CATEGORY_LABELS[section.category]}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {section.cards.length} integration{section.cards.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {section.cards.map((card) => (
                  <CompactProviderCard
                    key={card.provider.id}
                    card={card}
                    onView={() => setDetailId(card.provider.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="text-xs leading-relaxed text-slate-400">
        Vendor connectors are not live in this foundation. Connected appears only after a real authenticated
        connection. Manual commission statement upload in Reconciliation remains supported.
      </p>

      {detailCard && (
        <ProviderDetailDrawer
          card={detailCard}
          onClose={() => setDetailId(null)}
          onRequest={() => onRequest(detailCard.provider.id, detailCard.provider.name)}
        />
      )}
    </div>
  )
}

function CompactProviderCard({
  card,
  onView,
}: {
  card: ResolvedProviderCard
  onView: () => void
}) {
  const { provider, status, statusLabel } = card
  const blurb = oneLineProviderBlurb(provider.description)

  return (
    <article className="group flex flex-col rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-sm transition-shadow hover:border-slate-300 hover:shadow-md">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-alza-blue-700 ring-1 ring-slate-200/80">
          <Cable className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900">{provider.name}</h3>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            {INTEGRATION_CATEGORY_LABELS[provider.category]}
          </p>
        </div>
      </div>
      <p className="mt-2.5 line-clamp-2 text-xs leading-relaxed text-slate-600">{blurb}</p>
      <button
        type="button"
        onClick={onView}
        className="mt-3 inline-flex items-center gap-1 self-start text-xs font-semibold text-alza-blue-700 hover:text-alza-blue-800"
      >
        View integration
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
      </button>
    </article>
  )
}

function ProviderDetailDrawer({
  card,
  onClose,
  onRequest,
}: {
  card: ResolvedProviderCard
  onClose: () => void
  onRequest: () => void
}) {
  const { provider, status, statusLabel, action, actionLabel, connectAllowed } = card
  const availabilityLabel =
    provider.availability === 'coming_soon'
      ? 'Coming soon'
      : provider.availability === 'request'
        ? 'Request integration'
        : 'Available'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close integration details"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-alza-blue-50 text-alza-blue-700">
              <Cable className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{provider.name}</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {INTEGRATION_CATEGORY_LABELS[provider.category]}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <div className="flex flex-wrap gap-2">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
            >
              {statusLabel}
            </span>
            <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
              {availabilityLabel}
            </span>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{provider.description}</p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Capabilities</h3>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {CONNECTOR_CAPABILITIES.map((cap) => (
                <li
                  key={cap}
                  className="rounded-md bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200/80"
                >
                  {cap}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              Framework contract for future connectors — not live for this provider yet.
            </p>
          </div>

          {provider.feedKinds && provider.feedKinds.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Connection / feed architecture
              </h3>
              <p className="mt-2 text-sm text-slate-700">
                Future transport options for this integration:
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {provider.feedKinds.map((kind) => (
                  <li
                    key={kind}
                    className="rounded-md bg-alza-blue-50 px-2 py-1 font-mono text-[11px] text-alza-blue-800 ring-1 ring-alza-blue-200/70"
                  >
                    {kind}
                  </li>
                ))}
              </ul>
              {provider.category === 'carrier_mga_commission_feeds' && (
                <p className="mt-3 text-sm leading-relaxed text-slate-600">
                  Normalized feed lines hand off to ALZA&apos;s <span className="font-medium">existing</span>{' '}
                  Reconciliation staging and matching engine. Manual statement upload remains supported. No
                  second reconciliation engine.
                </p>
              )}
            </div>
          )}

          {(provider.category === 'payments' || provider.category === 'banking') && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Evidence model
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Payment and bank signals are evidence only. Matching amounts alone never auto-confirm
                commission receipt — existing ALZA reconciliation rules must justify confirmation.
              </p>
            </div>
          )}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sync pipeline</h3>
            <p className="mt-2 font-mono text-[11px] leading-relaxed text-slate-600">
              {CONNECTOR_SYNC_PIPELINE.join(' → ')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-4">
          {action === 'import_agency_data' && provider.fallbackPath && (
            <Link
              to={provider.fallbackPath}
              className="inline-flex items-center gap-2 rounded-lg bg-alza-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-alza-blue-800"
            >
              <Upload className="h-4 w-4" />
              {actionLabel}
            </Link>
          )}
          {action === 'request' && (
            <button
              type="button"
              disabled={status === 'requested'}
              onClick={onRequest}
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-default disabled:opacity-60"
            >
              {actionLabel}
            </button>
          )}
          {action === 'connect' && connectAllowed && (
            <button
              type="button"
              className="inline-flex items-center rounded-lg bg-alza-blue-700 px-4 py-2 text-sm font-medium text-white"
            >
              Connect
            </button>
          )}
          {action === 'manage' && (
            <button
              type="button"
              className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800"
            >
              {actionLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-sm font-medium text-slate-500 hover:text-slate-800"
          >
            Close
          </button>
        </div>
      </aside>
    </div>
  )
}
