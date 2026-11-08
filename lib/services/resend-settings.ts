/**
 * lib/services/resend-settings.ts
 *
 * Clave de API de Resend administrable desde Administración › Correo.
 *
 * Hasta ahora la clave vivía sólo en el `.env` del servidor (`RESEND_API_KEY`):
 * rotarla obligaba a editar el `.env` y recrear el contenedor `app`. Ahora el
 * administrador puede guardarla cifrada en `system_settings`
 * (`email.resend.api_key`) con el helper compartido de `encrypted-settings`:
 *
 * - **Lo guardado gana; el `.env` es el respaldo.** Mientras nadie guarde nada
 *   desde la pantalla, se usa exactamente la clave de siempre.
 * - **Sobre ilegible → sin clave, no el `.env`.** Caer al entorno ahí sería
 *   enviar con la credencial ANTIGUA que la rotación vino a reemplazar.
 * - **La clave jamás cruza al navegador.** Ni entera ni un prefijo: la pantalla
 *   muestra sólo el origen (`ResendAdminStatus`).
 *
 * ## Caché
 *
 * `readResendConfig()` se consulta en CADA envío (`lib/email/smtp.ts`), y un
 * lote de notificaciones son decenas de envíos. Una consulta por correo no es
 * razonable, así que el resultado se guarda 30 s en memoria del proceso y se
 * invalida al guardar o restaurar (mismo patrón que `invalidateSstBackendCache`).
 * La caché es por proceso: sólo el proceso `app` envía correo (los cron y el
 * respaldo llaman a la app por HTTP), así que un cambio se ve de inmediato ahí;
 * ante varios workers el resto lo ve en ≤30 s.
 *
 * Si la BD no responde se usa el `.env` (semántica del helper), y ese resultado
 * también queda en caché hasta 30 s: es el costo de no consultar la BD por correo.
 */

import {
  clearSettingsGroup,
  defineSettingsGroup,
  readSettingsAdminStatus,
  readSettingsGroup,
  saveSettingsGroup,
  type SettingSource,
  type SettingsActor,
  type SettingsEnvValues,
} from "@/lib/services/encrypted-settings"

export const RESEND_API_KEY_SETTING_KEY = "email.resend.api_key"

export const RESEND_SETTINGS_GROUP = defineSettingsGroup({
  name: "resend",
  entityType: "resend_settings",
  entityId: "resend",
  fields: {
    apiKey: { key: RESEND_API_KEY_SETTING_KEY, secret: true },
  },
})

type ResendField = keyof typeof RESEND_SETTINGS_GROUP.fields

/** Valor del `.env`, ya normalizado: el respaldo cuando nada está guardado. */
function envValues(): SettingsEnvValues<ResendField> {
  return { apiKey: process.env.RESEND_API_KEY?.trim() || undefined }
}

/* ── Lectura para el envío (con caché) ───────────────────────────────────── */

export interface ResendConfig {
  /** Clave vigente; `""` si no hay ninguna. Sólo para uso del servidor. */
  apiKey: string
  source: SettingSource
  /** Hay una clave guardada que este servidor no puede abrir (llavero ausente o rotado). */
  unreadable: boolean
}

const CACHE_TTL_MS = 30_000
let cached: { value: ResendConfig; at: number } | null = null
let inFlight: Promise<ResendConfig> | null = null
// Una lectura que empezó antes de una invalidación no puede repoblar la caché
// con el valor viejo cuando termina.
let generation = 0

/** Purga la caché: el guardado y la restauración la llaman, y las pruebas. */
export function invalidateResendConfigCache(): void {
  generation += 1
  cached = null
  inFlight = null
}

async function loadResendConfig(): Promise<ResendConfig> {
  const resolved = await readSettingsGroup(RESEND_SETTINGS_GROUP, envValues())
  return {
    apiKey: resolved.values.apiKey,
    source: resolved.sources.apiKey,
    unreadable: resolved.unreadable.includes("apiKey"),
  }
}

/**
 * Clave de Resend vigente para enviar correo. Nunca lanza: una BD caída cae al
 * `.env` (ver el helper) y un sobre ilegible devuelve «sin clave».
 */
export async function readResendConfig(): Promise<ResendConfig> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value
  if (inFlight) return inFlight

  const startedAt = generation
  const pending = loadResendConfig()
    .then((value) => {
      if (startedAt === generation) cached = { value, at: Date.now() }
      return value
    })
    .finally(() => {
      if (inFlight === pending) inFlight = null
    })
  inFlight = pending
  return pending
}

/* ── Estado para la pantalla ─────────────────────────────────────────────── */

/**
 * DTO seguro para la pantalla de Administración: dice si hay clave y de dónde
 * viene, nunca la clave ni parte de ella.
 */
export interface ResendAdminStatus {
  configured: boolean
  source: SettingSource
  /** Hay una fila guardada (habilita «Restaurar la configuración del servidor»). */
  hasStoredSettings: boolean
  /** False sin llavero activo: sin él no se puede guardar la clave. */
  canStoreSecrets: boolean
}

/** Lectura fresca (sin caché): la pantalla tiene que reflejar lo recién guardado. */
export async function readResendAdminStatus(): Promise<ResendAdminStatus> {
  const status = await readSettingsAdminStatus(RESEND_SETTINGS_GROUP, envValues())
  return {
    configured: status.fields.apiKey.configured,
    source: status.fields.apiKey.source,
    hasStoredSettings: status.hasStoredSettings,
    canStoreSecrets: status.canStoreSecrets,
  }
}

/* ── Escritura ───────────────────────────────────────────────────────────── */

export interface SaveResendSettingsInput {
  /** Clave nueva. Vacía o ausente conserva la guardada. */
  apiKey?: string
  /** Borra la clave guardada: vuelve la del `.env`, si hay. */
  clearApiKey?: boolean
}

/**
 * Guarda (o borra) la clave. Sin llavero activo lanza `EncryptedSettingsError`
 * `SETTINGS_KEYRING_REQUIRED` sin tocar nada. Siempre purga la caché.
 */
export async function saveResendSettings(input: SaveResendSettingsInput, actor: SettingsActor) {
  try {
    return await saveSettingsGroup(
      RESEND_SETTINGS_GROUP,
      {
        set: { apiKey: input.apiKey },
        clear: input.clearApiKey ? ["apiKey"] : [],
      },
      actor,
    )
  } finally {
    invalidateResendConfigCache()
  }
}

/** Borra lo guardado y devuelve el mando al `.env` del servidor. Purga la caché. */
export async function clearResendSettings(actor: SettingsActor) {
  try {
    return await clearSettingsGroup(RESEND_SETTINGS_GROUP, actor)
  } finally {
    invalidateResendConfigCache()
  }
}
