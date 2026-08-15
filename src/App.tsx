import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequirePathAccess } from '@/components/auth/RequirePermission'
import { Dashboard } from '@/pages/Dashboard'
import { Clients } from '@/pages/Clients'
import { ClientDetails } from '@/pages/ClientDetails'
import { PolicyFiles } from '@/pages/PolicyFiles'
import { PolicyDetails } from '@/pages/PolicyDetails'
import { Transactions } from '@/pages/Transactions'
import { Financials } from '@/pages/Financials'
import { Reports } from '@/pages/Reports'
import { NotificationsPage } from '@/pages/Notifications'
import { ActivityHistoryPage } from '@/pages/ActivityHistory'
import { Producers } from '@/pages/admin/Producers'
import { CSRs } from '@/pages/admin/CSRs'
import { MGAs } from '@/pages/admin/MGAs'
import { Carriers } from '@/pages/admin/Carriers'
import { UsersPage } from '@/pages/admin/Users'
import { AgencySettingsPage } from '@/pages/admin/AgencySettings'
import { TestSupabase } from '@/pages/TestSupabase'
import { LoginPage } from '@/pages/Login'
import { AccessDeniedPage } from '@/pages/AccessDenied'
import { SetPasswordPage } from '@/pages/SetPassword'
import { useAuth } from '@/lib/auth'

function Guard({ path, children }: { path: string; children: React.ReactNode }) {
  return <RequirePathAccess path={path}>{children}</RequirePathAccess>
}

function AuthenticatedApp() {
  const { status } = useAuth()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-600">Loading ALZA Flow…</p>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <LoginPage />
  }

  if (status === 'access_denied') {
    return <AccessDeniedPage />
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route
          index
          element={
            <Guard path="/">
              <Dashboard />
            </Guard>
          }
        />
        <Route
          path="clients"
          element={
            <Guard path="/clients">
              <Clients />
            </Guard>
          }
        />
        <Route
          path="clients/:id"
          element={
            <Guard path="/clients">
              <ClientDetails />
            </Guard>
          }
        />
        <Route
          path="policy-files"
          element={
            <Guard path="/policy-files">
              <PolicyFiles />
            </Guard>
          }
        />
        <Route
          path="policies/:id"
          element={
            <Guard path="/policies">
              <PolicyDetails />
            </Guard>
          }
        />
        <Route
          path="transactions"
          element={
            <Guard path="/transactions">
              <Transactions />
            </Guard>
          }
        />
        <Route
          path="transactions/:id"
          element={
            <Guard path="/transactions">
              <Transactions />
            </Guard>
          }
        />
        <Route
          path="financials"
          element={
            <Guard path="/financials">
              <Financials />
            </Guard>
          }
        />
        <Route
          path="reports"
          element={
            <Guard path="/reports">
              <Reports />
            </Guard>
          }
        />
        <Route
          path="notifications"
          element={
            <Guard path="/notifications">
              <NotificationsPage />
            </Guard>
          }
        />
        <Route
          path="activity"
          element={
            <Guard path="/activity">
              <ActivityHistoryPage />
            </Guard>
          }
        />
        <Route
          path="admin/producers"
          element={
            <Guard path="/admin/producers">
              <Producers />
            </Guard>
          }
        />
        <Route
          path="admin/csrs"
          element={
            <Guard path="/admin/csrs">
              <CSRs />
            </Guard>
          }
        />
        <Route
          path="admin/mgas"
          element={
            <Guard path="/admin/mgas">
              <MGAs />
            </Guard>
          }
        />
        <Route
          path="admin/carriers"
          element={
            <Guard path="/admin/carriers">
              <Carriers />
            </Guard>
          }
        />
        <Route
          path="admin/users"
          element={
            <Guard path="/admin/users">
              <UsersPage />
            </Guard>
          }
        />
        <Route
          path="admin/agency-settings"
          element={
            <Guard path="/admin/agency-settings">
              <AgencySettingsPage />
            </Guard>
          }
        />
        <Route
          path="test-supabase"
          element={
            <Guard path="/test-supabase">
              <TestSupabase />
            </Guard>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  const location = useLocation()

  // Public auth routes must work before/without the main session gate
  // (invite emails land here with tokens in the URL hash/query).
  if (location.pathname.startsWith('/auth/')) {
    return (
      <Routes>
        <Route path="/auth/set-password" element={<SetPasswordPage />} />
        <Route path="*" element={<Navigate to="/auth/set-password" replace />} />
      </Routes>
    )
  }

  return <AuthenticatedApp />
}
