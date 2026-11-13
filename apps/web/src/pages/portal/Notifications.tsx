import { NotificationsPage } from '@/components/shared/NotificationsPage'
import { usePortalClient } from './Layout'

export default function PortalNotifications() {
  const { clients, setClientId } = usePortalClient()
  // A notification about another company switches the portal to it before opening
  return (
    <NotificationsPage
      side="client"
      onOpen={(n) => { if (n.clientId && clients.some((c) => c.id === n.clientId)) setClientId(n.clientId) }}
    />
  )
}
