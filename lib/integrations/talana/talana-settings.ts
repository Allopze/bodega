/**
 * Configuración de la sincronización con Talana. Sólo entorno, como VisionLink:
 * el token lo emite Talana por cuenta y no hay pantalla para rotarlo.
 *
 * `TALANA_SYNC_MODE`:
 * - `off` (o cualquier otro valor): el cron responde «deshabilitado».
 * - `simulate`: descarga, guarda la copia local y calcula lo que haría, sin
 *   tocar trabajadores. Es el modo de arranque en producción.
 * - `apply`: aplica los cambios.
 */
export type TalanaSyncMode = "off" | "simulate" | "apply"

export interface TalanaConfig {
  token: string
  mode: TalanaSyncMode
  hasCredentials: boolean
  /** Hay token y el modo no es `off`. */
  enabled: boolean
}

export function readTalanaConfig(env: NodeJS.ProcessEnv = process.env): TalanaConfig {
  const token = env.TALANA_API_TOKEN?.trim() ?? ""
  const rawMode = env.TALANA_SYNC_MODE?.trim()
  const mode: TalanaSyncMode = rawMode === "simulate" || rawMode === "apply" ? rawMode : "off"
  const hasCredentials = token.length > 0
  return { token, mode, hasCredentials, enabled: hasCredentials && mode !== "off" }
}
