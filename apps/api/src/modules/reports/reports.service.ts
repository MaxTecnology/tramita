import puppeteer from 'puppeteer'
import { prisma } from '@/lib/prisma'
import { redis } from '@/lib/redis'
import { AppError } from '@/errors/AppError'

const CACHE_TTL = 3600

function buildReportHtml(
  orgName: string,
  clientName: string,
  month: string,
  tasks: Array<{ title: string; status: string; priority: string; updatedAt: Date }>,
): string {
  const taskRows = tasks
    .map(
      (t) =>
        `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px">${t.title}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px">${t.status}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px">${t.priority}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px">${new Date(t.updatedAt).toLocaleDateString('pt-BR')}</td>
        </tr>`,
    )
    .join('')

  const done = tasks.filter((t) => t.status === 'DONE').length
  const active = tasks.filter((t) => t.status !== 'DONE' && t.status !== 'CANCELLED').length

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;padding:40px;color:#333}
  h1{color:#1d4ed8;margin-bottom:4px}
  h2{color:#6b7280;font-size:14px;font-weight:normal;margin-top:0}
  table{width:100%;border-collapse:collapse;margin-top:24px}
  th{background:#f3f4f6;padding:8px 12px;text-align:left;font-size:12px}
  .summary{background:#eff6ff;border-radius:8px;padding:16px;margin:24px 0}
  .summary p{margin:4px 0;font-size:13px}
  .footer{margin-top:32px;font-size:11px;color:#9ca3af}
</style>
</head>
<body>
  <h1>${orgName}</h1>
  <h2>Relatório mensal — ${month} — Cliente: ${clientName}</h2>
  <div class="summary">
    <p><strong>Total de tarefas no período:</strong> ${tasks.length}</p>
    <p><strong>Concluídas:</strong> ${done}</p>
    <p><strong>Em andamento:</strong> ${active}</p>
  </div>
  <table>
    <thead><tr>
      <th>Tarefa</th><th>Status</th><th>Prioridade</th><th>Última atualização</th>
    </tr></thead>
    <tbody>${taskRows || '<tr><td colspan="4" style="padding:16px;text-align:center;color:#9ca3af;font-size:12px">Nenhuma tarefa no período</td></tr>'}</tbody>
  </table>
  <p class="footer">Gerado em ${new Date().toLocaleDateString('pt-BR')} — Tramita / AutoHubs</p>
</body>
</html>`
}

export async function generateReport(
  clientId: string,
  organizationId: string,
  month: string,
): Promise<Buffer> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new AppError(400, 'Formato de mês inválido. Use YYYY-MM')

  const cacheKey = `report:${clientId}:${month}`
  const cached = await redis.get(cacheKey).catch(() => null)
  if (cached) return Buffer.from(cached, 'base64')

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId, isActive: true },
    include: { organization: { select: { name: true } } },
  })
  if (!client) throw new AppError(404, 'Cliente não encontrado')

  const [year, mon] = month.split('-').map(Number)
  const from = new Date(year, mon - 1, 1)
  const to = new Date(year, mon, 0, 23, 59, 59, 999)

  const tasks = await prisma.task.findMany({
    where: {
      column: { board: { clientId, organizationId } },
      updatedAt: { gte: from, lte: to },
    },
    orderBy: { updatedAt: 'desc' },
    select: { title: true, status: true, priority: true, updatedAt: true },
  })

  const html = buildReportHtml(client.organization.name, client.name, month, tasks)
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0' })
  const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true })
  await browser.close()

  const buffer = Buffer.from(pdfBuffer)
  await redis.set(cacheKey, buffer.toString('base64'), 'EX', CACHE_TTL).catch(() => {})

  return buffer
}
