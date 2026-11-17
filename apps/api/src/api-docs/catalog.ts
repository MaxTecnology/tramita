import type { RouteDocs } from '@/api-docs/types'
import { ACCESS_DOCS } from '@/api-docs/access'
import { WORK_DOCS } from '@/api-docs/work'
import { CLIENT_DOCS } from '@/api-docs/client'
import { SYSTEM_DOCS } from '@/api-docs/system'

// Every route's documentation. A test fails when a route has no entry or an entry names no route.
export const ROUTE_DOCS: RouteDocs = { ...ACCESS_DOCS, ...WORK_DOCS, ...CLIENT_DOCS, ...SYSTEM_DOCS }
