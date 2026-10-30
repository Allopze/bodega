/**
 * Credenciales de VisionLink. Sólo entorno, como Copec: el secreto lo emite
 * Cat Digital Marketplace por client id y no hay pantalla para rotarlo.
 * `VISIONLINK_SYNC_ENABLED` enciende el cron sólo si vale exactamente `"true"`.
 */
import type { VisionLinkCredentials } from "./visionlink-client"

export interface VisionLinkConfig extends VisionLinkCredentials {
  syncEnabled: boolean
  hasCredentials: boolean
}

export function readVisionLinkConfig(env: NodeJS.ProcessEnv = process.env): VisionLinkConfig {
  const clientId = env.VISIONLINK_CLIENT_ID?.trim() ?? ""
  const clientSecret = env.VISIONLINK_CLIENT_SECRET?.trim() ?? ""
  return {
    clientId,
    clientSecret,
    scope: env.VISIONLINK_SCOPE?.trim() ?? "",
    syncEnabled: env.VISIONLINK_SYNC_ENABLED?.trim() === "true",
    hasCredentials: clientId.length > 0 && clientSecret.length > 0,
  }
}
