export interface OrgListItem {
  id: string
  name: string
  slug: string
  email: string
  subscriptionStatus: string
  planId: string
  planName: string
  clientsCount: number
  usersCount: number
  createdAt: Date
}

export interface OrgDetail extends OrgListItem {
  cnpj: string | null
  phone: string | null
  gracePeriodEndsAt: Date | null
  trialEndsAt: Date | null
  subscriptionHistory: Array<{
    id: string
    event: string
    amount: number | null
    createdAt: Date
  }>
}
