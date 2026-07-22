import { ArrowLeftRight } from 'lucide-react'
import { PagePlaceholder } from '@/components/PagePlaceholder'

export function Transactions() {
  return (
    <PagePlaceholder
      icon={ArrowLeftRight}
      title="Transactions"
      description="Track all financial transactions including premium payments, commissions, and disbursements."
    />
  )
}
