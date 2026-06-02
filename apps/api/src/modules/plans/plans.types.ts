export interface PlanFeatures {
  pdf: boolean
  sse: boolean
  attachments: boolean
  [key: string]: boolean
}

export interface PlanData {
  name: string
  maxClients: number
  priceMonthly: number
  features: PlanFeatures
}
