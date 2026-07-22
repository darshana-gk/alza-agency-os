import { type LucideIcon } from 'lucide-react'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
}

export interface NavGroup {
  title?: string
  items: NavItem[]
}

export interface StatCardData {
  title: string
  value: string
  change: string
  changeType: 'positive' | 'negative' | 'neutral'
  icon: LucideIcon
  iconBg: string
  iconColor: string
}

export interface ActivityItem {
  id: string
  title: string
  description: string
  time: string
  type: 'payment' | 'renewal' | 'client' | 'policy' | 'refund'
}
