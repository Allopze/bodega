/**
 * Configuración de la sincronización con Talana: token y modo.
 *
 * Se administra desde Administración › Sincronización Talana (permiso
 * `admin:talana_settings`, sólo administrador), con el token cifrado en
 * `system_settings`. El `.env` del servidor sigue siendo el respaldo: lo
 * guardado en la plataforma gana, y mientras nadie guarde nada la configuración
 * vigente es exactamente la del entorno.
 *
 * `TALANA_SYNC_MODE` (o `talana.sync_mode` guardado):
 * - `off` (o cualquier otro valor): el cron responde «deshabilitado».
 * - `simulate`: descarga, guarda la copia local y calcula lo que haría, sin
 *   tocar trabajadores. Es el modo de arranque en producción.
 * - `apply`: aplica los cambios.
 *
 * Tres lectores, para tres necesidades:
 * - `readTalanaConfig(env)`: sólo entorno y síncrono. Es el respaldo, y lo que
 *   `loadTalanaConfig` pasa al helper como valor de entorno.
 * - `loadTalanaConfig()`: lo vigente (guardado, o entorno) para quien EJECUTA la
 *   sincronización: el cron, el script y la pantalla.
 * - `readTalanaAdminStatus()`: el DTO seguro del diálogo «Configurar»; dice si
 *   hay token y de dónde viene, nunca el token.
 */
import {
  clearSettingsGroup,
  defineSettingsGroup,
  readSettingsAdminStatus,
  readSettingsGroup,
  saveSettingsGroup,
  type SettingSource,
  type SettingsActor,
  type SettingsChangeResult,
} from "@/lib/services/encrypted-settings"

export type TalanaSyncMode = "off" | "simulate" | "apply"

export interface TalanaConfig {
  token: string
  mode: TalanaSyncMode
  hasCredentials: boolean
  /** Hay token y el modo no es `off`. */
  enabled: boolean
}

/** De dónde sale cada valor vigente. */
export interface TalanaConfigSources {
  token: SettingSource
  mode: SettingSource
}

/** Configuración vigente de quien ejecuta la sincronización, con su origen. */
export interface TalanaLoadedConfig extends TalanaConfig {
  sources: TalanaConfigSources
  /**
   * Hay un token guardado que este servidor no puede abrir (llavero ausente o
   * sin la clave con que se cifró). Se opera sin token en vez de con el del
   * `.env`: caer al entorno sería usar la credencial ANTIGUA sin que nadie lo note.
   */
  tokenUnreadable: boolean
}

/** Grupo de ajustes de Talana en `system_settings`. */
export const TALANA_SETTINGS_GROUP = defineSettingsGroup({
  name: "talana",
  entityType: "talana_settings",
  entityId: "talana",
  fields: {
    apiToken: { key: "talana.api_token", secret: true },
    mode: { key: "talana.sync_mode", secret: false },
  },
})

/** Sólo `simulate` y `apply`, exactamente: cualquier otro valor apaga la sincronización. */
export function normalizeTalanaMode(raw: string | null | undefined): TalanaSyncMode {
  const mode = raw?.trim()
  return mode === "simulate" || mode === "apply" ? mode : "off"
}

function composeConfig(token: string, rawMode: string | undefined): TalanaConfig {
  const mode = normalizeTalanaMode(rawMode)
  const hasCredentials = token.length > 0
  return { token, mode, hasCredentials, enabled: hasCredentials && mode !== "off" }
}

/** Valores del entorno, con el modo sin normalizar: el origen («Del servidor») se decide con ellos. */
function envValues(env: NodeJS.ProcessEnv) {
  return {
    apiToken: env.TALANA_API_TOKEN?.trim() ?? "",
    mode: env.TALANA_SYNC_MODE?.trim() ?? "",
  }
}

/** Sólo entorno: el respaldo cuando nada se guardó desde la pantalla. */
export function readTalanaConfig(env: NodeJS.ProcessEnv = process.env): TalanaConfig {
  const values = envValues(env)
  return composeConfig(values.apiToken, values.mode)
}

/**
 * Lo vigente: lo guardado en la plataforma, con el entorno de respaldo. Si la BD
 * no responde se usa el entorno (el helper deja constancia en el log): apagar la
 * sincronización por una caída de Postgres sería peor que seguir con el `.env`.
 */
export async function loadTalanaConfig(env: NodeJS.ProcessEnv = process.env): Promise<TalanaLoadedConfig> {
  const resolved = await readSettingsGroup(TALANA_SETTINGS_GROUP, envValues(env))
  return {
    ...composeConfig(resolved.values.apiToken.trim(), resolved.values.mode),
    sources: { token: resolved.sources.apiToken, mode: resolved.sources.mode },
    tokenUnreadable: resolved.unreadable.includes("apiToken"),
  }
}

/** DTO seguro para el diálogo «Configurar»: nunca lleva el token. */
export interface TalanaAdminStatus {
  token: { configured: boolean; source: SettingSource }
  /** Modo vigente (ya normalizado) y de dónde sale. */
  mode: TalanaSyncMode
  modeSource: SettingSource
  /** Hay filas guardadas en la plataforma: habilita «Restaurar la configuración del servidor». */
  hasStoredSettings: boolean
  /** Sin llavero activo no se puede guardar el token, pero el modo sí. */
  canStoreSecrets: boolean
}

export async function readTalanaAdminStatus(env: NodeJS.ProcessEnv = process.env): Promise<TalanaAdminStatus> {
  const status = await readSettingsAdminStatus(TALANA_SETTINGS_GROUP, envValues(env))
  return {
    token: { configured: status.fields.apiToken.configured, source: status.fields.apiToken.source },
    mode: normalizeTalanaMode(status.fields.mode.value),
    modeSource: status.fields.mode.source,
    hasStoredSettings: status.hasStoredSettings,
    canStoreSecrets: status.canStoreSecrets,
  }
}

export interface SaveTalanaSettingsInput {
  /** Token nuevo. Vacío o ausente conserva el actual. */
  apiToken?: string
  /** Borra el token guardado: vuelve al del `.env`. */
  clearApiToken?: boolean
  /** Modo nuevo. Ausente conserva el actual (no copia el del `.env` a la BD). */
  mode?: TalanaSyncMode
}

type TalanaField = keyof typeof TALANA_SETTINGS_GROUP.fields

/**
 * Guarda token y/o modo en una sola transacción con su auditoría (modo anterior
 * y nuevo; del token sólo si cambió). Sin llavero activo rechaza el token y no
 * escribe nada, ni siquiera el modo: una operación entera o ninguna.
 */
export function saveTalanaSettings(
  input: SaveTalanaSettingsInput,
  actor: SettingsActor,
): Promise<SettingsChangeResult<TalanaField>> {
  // `F` explícito: inferido desde `clear` (`["apiToken"]`) se estrechaba al
  // único campo del array y rechazaba `mode` en `set`.
  return saveSettingsGroup<TalanaField>(
    TALANA_SETTINGS_GROUP,
    {
      set: { apiToken: input.apiToken, mode: input.mode },
      clear: input.clearApiToken ? ["apiToken"] : [],
    },
    actor,
  )
}

/** Borra lo guardado y devuelve el mando al `.env` del servidor. */
export function clearTalanaSettings(actor: SettingsActor): Promise<{ changed: boolean }> {
  return clearSettingsGroup(TALANA_SETTINGS_GROUP, actor)
}
