import { and, asc, count, desc, eq, inArray, isNull, lt, or } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionInspectionPrograms,
  preventionInspectionTemplates,
  preventionContainers,
  preventionEmergencyResources,
  fuelVehicles,
  pdtpActivities,
  pdtpPrograms,
  preventionRiskEntries,
  sstDocuments,
  sstDocumentVersions,
  roles,
  userRoles,
  users,
  worksites,
  worksiteUsers,
} from "@/db/schema"
import { requireAccess, scopeCondition, type InspectionAccess } from "@/lib/services/prevention-inspections-access"
import { allowedDocumentConfidentialities } from "@/lib/services/prevention-documents/utils"
import { getUserIdsWithPermission, getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"
import { assessEnrichmentCoverage } from "@/lib/prevention/inspections"
import { containerLabel } from "@/lib/prevention/containers"
import { defaultInspectionKindFor } from "@/lib/prevention/inspection-wiring"
import { CHECKLIST_DEFINITIONS, isNonInspectionDefinition, isPersonEvaluationDefinition } from "@/lib/sst/definitions"
import { officialInspectionSourceFor } from "@/lib/sst/official-inspection-sources"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { vehicleLabel } from "@/lib/services/fleet"
import { todayInChile } from "@/lib/utils"
import { pdtpActivityCandidatesFor } from "@/lib/services/pdtp-adapters/inspection-templates-2026"
import { type InspectionKindFilter, kindCondition } from "./queries"
import { itemsFromDefinition, contentHashOf, inspectionDefinitionNeedsOfficialSource } from "./templates"

export async function listInspectionTemplates(access: InspectionAccess, filter: InspectionKindFilter = {}) {
  requireAccess(access, "prevention:inspections:view")
  const templates = await db.select().from(preventionInspectionTemplates)
    .where(kindCondition(filter))
    .orderBy(asc(preventionInspectionTemplates.code), desc(preventionInspectionTemplates.createdAt))
  // Se expone la calibración real de cada plantilla: una sin daño potencial
  // declarado produce hallazgos siempre medios y no bloquea ningún cierre.
  //
  // A-03: además se compara el snapshot congelado contra la definición que hoy
  // vive en `lib/sst/definitions`. El `contentHash` se calculaba al importar y
  // nunca se leía, así que nada avisaba cuándo el catálogo en código se había
  // adelantado a la plantilla aprobada — que es justo la señal que dice cuándo
  // toca publicar una versión nueva.
  return templates.map((template) => {
    const source = template.sourceDefinitionCode ? CHECKLIST_DEFINITIONS[template.sourceDefinitionCode] : undefined
    return {
      ...template,
      coverage: assessEnrichmentCoverage(itemsFromDefinition(template.definitionSnapshot as unknown as ChecklistDefinition)),
      /** La definición de origen ya no existe en el catálogo en código. */
      definitionMissing: Boolean(template.sourceDefinitionCode) && !source,
      /** El contenido en código difiere del snapshot aprobado. No implica que el checklist cambie de fondo: reordenar propiedades también deriva. */
      definitionDrifted: Boolean(source) && contentHashOf(source!) !== template.contentHash,
    }
  })
}

/**
 * Versiones aprobadas/vigentes de la Biblioteca SST elegibles como fuente.
 *
 * El único filtro era el estado de la versión: con `inspections:manage` bastaba
 * para leer título, nombre de archivo y checksum de documentos `restringido` y
 * `sensible` de faenas fuera del alcance. El binario sí estaba protegido en la
 * ruta de descarga; la metadata no, y un nombre de archivo ya dice de qué trata.
 * Se aplica el mismo par de condiciones que `searchDocuments`: confidencialidad
 * por permiso y alcance de faena **dejando pasar los corporativos**
 * (`worksiteId IS NULL`), que es donde viven los anexos del SGI.
 */
export async function listInspectionDocumentSources(access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:manage")
  if (access.scope.mode === "none") return []

  const conditions = [
    inArray(sstDocumentVersions.status, ["aprobado", "vigente"]),
    inArray(sstDocuments.confidentiality, allowedDocumentConfidentialities(access.permissions)),
    access.scope.mode === "some"
      ? or(inArray(sstDocuments.worksiteId, access.scope.ids), isNull(sstDocuments.worksiteId))
      : undefined,
  ]

  return db.select({
    id: sstDocumentVersions.id,
    documentId: sstDocuments.id,
    documentCode: sstDocuments.internalCode,
    documentTitle: sstDocuments.title,
    fileName: sstDocumentVersions.fileName,
    checksumSha256: sstDocumentVersions.checksum,
    status: sstDocumentVersions.status,
    effectiveFrom: sstDocumentVersions.effectiveFrom,
  }).from(sstDocumentVersions)
    .innerJoin(sstDocuments, eq(sstDocuments.id, sstDocumentVersions.documentId))
    .where(and(...conditions))
    .orderBy(asc(sstDocuments.internalCode), desc(sstDocumentVersions.version))
}

export async function listInspectionPrograms(access: InspectionAccess, filter: InspectionKindFilter = {}) {
  requireAccess(access, "prevention:inspections:view")
  const rows = await db.select({
    program: preventionInspectionPrograms,
    templateName: preventionInspectionTemplates.name,
    // I-04: sin esto un programa apuntando a una plantilla `superseded` se
    // veía "Activa: Sí" con botón operativo, aunque el materializador ya la
    // salta. El join contra la plantilla ya existía para el nombre.
    templateStatus: preventionInspectionTemplates.status,
    /* La plantilla decide si el programa exige contenedor del catálogo: el
     * formulario de edición lo necesita para no dejar quitarle el sujeto. */
    templateDefinitionCode: preventionInspectionTemplates.sourceDefinitionCode,
    worksiteName: worksites.name,
    assigneeName: users.name,
    riskHazardCode: preventionRiskEntries.hazardCode,
    riskHazard: preventionRiskEntries.hazard,
    // Piezas del sujeto concreto (recurso, equipo o contenedor). Se arman en
    // `subjectLabel` abajo y no salen del servicio: la pantalla sólo necesita el
    // nombre ya compuesto.
    resourceName: preventionEmergencyResources.name,
    vehiclePlate: fuelVehicles.plate,
    vehicleCode: fuelVehicles.code,
    containerCode: preventionContainers.code,
    containerLocation: preventionContainers.location,
  })
    .from(preventionInspectionPrograms)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionPrograms.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionPrograms.worksiteId, worksites.id))
    .leftJoin(users, eq(preventionInspectionPrograms.assignedToUserId, users.id))
    .leftJoin(preventionRiskEntries, eq(preventionInspectionPrograms.riskEntryId, preventionRiskEntries.id))
    .leftJoin(preventionEmergencyResources, eq(preventionInspectionPrograms.subjectResourceId, preventionEmergencyResources.id))
    .leftJoin(fuelVehicles, eq(preventionInspectionPrograms.subjectVehicleId, fuelVehicles.id))
    .leftJoin(preventionContainers, eq(preventionInspectionPrograms.subjectContainerId, preventionContainers.id))
    .where(and(scopeCondition(access.scope, preventionInspectionPrograms.worksiteId), kindCondition(filter)))
    .orderBy(asc(preventionInspectionPrograms.nextDueOn))

  // El programa guarda el id del sujeto, no su nombre: sin esto la pantalla
  // mostraba «No especificado» aunque se hubiera elegido uno del inventario.
  // Misma precedencia y mismo formato que `resolveSubject`, que es quien fija
  // la etiqueta de las ejecuciones que este programa genera.
  return rows.map(({ resourceName, vehiclePlate, vehicleCode, containerCode, containerLocation, ...row }) => ({
    ...row,
    subjectLabel: resourceName
      ?? (vehiclePlate ? vehicleLabel({ plate: vehiclePlate, code: vehicleCode }) : null)
      ?? (containerCode ? containerLabel({ code: containerCode, location: containerLocation }) : null),
  }))
}

/**
 * Cuántas programaciones están vencidas: activas, con plantilla aprobada y su
 * próxima fecha ya pasada. Es el mismo criterio que `inspectionProgramIsOverdue`
 * (la regla de un solo lugar que usan el badge, el filtro y la celda de
 * Programación), pero contado en SQL: la bandeja sólo necesita la cifra del aviso
 * y traer todas las programaciones —con cinco joins cada una— para contarlas en
 * memoria era el costo de una cifra. `today` es el día civil de Chile
 * (`todayInChile()`); se recibe para poder fijarlo en una prueba.
 */
export async function countOverdueInspectionPrograms(
  access: InspectionAccess,
  filter: InspectionKindFilter = {},
  today: string = todayInChile(),
): Promise<number> {
  requireAccess(access, "prevention:inspections:view")
  const [row] = await db.select({ value: count() })
    .from(preventionInspectionPrograms)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionPrograms.templateId, preventionInspectionTemplates.id))
    .where(and(
      scopeCondition(access.scope, preventionInspectionPrograms.worksiteId),
      kindCondition(filter),
      eq(preventionInspectionPrograms.isActive, true),
      eq(preventionInspectionTemplates.status, "approved"),
      lt(preventionInspectionPrograms.nextDueOn, today),
    ))
  return row?.value ?? 0
}

/** Faenas visibles para el alcance, para poblar la programación y la alta de ejecución. */
export async function listInspectionWorksites(access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view")
  if (access.scope.mode === "none") return []
  return db.select({ id: worksites.id, name: worksites.name })
    .from(worksites)
    .where(and(
      eq(worksites.isActive, true),
      access.scope.mode === "some" ? inArray(worksites.id, access.scope.ids) : undefined,
    ))
    .orderBy(asc(worksites.name))
}

/**
 * Quien puede ejecutar una inspección: población de `assignedToUserId` en
 * programa/ejecución y de `responsibleUserId` al derivar un hallazgo a CAPA,
 * porque quien ejecuta en terreno es quien razonablemente corrige.
 */
export type InspectionAssignee = {
  id: string
  name: string
  worksiteIds: string[]
  isFaenaPreventionist: boolean
  isGlobalPreventionist: boolean
}

export async function listInspectionAssignees(access: InspectionAccess): Promise<InspectionAssignee[]> {
  requireAccess(access, "prevention:inspections:view")
  const ids = await getUserIdsWithPermission("prevention:inspections:execute")
  if (ids.length === 0) return []

  const [userRows, worksiteRows, roleRows] = await Promise.all([
    db.select({ id: users.id, name: users.name })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.isActive, true)))
      .orderBy(asc(users.name)),
    db.select({ userId: worksiteUsers.userId, worksiteId: worksiteUsers.worksiteId })
      .from(worksiteUsers)
      .where(inArray(worksiteUsers.userId, ids)),
    db.select({ userId: userRoles.userId, roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(inArray(userRoles.userId, ids)),
  ])

  const worksiteMap = new Map<string, string[]>()
  for (const row of worksiteRows) {
    const list = worksiteMap.get(row.userId) ?? []
    list.push(row.worksiteId)
    worksiteMap.set(row.userId, list)
  }

  const roleMap = new Map<string, Set<string>>()
  for (const row of roleRows) {
    const set = roleMap.get(row.userId) ?? new Set<string>()
    set.add(row.roleName)
    roleMap.set(row.userId, set)
  }

  return userRows.map((u) => {
    const userRoleSet = roleMap.get(u.id) ?? new Set<string>()
    return {
      id: u.id,
      name: u.name,
      worksiteIds: worksiteMap.get(u.id) ?? [],
      isFaenaPreventionist: userRoleSet.has("prevencionista_faena"),
      isGlobalPreventionist: userRoleSet.has("prevencionista"),
    }
  })
}

/**
 * Quién puede cerrar esta inspección en esta faena (I-08, auditoría UI/UX
 * 2026-08-25).
 *
 * Misma lista que ya resuelve `notifySafely("pendiente de revisión")` al
 * completar — se expone para lectura porque la pantalla que bloquea el cierre
 * ("Tú ejecutaste esta inspección…") nombraba el problema sin decir a quién
 * pedirle la revisión. Que la pantalla y la notificación automática lean la
 * MISMA función evita que se contradigan.
 */
export async function listInspectionReviewers(access: InspectionAccess, worksiteId: string) {
  requireAccess(access, "prevention:inspections:view", worksiteId)
  const ids = (await getUserIdsWithPermissionForWorksite("prevention:inspections:review", worksiteId))
    .filter((userId) => userId !== access.userId)
  if (ids.length === 0) return []
  return db.select({ id: users.id, name: users.name })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.isActive, true)))
    .orderBy(asc(users.name))
}

/** Actividades del PDTP vigente para elegir por número y nombre, sin pedirle
 * al prevencionista que memorice o transcriba números sueltos. */
export async function listInspectionPdtpActivityOptions(access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view")
  const rows = await db.select({
    n: pdtpActivities.n,
    name: pdtpActivities.activity,
    year: pdtpPrograms.year,
  }).from(pdtpActivities)
    .innerJoin(pdtpPrograms, eq(pdtpPrograms.id, pdtpActivities.programId))
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpActivities.status, "active")))
    .orderBy(desc(pdtpPrograms.year), asc(pdtpActivities.n))
  // PREV-C03.6: en diciembre-enero conviven dos programas activos (el año que
  // se cierra y el nuevo). La plantilla declara números, no años, así que cada
  // número se ofrece una sola vez, con el nombre del programa más reciente.
  const seen = new Set<number>()
  return rows.filter((row) => {
    if (seen.has(row.n)) return false
    seen.add(row.n)
    return true
  })
}

/** Catálogo de definiciones SST disponibles para incorporar como plantilla. */
export function listImportableDefinitions() {
  return Object.entries(CHECKLIST_DEFINITIONS)
    .flatMap(([code, definition]) => isPersonEvaluationDefinition(code) || isNonInspectionDefinition(code)
      ? []
      : [{
          code,
          title: definition.title,
          version: definition.version,
          sections: definition.sections.length,
          items: definition.sections.reduce((total, section) => total + section.items.length, 0),
          coverage: assessEnrichmentCoverage(itemsFromDefinition(definition)),
          // Actividades del PDTP que acreditará. El diálogo las muestra antes
          // de incorporar: es lo único que distingue una plantilla que alimenta
          // el programa anual de una que no.
          pdtpActivities: pdtpActivityCandidatesFor(code),
          // Tipo con que debe nacer (una auditoría ya no entra como inspección).
          defaultKind: defaultInspectionKindFor(code),
          // Si transcribe un anexo oficial, la fuente documental es obligatoria
          // para poder aprobarla; el diálogo lo dice antes de incorporar.
          needsOfficialSource: inspectionDefinitionNeedsOfficialSource(code),
          // Checksum del archivo oficial, para preseleccionar en la Biblioteca
          // la versión que coincide. `null` si el anexo no tiene uno conocido.
          officialChecksumSha256: officialInspectionSourceFor(code)?.sha256 ?? null,
        }])
}
