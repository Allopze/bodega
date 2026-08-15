/**
 * lib/services/billing/health.ts
 *
 * Último estado conocido de cada proveedor, persistido.
 *
 * ## Por qué existe
 *
 * Un `healthCheck()` **cuesta una llamada externa real**: en FacturaEnLínea es un
 * scraping del portal (con timeout de 120 s) y en Chipax es un login que consume
 * credenciales. Ejecutarlo al renderizar la pantalla significaba golpear ambos
 * servicios en cada carga, cada refresco y por cada usuario que entrara — con la
 * página colgada mientras tanto y con riesgo de throttle o bloqueo de cuenta.
 *
 * Así que la comprobación pasa a ser **bajo demanda** (el botón «Probar
 * conexión») y la pantalla muestra el último resultado guardado, diciendo
 * cuándo se tomó. Un estado de hace una hora rotulado como tal es más honesto
 * —y muchísimo más barato— que uno fresco que nadie pidió.
 *
 * Se guarda en `system_settings`, la misma tabla KV que ya usa la configuración
 * del portal DTE. Nunca guarda credenciales: solo `ok`, un detalle ya redactado
 * y la marca de tiempo.
 */

import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { systemSettings, type BillingProviderId } from "@/db/schema"
import { logger } from "@/lib/logger"
import type { ProviderHealth } from "./providers/types"

const KEY_PREFIX = "billing.health."
export const BILLING_HEALTH_TTL_MS = 24 * 60 * 60 * 1_000

function keyFor(provider: BillingProviderId): string {
  return `${KEY_PREFIX}${provider}`
}

/** Estado guardado. `null` = nunca se comprobó este proveedor. */
export type StoredHealth = ProviderHealth | null

/**
 * Lee el último estado de varios proveedores en una sola consulta.
 *
 * Un valor corrupto o de una versión anterior se trata como "nunca comprobado"
 * en vez de romper la pantalla: el diagnóstico no puede ser lo que tumbe el
 * diagnóstico.
 */
export async function readStoredHealth(
  providers: readonly BillingProviderId[],
): Promise<Record<string, StoredHealth>> {
  const result: Record<string, StoredHealth> = {}
  for (const provider of providers) result[provider] = null
  if (providers.length === 0) return result

  try {
    const rows = await db
      .select({ key: systemSettings.key, value: systemSettings.value })
      .from(systemSettings)
      .where(inArray(systemSettings.key, providers.map(keyFor)))

    for (const row of rows) {
      const provider = row.key.slice(KEY_PREFIX.length)
      result[provider] = parseHealth(row.value)
    }
  } catch (error) {
    logger.warn("[billing/health] no se pudo leer el estado guardado", {
      message: error instanceof Error ? error.message : String(error),
    })
  }
  return result
}

/** Guarda el resultado de una comprobación. */
export async function writeStoredHealth(
  provider: BillingProviderId,
  health: ProviderHealth,
): Promise<void> {
  // Se persiste solo lo que la pantalla necesita mostrar. `detail` ya viene
  // redactado por el adaptador; acá se acota por si acaso.
  const value = JSON.stringify({
    ok: health.ok,
    detail: health.detail.slice(0, 1000),
    checkedAt: health.checkedAt,
  })

  try {
    await db
      .insert(systemSettings)
      .values({ key: keyFor(provider), value, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value, updatedAt: new Date().toISOString() },
      })
  } catch (error) {
    // Que no se pueda guardar el diagnóstico no debe hacer fallar la acción
    // que el usuario pidió: ya tiene su resultado en pantalla.
    logger.warn("[billing/health] no se pudo guardar el estado", {
      provider,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Borra el estado guardado de un proveedor (p. ej. al cambiar credenciales). */
export async function clearStoredHealth(provider: BillingProviderId): Promise<void> {
  await db.delete(systemSettings).where(eq(systemSettings.key, keyFor(provider)))
}

function parseHealth(raw: string): StoredHealth {
  try {
    const parsed = JSON.parse(raw) as Partial<ProviderHealth>
    if (typeof parsed.ok !== "boolean" || typeof parsed.detail !== "string") return null
    if (typeof parsed.checkedAt !== "string") return null
    return { ok: parsed.ok, detail: parsed.detail, checkedAt: parsed.checkedAt }
  } catch {
    return null
  }
}

/* ── Estado presentable ──────────────────────────────────────────────────── */

export type ProviderStatusKind =
  | "disabled"        // apagado por feature flag
  | "unconfigured"    // habilitado pero sin credenciales: falta configurarlo, no está roto
  | "unchecked"       // configurado pero nunca comprobado
  | "stale"            // la última comprobación excedió el TTL
  | "ok"
  | "failing"

export interface ProviderStatus {
  kind: ProviderStatusKind
  label: string
  tone: "success" | "danger" | "warning" | "neutral"
  /** Explicación en una línea. */
  detail: string
  /** Cuándo se tomó el estado; null si nunca se comprobó. */
  checkedAt: string | null
}

/**
 * Deriva el estado presentable.
 *
 * La distinción que importa: **«sin configurar» no es «con problema»**. Un
 * proveedor que nunca se configuró tiene una tarea pendiente, no una falla, y
 * pintarlo de rojo junto a una caída real enseña a ignorar el rojo.
 */
export function deriveProviderStatus(input: {
  enabled: boolean
  configured: boolean
  stored: StoredHealth
  now?: Date
}): ProviderStatus {
  if (!input.enabled) {
    return {
      kind: "disabled",
      label: "Inactivo",
      tone: "neutral",
      detail: "Desactivado por configuración del servidor.",
      checkedAt: null,
    }
  }

  if (!input.configured) {
    return {
      kind: "unconfigured",
      label: "Sin configurar",
      tone: "warning",
      detail: "Faltan credenciales en el servidor. No es una falla: está pendiente de configurar.",
      checkedAt: null,
    }
  }

  if (!input.stored) {
    return {
      kind: "unchecked",
      label: "Sin comprobar",
      tone: "neutral",
      detail: "Todavía nadie probó la conexión con este proveedor.",
      checkedAt: null,
    }
  }

  const checkedAtMs = Date.parse(input.stored.checkedAt)
  const nowMs = (input.now ?? new Date()).getTime()
  if (input.stored.ok && (!Number.isFinite(checkedAtMs) || nowMs - checkedAtMs > BILLING_HEALTH_TTL_MS)) {
    return {
      kind: "stale",
      label: "Comprobación vencida",
      tone: "warning",
      detail: "La última comprobación exitosa tiene más de 24 horas; vuelve a comprobar el proveedor.",
      checkedAt: input.stored.checkedAt,
    }
  }

  return {
    kind: input.stored.ok ? "ok" : "failing",
    label: input.stored.ok ? "Operativo" : "Con problema",
    tone: input.stored.ok ? "success" : "danger",
    detail: input.stored.detail,
    checkedAt: input.stored.checkedAt,
  }
}
