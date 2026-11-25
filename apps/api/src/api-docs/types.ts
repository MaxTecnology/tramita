import type { ZodTypeAny } from 'zod'

// What the reference shows for one route. Bodies and queries are the same Zod schemas the
// handler validates with, so the documentation follows the code.
export type RouteDoc = {
  summary: string
  description?: string
  body?: ZodTypeAny
  querystring?: ZodTypeAny
  // Who can call it, when the role is checked inside the service (after the body is read) and the
  // route audit probe cannot see it; wins over the probe in the generated files
  roles?: string[]
  // File upload (multipart/form-data); `fields` lists the text fields sent before the file and
  // `file` says what the file may be when the route differs from the default upload policy
  upload?: { fields?: Record<string, string>; file?: string }
}

// Key: "METHOD /path/:param", exactly as the route is registered
export type RouteDocs = Record<string, RouteDoc>
