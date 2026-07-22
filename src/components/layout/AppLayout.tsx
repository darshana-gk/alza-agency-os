import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { X } from 'lucide-react'

const pageTitles: Record<string, { title: string; subtitle?: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Overview of your agency performance' },
  '/clients': { title: 'Clients', subtitle: 'Manage client accounts and policies' },
  '/policy-files': { title: 'Policy Files', subtitle: 'Browse and manage policy documents' },
  '/transactions': { title: 'Transactions', subtitle: 'Track payments and financial activity' },
  '/financials': { title: 'Financials', subtitle: 'Revenue, payables, and accounting' },
  '/reports': { title: 'Reports', subtitle: 'Analytics and business intelligence' },
  '/admin/producers': { title: 'Producers', subtitle: 'Manage producer accounts' },
  '/admin/csrs': { title: 'CSRs', subtitle: 'Customer service representatives' },
  '/admin/mgas': { title: 'MGAs', subtitle: 'Managing general agents' },
  '/admin/carriers': { title: 'Carriers', subtitle: 'Insurance carrier partners' },
  '/admin/users': { title: 'Users', subtitle: 'System user management' },
}

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const pageInfo = pageTitles[location.pathname] ?? { title: 'ALZA Flow' }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - mobile slide-in */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute right-3 top-4 rounded-lg p-1 text-white/70 hover:text-white lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
        <Sidebar />
      </div>

      {/* Main content */}
      <div className="lg:pl-64">
        <Header
          title={pageInfo.title}
          subtitle={pageInfo.subtitle}
          onMenuClick={() => setSidebarOpen(true)}
        />
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
