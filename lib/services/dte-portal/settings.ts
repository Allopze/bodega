/**
 * lib/services/dte-portal/settings.ts
 *
 * Credenciales y configuración del portal DTE guardadas en `system_settings`
 * desde Administración › Sincronización DTE — "lo que hoy hace el .env",
 * sin tocar el servidor.
 *
 * Precedencia (ver `readDtePortalConfig` en config.ts):
 *   lo guardado aquí > variable de entorno (DTE_PORTAL_*) > default.
 * Dejar un campo en blanco borra el valor guardado y vuelve a caer al .env.
 * La contraseña es la excepción: un campo vacío la conserva; solo se borra
 * con `clearClave` explícito, para que un guardado accidental no la pierda.
 *
 * NOTA DE SEGURIDAD: `dte.clave` queda en texto plano en `system_settings`
 * (la tabla KV del sistema), igual que el resto de la configuración. La
 * auditoría jamás registra la clave — solo una máscara. Quien tenga acceso a
 * la base de datos puede leerla; es el trade-off pedido para gestionar las
 * credenciales desde el panel sin tocar el servidor.
 */

import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { eq, like } from "drizzle-orm"
import { recordAudit } from "@/lib/audit"

/** Claves en `system_settings` para cada campo de la configuración DTE. */
export const DTE_SETTING_KEYS = {
  baseUrl:       "dte.base_url",
  rutUsr:        "dte.rut_usr",
  rutEmp:        "dte.rut_emp",
  clave:         "dte.clave",
  codEmp:        "dte.cod_emp",
  syncEnabled:   "dte.sync_enabled",
  delayMs:       "dte.sync_delay_ms",
  importerEmail: "dte.sync_importer_email",
} as const

export type DteSettingField = keyof typeof DTE_SETTING_KEYS

const DTE_KEY_PREFIX = "dte.%"

/** Lee todos los valores guardados (dte.*) como un mapa campo → valor crudo. */
export async function readStoredDteSettings(): Promise<Partial<Record<DteSettingField, string>>> {
  try {
    const rows = await db
      .select({ key: systemSettings.key, value: systemSettings.value })
      .from(systemSettings)
      .where(like(systemSettings.key, DTE_KEY_PREFIX))

    const byField: Partial<Record<DteSettingField, string>> = {}
    for (const row of rows) {
      const field = (Object.keys(DTE_SETTING_KEYS) as DteSettingField[]).find(
        (f) => DTE_SETTING_KEYS[f] === row.key,
      )
      if (field) byField[field] = row.value
    }
    return byField
  } catch {
    // Un fallo de lectura no debe tumbar al dashboard ni a la pantalla admin:
    // se comporta como si no hubiera nada guardado (cae al .env).
    return {}
  }
}

/** True si existe al menos un valor DTE guardado en la base de datos. */
export async function hasStoredDteSettings(): Promise<boolean> {
  const stored = await readStoredDteSettings()
  return Object.keys(stored).length > 0
}

export interface DtePortalSettingsInput {
  /** URL base. '' borra el valor guardado (vuelve a DTE_PORTAL_BASE_URL). */
  baseUrl?: string
  rutUsr?: string
  rutEmp?: string
  /** Contraseña. '' conserva la actual; usar `clearClave` para borrarla. */
  clave?: string
  codEmp?: string
  syncEnabled?: boolean
  /** Milisegundos entre requests. Validado 0–10.000. */
  delayMs?: number
  importerEmail?: string
  /** Borra la contraseña guardada (vuelve a DTE_PORTAL_CLAVE del .env). */
  clearClave?: boolean
}

export interface DteSettingsActor {
  userId: string
  userEmail?: string
}

/**
 * Guarda (o borra) los campos provistos de la configuración DTE.
 *
 * - Campos de texto: `''` borra la clave guardada.
 * - `clave`: `''` la conserva; solo `clearClave: true` la borra.
 * - Solo escribe los campos definidos (no toca el resto).
 */
export async function saveDtePortalSettings(
  input: DtePortalSettingsInput,
  actor: DteSettingsActor,
): Promise<void> {
  const before = await readStoredDteSettings()
  const now = new Date().toISOString()

  const writes: { key: string; value: string }[] = []
  const deletes: string[] = []

  const applyText = (field: DteSettingField, value: string | undefined) => {
    if (value === undefined) return
    if (value === "") {
      deletes.push(DTE_SETTING_KEYS[field])
    } else {
      writes.push({ key: DTE_SETTING_KEYS[field], value })
    }
  }

  applyText("baseUrl", input.baseUrl?.trim())
  applyText("rutUsr", input.rutUsr?.trim())
  applyText("rutEmp", input.rutEmp?.trim())
  applyText("codEmp", input.codEmp?.trim())
  applyText("importerEmail", input.importerEmail?.trim())

  if (input.delayMs !== undefined) {
    if (!Number.isFinite(input.delayMs) || input.delayMs < 0 || input.delayMs > 10_000) {
      throw new Error("El intervalo entre consultas debe estar entre 0 y 10.000 ms")
    }
    applyText("delayMs", String(Math.trunc(input.delayMs)))
  }

  if (input.syncEnabled !== undefined) {
    applyText("syncEnabled", input.syncEnabled ? "true" : "false")
  }

  // La clave no se normaliza (ni trim ni lower): es texto que va tal cual al portal.
  if (input.clave !== undefined && input.clave !== "") {
    writes.push({ key: DTE_SETTING_KEYS.clave, value: input.clave })
  } else if (input.clearClave) {
    deletes.push(DTE_SETTING_KEYS.clave)
  }

  const touched = writes.length > 0 || deletes.length > 0
  if (!touched) return

  for (const write of writes) {
    await db
      .insert(systemSettings)
      .values({ key: write.key, value: write.value, updatedAt: now })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: write.value, updatedAt: now },
      })
  }
  for (const key of deletes) {
    await db.delete(systemSettings).where(eq(systemSettings.key, key))
  }

  const after = await readStoredDteSettings()
  await recordAudit({
    userId: actor.userId,
    userEmail: actor.userEmail,
    action: "update",
    entityType: "dte_portal_settings",
    entityId: "batch",
    oldState: summarizeSettings(before),
    newState: summarizeSettings(after),
  })
}

/**
 * Borra TODA la configuración DTE guardada: la app vuelve a leer solo las
 * variables de entorno (DTE_PORTAL_*). Útil para "restaurar el .env".
 */
export async function clearStoredDteSettings(actor: DteSettingsActor): Promise<void> {
  const before = await readStoredDteSettings()
  if (Object.keys(before).length === 0) return

  await db.delete(systemSettings).where(like(systemSettings.key, DTE_KEY_PREFIX))

  await recordAudit({
    userId: actor.userId,
    userEmail: actor.userEmail,
    action: "delete",
    entityType: "dte_portal_settings",
    entityId: "batch",
    oldState: summarizeSettings(before),
    newState: {},
  })
}

/** Nunca se registra la contraseña en la auditoría. */
function summarizeSettings(
  stored: Partial<Record<DteSettingField, string>>,
): Record<string, string | boolean | number> {
  const summary: Record<string, string | boolean | number> = {}
  for (const [field, value] of Object.entries(stored) as [DteSettingField, string | undefined][]) {
    if (value === undefined) continue
    if (field === "clave") {
      summary.clave = value ? "••••••••" : ""
    } else if (field === "syncEnabled") {
      summary.syncEnabled = value === "true"
    } else if (field === "delayMs") {
      summary.delayMs = Number(value)
    } else {
      summary[field] = value
    }
  }
  return summary
}
