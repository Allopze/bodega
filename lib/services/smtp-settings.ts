/**
 * lib/services/smtp-settings.ts
 *
 * SMTP configuration stored in system_settings table.
 * Falls back to environment variables when no DB config exists.
 */

import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { eq } from "drizzle-orm"
import nodemailer from "nodemailer"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"

export interface SmtpConfig {
  host:   string
  port:   number
  secure: boolean
  user:   string
  pass:   string
  from:   string
}

export interface SmtpConfigView {
  host:   string
  port:   number
  secure: boolean
  user:   string
  pass:   string
  from:   string
  /** Non‑empty when the config comes from env vars rather than DB */
  source: "db" | "env"
}

const SMTP_KEYS = {
  host:   "smtp_host",
  port:   "smtp_port",
  secure: "smtp_secure",
  user:   "smtp_user",
  pass:   "smtp_pass",
  from:   "smtp_from",
} as const satisfies Record<keyof SmtpConfig, string>

/**
 * Load SMTP config from system_settings table.
 * Returns null if not fully configured in DB.
 */
async function getSmtpFromDb(): Promise<SmtpConfig | null> {
  try {
    const rows = await Promise.all(
      Object.values(SMTP_KEYS).map((key) =>
        db.query.systemSettings.findFirst({
          where: eq(systemSettings.key, key),
        })
      )
    )

    const byKey = Object.fromEntries(
      rows
        .filter((row): row is { key: string; value: string; updatedAt: string } => !!row)
        .map((row) => [row.key, row.value])
    )

    const host   = byKey[SMTP_KEYS.host]?.trim()
    const port   = byKey[SMTP_KEYS.port]?.trim()
    const secure = byKey[SMTP_KEYS.secure]?.trim()
    const user   = byKey[SMTP_KEYS.user]?.trim()
    const pass   = byKey[SMTP_KEYS.pass]?.trim()
    const from   = byKey[SMTP_KEYS.from]?.trim() || user

    if (!host || !port || !user || !pass || !from) return null

    const portNum = parseInt(port, 10)
    if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) return null

    return {
      host,
      port: portNum,
      secure: secure === "true" || portNum === 465,
      user,
      pass,
      from,
    }
  } catch (err) {
    logger.error("Error fetching SMTP config from DB:", err)
    return null
  }
}

/**
 * Load SMTP config from environment variables.
 */
function getSmtpFromEnv(): SmtpConfig | null {
  if (process.env.SMTP_DISABLED === "true") return null

  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM ?? user

  if (!host || !user || !pass || !from) return null
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null

  return {
    host,
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    user,
    pass,
    from,
  }
}

/**
 * Get the effective SMTP configuration.
 * DB config takes precedence over env vars.
 */
export async function getSmtpConfig(): Promise<SmtpConfigView | null> {
  const dbConfig = await getSmtpFromDb()
  if (dbConfig) return { ...dbConfig, source: "db" }

  const envConfig = getSmtpFromEnv()
  if (envConfig) return { ...envConfig, source: "env", pass: envConfig.pass ? "••••••" : "" }

  return null
}

/**
 * Get raw SMTP config for the mailer (includes password).
 * Used internally by lib/email/smtp.ts — never expose this to client code.
 */
export async function getRawSmtpConfig(): Promise<SmtpConfig | null> {
  const dbConfig = await getSmtpFromDb()
  if (dbConfig) return dbConfig
  return getSmtpFromEnv()
}

/**
 * Save SMTP configuration to the database.
 * Empty strings are treated as "no change" for the password field.
 */
export async function setSmtpConfig(
  config: SmtpConfig,
  userId: string,
  userEmail?: string,
): Promise<void> {
  const oldConfig = await getSmtpFromDb()
  const now = new Date().toISOString()

  const entries: Array<{ key: string; value: string }> = [
    { key: SMTP_KEYS.host,   value: config.host },
    { key: SMTP_KEYS.port,   value: config.port.toString() },
    { key: SMTP_KEYS.secure, value: config.secure ? "true" : "false" },
    { key: SMTP_KEYS.user,   value: config.user },
    { key: SMTP_KEYS.from,   value: config.from },
  ]

  // Only update password if a non‑empty value is provided
  if (config.pass) {
    entries.push({ key: SMTP_KEYS.pass, value: config.pass })
  }

  await Promise.all(
    entries.map(({ key, value }) =>
      db
        .insert(systemSettings)
        .values({ key, value, updatedAt: now })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value, updatedAt: now },
        })
    )
  )

  recordAudit({
    userId,
    userEmail,
    action: "update",
    entityType: "system_setting",
    entityId: "smtp_config",
    oldState: oldConfig ? { host: oldConfig.host, port: oldConfig.port, user: oldConfig.user } : {},
    newState: { host: config.host, port: config.port, user: config.user },
  })
}

/**
 * Send a test email using the current SMTP configuration.
 */
export async function testSmtpConnection(
  to: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const config = await getRawSmtpConfig()
  if (!config) {
    return { ok: false, error: "SMTP no configurado" }
  }

  try {
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    })

    await transport.sendMail({
      from: config.from,
      to,
      subject: "Prueba de conexión SMTP — Chome Bodega",
      text: "Este es un correo de prueba para verificar la configuración SMTP.\n\nSi recibiste este mensaje, la configuración es correcta.",
      html: "<p>Este es un correo de prueba para verificar la configuración SMTP.</p><p>Si recibiste este mensaje, la configuración es <strong>correcta</strong>.</p>",
    })

    transport.close()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error desconocido" }
  }
}
