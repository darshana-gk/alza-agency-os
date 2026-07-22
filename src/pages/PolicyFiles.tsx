import { FileText } from 'lucide-react'
import { PagePlaceholder } from '@/components/PagePlaceholder'

export function PolicyFiles() {
  return (
    <PagePlaceholder
      icon={FileText}
      title="Policy Files"
      description="Browse, upload, and manage policy documents. Access endorsements, declarations, and certificates."
    />
  )
}
