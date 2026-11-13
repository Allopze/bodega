/**
 * Credenciales e interruptor de Wialon, administrables desde
 * Flota → Monitoreo GPS → Configuración.
 *
 * El token lo emite la cuenta de Wialon y se guarda cifrado con el llavero de
 * la aplicación; el `.env` (`WIALON_*`) queda como respaldo. Lo guardado gana
 * sobre el entorno. La URL base es configurable porque Wialon Hosting tiene
 * varias regiones y Wialon Local vive en un dominio propio.
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
import { DEFAULT_WIALON_BASE_URL, normalizeWialonBaseUrl } from "./wialon-client"

type EnvSource = Readonly<Record<string, string | undefined>>

export const WIALON_DEFAULTS = {
  baseUrl: DEFAULT_WIALON_BASE_URL,
  // Vacío = usar los contadores que mantiene Wialon (cnm, cneh): existen en toda
  // unidad, a diferencia de un parámetro que cada cuenta nombra a su manera.
  odometerParam: "",
  hourMeterParam: "",
  fuelLevelParam: "fuel_level",
} as const

export interface WialonConfig {
  baseUrl: string
  token: string
  syncEnabled: boolean
  hasCredentials: boolean
  odometerParam: string
  hourMeterParam: string
  fuelLevelParam: string
}

export type WialonSettingField =
  | "baseUrl"
  | "token"
  | "syncEnabled"
  | "odometerParam"
  | "hourMeterParam"
  | "fuelLevelParam"

/** Las keys físicas están registradas en `settings-secret-keys.ts` (el token). */
export const WIALON_SETTINGS = defineSettingsGroup<WialonSettingField>({
  name: "wialon",
  entityType: "fleet_wialon_settings",
  entityId: "wialon",
  fields: {
    baseUrl: { key: "flota.wialon.base_url", secret: false },
    token: { key: "flota.wialon.token", secret: true },
    syncEnabled: { key: "flota.wialon.sync_enabled", secret: false },
    odometerParam: { key: "flota.wialon.odometer_param", secret: false },
    hourMeterParam: { key: "flota.wialon.hour_meter_param", secret: false },
    fuelLevelParam: { key: "flota.wialon.fuel_level_param", secret: false },
  },
})

export type WialonAdminStatus = SettingsAdminStatus<WialonSettingField>

export class WialonSettingsError extends Error {
  constructor(readonly code: "WIALON_TOKEN_REQUIRED_ON_URL_CHANGE") {
    super(code)
    this.name = "WialonSettingsError"
  }
}

function configFromValues(values: Record<WialonSettingField, string>): WialonConfig {
  const baseUrl = values.baseUrl.trim() || WIALON_DEFAULTS.baseUrl
  const token = values.token.trim()
  return {
    baseUrl,
    token,
    syncEnabled: values.syncEnabled.trim() === "true",
    hasCredentials: token.length > 0,
    // Sin `|| default`: vacío es un valor con significado (contador de Wialon).
    odometerParam: values.odometerParam.trim(),
    hourMeterParam: values.hourMeterParam.trim(),
    fuelLevelParam: values.fuelLevelParam.trim() || WIALON_DEFAULTS.fuelLevelParam,
  }
}

function envValues(env: EnvSource): SettingsEnvValues<WialonSettingField> {
  return {
    baseUrl: env.WIALON_BASE_URL?.trim(),
    token: env.WIALON_TOKEN?.trim(),
    syncEnabled: env.WIALON_SYNC_ENABLED?.trim(),
    odometerParam: env.WIALON_ODOMETER_PARAM?.trim(),
    hourMeterParam: env.WIALON_HOUR_METER_PARAM?.trim(),
    fuelLevelParam: env.WIALON_FUEL_LEVEL_PARAM?.trim(),
  }
}

/** Sólo el `.env`: el respaldo del lector asíncrono. No toca la BD. */
export function readWialonConfig(env: EnvSource = process.env): WialonConfig {
  return configFromValues({
    baseUrl: env.WIALON_BASE_URL ?? "",
    token: env.WIALON_TOKEN ?? "",
    syncEnabled: env.WIALON_SYNC_ENABLED ?? "",
    odometerParam: env.WIALON_ODOMETER_PARAM ?? "",
    hourMeterParam: env.WIALON_HOUR_METER_PARAM ?? "",
    fuelLevelParam: env.WIALON_FUEL_LEVEL_PARAM ?? "",
  })
}

/** Configuración vigente: lo guardado en la plataforma, con el `.env` de respaldo. */
export async function loadWialonConfig(env: EnvSource = process.env): Promise<WialonConfig> {
  const { values } = await readSettingsGroup(WIALON_SETTINGS, envValues(env))
  return configFromValues(values)
}

/** Estado para la pantalla: si hay valor y de dónde viene, nunca el token. */
export async function readWialonAdminStatus(env: EnvSource = process.env): Promise<WialonAdminStatus> {
  return readSettingsAdminStatus(WIALON_SETTINGS, envValues(env))
}

export function summarizeWialonStatus(status: WialonAdminStatus): { hasCredentials: boolean; syncEnabled: boolean } {
  return {
    hasCredentials: status.fields.token.configured,
    syncEnabled: status.fields.syncEnabled.value?.trim() === "true",
  }
}

export interface WialonSettingsInput {
  baseUrl?: string
  /** Vacío o ausente conserva el token actual. */
  token?: string
  syncEnabled?: boolean
  odometerParam?: string
  hourMeterParam?: string
  fuelLevelParam?: string
  clearToken?: boolean
}

/**
 * Guarda sólo lo que cambió. La URL se normaliza al origen antes de persistir:
 * el cliente siempre le agrega `/wialon/ajax.html`, y una URL con path,
 * query o credenciales sería una configuración ambigua.
 */
export async function saveWialonSettings(
  input: WialonSettingsInput,
  actor: SettingsActor,
  env: EnvSource = process.env,
): Promise<SettingsChangeResult<WialonSettingField>> {
  const current = await loadWialonConfig(env)
  const baseUrl = input.baseUrl?.trim()
  const normalizedBaseUrl = baseUrl ? normalizeWialonBaseUrl(baseUrl) : undefined
  // Cambiar de host cambia el destinatario del token. No se hereda el secreto
  // anterior: quien mueve la URL tiene que volver a demostrar que tiene el
  // token de esa cuenta.
  if (
    normalizedBaseUrl &&
    normalizedBaseUrl !== normalizeWialonBaseUrl(current.baseUrl) &&
    !input.token?.trim()
  ) {
    throw new WialonSettingsError("WIALON_TOKEN_REQUIRED_ON_URL_CHANGE")
  }

  return saveSettingsGroup<WialonSettingField>(WIALON_SETTINGS, {
    set: {
      baseUrl: normalizedBaseUrl && normalizedBaseUrl !== current.baseUrl ? normalizedBaseUrl : undefined,
      token: input.token?.trim() || undefined,
      syncEnabled: input.syncEnabled === undefined || input.syncEnabled === current.syncEnabled
        ? undefined
        : String(input.syncEnabled),
      odometerParam: input.odometerParam?.trim() && input.odometerParam.trim() !== current.odometerParam
        ? input.odometerParam.trim()
        : undefined,
      hourMeterParam: input.hourMeterParam?.trim() && input.hourMeterParam.trim() !== current.hourMeterParam
        ? input.hourMeterParam.trim()
        : undefined,
      fuelLevelParam: input.fuelLevelParam?.trim() && input.fuelLevelParam.trim() !== current.fuelLevelParam
        ? input.fuelLevelParam.trim()
        : undefined,
    },
    clear: [
      ...(input.clearToken ? ["token" as const] : []),
      // Enviar el campo vacío es pedir el contador de Wialon: se borra lo
      // guardado (sin valor propio, `.env` y luego el contador mandan).
      ...(input.odometerParam !== undefined && input.odometerParam.trim() === "" ? ["odometerParam" as const] : []),
      ...(input.hourMeterParam !== undefined && input.hourMeterParam.trim() === "" ? ["hourMeterParam" as const] : []),
    ],
  }, actor)
}

/** Borra lo guardado desde la pantalla: el `.env` del servidor vuelve a mandar. */
export async function clearWialonSettings(actor: SettingsActor): Promise<{ changed: boolean }> {
  return clearSettingsGroup(WIALON_SETTINGS, actor)
}
