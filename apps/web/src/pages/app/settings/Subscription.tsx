import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import OrgSubscription from '@/pages/org/Subscription'

export default function Subscription() {
  return (
    <div>
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <Link to="/app/settings" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft size={12} /> Configurações
        </Link>
      </div>
      <OrgSubscription />
    </div>
  )
}
