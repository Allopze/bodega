/**
 * lib/services/email-templates.ts
 *
 * Sistema de plantillas HTML editables para correos.
 * Almacena los templates en la tabla `email_templates` con soporte
 * para variables {{variable}} y restauración a valores por defecto.
 */

import { db } from "@/db"
import { emailTemplates } from "@/db/schema"
import { eq } from "drizzle-orm"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS as _TEMPLATE_KEYS, replaceVariables } from "./email-template-render"

export interface EmailTemplate {
  id:        string
  key:       string
  name:      string
  subject:   string
  bodyHtml:  string
  isDefault: boolean
  updatedAt: string
}

export interface EmailTemplateInput {
  subject:  string
  bodyHtml: string
}

export const TEMPLATE_KEYS = _TEMPLATE_KEYS

// ── Getters ──────────────────────────────────────────────────────────────────

/**
 * Get a single template by key.
 * Returns null if not found.
 */
export async function getTemplate(key: string): Promise<EmailTemplate | null> {
  const row = await db.query.emailTemplates.findFirst({
    where: eq(emailTemplates.key, key),
  })
  if (!row) return null
  return row
}

/**
 * Get all templates.
 */
export async function getAllTemplates(): Promise<EmailTemplate[]> {
  return db.query.emailTemplates.findMany({
    orderBy: (t, { asc }) => [asc(t.key)],
  })
}

/**
 * Render a template: replaces {{variable}} placeholders with values.
 * Falls back to hardcoded default if no template is found in DB.
 */
export async function renderTemplate(
  key: string,
  variables: Record<string, string>,
): Promise<{ subject: string; html: string }> {
  const template = await getTemplate(key)
  const source = template ?? DEFAULT_TEMPLATES.find((t) => t.key === key)

  if (!source) {
    throw new Error(`No template found for key: ${key}`)
  }

  const subject = replaceVariables(source.subject, variables)
  const html = replaceVariables(source.bodyHtml, variables)

  return { subject, html }
}



// ── Mutations ────────────────────────────────────────────────────────────────

/**
 * Update a template's subject and HTML body.
 */
export async function updateTemplate(
  key: string,
  input: EmailTemplateInput,
  userId: string,
  userEmail?: string,
): Promise<void> {
  const existing = await getTemplate(key)

  await db
    .insert(emailTemplates)
    .values({
      id:        existing?.id ?? nanoid(),
      key,
      name:     existing?.name ?? DEFAULT_TEMPLATES.find((t) => t.key === key)?.name ?? key,
      subject:   input.subject,
      bodyHtml:  input.bodyHtml,
      isDefault: false,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: emailTemplates.key,
      set: {
        subject:   input.subject,
        bodyHtml:  input.bodyHtml,
        isDefault: false,
        updatedAt: new Date().toISOString(),
      },
    })

  await recordAudit({
    userId,
    userEmail,
    action:     "update",
    entityType: "email_template",
    entityId:   key,
    oldState:   existing ? { subject: existing.subject, bodyHtml: existing.bodyHtml } : undefined,
    newState:   { subject: input.subject, bodyHtml: input.bodyHtml },
  })
}

/**
 * Reset a template to its system default.
 */
export async function resetTemplate(
  key: string,
  userId: string,
  userEmail?: string,
): Promise<void> {
  const defaultTemplate = DEFAULT_TEMPLATES.find((t) => t.key === key)
  if (!defaultTemplate) {
    throw new Error(`No default template for key: ${key}`)
  }

  const existing = await getTemplate(key)

  await db
    .insert(emailTemplates)
    .values({
      id:        existing?.id ?? nanoid(),
      key,
      name:     defaultTemplate.name,
      subject:   defaultTemplate.subject,
      bodyHtml:  defaultTemplate.bodyHtml,
      isDefault: true,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: emailTemplates.key,
      set: {
        subject:   defaultTemplate.subject,
        bodyHtml:  defaultTemplate.bodyHtml,
        isDefault: true,
        updatedAt: new Date().toISOString(),
      },
    })

  await recordAudit({
    userId,
    userEmail,
    action:     "update",
    entityType: "email_template",
    entityId:   key,
    oldState:   existing ? { subject: existing.subject, bodyHtml: existing.bodyHtml } : undefined,
    newState:   { subject: defaultTemplate.subject, bodyHtml: defaultTemplate.bodyHtml, isDefault: true },
  })
}

/**
 * Seed default templates into the database.
 * Only inserts templates that don't already exist.
 */
export async function seedDefaultTemplates(): Promise<void> {
  const existing = await getAllTemplates()
  const existingKeys = new Set(existing.map((t) => t.key))

  for (const tmpl of DEFAULT_TEMPLATES) {
    if (existingKeys.has(tmpl.key)) continue

    await db.insert(emailTemplates).values({
      id:        nanoid(),
      key:       tmpl.key,
      name:      tmpl.name,
      subject:   tmpl.subject,
      bodyHtml:  tmpl.bodyHtml,
      isDefault: true,
    })
  }
}


