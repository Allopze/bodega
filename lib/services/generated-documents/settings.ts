/**
 * Encendido y configuración del archivado de documentos generados.
 *
 * Tres llaves, y hacen falta las tres:
 *
 * 1. `GENERATED_DOCS_ARCHIVE_ENABLED=true` en el entorno del servidor. Solo el
 *    compose de producción la define. Existe porque la base de desarrollo es una
 *    copia de la de producción con sus ajustes —incluida la cuenta de Cloudreve
 *    real—, así que un switch guardado en BD no basta para que dev no escriba
 *    en el drive de la empresa.
 * 2. El switch de Administración (`storage.generated_docs.enabled`).
 * 3. Credenciales de Cloudreve: se exigen para encender el switch y el
 *    procesador vuelve a comprobarlas antes de subir.
 *
 * Las llaves viven en su propio objeto y no en `CLOUDREVE_SETTING_KEYS`:
 * `clearCloudreveSettings()` borra todo lo que hay en ese objeto, y borrar las
 * credenciales no debe cambiar dónde se archivan los documentos.
 */
import { inArray } from "drizzle-orm"
import { db } from "@/db"
import { systemSettings } from "@/db/schema"
import { recordAudit } from "@/lib/audit"
import {
  DEFAULT_GENERATED_ARCHIVE_BASE_PATH,
  normalizeGeneratedArchiveBasePath,
  parseGeneratedArchiveLayout,
  remoteFoldersOverlap,
  type GeneratedArchiveLayout,
} from "./remote-key"

export const GENERATED_ARCHIVE_SETTING_KEYS = {
  enabled:  "storage.generated_docs.enabled",
  basePath: "storage.generated_docs.base_path",
  layout:   "storage.generated_docs.layout",
} as const

export const GENERATED_ARCHIVE_ENV_FLAG = "GENERATED_DOCS_ARCHIVE_ENABLED"

type SettingsReader = Pick<typeof db, "select">

export interface GeneratedArchiveSettings {
  /** La llave de entorno del servidor. */
  envEnabled: boolean
  /** El switch de Administración. */
  switchOn: boolean
  /** Ambas: el archivado encola documentos. */
  enabled: boolean
  basePath: string
  /** Solo se ve cuando el valor guardado no es una carpeta válida. */
  basePathInvalid: boolean
  layout: GeneratedArchiveLayout
}

export function readGeneratedArchiveEnvFlag(): boolean {
  return process.env[GENERATED_ARCHIVE_ENV_FLAG]?.trim().toLowerCase() === "true"
}

/**
 * Lee los ajustes con el cliente que se le pase: el encolado lo llama con la
 * transacción del hecho de negocio, que en PGlite es la única conexión.
 */
export async function readGeneratedArchiveSettings(client: SettingsReader = db): Promise<GeneratedArchiveSettings> {
  const envEnabled = readGeneratedArchiveEnvFlag()
  const rows = await client
    .select({ key: systemSettings.key, value: systemSettings.value })
    .from(systemSettings)
    .where(inArray(systemSettings.key, Object.values(GENERATED_ARCHIVE_SETTING_KEYS)))
  const raw = new Map(rows.map((row) => [row.key, row.value]))

  let basePath = DEFAULT_GENERATED_ARCHIVE_BASE_PATH
  let basePathInvalid = false
  const storedBase = raw.get(GENERATED_ARCHIVE_SETTING_KEYS.basePath)
  if (storedBase !== undefined) {
    try {
      basePath = normalizeGeneratedArchiveBasePath(storedBase)
    } catch {
      basePathInvalid = true
    }
  }

  const switchOn = raw.get(GENERATED_ARCHIVE_SETTING_KEYS.enabled) === "true"
  return {
    envEnabled,
    switchOn,
    // Una carpeta guardada que ya no valida apaga el archivado en vez de
    // adivinar otra: los documentos quedarían donde nadie los busca.
    enabled: envEnabled && switchOn && !basePathInvalid,
    basePath,
    basePathInvalid,
    layout: parseGeneratedArchiveLayout(raw.get(GENERATED_ARCHIVE_SETTING_KEYS.layout)) ?? "faena",
  }
}

export class GeneratedArchiveSettingsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GeneratedArchiveSettingsError"
  }
}

export interface GeneratedArchiveSettingsInput {
  enabled: boolean
  basePath: string
  layout: GeneratedArchiveLayout
}

export interface GeneratedArchiveSettingsContext {
  /** Hay URL, usuario y contraseña de Cloudreve vigentes. */
  hasCredentials: boolean
  /** Carpetas que la de documentos generados no puede pisar. */
  reservedFolders: Array<{ path: string; label: string }>
}

/** Valida sin escribir: lo usa la acción antes de guardar y las pruebas. */
export function validateGeneratedArchiveSettings(
  input: GeneratedArchiveSettingsInput,
  context: GeneratedArchiveSettingsContext,
): { basePath: string; layout: GeneratedArchiveLayout; enabled: boolean } {
  let basePath: string
  try {
    basePath = normalizeGeneratedArchiveBasePath(input.basePath)
  } catch (error) {
    throw new GeneratedArchiveSettingsError(error instanceof Error ? error.message : "Carpeta inválida")
  }
  for (const reserved of context.reservedFolders) {
    if (remoteFoldersOverlap(basePath, reserved.path)) {
      throw new GeneratedArchiveSettingsError(
        `La carpeta «${basePath}» se cruza con ${reserved.label} («${reserved.path || "raíz de la cuenta"}»). Elige una carpeta aparte.`,
      )
    }
  }
  const layout = parseGeneratedArchiveLayout(input.layout)
  if (!layout) throw new GeneratedArchiveSettingsError("Orden de carpetas inválido")
  if (input.enabled && !readGeneratedArchiveEnvFlag()) {
    throw new GeneratedArchiveSettingsError(
      `Este servidor no tiene habilitado el archivado (${GENERATED_ARCHIVE_ENV_FLAG}). Solo se enciende en producción.`,
    )
  }
  if (input.enabled && !context.hasCredentials) {
    throw new GeneratedArchiveSettingsError("Configura primero las credenciales de Cloudreve.")
  }
  return { basePath, layout, enabled: input.enabled }
}

export async function saveGeneratedArchiveSettings(
  input: GeneratedArchiveSettingsInput,
  context: GeneratedArchiveSettingsContext,
  actor: { userId: string; userEmail?: string },
): Promise<GeneratedArchiveSettings> {
  const valid = validateGeneratedArchiveSettings(input, context)
  const before = await readGeneratedArchiveSettings()
  const updatedAt = new Date().toISOString()
  const writes: Array<[string, string]> = [
    [GENERATED_ARCHIVE_SETTING_KEYS.enabled, valid.enabled ? "true" : "false"],
    [GENERATED_ARCHIVE_SETTING_KEYS.basePath, valid.basePath],
    [GENERATED_ARCHIVE_SETTING_KEYS.layout, valid.layout],
  ]
  await db.transaction(async (tx) => {
    for (const [key, value] of writes) {
      await tx.insert(systemSettings).values({ key, value, updatedAt })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedAt } })
    }
    await recordAudit({
      userId: actor.userId,
      userEmail: actor.userEmail,
      action: "update",
      entityType: "generated_documents_settings",
      entityId: "generated_documents",
      oldState: { enabled: before.switchOn, basePath: before.basePath, layout: before.layout },
      newState: { enabled: valid.enabled, basePath: valid.basePath, layout: valid.layout },
    }, tx)
  })
  return readGeneratedArchiveSettings()
}
