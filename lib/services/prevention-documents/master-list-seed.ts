/**
 * lib/services/prevention-documents/master-list-seed.ts
 *
 * Siembra el RE-08 en `sst_documents` como **inventario de lo exigido**.
 *
 * Los 99 documentos entran corporativos (`worksiteId: null`), en `borrador` y
 * sin versión. Un documento sin binario no promete nada que no cumpla:
 * `borrador` significa literalmente "existe el registro, no la evidencia", y
 * ganar la brecha visible —99 exigidos, N con archivo cargado— es justo lo que
 * hoy no se puede ver con la tabla en cero.
 *
 * **Y no puede acreditar nada del PDTP, por construcción.** Publicar exige una
 * versión con archivo y checksum; y aun forzándolo, `onDocumentVersionPublished`
 * y `onDocumentAcknowledged` abandonan cuando el documento no tiene faena, que
 * es el caso de los 99. Ése es el argumento de seguridad que hace defendible
 * sembrar el inventario.
 *
 * **Lo que este sembrador NO resuelve: la decisión D12.** El RE-08 es
 * corporativo y la D12 pide la lista de documentos exigidos *por faena*. El
 * esquema no sabe decir "este documento debe existir en cada faena" salvo
 * duplicando 99 × 7 filas vacías de documentos que son uno solo — eso no es un
 * inventario, es ruido, y le cablearía a la N°19 un padrón inventado. La D12
 * necesita una decisión de esquema previa y sigue abierta.
 */

import { and, eq, isNull } from "drizzle-orm"
import { db } from "@/db"
import { sstDocumentFolders, sstDocumentTypes, sstDocuments } from "@/db/schema"
import { nanoid } from "@/lib/id"
import { RE08_DOCUMENTS, type Re08Document } from "./master-list-2026"

/**
 * Tipo documental derivado del código y del nombre. El RE-08 no lo declara.
 *
 * El orden importa: "Plan de Medio Ambiente" es un programa antes que un
 * procedimiento, y un `RE-` es un formato aunque su nombre diga "Matriz".
 */
export function deriveDocumentTypeCode(entry: Pick<Re08Document, "code" | "name">): string {
  const name = entry.name.toLocaleLowerCase("es-CL")
  if (/^pol[ií]tica/.test(name)) return "POL"
  if ((entry.code ?? "").startsWith("RE-")) return "FORMATO"
  if (/^(programa|plan)\b/.test(name)) return "PROG"
  if (/^(matriz|listado)/.test(name)) return "MATRIZ"
  if (/^instructivo/.test(name)) return "INSTR"
  return "PROC"
}

/**
 * Tema SST del documento. Es un mapa curado y no derivado: el RE-08 clasifica
 * por cláusula ISO y por proceso, dos ejes que no dicen de qué trata en materia
 * de prevención.
 */
const CATEGORY_BY_CODE: Record<string, string> = {
  "DO-41": "emergencias", "RE-25": "emergencias", "DO-46": "emergencias", "RE-33": "emergencias", "RE-34": "emergencias",
  "DO-39": "epp", "RE-23-1": "epp", "RE-23-2": "epp", "DO-45": "epp",
  "DO-36": "incidentes", "RE-20": "incidentes", "RE-19": "incidentes", "DO-35": "incidentes",
  "DO-08": "capacitacion", "DO-09": "capacitacion", "RE-05": "capacitacion", "RE-06": "capacitacion", "RE-07": "capacitacion", "RE-21": "capacitacion", "RE-22": "capacitacion",
  "DO-47": "salud_ocupacional", "RE-28": "salud_ocupacional", "DO-49": "salud_ocupacional", "RE-31": "salud_ocupacional", "RE-32": "salud_ocupacional", "DO-55": "salud_ocupacional", "DO-42": "salud_ocupacional", "DO-57": "salud_ocupacional", "DO-58": "salud_ocupacional",
  "RE-03": "legal_normativa", "DO-52": "legal_normativa", "RE-27": "legal_normativa",
  "DO-48": "comite", "RE-29": "comite", "RE-30": "comite",
}

/** Los procedimientos operativos de equipo y vehículo, por rango de código. */
const EQUIPMENT_CODES = /^DO-(1[4-9]|2[0-9]|3[01]|37|38|40)$/
const AUDIT_CODES = /^(DO-3[34]|RE-1[5-8])$/

export function deriveCategorySlug(entry: Pick<Re08Document, "code" | "name">): string {
  const code = entry.code ?? ""
  if (CATEGORY_BY_CODE[code]) return CATEGORY_BY_CODE[code]!
  if (EQUIPMENT_CODES.test(code)) return "equipos_vehiculos"
  if (AUDIT_CODES.test(code)) return "fiscalizacion"
  return "gestion_preventiva"
}

function slugify(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("es-CL").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

/**
 * Carpeta corporativa idempotente. `getOrCreateSystemFolder` no sirve acá:
 * exige faena y sólo crea raíces, y el RE-08 es corporativo y con dos niveles.
 */
async function getOrCreateCorporateFolder(name: string, parentId: string | null, actorUserId: string): Promise<string> {
  const slug = parentId ? `${slugify(name)}--${parentId}` : slugify(name)
  const [existing] = await db.select({ id: sstDocumentFolders.id }).from(sstDocumentFolders)
    .where(and(
      eq(sstDocumentFolders.slug, slug),
      parentId ? eq(sstDocumentFolders.parentId, parentId) : isNull(sstDocumentFolders.parentId),
    ))
    .limit(1)
  if (existing) return existing.id

  const now = new Date().toISOString()
  const id = `sdf-${nanoid()}`
  await db.insert(sstDocumentFolders).values({
    id, parentId, name, slug, worksiteId: null, createdBy: actorUserId,
    archivedAt: null, createdAt: now, updatedAt: now,
  }).onConflictDoNothing()
  const [folder] = await db.select({ id: sstDocumentFolders.id }).from(sstDocumentFolders)
    .where(and(
      eq(sstDocumentFolders.slug, slug),
      parentId ? eq(sstDocumentFolders.parentId, parentId) : isNull(sstDocumentFolders.parentId),
    ))
    .limit(1)
  if (!folder) throw new Error(`No se pudo crear la carpeta "${name}".`)
  return folder.id
}

export type MasterListSeedResult = {
  documents: number
  created: number
  folders: number
  /** Tipos que el mapeo pide y el catálogo no tiene: el sembrado se detiene. */
  missingTypes: string[]
}

/**
 * Idempotente por el `n` de la fila del RE-08, que viaja en `extraMetadata`.
 *
 * No se usa `internal_code`: `DO-20` y `DO-37` aparecen dos veces en el listado
 * —con documentos distintos— y cinco filas no traen código. Es un error del
 * propio RE-08, y por eso tampoco hay índice único sobre esa columna.
 */
export async function seedSstDocumentMasterList(input: {
  actorUserId: string
  dryRun?: boolean
  onProgress?: (line: string) => void
}): Promise<MasterListSeedResult> {
  const log = input.onProgress ?? (() => {})
  const result: MasterListSeedResult = { documents: RE08_DOCUMENTS.length, created: 0, folders: 0, missingTypes: [] }

  const types = await db.select({ id: sstDocumentTypes.id, code: sstDocumentTypes.code }).from(sstDocumentTypes)
  const typeIdByCode = new Map(types.map((row) => [row.code, row.id]))
  const required = [...new Set(RE08_DOCUMENTS.map((entry) => deriveDocumentTypeCode(entry)))]
  result.missingTypes = required.filter((code) => !typeIdByCode.has(code))
  if (result.missingTypes.length > 0) {
    // Sin los tipos, `type_id` quedaría nulo en masa y el inventario perdería
    // justamente lo que lo hace navegable. Se aborta antes de escribir.
    log(`  ✗ faltan tipos documentales en el catálogo: ${result.missingTypes.join(", ")}`)
    return result
  }

  const existing = await db.select({ metadata: sstDocuments.extraMetadata }).from(sstDocuments)
  const seeded = new Set(existing.flatMap((row) => {
    const re08 = (row.metadata as Record<string, unknown> | null)?.re08 as { n?: number } | undefined
    return typeof re08?.n === "number" ? [re08.n] : []
  }))

  const folderCache = new Map<string, string>()
  const now = new Date().toISOString()

  for (const entry of RE08_DOCUMENTS) {
    if (seeded.has(entry.n)) continue
    if (input.dryRun) { result.created++; continue }

    let folderId: string | null = null
    if (entry.folder) {
      const rootKey = entry.folder
      let rootId = folderCache.get(rootKey)
      if (!rootId) {
        rootId = await getOrCreateCorporateFolder(entry.folder, null, input.actorUserId)
        folderCache.set(rootKey, rootId)
        result.folders++
      }
      folderId = rootId
      if (entry.subfolder) {
        const childKey = `${rootKey}/${entry.subfolder}`
        let childId = folderCache.get(childKey)
        if (!childId) {
          childId = await getOrCreateCorporateFolder(entry.subfolder, rootId, input.actorUserId)
          folderCache.set(childKey, childId)
          result.folders++
        }
        folderId = childId
      }
    }

    await db.insert(sstDocuments).values({
      id: `sstdoc-re08-${entry.n}`,
      categorySlug: deriveCategorySlug(entry),
      typeId: typeIdByCode.get(deriveDocumentTypeCode(entry)) ?? null,
      internalCode: entry.code,
      title: entry.name,
      description: "Documento del listado maestro del SGI (RE-08). El registro existe; la evidencia se carga al subir su versión.",
      worksiteId: null,
      status: "borrador",
      folderId,
      effectiveFrom: entry.effectiveFrom,
      uploadedBy: input.actorUserId,
      requiresAcknowledgment: false,
      tags: ["re-08", "sgi"],
      extraMetadata: {
        re08: {
          n: entry.n, version: entry.version, process: entry.process,
          retention: entry.retention, owner: entry.owner,
          folder: entry.folder, subfolder: entry.subfolder,
        },
      },
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing()
    result.created++
  }

  return result
}
