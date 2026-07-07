const BRAND_COLOR = '#185FA5'
const BRAND_NAME = 'Tramita'

export function wrapEmailHtml(subject: string, bodyText: string, ctaUrl?: string, ctaLabel?: string): string {
  const bodyLines = bodyText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 12px 0;color:#374151;font-size:15px;line-height:1.6;">${escapeHtml(line)}</p>`)
    .join('\n')

  const ctaBlock = ctaUrl
    ? `
    <div style="text-align:center;margin:32px 0 8px;">
      <a href="${ctaUrl}"
         style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;
                font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;letter-spacing:0.3px;">
        ${escapeHtml(ctaLabel ?? 'Acessar portal')}
      </a>
    </div>`
    : ''

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',Arial,sans-serif;">

  <!-- wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;background:#ffffff;border-radius:12px;
                      box-shadow:0 1px 4px rgba(0,0,0,.08);overflow:hidden;">

          <!-- header -->
          <tr>
            <td style="background:${BRAND_COLOR};padding:28px 36px 24px;">
              <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">
                ${BRAND_NAME}
              </p>
              <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,.75);font-weight:400;">
                ${escapeHtml(subject)}
              </p>
            </td>
          </tr>

          <!-- divider -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,${BRAND_COLOR},#3b82f6 60%,#93c5fd);"></td>
          </tr>

          <!-- body -->
          <tr>
            <td style="padding:32px 36px 8px;">
              ${bodyLines}
            </td>
          </tr>

          ${ctaBlock ? `<tr><td style="padding:0 36px 24px;">${ctaBlock}</td></tr>` : ''}

          <!-- divider bottom -->
          <tr>
            <td style="padding:24px 36px 0;">
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;" />
            </td>
          </tr>

          <!-- footer -->
          <tr>
            <td style="padding:20px 36px 28px;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                Este email foi enviado automaticamente pelo <strong style="color:#6b7280;">${BRAND_NAME}</strong>.
                Não responda este email.
              </p>
              <p style="margin:8px 0 0;font-size:12px;color:#d1d5db;">
                © ${new Date().getFullYear()} AutoHubs · tramita.autohubs.com.br
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
