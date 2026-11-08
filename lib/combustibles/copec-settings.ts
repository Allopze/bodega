/**
 * Credenciales e interruptor de la sincronización de Copec (web services TCT/TAE),
 * administrables desde Combustibles › Ajustes › Integraciones.
 *
 * Hasta el 2026-11-08 todo esto salía del `.env` del servidor
 * (`COPEC_USERNAME`, `COPEC_PASSWORD`, `COPEC_CLIENT_RUT`, `COPEC_SYNC_ENABLED`,
 * `COPEC_SYNC_IMPORTER_EMAIL`) y cambiarlo exigía recrear el contenedor. Ahora se
 * guarda en `system_settings` (usuario y contraseña, cifrados con el llavero de la
 * aplicación) y **lo guardado gana**: el `.env` queda de respaldo, así que
 * mientras nadie guarde nada desde la pantalla la configuración vigente es la de
 * siempre. `COPEC_SYNC_START_DATE` sigue sólo en el `.env`: es una decisión del
 * despliegue, no de la operación.
 *
 * Interruptor: la actualización diaria sigue encendida salvo que valga
 * exactamente `"false"` (en `COPEC_SYNC_ENABLED` o en lo guardado). No se apaga
 * una integración por omisión: docker-compose ni siquiera pasa esa variable, y
 * en producción el cron corre siempre.
 */
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/db"
import { users } from "@/db/schema"
import { cleanRut, describeRutProblem } from "@/lib/rut"
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

/** `process.env` o cualquier mapa de variables: las pruebas pasan sólo las que importan. */
type EnvSource = Readonly<Record<string, string | undefined>>

export type CopecSettingField = "username" | "password" | "clientRut" | "syncEnabled" | "importerEmail"

/** Las keys físicas de usuario y contraseña están registradas en `settings-secret-keys.ts`. */
export const COPEC_SETTINGS = defineSettingsGroup<CopecSettingField>({
  name: "copec",
  entityType: "fuel_copec_settings",
  entityId: "copec",
  fields: {
    username: { key: "combustibles.copec.username", secret: true },
    password: { key: "combustibles.copec.password", secret: true },
    clientRut: { key: "combustibles.copec.client_rut", secret: false },
    syncEnabled: { key: "combustibles.copec.sync_enabled", secret: false },
    importerEmail: { key: "combustibles.copec.importer_email", secret: false },
  },
})

export type CopecAdminStatus = SettingsAdminStatus<CopecSettingField>

export interface CopecConfig {
  username: string
  password: string
  /** Como se guardó o vino del `.env`; el servicio valida y normaliza al consultar. */
  clientRut: string
  /** Usuario activo al que se le atribuye la corrida automática. */
  importerEmail: string
  syncEnabled: boolean
  /** Usuario, contraseña y RUT presentes (no dice que sean válidos). */
  hasCredentials: boolean
  /** Hay un valor guardado que este servidor no puede abrir (llavero equivocado o retirado). */
  hasUnreadableSecret: boolean
}

function copecConfigFromValues(values: Record<CopecSettingField, string>, unreadable: readonly CopecSettingField[] = []): CopecConfig {
  const username = values.username.trim()
  const password = values.password.trim()
  const clientRut = values.clientRut.trim()
  return {
    username,
    password,
    clientRut,
    importerEmail: values.importerEmail.trim(),
    // Sólo `"false"` apaga: el valor por omisión es seguir corriendo.
    syncEnabled: values.syncEnabled.trim() !== "false",
    hasCredentials: username.length > 0 && password.length > 0 && clientRut.length > 0,
    hasUnreadableSecret: unreadable.some((field) => COPEC_SETTINGS.fields[field].secret),
  }
}

function envValues(env: EnvSource): SettingsEnvValues<CopecSettingField> {
  return {
    username: env.COPEC_USERNAME?.trim(),
    password: env.COPEC_PASSWORD?.trim(),
    clientRut: env.COPEC_CLIENT_RUT?.trim(),
    syncEnabled: env.COPEC_SYNC_ENABLED?.trim(),
    importerEmail: env.COPEC_SYNC_IMPORTER_EMAIL?.trim(),
  }
}

/** Sólo el `.env`, sin BD: el respaldo del lector asíncrono y lo que usan las pruebas. */
export function copecConfigFromEnv(env: EnvSource = process.env): CopecConfig {
  return copecConfigFromValues({
    username: env.COPEC_USERNAME ?? "",
    password: env.COPEC_PASSWORD ?? "",
    clientRut: env.COPEC_CLIENT_RUT ?? "",
    syncEnabled: env.COPEC_SYNC_ENABLED ?? "",
    importerEmail: env.COPEC_SYNC_IMPORTER_EMAIL ?? "",
  })
}

/** Configuración vigente: lo guardado en la plataforma, con el `.env` de respaldo. */
export async function loadCopecConfig(env: EnvSource = process.env): Promise<CopecConfig> {
  const { values, unreadable } = await readSettingsGroup(COPEC_SETTINGS, envValues(env))
  return copecConfigFromValues(values, unreadable)
}

/** Estado para la pantalla: si hay valor y de dónde viene; sólo los no secretos traen su valor. */
export async function readCopecAdminStatus(env: EnvSource = process.env): Promise<CopecAdminStatus> {
  return readSettingsAdminStatus(COPEC_SETTINGS, envValues(env))
}

/** Lo que la pantalla pregunta, derivado del mismo DTO (una sola lectura). */
export function summarizeCopecStatus(status: CopecAdminStatus): { hasCredentials: boolean; syncEnabled: boolean } {
  const { username, password, clientRut, syncEnabled } = status.fields
  return {
    hasCredentials: username.configured && password.configured && clientRut.configured,
    // Sin valor (ni guardado ni en el `.env`) rige el default: encendida.
    syncEnabled: syncEnabled.value?.trim() !== "false",
  }
}

export type CopecSettingsErrorCode = "COPEC_RUT_INVALID" | "COPEC_IMPORTER_INVALID" | "COPEC_IMPORTER_INACTIVE"

/** Errores de validación del formulario: su mensaje está escrito para quien administra y no revela nada. */
export class CopecSettingsError extends Error {
  constructor(readonly code: CopecSettingsErrorCode, message: string) {
    super(message)
    this.name = "CopecSettingsError"
  }
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface CopecSettingsInput {
  /** Vacío o ausente conserva el valor actual. */
  username?: string
  password?: string
  clientRut?: string
  importerEmail?: string
  /** Se guarda sólo si cambia respecto de lo vigente: abrir y guardar no fija el valor del `.env`. */
  syncEnabled?: boolean
  clearUsername?: boolean
  clearPassword?: boolean
}

/**
 * RUT de la empresa en la forma que pide Copec (`76123456-0`), o un
 * `CopecSettingsError` que dice qué le pasa. Se valida acá y no al consultar:
 * un RUT con el dígito verificador mal guardado haría fallar cada corrida.
 */
function normalizeClientRut(raw: string): string {
  const problem = describeRutProblem(raw)
  if (problem === "format") throw new CopecSettingsError("COPEC_RUT_INVALID", "El RUT de la empresa no tiene un formato válido. Escríbelo como 12345678-9.")
  if (problem === "check-digit") throw new CopecSettingsError("COPEC_RUT_INVALID", "El RUT de la empresa tiene el dígito verificador incorrecto.")
  return cleanRut(raw)
}

/**
 * El usuario al que se le atribuye la corrida automática tiene que existir y
 * estar activo: `fuel_import_batches.importado_por` es NOT NULL, y sin él la
 * corrida de la madrugada cae. Devuelve el correo tal como está en `users`,
 * porque la lectura de la corrida lo compara exacto.
 */
async function resolveActiveImporterEmail(raw: string): Promise<string> {
  const email = raw.trim()
  if (!EMAIL_SHAPE.test(email)) throw new CopecSettingsError("COPEC_IMPORTER_INVALID", "El correo del usuario que registra la sincronización no es válido.")
  const user = await db.query.users.findFirst({
    where: and(sql`lower(${users.email}) = ${email.toLowerCase()}`, eq(users.isActive, true)),
    columns: { email: true },
  })
  if (!user) {
    throw new CopecSettingsError("COPEC_IMPORTER_INACTIVE", "Ese correo no pertenece a un usuario activo de la plataforma. La sincronización automática necesita uno para quedar registrada.")
  }
  return user.email
}

/**
 * Guarda lo que cambió. El RUT y el correo se escriben sólo si difieren de lo
 * vigente (el formulario los trae precargados), y se validan antes de tocar la
 * BD. Lanza `CopecSettingsError` por un valor inválido y
 * `EncryptedSettingsError` (`SETTINGS_KEYRING_REQUIRED`) si hay un secreto que
 * guardar y el servidor no tiene llavero.
 */
export async function saveCopecSettings(
  input: CopecSettingsInput,
  actor: SettingsActor,
  env: EnvSource = process.env,
): Promise<SettingsChangeResult<CopecSettingField>> {
  const current = await loadCopecConfig(env)

  const typedRut = input.clientRut?.trim()
  const clientRut = typedRut ? normalizeClientRut(typedRut) : undefined
  const rutChanged = clientRut !== undefined && (current.clientRut === "" || cleanRut(current.clientRut) !== clientRut)

  const typedEmail = input.importerEmail?.trim()
  const emailChanged = Boolean(typedEmail) && typedEmail!.toLowerCase() !== current.importerEmail.toLowerCase()
  const importerEmail = emailChanged ? await resolveActiveImporterEmail(typedEmail!) : undefined

  return saveSettingsGroup<CopecSettingField>(COPEC_SETTINGS, {
    set: {
      username: input.username?.trim() || undefined,
      password: input.password?.trim() || undefined,
      clientRut: rutChanged ? clientRut : undefined,
      importerEmail,
      syncEnabled: input.syncEnabled === undefined || input.syncEnabled === current.syncEnabled
        ? undefined
        : String(input.syncEnabled),
    },
    clear: [
      ...(input.clearUsername ? ["username" as const] : []),
      ...(input.clearPassword ? ["password" as const] : []),
    ],
  }, actor)
}

/** Borra lo guardado desde la pantalla: el `.env` del servidor vuelve a mandar. */
export async function clearCopecSettings(actor: SettingsActor): Promise<{ changed: boolean }> {
  return clearSettingsGroup(COPEC_SETTINGS, actor)
}
