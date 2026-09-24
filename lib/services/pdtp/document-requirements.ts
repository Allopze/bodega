/**
 * Documentos que una actividad del PDTP declara como su carpeta.
 *
 * Hoy la única que los declara es la N°19 ("Mantener carpetas de requisitos
 * legales"): el mes se acredita cuando la faena tiene vigentes todos los tipos
 * de su carpeta (ver `lib/prevention/legal-folder.ts` y
 * `lib/services/pdtp-adapters/legal-folder-connector.ts`). La lista es contenido
 * firmado del programa —entra a la huella desde el esquema 19—, así que sólo se
 * edita con el programa abierto y viaja en cada copia de versión.
 */
import { and, asc, eq, inArray } from "drizzle-orm"
import { db, type Tx } from "@/db"
import {
  pdtpActivities,
  pdtpActivityDocumentRequirements,
  pdtpPrograms,
  sstDocumentTypes,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { pdtpCatalogActivityIdForLegacyNumber } from "@/lib/services/pdtp-adapters/catalog-activities-2026"
import { addPdtpChangeLogEntry, assertPdtpProgramEditableState } from "./helpers"

type QueryClient = Tx | typeof db

export type PdtpDocumentRequirementScope = "faena" | "corporativo"

export type PdtpActivityDocumentRequirementInput = {
  documentTypeId: string
  scope: PdtpDocumentRequirementScope
  mustFollowDocumentTypeId?: string | null
}

export type PdtpActivityDocumentRequirementView = {
  id: string
  activityId: string
  documentTypeId: string
  documentTypeCode: string
  documentTypeName: string
  documentTypeIsActive: boolean
  scope: PdtpDocumentRequirementScope
  mustFollowDocumentTypeId: string | null
  displayOrder: number
}

/** Tope de requisitos por actividad: una carpeta, no un inventario. */
export const PDTP_DOCUMENT_REQUIREMENTS_MAX = 30

/** Número de catálogo de la carpeta de requisitos legales. */
export const PDTP_LEGAL_FOLDER_ACTIVITY_NUMBER = 19

/**
 * ¿Es ésta la actividad de carpeta? Por identidad de catálogo cuando la tiene
 * —el número se puede renumerar en otra versión, la identidad no— y por número
 * sólo en actividades sin catálogo (fixtures y programas en blanco).
 */
export function isPdtpLegalFolderActivity(activity: { catalogActivityId: string | null; n: number }): boolean {
  if (activity.catalogActivityId) {
    return activity.catalogActivityId === pdtpCatalogActivityIdForLegacyNumber(PDTP_LEGAL_FOLDER_ACTIVITY_NUMBER)
  }
  return activity.n === PDTP_LEGAL_FOLDER_ACTIVITY_NUMBER
}

export async function listPdtpActivityDocumentRequirements(
  activityIds: string[],
  client: QueryClient = db,
): Promise<PdtpActivityDocumentRequirementView[]> {
  if (activityIds.length === 0) return []
  const rows = await client.select({
    id: pdtpActivityDocumentRequirements.id,
    activityId: pdtpActivityDocumentRequirements.activityId,
    documentTypeId: pdtpActivityDocumentRequirements.documentTypeId,
    documentTypeCode: sstDocumentTypes.code,
    documentTypeName: sstDocumentTypes.name,
    documentTypeIsActive: sstDocumentTypes.isActive,
    scope: pdtpActivityDocumentRequirements.scope,
    mustFollowDocumentTypeId: pdtpActivityDocumentRequirements.mustFollowDocumentTypeId,
    displayOrder: pdtpActivityDocumentRequirements.displayOrder,
  })
    .from(pdtpActivityDocumentRequirements)
    .innerJoin(sstDocumentTypes, eq(sstDocumentTypes.id, pdtpActivityDocumentRequirements.documentTypeId))
    .where(inArray(pdtpActivityDocumentRequirements.activityId, activityIds))
    .orderBy(
      asc(pdtpActivityDocumentRequirements.activityId),
      asc(pdtpActivityDocumentRequirements.displayOrder),
      asc(sstDocumentTypes.name),
    )
  return rows.map((row) => ({ ...row, scope: row.scope as PdtpDocumentRequirementScope }))
}

/** Normaliza y valida una lista antes de escribirla. No toca la base. */
function normalizeRequirements(requirements: PdtpActivityDocumentRequirementInput[]): PdtpActivityDocumentRequirementInput[] {
  if (requirements.length > PDTP_DOCUMENT_REQUIREMENTS_MAX) {
    throw new Error(`Una carpeta admite como máximo ${PDTP_DOCUMENT_REQUIREMENTS_MAX} documentos.`)
  }
  const seen = new Set<string>()
  return requirements.map((requirement) => {
    const documentTypeId = requirement.documentTypeId.trim()
    if (!documentTypeId) throw new Error("Selecciona el tipo documental de cada requisito.")
    if (seen.has(documentTypeId)) throw new Error("Un mismo tipo documental no puede repetirse en la carpeta.")
    seen.add(documentTypeId)
    if (requirement.scope !== "faena" && requirement.scope !== "corporativo") {
      throw new Error("El alcance de cada requisito debe ser por faena o corporativo.")
    }
    const mustFollow = requirement.mustFollowDocumentTypeId?.trim() || null
    if (mustFollow === documentTypeId) throw new Error("Un documento no puede exigir ser posterior a sí mismo.")
    return { documentTypeId, scope: requirement.scope, mustFollowDocumentTypeId: mustFollow }
  })
}

/** Todos los tipos referenciados (requisito y "posterior a") deben existir. */
async function assertDocumentTypesExist(
  requirements: PdtpActivityDocumentRequirementInput[],
  client: QueryClient,
  options: { requireActive: boolean },
) {
  const ids = [...new Set(requirements.flatMap((requirement) => [
    requirement.documentTypeId,
    ...(requirement.mustFollowDocumentTypeId ? [requirement.mustFollowDocumentTypeId] : []),
  ]))]
  if (ids.length === 0) return
  const types = await client.select({ id: sstDocumentTypes.id, isActive: sstDocumentTypes.isActive })
    .from(sstDocumentTypes).where(inArray(sstDocumentTypes.id, ids))
  if (types.length !== ids.length) throw new Error("Uno de los tipos documentales de la carpeta ya no existe.")
  if (options.requireActive && types.some((type) => !type.isActive)) {
    throw new Error("La carpeta no puede exigir un tipo documental inactivo.")
  }
}

/**
 * Reemplaza la carpeta de una actividad. Autoritativo: lo que no viene en la
 * lista sale. Sólo con el programa editable y sólo para la actividad de
 * carpeta — declarar documentos en otra actividad la haría acreditarse por un
 * mecanismo que su ficha no describe.
 */
export async function setPdtpActivityDocumentRequirements(input: {
  programId: string
  activityId: string
  requirements: PdtpActivityDocumentRequirementInput[]
  userId: string
}) {
  const requirements = normalizeRequirements(input.requirements)
  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(pdtpPrograms)
      .where(eq(pdtpPrograms.id, input.programId)).for("update").limit(1)
    if (!program) throw new Error("Programa PDTP no encontrado.")
    assertPdtpProgramEditableState(program)

    const [activity] = await tx.select({
      id: pdtpActivities.id,
      n: pdtpActivities.n,
      catalogActivityId: pdtpActivities.catalogActivityId,
      status: pdtpActivities.status,
    })
      .from(pdtpActivities)
      .where(and(eq(pdtpActivities.id, input.activityId), eq(pdtpActivities.programId, input.programId)))
      .limit(1)
    if (!activity) throw new Error("Actividad PDTP no encontrada en este programa.")
    if (activity.status === "retired") throw new Error("Una actividad retirada no admite cambios.")
    if (!isPdtpLegalFolderActivity(activity)) {
      throw new Error("Sólo la carpeta de requisitos legales (N°19) declara documentos requeridos.")
    }
    await assertDocumentTypesExist(requirements, tx, { requireActive: true })

    const previous = await tx.select({
      documentTypeId: pdtpActivityDocumentRequirements.documentTypeId,
      scope: pdtpActivityDocumentRequirements.scope,
      mustFollowDocumentTypeId: pdtpActivityDocumentRequirements.mustFollowDocumentTypeId,
    })
      .from(pdtpActivityDocumentRequirements)
      .where(eq(pdtpActivityDocumentRequirements.activityId, activity.id))
      .orderBy(asc(pdtpActivityDocumentRequirements.displayOrder))

    const now = new Date().toISOString()
    await tx.delete(pdtpActivityDocumentRequirements)
      .where(eq(pdtpActivityDocumentRequirements.activityId, activity.id))
    await insertPdtpActivityDocumentRequirements(tx, activity.id, requirements, now)
    await addPdtpChangeLogEntry(
      program.id,
      program.version,
      input.userId,
      "document-requirements",
      { activityId: activity.id, requirements: previous },
      { activityId: activity.id, requirements },
      `Carpeta documental de la actividad N°${activity.n}: ${requirements.length} documento(s) requerido(s).`,
      tx,
    )
    return { activityId: activity.id, requirements }
  })
}

async function insertPdtpActivityDocumentRequirements(
  client: QueryClient,
  activityId: string,
  requirements: PdtpActivityDocumentRequirementInput[],
  now: string,
) {
  if (requirements.length === 0) return
  await client.insert(pdtpActivityDocumentRequirements).values(requirements.map((requirement, index) => ({
    id: `pdtp-docreq-${nanoid()}`,
    activityId,
    documentTypeId: requirement.documentTypeId,
    scope: requirement.scope,
    mustFollowDocumentTypeId: requirement.mustFollowDocumentTypeId ?? null,
    displayOrder: index,
    createdAt: now,
    updatedAt: now,
  })))
}

/**
 * Lee los requisitos de una actividad desde un snapshot firmado
 * (`documentRequirements`, esquema ≥19). Lo usan las dos rutas que reconstruyen
 * contenido desde una huella: instanciar una plantilla y adoptar una diferencia
 * de la Base. Un tipo que ya no existe es un error, igual que un rol ejecutor
 * desaparecido: aplicar a medias dejaría una carpeta que nadie firmó.
 */
export async function replacePdtpActivityDocumentRequirementsFromSnapshot(
  client: QueryClient,
  input: { activityId: string; activityNumber: number; snapshotRequirements: Array<Record<string, unknown>>; now: string },
) {
  const requirements = input.snapshotRequirements
    .filter((row) => Number(row.activityNumber) === input.activityNumber)
    .sort((a, b) => Number(a.displayOrder ?? 0) - Number(b.displayOrder ?? 0))
    .map((row) => ({
      documentTypeId: typeof row.documentTypeId === "string" ? row.documentTypeId : "",
      scope: (row.scope === "faena" ? "faena" : "corporativo") as PdtpDocumentRequirementScope,
      mustFollowDocumentTypeId: typeof row.mustFollowDocumentTypeId === "string" ? row.mustFollowDocumentTypeId : null,
    }))
    .filter((row) => row.documentTypeId)
  await client.delete(pdtpActivityDocumentRequirements)
    .where(eq(pdtpActivityDocumentRequirements.activityId, input.activityId))
  if (requirements.length === 0) return
  await assertDocumentTypesExist(requirements, client, { requireActive: false })
  await insertPdtpActivityDocumentRequirements(client, input.activityId, requirements, input.now)
}
