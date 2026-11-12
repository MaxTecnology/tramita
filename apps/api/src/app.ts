import './load-env'

import { buildApp } from '@/server'

const app = buildApp()

app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err)
    process.exit(1)
  }
})
