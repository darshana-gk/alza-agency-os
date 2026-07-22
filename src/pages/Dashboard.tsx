import {
    DollarSign,
    Wallet,
    Users,
    RotateCcw,
    CalendarClock,
    Activity,
  } from 'lucide-react'
  
  import { StatCard } from '@/components/dashboard/StatCard'
  import { RevenueChart } from '@/components/dashboard/RevenueChart'
  import {
    RecentActivity,
    RenewalsWidget,
  } from '@/components/dashboard/RecentActivity'
  
  import type { StatCardData, ActivityItem } from '@/types'
  
  const statCards: StatCardData[] = [
    {
      title: 'Expected Revenue',
      value: '$62,400',
      change: '+8.2% vs last month',
      changeType: 'positive',
      icon: DollarSign,
      iconBg: 'bg-alza-blue-50',
      iconColor: 'text-alza-blue-600',
    },
    {
      title: 'Revenue Received',
      value: '$58,900',
      change: '+12.4% vs last month',
      changeType: 'positive',
      icon: Wallet,
      iconBg: 'bg-alza-teal-50',
      iconColor: 'text-alza-teal-600',
    },
    {
      title: 'Producer Payables',
      value: '$14,250',
      change: '3 pending approvals',
      changeType: 'neutral',
      icon: Users,
      iconBg: 'bg-violet-50',
      iconColor: 'text-violet-600',
    },
    {
      title: 'Customer Payments Pending',
      value: '$2,180',
      change: '2 awaiting review',
      changeType: 'negative',
      icon: RotateCcw,
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-600',
    },
    {
      title: 'Renewals Due',
      value: '24',
      change: 'Next 30 days',
      changeType: 'neutral',
      icon: CalendarClock,
      iconBg: 'bg-orange-50',
      iconColor: 'text-orange-600',
    },
    {
      title: 'Agency Expenses',
      value: '$8,950',
      change: '12 expenses this month',
      changeType: 'positive',
      icon: Activity,
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
    },
  ]
  
  const recentActivities: ActivityItem[] = [
    {
      id: '1',
      title: 'Payment received',
      description: 'Johnson Family Trust — $4,250.00 premium payment',
      time: '2m ago',
      type: 'payment',
    },
    {
      id: '2',
      title: 'Policy renewed',
      description: 'Metro Auto Group LLC — Commercial Auto policy',
      time: '15m ago',
      type: 'renewal',
    },
    {
      id: '3',
      title: 'New client added',
      description: 'Sunrise Properties Inc — assigned to Sarah Mitchell',
      time: '1h ago',
      type: 'client',
    },
    {
      id: '4',
      title: 'Policy issued',
      description: 'Coastal Marine Services — General Liability',
      time: '2h ago',
      type: 'policy',
    },
    {
      id: '5',
      title: 'Refund initiated',
      description: 'Westside Retail Group — $890.00 overpayment',
      time: '3h ago',
      type: 'refund',
    },
  ]
  
  export function Dashboard() {
    return (
      <div className="space-y-6">
        {/* Welcome Banner */}
        <div className="relative overflow-hidden rounded-xl gradient-alza p-6 text-white shadow-lg">
          <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/10" />
          <div className="absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-white/5" />
  
          <div className="relative">
            <h2 className="text-2xl font-bold">
              Welcome to ALZA Flow Dashboard
            </h2>
  
            <p className="mt-2 max-w-2xl text-sm text-blue-100">
              Insurance Agency Operating System for ALZA Business Solutions LLP.
              Track customers, policies, commissions, renewals,
              endorsements, audits, cancellations and agency
              profitability from one dashboard.
            </p>
          </div>
        </div>
  
        {/* Stat Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {statCards.map((card) => (
            <StatCard key={card.title} {...card} />
          ))}
        </div>
  
        {/* Revenue + Renewals */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RevenueChart />
          </div>
  
          <RenewalsWidget count={24} />
        </div>
  
        {/* Recent Activity */}
        <RecentActivity activities={recentActivities} />
      </div>
    )
  }