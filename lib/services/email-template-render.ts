/**
 * lib/services/email-template-render.ts
 *
 * Pure template rendering logic — no DB dependencies.
 * Safe for client components (e.g. template-list.tsx preview).
 */

import { escapeHtml } from "@/lib/utils"

// ── Default templates (mirrors the DB-seeded defaults) ───────────────────────

export const DEFAULT_TEMPLATES: Array<{
  key: string
  name: string
  subject: string
  bodyHtml: string
}> = [
  {
    key: "invitation",
    name: "Invitación",
    subject: "Invitación a {{app_name}}",
    bodyHtml: [
      '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
      '<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6"><tr><td align="center" style="padding:40px 16px">',
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">',
      '<tr><td style="background-color:#17422b;border-radius:12px 12px 0 0;padding:32px 40px;text-align:center">',
      '<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px">{{app_name}}</h1>',
      '</td></tr>',
      '<tr><td style="background-color:#ffffff;padding:40px;border-radius:0 0 12px 12px">',
      '{{#sender_name}}<p style="margin:0 0 8px;color:#374151;font-size:16px;line-height:1.5"><strong>{{sender_name}}</strong> te ha invitado a <strong>{{app_name}}</strong>.</p>{{/sender_name}}',
      '{{^sender_name}}<p style="margin:0 0 8px;color:#374151;font-size:16px;line-height:1.5">Has sido invitado a <strong>{{app_name}}</strong>.</p>{{/sender_name}}',
      '<p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5">Haz clic en el botón de abajo para completar tu registro y empezar a usar la plataforma.</p>',
      '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>',
      '<td style="background-color:#17422b;border-radius:8px"><a href="{{invite_url}}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none">Aceptar invitación</a></td>',
      '</tr></table>',
      '<p style="margin:24px 0 0;color:#9ca3af;font-size:13px;line-height:1.5;text-align:center">Si no esperabas esta invitación, puedes ignorar este correo de forma segura.</p>',
      '</td></tr></table>',
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%"><tr>',
      '<td style="padding:24px 16px;text-align:center"><p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5">Este correo fue enviado por {{app_name}}<br>Si no solicitaste esta invitación, simplemente ignora este mensaje.</p></td>',
      '</tr></table>',
      '</td></tr></table></body></html>',
    ].join("\n"),
  },
  {
    key: "notification",
    name: "Notificación",
    subject: "{{title}}",
    bodyHtml: [
      '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
      '<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6"><tr><td align="center" style="padding:40px 16px">',
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">',
      '<tr><td style="background-color:#17422b;border-radius:12px 12px 0 0;padding:32px 40px;text-align:center">',
      '<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px">{{app_name}}</h1>',
      '</td></tr>',
      '<tr><td style="background-color:#ffffff;padding:40px;border-radius:0 0 12px 12px">',
      '<p style="margin:0 0 4px;color:#6b7280;font-size:14px;line-height:1.5">Hola {{user_name}},</p>',
      '<h2 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:700;line-height:1.3">{{title}}</h2>',
      '{{#body}}<p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6">{{body}}</p>{{/body}}',
      '{{#href}}<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>',
      '<td style="background-color:#17422b;border-radius:8px"><a href="{{href}}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">Ver detalle</a></td>',
      '</tr></table>{{/href}}',
      '</td></tr></table>',
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%"><tr>',
      '<td style="padding:24px 16px;text-align:center"><p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5">Notificación automática de {{app_name}}<br>Puedes desactivar los correos desde tu perfil.</p></td>',
      '</tr></table>',
      '</td></tr></table></body></html>',
    ].join("\n"),
  },
]

export const TEMPLATE_KEYS = DEFAULT_TEMPLATES.map((t) => t.key)

// ── Template engine ──────────────────────────────────────────────────────────

/**
 * Replace {{variable}} placeholders with escaped values.
 * Supports {{#var}}...{{/var}} (positive) and {{^var}}...{{/var}} (inverted) blocks.
 */
export function replaceVariables(template: string, variables: Record<string, string>): string {
  // Inverted conditional blocks: {{^key}}...{{/key}} (rendered when variable is falsy)
  let result = template.replace(
    /\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key: string, content: string) => {
      return variables[key] ? "" : content
    },
  )

  // Positive conditional blocks: {{#key}}...{{/key}}
  result = result.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, key: string, content: string) => {
      return variables[key] ? content : ""
    },
  )

  // Simple variable replacement
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = variables[key]
    return value !== undefined ? escapeHtml(value) : `{{${key}}}`
  })

  return result
}

/**
 * HALLAZGO SEC-003 (S4/P2) — La vista previa de plantillas de `/admin/plantillas`
 * tenía dos caminos: un documento HTML completo iba a un `iframe` con
 * `sandbox`, pero un cuerpo suelto (el caso habitual: la plantilla es un
 * fragmento) se inyectaba con `dangerouslySetInnerHTML` **dentro de la propia
 * página de administración**, sin sanear. La CSP con nonce impedía ejecutar
 * scripts, pero no impedía inyectar marcado engañoso en el panel de administración.
 *
 * En vez de añadir un saneador —que exige decidir qué etiquetas de correo se
 * permiten, decisión de producto que la plataforma no ha tomado— el fragmento
 * se envuelve en un documento y se muestra por el mismo `iframe` que ya se
 * consideraba correcto: el marcado se renderiza aislado del DOM de la
 * aplicación, que es lo que la vista previa necesita.
 */
export function buildTemplatePreviewDocument(bodyHtml: string): string {
  const isFullDocument = /<!DOCTYPE|<html/i.test(bodyHtml)
  if (isFullDocument) return bodyHtml
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:16px;font-family:system-ui,sans-serif">${bodyHtml}</body></html>`
}
