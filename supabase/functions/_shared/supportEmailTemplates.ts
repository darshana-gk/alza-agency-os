/**
 * ALZA Support email templates (shared by notify-support-event).
 * Identity: support@alzabusiness.com
 * Fail-soft callers must never block support message writes.
 */

export type SupportEmailEvent =
  | 'request_created'
  | 'customer_replied'
  | 'alza_replied'
  | 'ticket_resolved'
  | 'ticket_reopened'

export const SUPPORT_EMAIL_IDENTITY = 'ALZA Support <support@alzabusiness.com>'
export const SUPPORT_EMAIL_ADDRESS = 'support@alzabusiness.com'

export type SupportEmailTemplateInput = {
  event: SupportEmailEvent
  agencyName: string
  subject: string
  status: string
  appLink: string
  recipientAudience: 'customer' | 'alza'
}

export type SupportEmailTemplate = {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function titleFor(event: SupportEmailEvent, agencyName: string, audience: 'customer' | 'alza'): string {
  switch (event) {
    case 'request_created':
      return audience === 'alza'
        ? `New support request from ${agencyName}`
        : 'Your support request was received'
    case 'customer_replied':
      return `Customer replied — ${agencyName}`
    case 'alza_replied':
      return 'ALZA replied to your support request'
    case 'ticket_resolved':
      return 'Support request resolved'
    case 'ticket_reopened':
      return audience === 'alza'
        ? `Support request reopened — ${agencyName}`
        : 'Your support request was reopened'
    default:
      return 'ALZA Support update'
  }
}

function bodyLines(input: SupportEmailTemplateInput): string[] {
  const { event, agencyName, subject, status, appLink, recipientAudience } = input
  const intro: Record<SupportEmailEvent, string> = {
    request_created:
      recipientAudience === 'alza'
        ? `${agencyName} submitted a new support request.`
        : 'We received your support request. ALZA Support will respond shortly.',
    customer_replied: `${agencyName} replied on a support conversation.`,
    alza_replied: 'ALZA Support replied to your request.',
    ticket_resolved: 'This support request has been marked resolved.',
    ticket_reopened: 'This support request has been reopened.',
  }

  return [
    intro[event],
    '',
    `Agency: ${agencyName}`,
    `Subject: ${subject}`,
    `Status: ${status}`,
    '',
    `Open in ALZA Flow: ${appLink}`,
    '',
    '—',
    'ALZA Support · support@alzabusiness.com',
    'This message contains no credentials.',
  ]
}

export function buildSupportEmailTemplate(input: SupportEmailTemplateInput): SupportEmailTemplate {
  const subject = titleFor(input.event, input.agencyName, input.recipientAudience)
  const lines = bodyLines(input)
  const text = [subject, '', ...lines].join('\n')

  const safeAgency = escapeHtml(input.agencyName)
  const safeSubject = escapeHtml(input.subject)
  const safeStatus = escapeHtml(input.status)
  const safeLink = escapeHtml(input.appLink)
  const safeTitle = escapeHtml(subject)
  const safeIntro = escapeHtml(lines[0] ?? '')

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>${safeTitle}</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:#0b3b6e;color:#ffffff;padding:16px 20px;font-size:15px;font-weight:600;">
              ALZA Support
            </td>
          </tr>
          <tr>
            <td style="padding:20px;">
              <p style="margin:0 0 12px;font-size:16px;font-weight:600;">${safeTitle}</p>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#334155;">${safeIntro}</p>
              <table role="presentation" width="100%" style="font-size:13px;color:#334155;margin-bottom:16px;">
                <tr><td style="padding:4px 0;width:88px;color:#64748b;">Agency</td><td>${safeAgency}</td></tr>
                <tr><td style="padding:4px 0;color:#64748b;">Subject</td><td>${safeSubject}</td></tr>
                <tr><td style="padding:4px 0;color:#64748b;">Status</td><td>${safeStatus}</td></tr>
              </table>
              <a href="${safeLink}" style="display:inline-block;background:#0b3b6e;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;">
                Open conversation
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 20px 18px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;">
              ALZA Support · support@alzabusiness.com · This message contains no credentials.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  return { subject, text, html }
}
