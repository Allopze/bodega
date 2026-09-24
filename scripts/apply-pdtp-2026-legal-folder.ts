/**
 * scripts/apply-pdtp-2026-legal-folder.ts
 *
 * Declara la carpeta de requisitos legales de la N°19 del programa PDTP 2026:
 * qué documentos debe tener vigentes cada faena en Documentación para que el
 * mes se acredite (`pdtp_activity_document_requirements`, ver
 * `lib/services/pdtp-adapters/legal-folder-connector.ts`).
 *
 * La lista es la propuesta del 2026-09-24, tomada del propio texto de la
 * actividad ("carpeta de requisitos legales… entrega EPP, IRL, RIOHS con cartas
 * de SEREMI e inspección"):
 *
 *   - RIOHS vigente                                        corporativo
 *   - Carta conductora del RIOHS a la SEREMI de Salud      corporativo, posterior al RIOHS
 *   - Carta conductora del RIOHS a la Inspección del Trabajo corporativo, posterior al RIOHS
 *   - Registro de IRL de la faena                          por faena
 *   - Registro de entrega de EPP de la faena               por faena
 *
 * Es contenido firmado del programa y Prevención puede ajustarlo desde el
 * constructor mientras el programa siga en borrador. Por eso este script sólo
 * siembra una carpeta **vacía**: nunca reescribe una que ya declara documentos.
 *
 *   npm run pdtp:apply-legal-folder
 *   PDTP_LEGAL_FOLDER_DRY_RUN=true npm run pdtp:apply-legal-folder
 *   PDTP_LEGAL_FOLDER_ACTOR_USER_ID=<id> npm run pdtp:apply-legal-folder
 *   PDTP_LEGAL_FOLDER_DEPLOY_MODE=true node scripts/apply-pdtp-legal-folder.mjs
 *
 * Va después de `db:apply-sst-taxonomy` (siembra los tipos que la carpeta
 * exige) y de `pdtp:apply-demand-slas`. `PDTP_LEGAL_FOLDER_DEPLOY_MODE` lo
 * vuelve tolerante a que el programa del año todavía no exista, a que no haya
 * administrador que firme o a que el programa ya esté firmado — las mismas
 * condiciones que el resto de los pasos de dato del PDTP.
 */

import { eq, inArray } from "drizzle-orm"
import { db } from "@/db"
import { pdtpActivities, pdtpPrograms, roles, sstDocumentTypes, userRoles } from "@/db/schema"
import {
  isPdtpLegalFolderActivity,
  listPdtpActivityDocumentRequirements,
  setPdtpActivityDocumentRequirements,
  type PdtpDocumentRequirementScope,
} from "@/lib/services/pdtp/document-requirements"
import { assertPdtpProgramEditableState } from "@/lib/services/pdtp/helpers"

const PROGRAM_YEAR = 2026
const DRY_RUN = process.env.PDTP_LEGAL_FOLDER_DRY_RUN === "true"
const DEPLOY_MODE = process.env.PDTP_LEGAL_FOLDER_DEPLOY_MODE === "true"

function bail(reason: string): never {
  if (DEPLOY_MODE) {
    console.warn(`  ⚠ ${reason}`)
    console.warn("    Modo deploy: se omite el paso sin abortar el despliegue.")
    process.exit(0)
  }
  throw new Error(reason)
}

/**
 * Carpeta propuesta. Los tipos se identifican por el id determinista que
 * siembra `seedDefaultDocumentTypes` (`sstdt-<categoría>-<código>`): el código
 * sólo es único dentro de su categoría.
 */
const typeId = (category: string, code: string) => `sstdt-${category}-${code.toLowerCase()}`
const RIOHS = typeId("legal_normativa", "RIOHS")
const LEGAL_FOLDER: Array<{ label: string; typeId: string; scope: PdtpDocumentRequirementScope; mustFollowTypeId?: string }> = [
  { label: "RIOHS", typeId: RIOHS, scope: "corporativo" },
  { label: "RIOHS-SEREMI", typeId: typeId("legal_normativa", "RIOHS-SEREMI"), scope: "corporativo", mustFollowTypeId: RIOHS },
  { label: "RIOHS-DT", typeId: typeId("legal_normativa", "RIOHS-DT"), scope: "corporativo", mustFollowTypeId: RIOHS },
  { label: "IRL-REG", typeId: typeId("capacitacion", "IRL-REG"), scope: "faena" },
  { label: "EPP-REG", typeId: typeId("epp", "EPP-REG"), scope: "faena" },
]

async function resolveActorUserId(): Promise<string> {
  const fromEnv = process.env.PDTP_LEGAL_FOLDER_ACTOR_USER_ID?.trim()
  if (fromEnv) return fromEnv
  const [row] = await db.select({ userId: userRoles.userId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(roles.name, "administrador"))
    .limit(1)
  if (!row) throw new Error("No hay ningún usuario con rol `administrador`. Pasa PDTP_LEGAL_FOLDER_ACTOR_USER_ID explícitamente.")
  return row.userId
}

async function main() {
  const programs = await db.select().from(pdtpPrograms).where(eq(pdtpPrograms.year, PROGRAM_YEAR))
  const ordered = [...programs].sort((a, b) => b.version - a.version)
  // Una v+1 en borrador es donde la carpeta todavía se puede declarar; nunca
  // se prefiere la versión activa y firmada.
  const program = ordered.find((item) => item.status === "draft")
    ?? ordered.find((item) => item.status === "active")
    ?? ordered[0]
  if (!program) bail(`No existe ningún programa PDTP para el año ${PROGRAM_YEAR}.`)

  const actorUserId = await resolveActorUserId().catch((err: unknown) => bail(err instanceof Error ? err.message : String(err)))

  let locked = false
  try {
    assertPdtpProgramEditableState(program)
  } catch {
    locked = true
  }
  const planOnly = DRY_RUN || locked
  const mode = DRY_RUN ? "[DRY RUN]" : locked ? "[SÓLO LECTURA: programa firmado]" : "escribiendo"
  console.log(`Carpeta de requisitos legales del PDTP ${PROGRAM_YEAR} — ${mode}`)
  console.log(`  Programa: ${program.id} (status=${program.status}) · actor=${actorUserId}`)

  const activities = await db.select().from(pdtpActivities).where(eq(pdtpActivities.programId, program.id))
  const folder = activities.find((activity) => activity.status === "active" && isPdtpLegalFolderActivity(activity))
  if (!folder) {
    console.log("  · El programa no tiene la actividad de carpeta (N°19) activa; nada que declarar.")
    process.exit(0)
  }

  const existing = await listPdtpActivityDocumentRequirements([folder.id])
  if (existing.length > 0) {
    console.log(`  · N°${folder.n}: ya declara ${existing.length} documento(s); no se reescribe.`)
    process.exit(0)
  }

  const ids = LEGAL_FOLDER.map((item) => item.typeId)
  const types = await db.select({ id: sstDocumentTypes.id, isActive: sstDocumentTypes.isActive })
    .from(sstDocumentTypes).where(inArray(sstDocumentTypes.id, ids))
  const active = new Set(types.filter((type) => type.isActive).map((type) => type.id))
  const missing = LEGAL_FOLDER.filter((item) => !active.has(item.typeId)).map((item) => item.label)
  if (missing.length > 0) {
    bail(`Faltan tipos documentales activos para la carpeta: ${missing.join(", ")}. Corre antes db:apply-sst-taxonomy.`)
  }

  const requirements = LEGAL_FOLDER.map((item) => ({
    documentTypeId: item.typeId,
    scope: item.scope,
    mustFollowDocumentTypeId: item.mustFollowTypeId ?? null,
  }))
  for (const item of LEGAL_FOLDER) {
    console.log(`  ✓ ${item.label} (${item.scope}${item.mustFollowTypeId ? ", posterior al RIOHS" : ""})`)
  }

  if (locked) {
    bail(
      `El programa ${program.id} ya entró a revisión (status=${program.status}) y su N°${folder.n} no declara carpeta. `
      + "Su contenido está firmado, así que declararla exige una revisión nueva del programa.",
    )
  }
  if (!planOnly) {
    await setPdtpActivityDocumentRequirements({ programId: program.id, activityId: folder.id, requirements, userId: actorUserId })
  }
  console.log(`Resumen: carpeta de la N°${folder.n} ${planOnly ? "por declarar" : "declarada"} con ${requirements.length} documento(s).`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
