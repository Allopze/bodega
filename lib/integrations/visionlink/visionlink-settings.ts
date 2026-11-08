/**
 * Credenciales e interruptor de VisionLink, administrables desde
 * Combustibles › Ajustes › Integraciones.
 *
 * El client id y el secreto los emite Cat Digital Marketplace. Hasta el
 * 2026-11-08 sólo se podían cambiar editando el `.env` del servidor y
 * recreando el contenedor; ahora se guardan en `system_settings` (el secreto,
 * cifrado con el llavero de la aplicación) y **lo guardado gana**: el `.env`
 * (`VISIONLINK_CLIENT_ID`, `VISIONLINK_CLIENT_SECRET`, `VISIONLINK_SCOPE`,
 * `VISIONLINK_SYNC_ENABLED`) queda de respaldo, de modo que mientras nadie
 * guarde nada desde la pantalla la configuración vigente es la de siempre.
 *
 * - `readVisionLinkConfig(env)` es el lector del `.env`, síncrono y sin BD. Es
 *   el respaldo del lector asíncrono y lo que usan las pruebas.
 * - `loadVisionLinkConfig()` es la configuración vigente (lo guardado, y el
 *   `.env` donde falte). Es lo que leen el cron, el estado de las fuentes y la
 *   pantalla.
 * - `VISIONLINK_SYNC_ENABLED` enciende el cron sólo si vale exactamente `"true"`;
 *   lo guardado desde la pantalla escribe `"true"` o `"false"`.
 */
import {
  clearSettingsGroup,
  defineSettingsGroup,
  readSettingsAdminStatus,
  readSettingsGroup,
  saveSettingsGroup,
  type SettingsActor,
  type SettingsAdminStatus,
  type SettingsChangeResult,
  type SettingsEnvValues,
} from "@/lib/services/encrypted-settings"
import type { VisionLinkCredentials } from "./visionlink-client"

/** `process.env` o cualquier mapa de variables: las pruebas pasan sólo las que importan. */
type EnvSource = Readonly<Record<string, string | undefined>>

export interface VisionLinkConfig extends VisionLinkCredentials {
  syncEnabled: boolean
  hasCredentials: boolean
}

export type VisionLinkSettingField = "clientId" | "clientSecret" | "scope" | "syncEnabled"

/** Las keys físicas están registradas en `settings-secret-keys.ts` (el secreto, para la rotación del llavero). */
export const VISIONLINK_SETTINGS = defineSettingsGroup<VisionLinkSettingField>({
  name: "visionlink",
  entityType: "fuel_visionlink_settings",
  entityId: "visionlink",
  fields: {
    clientId: { key: "combustibles.visionlink.client_id", secret: false },
    clientSecret: { key: "combustibles.visionlink.client_secret", secret: true },
    scope: { key: "combustibles.visionlink.scope", secret: false },
    syncEnabled: { key: "combustibles.visionlink.sync_enabled", secret: false },
  },
})

export type VisionLinkAdminStatus = SettingsAdminStatus<VisionLinkSettingField>

function configFromValues(values: Record<VisionLinkSettingField, string>): VisionLinkConfig {
  const clientId = values.clientId.trim()
  const clientSecret = values.clientSecret.trim()
  return {
    clientId,
    clientSecret,
    scope: values.scope.trim(),
    syncEnabled: values.syncEnabled.trim() === "true",
    hasCredentials: clientId.length > 0 && clientSecret.length > 0,
  }
}

function envValues(env: EnvSource): SettingsEnvValues<VisionLinkSettingField> {
  return {
    clientId: env.VISIONLINK_CLIENT_ID?.trim(),
    clientSecret: env.VISIONLINK_CLIENT_SECRET?.trim(),
    scope: env.VISIONLINK_SCOPE?.trim(),
    syncEnabled: env.VISIONLINK_SYNC_ENABLED?.trim(),
  }
}

/** Sólo el `.env`: el respaldo del lector asíncrono. No toca la BD. */
export function readVisionLinkConfig(env: EnvSource = process.env): VisionLinkConfig {
  return configFromValues({
    clientId: env.VISIONLINK_CLIENT_ID ?? "",
    clientSecret: env.VISIONLINK_CLIENT_SECRET ?? "",
    scope: env.VISIONLINK_SCOPE ?? "",
    syncEnabled: env.VISIONLINK_SYNC_ENABLED ?? "",
  })
}

/** Configuración vigente: lo guardado en la plataforma, con el `.env` de respaldo. */
export async function loadVisionLinkConfig(env: EnvSource = process.env): Promise<VisionLinkConfig> {
  const { values } = await readSettingsGroup(VISIONLINK_SETTINGS, envValues(env))
  return configFromValues(values)
}

/** Estado para la pantalla: si hay valor y de dónde viene, nunca el secreto. */
export async function readVisionLinkAdminStatus(env: EnvSource = process.env): Promise<VisionLinkAdminStatus> {
  return readSettingsAdminStatus(VISIONLINK_SETTINGS, envValues(env))
}

/** Lo que la pantalla pregunta, derivado del mismo DTO (una sola lectura). */
export function summarizeVisionLinkStatus(status: VisionLinkAdminStatus): { hasCredentials: boolean; syncEnabled: boolean } {
  return {
    hasCredentials: status.fields.clientId.configured && status.fields.clientSecret.configured,
    syncEnabled: status.fields.syncEnabled.value === "true",
  }
}

export interface VisionLinkSettingsInput {
  /** Vacío o ausente conserva el valor actual. */
  clientId?: string
  clientSecret?: string
  scope?: string
  /** Se guarda sólo si cambia respecto de lo vigente: abrir y guardar no fija el valor del `.env`. */
  syncEnabled?: boolean
  clearClientSecret?: boolean
}

/**
 * Guarda lo que cambió. El client id y el scope se escriben sólo si difieren de
 * lo vigente: el formulario los trae precargados con el valor actual, y
 * reescribirlos sin cambio fijaría en la plataforma lo que viene del `.env`.
 * Lanza `EncryptedSettingsError` (`SETTINGS_KEYRING_REQUIRED`) si hay un
 * secreto que guardar y el servidor no tiene llavero.
 */
export async function saveVisionLinkSettings(
  input: VisionLinkSettingsInput,
  actor: SettingsActor,
  env: EnvSource = process.env,
): Promise<SettingsChangeResult<VisionLinkSettingField>> {
  const current = await loadVisionLinkConfig(env)
  const clientId = input.clientId?.trim()
  const scope = input.scope?.trim()
  return saveSettingsGroup<VisionLinkSettingField>(VISIONLINK_SETTINGS, {
    set: {
      clientId: clientId && clientId !== current.clientId ? clientId : undefined,
      clientSecret: input.clientSecret?.trim() || undefined,
      scope: scope && scope !== current.scope ? scope : undefined,
      syncEnabled: input.syncEnabled === undefined || input.syncEnabled === current.syncEnabled
        ? undefined
        : String(input.syncEnabled),
    },
    clear: input.clearClientSecret ? ["clientSecret"] : [],
  }, actor)
}

/** Borra lo guardado desde la pantalla: el `.env` del servidor vuelve a mandar. */
export async function clearVisionLinkSettings(actor: SettingsActor): Promise<{ changed: boolean }> {
  return clearSettingsGroup(VISIONLINK_SETTINGS, actor)
}
