import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Building2,
  ClipboardList,
  DollarSign,
  FileCheck,
  FileText,
  MessageSquare,
  RefreshCw,
  ScrollText,
  Shield,
  StickyNote,
} from 'lucide-react'

type ClientStatus = 'active' | 'pending' | 'inactive' | 'prospect'
type PolicyStatus = 'active' | 'pending' | 'expired' | 'cancelled' | 'renewal_due'
type ActivityType = 'quote' | 'policy_bound' | 'endorsement' | 'audit' | 'renewal' | 'note'
type DocumentCategory = 'policy_pdf' | 'coi' | 'application' | 'signed_form'

interface ClientPolicy {
  policyNumber: string
  policyType: string
  carrier: string
  mga: string
  effectiveDate: string
  expirationDate: string
  premium: number
  status: PolicyStatus
}

interface ClientFinancials {
  totalWrittenPremium: number
  brokerFees: number
  carrierCommission: number
  producerCommission: number
  outstandingBalance: number
}

interface ClientActivity {
  id: string
  type: ActivityType
  title: string
  description: string
  date: string
}

interface ClientDocument {
  id: string
  name: string
  category: DocumentCategory
  uploadedAt: string
}

interface ClientDetail {
  id: number
  businessName: string
  dba: string
  fein: string
  contact: string
  phone: string
  email: string
  address: string
  producer: string
  csr: string
  status: ClientStatus
  policies: ClientPolicy[]
  financials: ClientFinancials
  activities: ClientActivity[]
  documents: ClientDocument[]
}

const clientStatusLabels: Record<ClientStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  inactive: 'Inactive',
  prospect: 'Prospect',
}

const clientStatusStyles: Record<ClientStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  prospect: 'bg-alza-blue-50 text-alza-blue-700 ring-alza-blue-600/20',
}

const policyStatusLabels: Record<PolicyStatus, string> = {
  active: 'Active',
  pending: 'Pending',
  expired: 'Expired',
  cancelled: 'Cancelled',
  renewal_due: 'Renewal Due',
}

const policyStatusStyles: Record<PolicyStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  expired: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  cancelled: 'bg-red-50 text-red-700 ring-red-600/20',
  renewal_due: 'bg-orange-50 text-orange-700 ring-orange-600/20',
}

const activityConfig: Record<
  ActivityType,
  { label: string; icon: typeof FileText; color: string }
> = {
  quote: { label: 'Quote', icon: ScrollText, color: 'text-alza-blue-600 bg-alza-blue-50' },
  policy_bound: { label: 'Policy Bound', icon: FileCheck, color: 'text-emerald-600 bg-emerald-50' },
  endorsement: { label: 'Endorsement', icon: ClipboardList, color: 'text-violet-600 bg-violet-50' },
  audit: { label: 'Audit', icon: Shield, color: 'text-orange-600 bg-orange-50' },
  renewal: { label: 'Renewal', icon: RefreshCw, color: 'text-alza-teal-600 bg-alza-teal-50' },
  note: { label: 'Note', icon: StickyNote, color: 'text-slate-600 bg-slate-100' },
}

const documentCategoryLabels: Record<DocumentCategory, string> = {
  policy_pdf: 'Policy PDFs',
  coi: 'COIs',
  application: 'Applications',
  signed_form: 'Signed Forms',
}

const clientDetails: ClientDetail[] = [
  {
    id: 1,
    businessName: 'ABC Construction LLC',
    dba: 'ABC Builders',
    fein: '84-2917365',
    contact: 'John Miller',
    phone: '(555) 123-4567',
    email: 'john@abcconstruction.com',
    address: '1240 Industrial Parkway, Austin, TX 78744',
    producer: 'Michael Johnson',
    csr: 'Emily Nguyen',
    status: 'active',
    policies: [
      {
        policyNumber: 'CGL-2026-004821',
        policyType: 'Commercial General Liability',
        carrier: 'Hartford',
        mga: 'AmWINS Brokerage',
        effectiveDate: '2026-01-15',
        expirationDate: '2027-01-15',
        premium: 18500,
        status: 'active',
      },
      {
        policyNumber: 'WC-2026-004822',
        policyType: 'Workers Compensation',
        carrier: 'Employers',
        mga: 'Burns & Wilcox',
        effectiveDate: '2026-01-15',
        expirationDate: '2027-01-15',
        premium: 24000,
        status: 'active',
      },
      {
        policyNumber: 'CA-2025-004820',
        policyType: 'Commercial Auto',
        carrier: 'Travelers',
        mga: 'RT Specialty',
        effectiveDate: '2025-06-01',
        expirationDate: '2026-06-01',
        premium: 0,
        status: 'expired',
      },
    ],
    financials: {
      totalWrittenPremium: 42500,
      brokerFees: 2125,
      carrierCommission: 6375,
      producerCommission: 4250,
      outstandingBalance: 1850,
    },
    activities: [
      {
        id: '1',
        type: 'renewal',
        title: 'Renewal quote requested',
        description: 'CGL policy renewal — Hartford quote in progress',
        date: '2026-07-18',
      },
      {
        id: '2',
        type: 'endorsement',
        title: 'Additional insured added',
        description: 'City of Austin added to CGL-2026-004821',
        date: '2026-06-22',
      },
      {
        id: '3',
        type: 'policy_bound',
        title: 'Workers Comp policy bound',
        description: 'WC-2026-004822 effective 01/15/2026',
        date: '2026-01-10',
      },
      {
        id: '4',
        type: 'quote',
        title: 'Umbrella quote submitted',
        description: 'Requested $2M umbrella over CGL and WC',
        date: '2025-12-05',
      },
      {
        id: '5',
        type: 'note',
        title: 'Account review note',
        description: 'Client expanding to San Antonio — discuss fleet coverage at renewal',
        date: '2025-11-14',
      },
    ],
    documents: [
      { id: 'd1', name: 'CGL-2026-004821 Declarations.pdf', category: 'policy_pdf', uploadedAt: '2026-01-15' },
      { id: 'd2', name: 'WC-2026-004822 Policy Jacket.pdf', category: 'policy_pdf', uploadedAt: '2026-01-15' },
      { id: 'd3', name: 'COI — City of Austin Project.pdf', category: 'coi', uploadedAt: '2026-06-22' },
      { id: 'd4', name: 'Commercial Insurance Application.pdf', category: 'application', uploadedAt: '2025-12-01' },
      { id: 'd5', name: 'Signed Broker of Record Letter.pdf', category: 'signed_form', uploadedAt: '2025-11-20' },
    ],
  },
  {
    id: 2,
    businessName: 'Sunrise Roofing Inc',
    dba: 'Sunrise Roofing',
    fein: '73-4829104',
    contact: 'David Smith',
    phone: '(555) 234-5678',
    email: 'info@sunriseroofing.com',
    address: '890 Commerce Drive, Phoenix, AZ 85034',
    producer: 'Sarah Wilson',
    csr: 'David Ortiz',
    status: 'active',
    policies: [
      {
        policyNumber: 'WC-2026-009134',
        policyType: 'Workers Compensation',
        carrier: 'Travelers',
        mga: 'RT Specialty',
        effectiveDate: '2026-03-01',
        expirationDate: '2027-03-01',
        premium: 22400,
        status: 'active',
      },
      {
        policyNumber: 'GL-2025-009133',
        policyType: 'Commercial General Liability',
        carrier: 'Markel',
        mga: 'AmWINS Brokerage',
        effectiveDate: '2025-03-01',
        expirationDate: '2026-03-01',
        premium: 0,
        status: 'renewal_due',
      },
    ],
    financials: {
      totalWrittenPremium: 18900,
      brokerFees: 945,
      carrierCommission: 2835,
      producerCommission: 1890,
      outstandingBalance: 0,
    },
    activities: [
      { id: '1', type: 'audit', title: 'WC payroll audit scheduled', description: 'Travelers audit for policy year 2025', date: '2026-07-10' },
      { id: '2', type: 'renewal', title: 'GL renewal due', description: 'Markel GL expiring 03/01/2026', date: '2026-06-15' },
      { id: '3', type: 'policy_bound', title: 'WC policy bound', description: 'WC-2026-009134 effective 03/01/2026', date: '2026-02-20' },
    ],
    documents: [
      { id: 'd1', name: 'WC-2026-009134 Declarations.pdf', category: 'policy_pdf', uploadedAt: '2026-03-01' },
      { id: 'd2', name: 'COI — General Contractor.pdf', category: 'coi', uploadedAt: '2026-04-12' },
      { id: 'd3', name: 'Roofing Operations Application.pdf', category: 'application', uploadedAt: '2026-02-01' },
    ],
  },
  {
    id: 3,
    businessName: 'Metro Auto Group LLC',
    dba: 'Metro Auto Group',
    fein: '62-1938472',
    contact: 'Lisa Chen',
    phone: '(555) 345-6789',
    email: 'lisa@metroauto.com',
    address: '4500 Auto Mall Blvd, Dallas, TX 75207',
    producer: 'Michael Johnson',
    csr: 'Emily Nguyen',
    status: 'active',
    policies: [
      {
        policyNumber: 'CA-2025-112907',
        policyType: 'Commercial Auto',
        carrier: 'Liberty Mutual',
        mga: 'CRC Group',
        effectiveDate: '2025-08-01',
        expirationDate: '2026-08-01',
        premium: 34200,
        status: 'renewal_due',
      },
    ],
    financials: {
      totalWrittenPremium: 67200,
      brokerFees: 3360,
      carrierCommission: 10080,
      producerCommission: 6720,
      outstandingBalance: 4200,
    },
    activities: [
      { id: '1', type: 'renewal', title: 'Commercial Auto renewal', description: 'Liberty Mutual renewal quote — 42 vehicles', date: '2026-07-05' },
      { id: '2', type: 'endorsement', title: 'Vehicle added to fleet', description: '2026 Ford F-150 added to CA-2025-112907', date: '2026-05-18' },
      { id: '3', type: 'quote', title: 'Garagekeepers quote', description: 'Quoted garagekeepers for service department', date: '2026-03-22' },
    ],
    documents: [
      { id: 'd1', name: 'CA-2025-112907 Policy.pdf', category: 'policy_pdf', uploadedAt: '2025-08-01' },
      { id: 'd2', name: 'Fleet Schedule — 42 Units.pdf', category: 'application', uploadedAt: '2025-07-15' },
      { id: 'd3', name: 'Signed Payment Authorization.pdf', category: 'signed_form', uploadedAt: '2025-07-20' },
    ],
  },
]

function getDefaultClientDetail(id: number): ClientDetail | undefined {
  const defaults: Record<number, Partial<ClientDetail>> = {
    4: {
      businessName: 'Coastal Marine Services',
      dba: 'Coastal Marine',
      fein: '91-2847361',
      contact: 'Robert Hayes',
      phone: '(555) 456-7890',
      email: 'rhayes@coastmarine.com',
      address: '220 Harbor View Rd, Tampa, FL 33602',
      producer: 'Sarah Wilson',
      csr: 'Rachel Kim',
      status: 'pending',
    },
    5: {
      businessName: 'Sunrise Properties Inc',
      dba: 'Sunrise Properties',
      fein: '55-3928174',
      contact: 'Amanda Torres',
      phone: '(555) 567-8901',
      email: 'amanda@sunriseprops.com',
      address: '1800 Market Street, Denver, CO 80202',
      producer: 'James Carter',
      csr: 'David Ortiz',
      status: 'active',
    },
    6: {
      businessName: 'Westside Retail Group',
      dba: 'Westside Retail',
      fein: '48-1029384',
      contact: 'Kevin Brooks',
      phone: '(555) 678-9012',
      email: 'kbrooks@westsideretail.com',
      address: '3300 Westheimer Rd, Houston, TX 77098',
      producer: 'Sarah Wilson',
      csr: 'Rachel Kim',
      status: 'inactive',
    },
    7: {
      businessName: 'Johnson Family Trust',
      dba: '—',
      fein: 'N/A (Trust)',
      contact: 'Patricia Johnson',
      phone: '(555) 789-0123',
      email: 'pjohnson@jfamilytrust.com',
      address: '8901 Estate Lane, Naples, FL 34108',
      producer: 'Michael Johnson',
      csr: 'Emily Nguyen',
      status: 'active',
    },
    8: {
      businessName: 'Peak Logistics Corp',
      dba: 'Peak Logistics',
      fein: '33-8472910',
      contact: 'Daniel Wright',
      phone: '(555) 890-1234',
      email: 'dwright@peaklogistics.com',
      address: '5600 Logistics Way, Memphis, TN 38118',
      producer: 'James Carter',
      csr: 'Rachel Kim',
      status: 'prospect',
    },
    9: {
      businessName: 'Harbor Medical Group',
      dba: 'Harbor Medical',
      fein: '26-5910384',
      contact: 'Dr. Emily Park',
      phone: '(555) 901-2345',
      email: 'epark@harbormedical.com',
      address: '1200 Medical Center Dr, Seattle, WA 98101',
      producer: 'Sarah Wilson',
      csr: 'David Ortiz',
      status: 'active',
    },
    10: {
      businessName: 'Summit Tech Solutions',
      dba: 'Summit Tech',
      fein: '81-2039481',
      contact: 'Marcus Lee',
      phone: '(555) 012-3456',
      email: 'marcus@summittech.io',
      address: '500 Innovation Blvd, San Jose, CA 95134',
      producer: 'James Carter',
      csr: 'Rachel Kim',
      status: 'pending',
    },
    11: {
      businessName: 'Green Valley Farms',
      dba: 'Green Valley Farms',
      fein: '42-9182736',
      contact: 'Thomas Green',
      phone: '(555) 111-2222',
      email: 'tgreen@greenvalleyfarms.com',
      address: '7800 County Road 12, Des Moines, IA 50309',
      producer: 'Michael Johnson',
      csr: 'Emily Nguyen',
      status: 'active',
    },
    12: {
      businessName: 'Urban Fitness Studios',
      dba: 'Urban Fitness',
      fein: '59-3847261',
      contact: 'Nina Alvarez',
      phone: '(555) 222-3333',
      email: 'nina@urbanfitness.com',
      address: '1450 Fitness Ave, Miami, FL 33130',
      producer: 'Sarah Wilson',
      csr: 'David Ortiz',
      status: 'prospect',
    },
  }

  const base = defaults[id]
  if (!base) return undefined

  return {
    id,
    businessName: base.businessName!,
    dba: base.dba!,
    fein: base.fein!,
    contact: base.contact!,
    phone: base.phone!,
    email: base.email!,
    address: base.address!,
    producer: base.producer!,
    csr: base.csr!,
    status: base.status!,
    policies: base.policies ?? [
      {
        policyNumber: `GL-2026-${id.toString().padStart(6, '0')}`,
        policyType: 'Commercial General Liability',
        carrier: 'Travelers',
        mga: 'AmWINS Brokerage',
        effectiveDate: '2026-01-01',
        expirationDate: '2027-01-01',
        premium: 8500 + id * 1200,
        status: base.status === 'inactive' ? 'expired' : 'active',
      },
    ],
    financials: base.financials ?? {
      totalWrittenPremium: 8500 + id * 3200,
      brokerFees: 425 + id * 160,
      carrierCommission: 1275 + id * 480,
      producerCommission: 850 + id * 320,
      outstandingBalance: base.status === 'prospect' ? 0 : id * 150,
    },
    activities: base.activities ?? [
      {
        id: '1',
        type: 'note',
        title: 'Account opened',
        description: `${base.businessName} added to ALZA Flow`,
        date: '2026-01-15',
      },
      {
        id: '2',
        type: 'quote',
        title: 'Initial quote provided',
        description: 'Commercial package quote sent to client',
        date: '2026-02-01',
      },
    ],
    documents: base.documents ?? [
      {
        id: 'd1',
        name: 'Client Information Form.pdf',
        category: 'application',
        uploadedAt: '2026-01-10',
      },
      {
        id: 'd2',
        name: 'Signed Agency Agreement.pdf',
        category: 'signed_form',
        uploadedAt: '2026-01-12',
      },
    ],
  }
}

function getClientDetail(id: number): ClientDetail | undefined {
  return clientDetails.find((c) => c.id === id) ?? getDefaultClientDetail(id)
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-sm text-slate-900">{value}</p>
    </div>
  )
}

export function ClientDetails() {
  const { id } = useParams<{ id: string }>()
  const client = getClientDetail(Number(id))

  if (!client) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
        <Building2 className="mx-auto h-12 w-12 text-slate-300" />
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Client not found</h2>
        <p className="mt-2 text-sm text-slate-500">The requested client record does not exist.</p>
        <Link
          to="/clients"
          className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-alza-blue-600 hover:text-alza-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Clients
        </Link>
      </div>
    )
  }

  const documentGroups = (Object.keys(documentCategoryLabels) as DocumentCategory[]).map(
    (category) => ({
      category,
      label: documentCategoryLabels[category],
      items: client.documents.filter((doc) => doc.category === category),
    }),
  )

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to="/clients"
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-alza-blue-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Clients
      </Link>

      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{client.businessName}</h1>
          <p className="text-sm text-slate-500">Client 360° View · ID #{client.id.toString().padStart(4, '0')}</p>
        </div>
        <span
          className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${clientStatusStyles[client.status]}`}
        >
          {clientStatusLabels[client.status]}
        </span>
      </div>

      {/* Client Information */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-alza-blue-50">
            <Building2 className="h-5 w-5 text-alza-blue-600" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">Client Information</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <InfoField label="Business Name" value={client.businessName} />
          <InfoField label="DBA" value={client.dba} />
          <InfoField label="FEIN" value={client.fein} />
          <InfoField label="Contact" value={client.contact} />
          <InfoField label="Phone" value={client.phone} />
          <InfoField label="Email" value={client.email} />
          <InfoField label="Address" value={client.address} />
          <InfoField label="Producer" value={client.producer} />
          <InfoField label="CSR" value={client.csr} />
          <InfoField label="Status" value={clientStatusLabels[client.status]} />
        </div>
      </div>

      {/* Financial Summary */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: 'Total Written Premium', value: formatCurrency(client.financials.totalWrittenPremium), icon: DollarSign, bg: 'bg-alza-teal-50', color: 'text-alza-teal-600' },
          { label: 'Broker Fees', value: formatCurrency(client.financials.brokerFees), icon: DollarSign, bg: 'bg-alza-blue-50', color: 'text-alza-blue-600' },
          { label: 'Carrier Commission', value: formatCurrency(client.financials.carrierCommission), icon: DollarSign, bg: 'bg-violet-50', color: 'text-violet-600' },
          { label: 'Producer Commission', value: formatCurrency(client.financials.producerCommission), icon: DollarSign, bg: 'bg-emerald-50', color: 'text-emerald-600' },
          { label: 'Outstanding Balance', value: formatCurrency(client.financials.outstandingBalance), icon: DollarSign, bg: 'bg-orange-50', color: 'text-orange-600' },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">{card.label}</p>
                <p className="mt-2 text-xl font-bold text-slate-900">{card.value}</p>
              </div>
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Policy Summary */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-alza-blue-50">
              <FileText className="h-4 w-4 text-alza-blue-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Policy Summary</h2>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                {['Policy Number', 'Policy Type', 'Carrier', 'MGA', 'Effective Date', 'Expiration Date', 'Premium', 'Status'].map((col) => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {client.policies.map((policy) => (
                <tr key={policy.policyNumber} className="hover:bg-slate-50/60">
                  <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-alza-blue-700">
                    {policy.policyNumber}
                  </td>
                  <td className="px-4 py-4 text-sm text-slate-700">{policy.policyType}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">{policy.carrier}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">{policy.mga}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">{formatDate(policy.effectiveDate)}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">{formatDate(policy.expirationDate)}</td>
                  <td className="whitespace-nowrap px-4 py-4 text-sm font-semibold text-slate-900">
                    {formatCurrency(policy.premium)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${policyStatusStyles[policy.status]}`}>
                      {policyStatusLabels[policy.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Activity Timeline */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-alza-teal-50">
                <MessageSquare className="h-4 w-4 text-alza-teal-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Activity Timeline</h2>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {client.activities.map((activity) => {
              const config = activityConfig[activity.type]
              const Icon = config.icon
              return (
                <div key={activity.id} className="flex gap-4 px-6 py-4">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${config.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">{activity.title}</p>
                      <span className="shrink-0 text-xs text-slate-500">{formatDate(activity.date)}</span>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-600">{activity.description}</p>
                    <span className="mt-1.5 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {config.label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Documents */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50">
                <FileText className="h-4 w-4 text-violet-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Documents</h2>
            </div>
          </div>
          <div className="space-y-5 p-6">
            {documentGroups.map((group) => (
              <div key={group.category}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {group.label}
                </h3>
                {group.items.length === 0 ? (
                  <p className="text-sm text-slate-400">No documents uploaded</p>
                ) : (
                  <ul className="space-y-2">
                    {group.items.map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2.5 transition-colors hover:border-alza-blue-200 hover:bg-alza-blue-50/30"
                      >
                        <div className="flex items-center gap-2.5">
                          <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="text-sm font-medium text-slate-800">{doc.name}</span>
                        </div>
                        <span className="shrink-0 text-xs text-slate-500">{formatDate(doc.uploadedAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
