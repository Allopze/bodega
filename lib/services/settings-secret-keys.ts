/**
 * Claves de `system_settings` que guardan un secreto cifrado con el llavero de
 * la aplicación (`DTE_SETTINGS_KEYRING`), fuera de las propias del portal DTE.
 *
 * ## Por qué una lista explícita
 *
 * El re-cifrado del llavero (`rotateDteSettingsKeyring`) re-envuelve los
 * secretos `dte.*` y los de esta lista. Un secreto que no esté acá se queda con
 * el `kid` retirado y, cuando el runbook quita la clave anterior del host, ya no
 * vuelve a abrirse: la integración cae en silencio a la credencial del `.env` (o
 * queda sin credencial). Hasta el 2026-11-08 la lista sólo tenía a Chipax, y
 * OnWay y Cloudreve estaban expuestos a eso.
 *
 * Vive en su propio módulo —sin BD, red ni llavero— porque la importan el
 * servicio DTE (la rotación) y el helper `encrypted-settings` (que se niega a
 * definir un grupo con un secreto que no esté acá). Las cadenas se repiten a
 * propósito en lugar de importarse de cada integración: esos módulos sí
 * dependen de la BD, y `settings-secret-keys.test.ts` cruza esta lista contra
 * las constantes de cada uno para que no se separen.
 */
export const SHARED_KEYRING_SECRET_KEYS = [
  // Chipax (lib/services/billing/chipax-settings.ts)
  "billing.chipax.app_id",
  "billing.chipax.secret_key",
  // Entel OnWay GPS (lib/integrations/onway/onway-settings.ts)
  "flota.onway.username",
  "flota.onway.password",
  // Cloudreve (lib/services/cloudreve/setting-keys.ts)
  "storage.cloudreve.username",
  "storage.cloudreve.password",
  // Talana (lib/integrations/talana/talana-settings.ts)
  "talana.api_token",
  // VisionLink (lib/integrations/visionlink/visionlink-settings.ts)
  "combustibles.visionlink.client_secret",
  // Copec TCT/TAE (lib/combustibles/copec-settings.ts)
  "combustibles.copec.username",
  "combustibles.copec.password",
  // Resend (lib/services/smtp-settings.ts)
  "email.resend.api_key",
] as const

export type SharedKeyringSecretKey = typeof SHARED_KEYRING_SECRET_KEYS[number]

const REGISTERED = new Set<string>(SHARED_KEYRING_SECRET_KEYS)

export function isRegisteredSecretKey(key: string): boolean {
  return REGISTERED.has(key)
}
