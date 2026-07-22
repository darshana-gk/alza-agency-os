import { Routes, Route } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Dashboard } from '@/pages/Dashboard'
import { Clients } from '@/pages/Clients'
import { ClientDetails } from '@/pages/ClientDetails'
import { PolicyFiles } from '@/pages/PolicyFiles'
import { Transactions } from '@/pages/Transactions'
import { Financials } from '@/pages/Financials'
import { Reports } from '@/pages/Reports'
import { Producers } from '@/pages/admin/Producers'
import { CSRs } from '@/pages/admin/CSRs'
import { MGAs } from '@/pages/admin/MGAs'
import { Carriers } from '@/pages/admin/Carriers'
import { UsersPage } from '@/pages/admin/Users'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="clients" element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetails />} />
        <Route path="policy-files" element={<PolicyFiles />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="financials" element={<Financials />} />
        <Route path="reports" element={<Reports />} />
        <Route path="admin/producers" element={<Producers />} />
        <Route path="admin/csrs" element={<CSRs />} />
        <Route path="admin/mgas" element={<MGAs />} />
        <Route path="admin/carriers" element={<Carriers />} />
        <Route path="admin/users" element={<UsersPage />} />
      </Route>
    </Routes>
  )
}
