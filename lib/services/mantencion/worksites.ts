import { asc, eq } from "drizzle-orm"
import { db, type Tx } from "@/db"
import { mantWorksiteSettings, worksites } from "@/db/schema"
import { cleanName, deriveFolioCode, findByNameKey } from "@/lib/mantencion/normalize"
import { createWorksiteTx } from "@/lib/services/worksite-create"

/**
 * Faenas del módulo de mantención: la faena es `worksites` (la misma de toda la
 * plataforma) y lo propio del módulo —el código de tres letras del folio—
 * vive en `mant_worksite_settings`.
 */

export interface MantWorksite {
  id: string
  name: string
  code: string
  folioCode: string | null
  isActive: boolean
}

/** Faenas para selectores y filtros. `folioCode` nulo = la faena aún no tiene folio (se le asigna al primer uso). */
export async function listMantWorksites(opts: { includeInactive?: boolean } = {}): Promise<MantWorksite[]> {
  const rows = await db
    .select({
      id: worksites.id,
      name: worksites.name,
      code: worksites.code,
      folioCode: mantWorksiteSettings.folioCode,
      isActive: worksites.isActive,
    })
    .from(worksites)
    .leftJoin(mantWorksiteSettings, eq(mantWorksiteSettings.worksiteId, worksites.id))
    .where(opts.includeInactive ? undefined : eq(worksites.isActive, true))
    .orderBy(asc(worksites.name))
  return rows
}

const FOLIO_ATTEMPTS = 6

/**
 * Garantiza la fila de `mant_worksite_settings` de la faena y devuelve su código
 * de folio. Idempotente: si ya tiene uno, lo devuelve sin tocarlo (cambiarlo
 * rompería la lectura de los folios ya emitidos).
 *
 * `preferred` es el código que la carga inicial trae de la planilla; si ya lo
 * usa otra faena, o no son tres letras, se deriva uno del nombre con
 * `deriveFolioCode`. Dos altas simultáneas que elijan el mismo código chocan en
 * el índice único: `ON CONFLICT DO NOTHING` deja a una sin fila, y esa relee los
 * códigos tomados y reintenta con otro.
 */
export async function ensureFolioCode(tx: Tx, worksiteId: string, preferred?: string): Promise<string> {
  for (let attempt = 0; attempt < FOLIO_ATTEMPTS; attempt++) {
    const [own] = await tx.select({ folioCode: mantWorksiteSettings.folioCode })
      .from(mantWorksiteSettings)
      .where(eq(mantWorksiteSettings.worksiteId, worksiteId))
    if (own) return own.folioCode

    const [worksite] = await tx.select({ name: worksites.name }).from(worksites).where(eq(worksites.id, worksiteId))
    if (!worksite) throw new Error("La faena no existe.")
    const taken = new Set((await tx.select({ folioCode: mantWorksiteSettings.folioCode }).from(mantWorksiteSettings))
      .map((row) => row.folioCode))
    const candidate = attempt === 0 && preferred && /^[A-Z]{3}$/.test(preferred) && !taken.has(preferred)
      ? preferred
      : deriveFolioCode(worksite.name, taken)
    await tx.insert(mantWorksiteSettings)
      .values({ worksiteId, folioCode: candidate })
      .onConflictDoNothing()
  }
  throw new Error("No se pudo asignar un código de folio a la faena.")
}

/**
 * Regla 17: «Nueva faena…» no duplica. Si el nombre escrito coincide
 * normalizado con una faena existente (activa o no: «cholguán» = «Cholguan»)
 * se usa esa; si es realmente nueva se crea con el mismo servicio que
 * Administración, con un código propio `MANT-<FOLIO>` y su folio.
 *
 * También deja la faena existente con folio: sin él, el primer registro que
 * llegue a esa faena no podría numerarse.
 */
export async function resolveOrCreateWorksite(
  tx: Tx,
  input: {
    typedName: string
    actor: { userId: string | null; email?: string | null }
    /** Código de folio preferido (la carga inicial lo trae de la planilla); si está tomado se deriva otro. */
    folioCode?: string
  },
): Promise<{ id: string; name: string; created: boolean }> {
  const typed = cleanName(input.typedName)
  if (typed.length < 2) throw new Error("Escribe el nombre de la faena.")
  if (typed.length > 80) throw new Error("El nombre de la faena no puede pasar de 80 caracteres.")

  const all = await tx.select({ id: worksites.id, name: worksites.name, code: worksites.code }).from(worksites)
  const existing = findByNameKey(all, typed)
  if (existing) {
    await ensureFolioCode(tx, existing.id, input.folioCode)
    return { id: existing.id, name: existing.name, created: false }
  }

  const taken = new Set((await tx.select({ folioCode: mantWorksiteSettings.folioCode }).from(mantWorksiteSettings))
    .map((row) => row.folioCode))
  const preferred = input.folioCode
  const folio = preferred && /^[A-Z]{3}$/.test(preferred) && !taken.has(preferred) ? preferred : deriveFolioCode(typed, taken)
  const usedCodes = new Set(all.map((row) => row.code))
  let code = `MANT-${folio}`
  for (let suffix = 2; usedCodes.has(code); suffix++) code = `MANT-${folio}-${suffix}`

  const { id } = await createWorksiteTx(tx, { name: typed, code, isActive: true }, input.actor)
  await ensureFolioCode(tx, id, folio)
  return { id, name: typed, created: true }
}
