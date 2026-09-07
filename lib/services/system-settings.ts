import { db, type DB } from "@/db"
import { systemSettings } from "@/db/schema"
import { eq } from "drizzle-orm"
import { recordAudit } from "@/lib/audit"
import { logger } from "@/lib/logger"
import {
  PDF_DOCUMENT_LIST,
  parsePdfEngine,
  type PdfDocumentId,
  type PdfEngine,
} from "@/lib/pdf/engines"

export interface CompanyProfile {
  name:             string
  rut:              string
  businessActivity: string
  address:          string
  branchAddress:    string
  phone:            string
  email:            string
  website:          string
}

/** Persistent keys for advanced operational parameters (admin:ops_settings). */
export const OPS_SETTING_KEYS = {
  exportMaxRows:             "ops.export.max_rows",
  notificationRetentionDays: "ops.notifications.retention_days",
  feedbackAttachmentMaxMb:  "ops.feedback.attachment_max_mb",
  pdtpEvidenceMaxMb:         "ops.pdtp.evidence_max_mb",
  pdtpEvidenceRetentionDays: "ops.pdtp.evidence_retention_days",
  purchasingClpTolerance:    "ops.compras.clp_tolerance",
} as const

export const DEFAULT_OPS_SETTINGS = {
  exportMaxRows:              10_000,
  notificationRetentionDays:  90,
  feedbackAttachmentMaxMb:    20,
  pdtpEvidenceMaxMb:           25,
  pdtpEvidenceRetentionDays:  365,
  /**
   * Diferencia máxima en pesos para dar por coincidente un monto al conciliar
   * OC contra factura. El default es el ruido de redondeo: el CLP no tiene
   * decimales, así que cualquier diferencia mayor la produjo alguien.
   *
   * Se puede ampliar para un proveedor que prorratea flete, pero **no gobierna
   * el vínculo automático DTE↔factura**, que se queda en el peso de redondeo
   * (ver `money-tolerance.ts`): aflojar lo que nadie revisa es otra decisión.
   */
  purchasingClpTolerance:       1,
} as const

export interface OperationalSettings {
  exportMaxRows:              number
  notificationRetentionDays:  number
  feedbackAttachmentMaxMb:    number
  pdtpEvidenceMaxMb:           number
  pdtpEvidenceRetentionDays:  number
  purchasingClpTolerance:     number
}

const OPS_VALIDATION: Record<keyof OperationalSettings, { min: number; max: number }> = {
  exportMaxRows:              { min: 100,    max: 100_000 },
  notificationRetentionDays:  { min: 7,      max: 3650 },
  feedbackAttachmentMaxMb:    { min: 1,      max: 20 },
  pdtpEvidenceMaxMb:           { min: 1,      max: 100 },
  pdtpEvidenceRetentionDays:  { min: 30,     max: 3650 },
  purchasingClpTolerance:     { min: 0,      max: 100_000 },
}

/**
 * `db` exposes both the relational query API and the core builder; a Drizzle
 * transaction reliably exposes the latter. Keeping `query` optional also
 * preserves the lightweight relational mocks used by older callers/tests.
 */
type SettingsClient = Pick<DB, "select" | "insert"> & Partial<Pick<DB, "query">>

async function readSystemSetting(
  key: string,
  client: SettingsClient = db,
): Promise<string | null> {
  try {
    if (client.query?.systemSettings?.findFirst) {
      const row = await client.query.systemSettings.findFirst({
        where: eq(systemSettings.key, key),
      })
      return row?.value ?? null
    }

    const [row] = await client
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1)
    return row?.value ?? null
  } catch (err) {
    logger.error(`Error reading setting ${key}:`, err)
    return null
  }
}

function parseIntStrict(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.trunc(n)
}

export async function getOperationalSettings(
  client: SettingsClient = db,
): Promise<OperationalSettings> {
  const stored = await Promise.all(
    (Object.keys(OPS_SETTING_KEYS) as Array<keyof OperationalSettings>).map((k) =>
      readSystemSetting(OPS_SETTING_KEYS[k], client),
    ),
  )
  const raw = Object.fromEntries(
    (Object.keys(OPS_SETTING_KEYS) as Array<keyof OperationalSettings>).map((k, i) => [k, stored[i]]),
  ) as Record<keyof OperationalSettings, string | null>

  const settings: OperationalSettings = {
    exportMaxRows:              parseIntStrict(raw.exportMaxRows,              DEFAULT_OPS_SETTINGS.exportMaxRows),
    notificationRetentionDays:  parseIntStrict(raw.notificationRetentionDays,  DEFAULT_OPS_SETTINGS.notificationRetentionDays),
    feedbackAttachmentMaxMb:    parseIntStrict(raw.feedbackAttachmentMaxMb,    DEFAULT_OPS_SETTINGS.feedbackAttachmentMaxMb),
    pdtpEvidenceMaxMb:           parseIntStrict(raw.pdtpEvidenceMaxMb,           DEFAULT_OPS_SETTINGS.pdtpEvidenceMaxMb),
    pdtpEvidenceRetentionDays:  parseIntStrict(raw.pdtpEvidenceRetentionDays,  DEFAULT_OPS_SETTINGS.pdtpEvidenceRetentionDays),
    purchasingClpTolerance:     parseIntStrict(raw.purchasingClpTolerance,     DEFAULT_OPS_SETTINGS.purchasingClpTolerance),
  }

  for (const k of Object.keys(settings) as Array<keyof OperationalSettings>) {
    const range = OPS_VALIDATION[k]
    if (settings[k] < range.min) settings[k] = range.min
    if (settings[k] > range.max) settings[k] = range.max
  }
  return settings
}

export interface AuditActor {
  userId: string
  userEmail?: string
}

export async function updateOperationalSettings(
  input: unknown,
  actor: AuditActor,
  client: SettingsClient = db,
): Promise<OperationalSettings> {
  const partial = (input ?? {}) as Partial<Record<keyof OperationalSettings, unknown>>
  const merged: OperationalSettings = { ...(await getOperationalSettings(client)) }
  const changes: { key: string; before: number; after: number }[] = []

  for (const k of Object.keys(OPS_SETTING_KEYS) as Array<keyof OperationalSettings>) {
    const raw = partial[k]
    if (raw === undefined || raw === null) continue
    const candidate = Number(raw)
    if (!Number.isFinite(candidate)) {
      throw new Error(`El valor para ${k} no es un número válido`)
    }
    const range = OPS_VALIDATION[k]
    if (candidate < range.min || candidate > range.max) {
      throw new Error(
        `El valor para ${k} debe estar entre ${range.min} y ${range.max}`,
      )
    }
    const next = Math.trunc(candidate)
    if (next !== merged[k]) {
      changes.push({ key: k, before: merged[k], after: next })
      merged[k] = next
    }
  }

  if (changes.length === 0) {
    return merged
  }

  const now = new Date().toISOString()
  for (const change of changes) {
    await client
      .insert(systemSettings)
      .values({
        key: OPS_SETTING_KEYS[change.key as keyof OperationalSettings],
        value: String(change.after),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: String(change.after), updatedAt: now },
      })
  }

  await recordAudit({
    userId: actor.userId,
    userEmail: actor.userEmail,
    action: "update",
    entityType: "operational_settings",
    entityId:   "batch",
    oldState:   Object.fromEntries(changes.map((c) => [c.key, c.before])),
    newState:   Object.fromEntries(changes.map((c) => [c.key, c.after])),
  }, client)

  return merged
}

/**
 * Qué motor arma cada documento PDF. El catálogo de documentos y la validación
 * viven en `lib/pdf/engines.ts`; aquí solo está la persistencia.
 */
export type PdfEngineSettings = Record<PdfDocumentId, PdfEngine>

export async function getPdfEngineSettings(
  client: SettingsClient = db,
): Promise<PdfEngineSettings> {
  const stored = await Promise.all(
    PDF_DOCUMENT_LIST.map((spec) => readSystemSetting(spec.settingKey, client)),
  )
  return Object.fromEntries(
    PDF_DOCUMENT_LIST.map((spec, i) => [
      spec.id,
      // Un valor corrupto o huérfano degrada al motor por defecto en silencio:
      // la opción segura es que el documento se siga generando.
      parsePdfEngine(spec.id, stored[i]) ?? spec.defaultEngine,
    ]),
  ) as PdfEngineSettings
}

/** Atajo para las rutas de PDF, que solo necesitan su propio documento. */
export async function getPdfEngineFor(
  doc: PdfDocumentId,
  client: SettingsClient = db,
): Promise<PdfEngine> {
  const spec = PDF_DOCUMENT_LIST.find((candidate) => candidate.id === doc)
  if (!spec) return "chromium"
  return parsePdfEngine(doc, await readSystemSetting(spec.settingKey, client)) ?? spec.defaultEngine
}

/** Valida el payload completo antes de abrir una transacción de ajustes. */
export function validatePdfEngineSettings(
  input: unknown,
): Partial<Record<PdfDocumentId, PdfEngine>> {
  const partial = (input ?? {}) as Partial<Record<PdfDocumentId, unknown>>
  const validated: Partial<Record<PdfDocumentId, PdfEngine>> = {}

  for (const spec of PDF_DOCUMENT_LIST) {
    const raw = partial[spec.id]
    if (raw === undefined || raw === null) continue
    const next = parsePdfEngine(spec.id, typeof raw === "string" ? raw : String(raw))
    if (!next) {
      throw new Error(`Motor de PDF no válido para ${spec.label}: ${String(raw)}`)
    }
    validated[spec.id] = next
  }

  return validated
}

export async function updatePdfEngineSettings(
  input: unknown,
  actor: AuditActor,
  client: SettingsClient = db,
): Promise<PdfEngineSettings> {
  const partial = validatePdfEngineSettings(input)
  const merged: PdfEngineSettings = { ...(await getPdfEngineSettings(client)) }
  const changes: { id: PdfDocumentId; settingKey: string; before: PdfEngine; after: PdfEngine }[] = []

  for (const spec of PDF_DOCUMENT_LIST) {
    const raw = partial[spec.id]
    if (raw === undefined || raw === null) continue
    const next = raw
    if (next !== merged[spec.id]) {
      changes.push({ id: spec.id, settingKey: spec.settingKey, before: merged[spec.id], after: next })
      merged[spec.id] = next
    }
  }

  if (changes.length === 0) {
    return merged
  }

  const now = new Date().toISOString()
  for (const change of changes) {
    await client
      .insert(systemSettings)
      .values({ key: change.settingKey, value: change.after, updatedAt: now })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: change.after, updatedAt: now },
      })
  }

  // `entityType` propio y no "operational_settings": la pantalla es la misma,
  // pero el grupo no. Así la auditoría puede responder quién cambió el motor de
  // PDF sin leer el diff de cada parámetro operativo.
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.userEmail,
    action: "update",
    entityType: "pdf_engine_settings",
    entityId:   "batch",
    oldState:   Object.fromEntries(changes.map((c) => [c.id, c.before])),
    newState:   Object.fromEntries(changes.map((c) => [c.id, c.after])),
  }, client)

  return merged
}

export interface FleetAdminSettings {
  warningDays: number
  defaultVehicleStatus: string
}

const DEFAULT_FLEET_ADMIN_SETTINGS: FleetAdminSettings = {
  warningDays: 30,
  defaultVehicleStatus: "operativo",
}

export async function getFleetAdminSettings(): Promise<FleetAdminSettings> {
  const [warnRaw, statusRaw] = await Promise.all([
    readSystemSetting("fleet.document.warning_days"),
    readSystemSetting("fleet.default_vehicle_status"),
  ])
  const warningParsed = parseIntStrict(warnRaw, DEFAULT_FLEET_ADMIN_SETTINGS.warningDays)
  return {
    warningDays: warningParsed >= 1 && warningParsed <= 365 ? warningParsed : DEFAULT_FLEET_ADMIN_SETTINGS.warningDays,
    defaultVehicleStatus: statusRaw ?? DEFAULT_FLEET_ADMIN_SETTINGS.defaultVehicleStatus,
  }
}

/**
 * Tasas de IEC (CLP/litro) vigentes, para que un formulario pueda previsualizar
 * el mismo cálculo que `actions-module/loads.ts` hará en el servidor con
 * `autoCalc`. `null` = no configurada (calculateFuelAmounts la trata como 0).
 */
export async function getFuelIecRates(): Promise<{ iecFixedRate: number | null; iecVariableRate: number | null }> {
  const [fixedRaw, variableRaw] = await Promise.all([
    readSystemSetting("fuel:iec_fixed_rate"),
    readSystemSetting("fuel:iec_variable_rate"),
  ])
  return {
    iecFixedRate: fixedRaw != null ? Number(fixedRaw) : null,
    iecVariableRate: variableRaw != null ? Number(variableRaw) : null,
  }
}

/** Generic single-number system setting setter (validates min/max if provided). */
export async function updateSystemSettingNumber(input: {
  key: string
  value: number | string
  min?: number
  max?: number
}): Promise<void> {
  if (typeof input.value === "number") {
    if (input.min !== undefined && input.value < input.min) {
      throw new Error(`El valor para ${input.key} debe ser ≥ ${input.min}`)
    }
    if (input.max !== undefined && input.max > 0 && input.value > input.max) {
      throw new Error(`El valor para ${input.key} debe ser ≤ ${input.max}`)
    }
  }
  const now = new Date().toISOString()
  await db
    .insert(systemSettings)
    .values({
      key: input.key,
      value: String(input.value),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: String(input.value), updatedAt: now },
    })
}

const DEFAULT_COMPANY_PROFILE: CompanyProfile = {
  name:             "Servicios Industriales Chome Limitada",
  rut:              "78.023.530-6",
  businessActivity: "Servicios Industrial",
  address:          "Camino de Luna 91 Villa Portal del Sol - Panguipulli - Panguipulli - Chile",
  branchAddress:    "Pedro Aguirre Cerda 1156 Block 4to, Concepcion",
  phone:            "41-3251368",
  email:            "",
  website:          "",
}

const COMPANY_PROFILE_KEYS = {
  name:             "company_name",
  rut:              "company_rut",
  businessActivity: "company_business_activity",
  address:          "company_address",
  branchAddress:    "company_branch_address",
  phone:            "company_phone",
  email:            "company_email",
  website:          "company_website",
} as const satisfies Record<keyof CompanyProfile, string>

/**
 * Get the configured maximum PDF file size upload limit in MB.
 * Defaults to 10 MB if not set or invalid.
 */
export async function getPdfMaxSizeMb(): Promise<number> {
  try {
    const setting = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, "pdf_max_size_mb"),
    })
    if (setting) {
      const val = parseInt(setting.value, 10)
      if (!isNaN(val) && val > 0) {
        return val
      }
    }
  } catch (err) {
    logger.error("Error fetching pdf_max_size_mb setting, using default 10MB:", err)
  }
  return 10
}

/**
 * Get whether system emails are globally enabled.
 * Acts as a kill-switch: when false, no outbound email is sent.
 * Defaults to true when not set or invalid.
 */
export async function getEmailsEnabled(): Promise<boolean> {
  try {
    const setting = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, "emails_enabled"),
    })
    if (setting) return setting.value !== "false"
  } catch (err) {
    logger.error("Error fetching emails_enabled setting, defaulting to enabled:", err)
  }
  return true
}

/**
 * Set whether system emails are globally enabled.
 * Updates the database and logs the action to the audit log.
 */
export async function setEmailsEnabled(
  value: boolean,
  userId: string,
  userEmail?: string,
): Promise<void> {
  const oldValue = await getEmailsEnabled()
  const valStr = value ? "true" : "false"

  await db
    .insert(systemSettings)
    .values({
      key: "emails_enabled",
      value: valStr,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: valStr,
        updatedAt: new Date().toISOString(),
      },
    })

  await recordAudit({
    userId,
    userEmail,
    action: "update",
    entityType: "system_setting",
    entityId: "emails_enabled",
    oldState: { value: oldValue },
    newState: { value },
  })
}

/**
 * Get the configured company profile used in printable purchase orders.
 * Missing fields fall back to empty strings, while the company name defaults to Chome.
 */
export async function getCompanyProfile(): Promise<CompanyProfile> {
  try {
    const rows = await Promise.all(
      Object.values(COMPANY_PROFILE_KEYS).map((key) =>
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

    return {
      name:             cleanSetting(byKey[COMPANY_PROFILE_KEYS.name]) || DEFAULT_COMPANY_PROFILE.name,
      rut:              cleanSetting(byKey[COMPANY_PROFILE_KEYS.rut]) || DEFAULT_COMPANY_PROFILE.rut,
      businessActivity: cleanSetting(byKey[COMPANY_PROFILE_KEYS.businessActivity]) || DEFAULT_COMPANY_PROFILE.businessActivity,
      address:          cleanSetting(byKey[COMPANY_PROFILE_KEYS.address]) || DEFAULT_COMPANY_PROFILE.address,
      branchAddress:    cleanSetting(byKey[COMPANY_PROFILE_KEYS.branchAddress]) || DEFAULT_COMPANY_PROFILE.branchAddress,
      phone:            cleanSetting(byKey[COMPANY_PROFILE_KEYS.phone]) || DEFAULT_COMPANY_PROFILE.phone,
      email:            cleanSetting(byKey[COMPANY_PROFILE_KEYS.email]) || DEFAULT_COMPANY_PROFILE.email,
      website:          cleanSetting(byKey[COMPANY_PROFILE_KEYS.website]) || DEFAULT_COMPANY_PROFILE.website,
    }
  } catch (err) {
    logger.error("Error fetching company profile settings, using defaults:", err)
    return DEFAULT_COMPANY_PROFILE
  }
}

/**
 * Set the maximum PDF file size upload limit in MB.
 * Updates the database and logs the action to the audit log.
 */
export async function setPdfMaxSizeMb(
  value: number,
  userId: string,
  userEmail?: string,
): Promise<void> {
  const oldValue = await getPdfMaxSizeMb()
  const valStr = value.toString()

  await db
    .insert(systemSettings)
    .values({
      key: "pdf_max_size_mb",
      value: valStr,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: valStr,
        updatedAt: new Date().toISOString(),
      },
    })

  await recordAudit({
    userId,
    userEmail,
    action: "update",
    entityType: "system_setting",
    entityId: "pdf_max_size_mb",
    oldState: { value: oldValue },
    newState: { value },
  })
}

/**
 * Set the company profile used in printable purchase orders.
 */
export async function setCompanyProfile(
  profile: CompanyProfile,
  userId: string,
  userEmail?: string,
): Promise<void> {
  const oldValue = await getCompanyProfile()
  const normalized: CompanyProfile = {
    name:             cleanSetting(profile.name) || DEFAULT_COMPANY_PROFILE.name,
    rut:              cleanSetting(profile.rut),
    businessActivity: cleanSetting(profile.businessActivity),
    address:          cleanSetting(profile.address),
    branchAddress:    cleanSetting(profile.branchAddress),
    phone:            cleanSetting(profile.phone),
    email:            cleanSetting(profile.email),
    website:          cleanSetting(profile.website),
  }

  const now = new Date().toISOString()

  await Promise.all(
    (Object.keys(COMPANY_PROFILE_KEYS) as Array<keyof CompanyProfile>).map((field) =>
      db
        .insert(systemSettings)
        .values({
          key:       COMPANY_PROFILE_KEYS[field],
          value:     normalized[field],
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: {
            value:     normalized[field],
            updatedAt: now,
          },
        })
    )
  )

  await recordAudit({
    userId,
    userEmail,
    action:     "update",
    entityType: "system_setting",
    entityId:   "company_profile",
    oldState:   { ...oldValue },
    newState:   { ...normalized },
  })
}

function cleanSetting(value: string | null | undefined): string {
  return (value ?? "").trim()
}
