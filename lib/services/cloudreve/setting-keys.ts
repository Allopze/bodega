/**
 * Keys físicas de la integración Cloudreve en `system_settings`.
 *
 * Vive en su propio módulo —sin BD ni red— porque lo necesitan dos capas que
 * no pueden importarse entre sí: el servicio de credenciales
 * (`./settings.ts`, que lee y cifra) y el selector de backend
 * (`lib/storage/sst-backend.ts`, al que `./client.ts` ya apunta de vuelta).
 * Tenerlas acá evita que la misma cadena se escriba dos veces y se separen.
 */

export const CLOUDREVE_SETTING_KEYS = {
  baseUrl:  "storage.cloudreve.base_url",
  username: "storage.cloudreve.username",
  password: "storage.cloudreve.password",
  sstPath:  "storage.cloudreve.sst_path",
  backend:  "storage.cloudreve.backend",
} as const

export type CloudreveSettingField = keyof typeof CLOUDREVE_SETTING_KEYS
