import { UserCog } from 'lucide-react'
import { PagePlaceholder } from '@/components/PagePlaceholder'

export function Producers() {
  return (
    <PagePlaceholder
      icon={UserCog}
      title="Producers"
      description="Manage producer profiles, commission schedules, and production hierarchies."
    />
  )
}
