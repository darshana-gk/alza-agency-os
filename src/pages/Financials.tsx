import { DollarSign } from 'lucide-react'
import { PagePlaceholder } from '@/components/PagePlaceholder'

export function Financials() {
  return (
    <PagePlaceholder
      icon={DollarSign}
      title="Financials"
      description="Manage revenue, payables, receivables, and accounting integrations for your agency."
    />
  )
}
