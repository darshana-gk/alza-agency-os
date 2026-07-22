import { UserCircle } from 'lucide-react'
import { PagePlaceholder } from '@/components/PagePlaceholder'

export function UsersPage() {
  return (
    <PagePlaceholder
      icon={UserCircle}
      title="User Management"
      description="Create and manage system users, roles, permissions, and access controls."
    />
  )
}
