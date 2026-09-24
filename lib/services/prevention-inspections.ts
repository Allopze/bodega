import { createHash } from "node:crypto"
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm"
import { z } from "zod"
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core"
import { db, type Tx } from "@/db"
import {
  preventionCapaActions,
  preventionInspectionAnswerEvidence,
  preventionInspectionAnswers,
  preventionInspectionFindings,
  preventionInspectionFindingEvidence,
  preventionInspectionPrograms,
  preventionInspectionRunDocuments,
  preventionInspectionRunParticipants,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  preventionContainers,
  preventionEmergencyResources,
  fuelVehicles,
  pdtpActivities,
  pdtpPrograms,
  preventionRiskEntries,
  preventionRiskMatrices,
  sstDocuments,
  sstDocumentVersions,
  roles,
  userRoles,
  users,
  worksites,
  worksiteUsers,
} from "@/db/schema"
import {
  history,
  isUniqueViolation,
  NOT_FOUND,
  nowIso,
  requireAccess,
  scopeAllows,
  scopeCondition,
  type Client,
  type InspectionAccess,
} from "@/lib/services/prevention-inspections-access"
import { allowedDocumentConfidentialities } from "@/lib/services/prevention-documents/utils"
import { nanoid } from "@/lib/id"
import { containerLabel } from "@/lib/prevention/containers"
import { listContainersByWorksite, listContainersForWorksite } from "@/lib/services/prevention-containers"
import { recordOperationalActivity } from "@/lib/services/operational-activity"
import { getUserIdsWithPermission, getUserIdsWithPermissionForWorksite } from "@/lib/services/notification-targeting"
import { createNotifications } from "@/lib/services/notifications"
import { logger } from "@/lib/logger"
import {
  addDays,
  assertInspectionRunTransition,
  assessEnrichmentCoverage,
  assessRunCompletion,
  capaPriorityForCriticality,
  closingActFromDefinition,
  criticalityFromDanoPotencial,
  deriveFindings,
  nextDueAfter,
  requiresCapa,
  requiresHumanConfirmation,
  summarizeCompliance,
  summarizeTimelyClosure,
  validateAnswerRow,
  FREQUENCY_INTERVAL_DAYS,
  TRANSITION_REASON_MIN_LENGTH,
  type InspectionRunStatus,
  type InspectionAnswerInput,
  type InspectionItemSpec,
} from "@/lib/prevention/inspections"
import {
  findOfferedDeviation,
  listOfferedDeviations,
} from "@/lib/services/prevention-deviations"
import { listWorksiteVehicles, setVehicleOperationalStatus, vehicleLabel } from "@/lib/services/fleet"
import { createMaintenanceRecordWithClient } from "@/lib/services/maintenance"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import { CHECKLIST_DEFINITIONS, isNonInspectionDefinition, isPersonEvaluationDefinition } from "@/lib/sst/definitions"
import { officialInspectionSourceFor } from "@/lib/sst/official-inspection-sources"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { onInspectionCompleted, onInspectionReverted } from "@/lib/services/pdtp-adapters/pdtp-accreditation-connectors"
import { replacePdtpAccreditationBindings, resolvePdtpAccreditationTarget } from "@/lib/services/pdtp/accreditation-bindings"
import { defaultPdtpActivityNumbers, defaultPdtpReviewActivityNumbers, inspectionTemplateCodeFor, pdtpActivityCandidatesFor } from "@/lib/services/pdtp-adapters/inspection-templates-2026"
import { codeYear, formatDate, todayInChile } from "@/lib/utils"
import { assertRouteModuleEnabled } from "@/lib/services/module-toggles"
import { enqueueGeneratedDocumentTx } from "@/lib/services/generated-documents/enqueue"


/**
 * Toggle del submódulo. Inspecciones, observaciones y auditorías del SGSST
 * viven en una sola ruta desde que se fusionaron (2026-08-21), así que basta
 * la ruta del motor.
 *
 * Antes esto resolvía el `kind` persistido con siete joins —plantilla,
 * programa, run, hallazgo, respuesta, documento, evidencia— porque
 * `/prevencion/auditorias` tenía su propio toggle y había que impedir operar
 * una auditoría desde la ruta hermana cuando el suyo estaba apagado. Con un
 * único owner esa distinción no existe: el toggle que valía era el de la ruta.
 */
export type { InspectionAccess }

export async function assertInspectionOperationEnabled(): Promise<void> {
  await assertRouteModuleEnabled("/prevencion/inspecciones")
}


/* ── Plantillas ───────────────────────────────────────────────────────────── */

const importTemplateSchema = z.object({
  definitionCode: z.string().min(1),
  kind: z.enum(["inspection", "observation", "audit"]).default("inspection"),
  versionLabel: z.string().trim().min(1).max(80).optional(),
  /**
   * Actividades del PDTP (campo `n`) que esta plantilla acredita al completar
   * un run. Sin esto el conector `onInspectionCompleted` es un no-op y la
   * inspección nunca llega al programa anual — que era el estado de todas las
   * plantillas hasta 2026-08-04.
   */
  pdtpActivityNumbers: z.array(z.number().int().positive()).max(20).optional(),
  /** Actividades que acredita al revisarse (la firma del supervisor, no la ejecución). */
  pdtpReviewActivityNumbers: z.array(z.number().int().positive()).max(20).optional(),
  sourceDocumentVersionId: z.string().min(1).optional(),
  sourceRevision: z.string().trim().max(120).nullable().optional(),
  parityReport: z.object({
    status: z.enum(["pending", "passed", "failed"]),
    expectedItems: z.number().int().nonnegative().nullable(),
    actualItems: z.number().int().nonnegative().nullable(),
    differences: z.array(z.string().trim().min(1).max(500)).max(200),
  }).optional(),
})

/**
 * Aplana la definición de checklist a la especificación que consume el motor.
 * `countsForCompliance` respeta la sección, igual que el cálculo del PDTP.
 */
export function itemsFromDefinition(definition: ChecklistDefinition): InspectionItemSpec[] {
  const items: InspectionItemSpec[] = []
  // Piso de seguridad: un `definitionSnapshot` sin `sections` (fixture de
  // prueba insertado a mano, o un futuro snapshot legado incompleto) no debe
  // reventar el listado entero de plantillas — sólo esa plantilla queda sin
  // ítems calculables. `importInspectionTemplate` siempre guarda una
  // definición real, así que esto es defensa, no el camino esperado.
  if (!Array.isArray(definition.sections)) return items
  for (const section of definition.sections) {
    for (const item of section.items) {
      items.push({
        sectionId: section.id,
        itemId: item.id,
        label: item.label,
        required: item.required ?? false,
        countsForCompliance: section.countsForCompliance ?? true,
        danoPotencial: item.danoPotencial ?? null,
        // H-04 (AUDITORIA_BUGS_2026-08-05.md): antes se descartaba acá, y el
        // motor perdía la escala B/R/M del ítem sin poder ofrecer 'partial'.
        kind: item.kind,
        // B-08: sin estos, la UI no puede pintar un `select` ni orientar un
        // campo de texto — y esos ítems quedaban sin forma de responderse.
        options: item.options,
        placeholder: item.placeholder,
        matrix: item.matrix,
      })
    }
  }
  return items
}

/**
 * Hash del contenido del cuestionario. Fuente única: `importInspectionTemplate`
 * lo calcula al congelar el snapshot y `listInspectionTemplates` lo recalcula
 * para detectar deriva. Si las dos expresiones divergieran, toda plantilla
 * aparecería derivada (A-03, auditoría 2026-08-18).
 */
export function contentHashOf(definition: ChecklistDefinition | Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(definition)).digest("hex")
}


/**
 * Retira la versión vigente anterior del mismo código. La usan las dos puertas
 * que publican: incorporar (el camino normal) y aprobar un borrador heredado.
 */
async function supersedePreviousApproved(tx: Tx, args: { code: string; keepTemplateId: string; now: string }) {
  await tx.update(preventionInspectionTemplates).set({
    status: "superseded",
    supersededAt: args.now,
    supersededByTemplateId: args.keepTemplateId,
    version: sql`${preventionInspectionTemplates.version} + 1`,
    updatedAt: args.now,
  }).where(and(
    eq(preventionInspectionTemplates.code, args.code),
    eq(preventionInspectionTemplates.status, "approved"),
    ne(preventionInspectionTemplates.id, args.keepTemplateId),
  ))
}

/**
 * Incorpora una definición SST existente como plantilla del motor transversal.
 * Las evaluaciones de personas quedan fuera a propósito: la auditoría pide no
 * mezclar inspecciones de activos con evaluación de trabajadores.
 *
 * Nace en **borrador** (`draft`): incorporar y habilitar son dos actos
 * distintos, y el segundo deja constancia de quién puso el instrumento en uso
 * (`approveInspectionTemplate`). La versión vigente anterior NO se retira acá
 * — hacerlo sacaría de circulación el instrumento en uso por un borrador que
 * quizás nadie apruebe, y la faena se quedaría sin con qué inspeccionar.
 *
 * Reimportar un código ya incorporado sigue siendo el camino para versionar.
 * Lo único que no se admite es repetir la misma `versionLabel` (A-02/C-10).
 */
export async function importInspectionTemplate(input: unknown, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:manage")
  const data = importTemplateSchema.parse(input)

  if (isPersonEvaluationDefinition(data.definitionCode)) {
    throw new Error("Las evaluaciones de personas no se incorporan al motor de inspecciones.")
  }
  // Se comprueba acá y no sólo al listar: el código de la definición llega por
  // la acción, así que filtrar únicamente el catálogo dejaría la puerta abierta.
  if (isNonInspectionDefinition(data.definitionCode)) {
    throw new Error("Este formulario no es un instrumento del motor de inspecciones.")
  }
  const definition = CHECKLIST_DEFINITIONS[data.definitionCode]
  if (!definition) throw new Error("La definición de checklist no existe en el catálogo.")

  // C-05: el motor aplana las secciones e ignora `appliesWhen` (visibilidad por
  // cargo) y `requiresPermission` (gate de acceso). Aceptar en silencio una
  // definición que los declare exigiría responder secciones que no aplican y
  // expondría las restringidas. Ninguna de las definiciones importables los usa
  // hoy, así que esto es preventivo: sólo salta si alguien agrega una.
  const gated = (definition.sections ?? []).find((section) => section.appliesWhen?.length || section.requiresPermission)
  if (gated) {
    throw new Error(`La sección "${gated.title}" declara visibilidad condicional, que el motor de inspecciones no aplica. No puede incorporarse.`)
  }

  const versionLabel = data.versionLabel ?? definition.version
  // La plantilla llega cableada al programa anual: qué actividad acredita cada
  // definición ya lo declara `PDTP_2026_INSPECTION_SPECS`, la misma fuente que
  // usa el sembrado. Antes el diálogo del catálogo no mandaba nada y toda
  // plantilla incorporada a mano nacía sin acreditar, así que la inspección se
  // ejecutaba y el PDTP seguía mostrando la actividad pendiente. Lo explícito
  // manda: un `[]` deliberado sigue significando "no acredita".
  const pdtpActivityNumbers = data.pdtpActivityNumbers ?? defaultPdtpActivityNumbers(data.definitionCode)
  const pdtpReviewActivityNumbers = data.pdtpReviewActivityNumbers ?? defaultPdtpReviewActivityNumbers(data.definitionCode)
  const snapshot = definition as unknown as Record<string, unknown>
  const contentHash = contentHashOf(snapshot)
  const officialSource = officialInspectionSourceFor(data.definitionCode)
  const needsOfficialSource = Boolean(officialSource) || data.definitionCode === "reporte_equipos"

  try {
    return await db.transaction(async (tx) => {
      let sourceSnapshot: {
        documentId: string
        versionId: string
        fileName: string
        revision: string | null
        effectiveFrom: string | null
        checksumSha256: string
      } | null = null
      if (data.sourceDocumentVersionId) {
        const [source] = await tx.select({ version: sstDocumentVersions, document: sstDocuments })
          .from(sstDocumentVersions)
          .innerJoin(sstDocuments, eq(sstDocuments.id, sstDocumentVersions.documentId))
          .where(eq(sstDocumentVersions.id, data.sourceDocumentVersionId)).limit(1)
        if (!source || !["aprobado", "vigente"].includes(source.version.status)) {
          throw new Error("La fuente documental debe existir y estar aprobada o vigente.")
        }
        if (officialSource && source.version.checksum !== officialSource.sha256) {
          throw new Error("El archivo seleccionado no coincide con el checksum de la fuente oficial SGI.")
        }
        sourceSnapshot = {
          documentId: source.document.id,
          versionId: source.version.id,
          fileName: source.version.fileName,
          revision: data.sourceRevision ?? officialSource?.revision ?? null,
          effectiveFrom: source.version.effectiveFrom ?? officialSource?.effectiveDate ?? null,
          checksumSha256: source.version.checksum,
        }
      }
      const parityReport = {
        status: data.parityReport?.status ?? (needsOfficialSource ? "pending" : "passed"),
        verifiedAt: data.parityReport?.status === "passed" ? nowIso() : null,
        verifiedByUserId: data.parityReport?.status === "passed" ? access.userId : null,
        expectedItems: data.parityReport?.expectedItems ?? null,
        actualItems: data.parityReport?.actualItems ?? null,
        differences: data.parityReport?.differences ?? [],
      } as const
      const [created] = await tx.insert(preventionInspectionTemplates).values({
        id: `instpl-${nanoid()}`,
        // I-03: dos filas que comparten definición (EPP JT/PRF) son dos
        // instrumentos, no dos versiones — desempatado por la actividad PDTP
        // elegida (el diálogo ya obliga a elegirla cuando es ambigua).
        code: inspectionTemplateCodeFor(data.definitionCode, pdtpActivityNumbers),
        versionLabel,
        name: definition.title,
        kind: data.kind,
        sourceDefinitionCode: data.definitionCode,
        provenanceKind: needsOfficialSource ? "official_document" : "platform_definition",
        sourceDocumentVersionId: data.sourceDocumentVersionId ?? null,
        sourceSnapshot,
        parityReport,
        definitionSnapshot: snapshot,
        contentHash,
        // Nace en borrador: incorporar y habilitar son dos actos distintos, y
        // el segundo deja constancia de quién puso el instrumento en uso.
        status: "draft",
        legalFramework: definition.legalFramework?.join(" · ") ?? null,
        pdtpActivityNumbers: pdtpActivityNumbers.length ? pdtpActivityNumbers : null,
        pdtpReviewActivityNumbers: pdtpReviewActivityNumbers.length ? pdtpReviewActivityNumbers : null,
        authorUserId: access.userId,
      }).returning()
      if (!created) throw new Error("No se pudo incorporar la plantilla.")

      // El reemplazo de la versión vigente lo hace ahora `approveInspectionTemplate`,
      // no esto: desde que incorporar deja un borrador, jubilar acá a la que
      // está en uso la sacaría de circulación por un borrador que quizás nadie
      // apruebe, y la faena se quedaría sin instrumento.
      await history(tx, { entityType: "template", entityId: created.id, changeType: "imported", reason: `Definición ${data.definitionCode} incorporada como borrador ${versionLabel}`, afterState: created, actorUserId: access.userId })
      return created
    })
  } catch (error) {
    // C-10: sin esto el usuario veía el texto crudo de Postgres
    // ("duplicate key value violates unique constraint …").
    if (isUniqueViolation(error, "prevention_inspection_template_version_unique")) {
      throw new Error(`Ya existe la versión "${versionLabel}" de la plantilla ${definition.code}. Usa otra etiqueta de versión.`)
    }
    throw error
  }
}

/**
 * Declara qué actividades del PDTP acredita la plantilla. Editable mientras la
 * plantilla esté vigente; una reemplazada ya no acredita nada.
 *
 * No toca `contentHash` a propósito — el hash cubre el cuestionario
 * (`definitionSnapshot`), no el cableado al programa anual. Cambiar a qué
 * actividad acredita no altera la evidencia de lo que se preguntó, así que se
 * admite también sobre una plantilla ya vigente.
 */
/** Qué quedó cableado en un eje: identidades si se declararon, o los números. */
function describeWiring(label: string, catalogIds: string[] | undefined, numbers: number[] | null): string | null {
  if (catalogIds) return catalogIds.length > 0 ? `${label}: ${catalogIds.join(", ")}` : null
  return numbers ? `${label}: ${numbers.join(", ")}` : null
}

export async function setInspectionTemplatePdtpActivities(input: unknown, access: InspectionAccess) {
  const data = z.object({
    templateId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    pdtpActivityNumbers: z.array(z.number().int().positive()).max(20),
    /** Omitirlo conserva las que ya declaraba: el diálogo puede mandar sólo un conjunto. */
    pdtpReviewActivityNumbers: z.array(z.number().int().positive()).max(20).optional(),
    catalogActivityIds: z.array(z.string().min(1)).max(20).optional(),
    reviewCatalogActivityIds: z.array(z.string().min(1)).max(20).optional(),
  }).parse(input)
  requireAccess(access, "prevention:inspections:manage")

  return db.transaction(async (tx) => {
    const [template] = await tx.select().from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
    if (!template) throw new Error(NOT_FOUND)
    if (template.version !== data.expectedVersion) throw new Error("La plantilla cambió mientras la editabas. Recarga y reintenta.")
    if (template.status === "superseded") throw new Error("Una plantilla reemplazada ya no puede cambiar sus actividades PDTP.")

    const now = nowIso()
    const normalize = (values: number[] | undefined) =>
      values && values.length > 0 ? [...new Set(values)].sort((a, b) => a - b) : null
    const keep = (current: unknown) => Array.isArray(current) ? current as number[] : null
    /*
     * Cuando el llamador cablea identidades de catálogo, los números dejan de
     * ser configuración y quedan como snapshot histórico: es la única red si
     * el código se revierte antes del segundo despliegue, porque
     * `resolvePdtpAccreditationTarget` cae a los números justamente cuando la
     * fuente no tiene binding. Una selección vacía sí los apaga — conservarlos
     * ahí reviviría por el fallback una acreditación que el usuario destildó.
     */
    const declared = (catalogIds: string[] | undefined, current: unknown, values: number[] | undefined) =>
      catalogIds && catalogIds.length > 0 ? keep(current) : normalize(values)
    const numbers = declared(data.catalogActivityIds, template.pdtpActivityNumbers, data.pdtpActivityNumbers)
    const reviewNumbers = data.pdtpReviewActivityNumbers === undefined
      ? keep(template.pdtpReviewActivityNumbers)
      : declared(data.reviewCatalogActivityIds, template.pdtpReviewActivityNumbers, data.pdtpReviewActivityNumbers)
    const [updated] = await tx.update(preventionInspectionTemplates).set({
      pdtpActivityNumbers: numbers,
      pdtpReviewActivityNumbers: reviewNumbers,
      version: template.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionTemplates.id, template.id),
      eq(preventionInspectionTemplates.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La plantilla cambió mientras la editabas. Recarga y reintenta.")
    if (data.catalogActivityIds) await replacePdtpAccreditationBindings({ sourceType: "inspeccion", sourceId: template.id, eventType: "execute", catalogActivityIds: data.catalogActivityIds, updatedByUserId: access.userId }, tx)
    if (data.reviewCatalogActivityIds) await replacePdtpAccreditationBindings({ sourceType: "inspeccion", sourceId: template.id, eventType: "review", catalogActivityIds: data.reviewCatalogActivityIds, updatedByUserId: access.userId }, tx)
    await history(tx, {
      entityType: "template", entityId: template.id, changeType: "pdtp_activities_set",
      // El historial nombra lo que se cableó en este cambio. Repetir el
      // snapshot numérico conservado haría creer que el número fue la decisión.
      reason: [
        describeWiring("Acredita al ejecutar", data.catalogActivityIds, numbers) ?? "Sin acreditación al ejecutar",
        describeWiring("al revisar", data.reviewCatalogActivityIds, reviewNumbers),
      ].filter(Boolean).join(" · "),
      beforeState: template, afterState: updated, actorUserId: access.userId,
    })
    return updated
  })
}

/**
 * Declara el resultado de contrastar la definición digital con la planilla
 * oficial que transcribe.
 *
 * El `parityReport` sólo se escribía en el INSERT de `importInspectionTemplate`,
 * y el diálogo únicamente sabía producir `passed` con `differences: []` —
 * comparando la definición consigo misma—. Una plantilla `official_document`
 * incorporada sin marcar la casilla nacía en `pending`, y como
 * `approveInspectionTemplate` rechaza todo lo que no sea `passed`, quedaba
 * inaprobable para siempre: el único remedio era reimportarla con otra etiqueta
 * de versión. `failed` y `differences` eran, además, código muerto: ninguna ruta
 * de la aplicación podía producirlos.
 *
 * Con segregación respecto de quien incorporó, y esto se aparta a propósito de
 * `approveInspectionTemplate`, que documenta por qué ahí no la hay. La
 * diferencia es lo que cada acto afirma. Aprobar una plantilla del catálogo
 * avala una copia literal de algo ya revisado en el repositorio: un segundo par
 * de ojos no revisaba nada y dejaba el instrumento inservible donde el Jefe de
 * Prevención es quien lo instala. Declarar paridad es un juicio: alguien afirma
 * que la transcripción digital coincide con el papel, ítem por ítem. Que lo
 * afirme la misma persona que la incorporó es el control revisándose a sí mismo.
 */
export async function setInspectionTemplateParity(input: unknown, access: InspectionAccess) {
  const data = z.object({
    templateId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    status: z.enum(["passed", "failed"]),
    expectedItems: z.number().int().nonnegative().nullable().default(null),
    actualItems: z.number().int().nonnegative().nullable().default(null),
    differences: z.array(z.string().trim().min(1).max(500)).max(200).default([]),
    reason: z.string().trim().min(TRANSITION_REASON_MIN_LENGTH).max(3000),
  }).parse(input)
  requireAccess(access, "prevention:inspections:approve")

  // Coherente con lo que exige la aprobación: "sin diferencias" no es una
  // opinión, es la ausencia de la lista.
  if (data.status === "passed" && data.differences.length > 0) {
    throw new Error("Una paridad aprobada no puede declarar diferencias. Resuélvelas o declárala con diferencias.")
  }
  if (data.status === "failed" && data.differences.length === 0) {
    throw new Error("Declarar diferencias exige enumerarlas: es lo que leerá quien decida si el instrumento sirve.")
  }

  return db.transaction(async (tx) => {
    const [template] = await tx.select().from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
    if (!template) throw new Error(NOT_FOUND)
    if (template.version !== data.expectedVersion) {
      throw new Error("La plantilla cambió mientras la revisabas. Recarga y reintenta.")
    }
    if (template.provenanceKind !== "official_document") {
      throw new Error("Sólo una plantilla con fuente documental oficial declara paridad.")
    }
    // Una vez vigente, la paridad quedó sellada: contrastarla de nuevo implica
    // una versión nueva del instrumento, no editar la que ya está en uso.
    if (template.status !== "draft") {
      throw new Error("Sólo puede declararse la paridad de una plantilla en borrador.")
    }
    if (!template.sourceDocumentVersionId || !template.sourceSnapshot) {
      throw new Error("La plantilla no tiene una versión documental vinculada contra la cual contrastar.")
    }
    if (template.authorUserId === access.userId) {
      throw new Error("La paridad la declara alguien distinto de quien incorporó la plantilla: contrastar la transcripción con el papel es el control, y no se revisa a sí mismo.")
    }

    // Misma verificación de integridad que la aprobación: declarar paridad
    // contra un archivo que ya cambió no prueba nada.
    const [source] = await tx.select({ status: sstDocumentVersions.status, checksum: sstDocumentVersions.checksum })
      .from(sstDocumentVersions).where(eq(sstDocumentVersions.id, template.sourceDocumentVersionId)).limit(1)
    const snapshot = template.sourceSnapshot as { checksumSha256?: string }
    if (!source || !["aprobado", "vigente"].includes(source.status) || source.checksum !== snapshot.checksumSha256) {
      throw new Error("La versión documental vinculada ya no está vigente o cambió su integridad.")
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionInspectionTemplates).set({
      parityReport: {
        status: data.status,
        verifiedAt: now,
        verifiedByUserId: access.userId,
        expectedItems: data.expectedItems,
        actualItems: data.actualItems,
        differences: data.differences,
      },
      version: template.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionTemplates.id, template.id),
      eq(preventionInspectionTemplates.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La plantilla cambió mientras la revisabas. Recarga y reintenta.")

    await history(tx, {
      entityType: "template", entityId: template.id, changeType: "parity_declared",
      reason: data.reason, beforeState: template, afterState: updated, actorUserId: access.userId,
    })
    return updated
  })
}

/**
 * Publica un borrador heredado. Desde que incorporar deja la plantilla vigente
 * ya no nacen borradores nuevos, pero los que quedaron de antes necesitan esta
 * puerta para poder usarse. Sigue exigiendo un aprobador distinto del autor.
 */
export async function approveInspectionTemplate(input: unknown, access: InspectionAccess) {
  const data = z.object({ templateId: z.string().min(1), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(10).max(2000) }).parse(input)
  requireAccess(access, "prevention:inspections:approve")

  return db.transaction(async (tx) => {
    const [template] = await tx.select().from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
    if (!template) throw new Error(NOT_FOUND)
    if (template.version !== data.expectedVersion) throw new Error("La plantilla cambió mientras la revisabas. Recarga y reintenta.")
    if (template.status !== "draft") throw new Error("Sólo una plantilla en borrador puede aprobarse.")
    if (template.provenanceKind === "official_document") {
      if (!template.sourceDocumentVersionId || !template.sourceSnapshot) {
        throw new Error("La plantilla documental no puede aprobarse sin una versión oficial vinculada.")
      }
      const parity = template.parityReport as { status?: string; differences?: string[] } | null
      if (parity?.status !== "passed" || (parity.differences?.length ?? 0) > 0) {
        throw new Error("La plantilla no puede aprobarse hasta completar la paridad documental sin diferencias bloqueantes.")
      }
      const [source] = await tx.select({ status: sstDocumentVersions.status, checksum: sstDocumentVersions.checksum })
        .from(sstDocumentVersions).where(eq(sstDocumentVersions.id, template.sourceDocumentVersionId)).limit(1)
      const snapshot = template.sourceSnapshot as { checksumSha256?: string }
      if (!source || !["aprobado", "vigente"].includes(source.status) || source.checksum !== snapshot.checksumSha256) {
        throw new Error("La versión documental vinculada ya no está vigente o cambió su integridad.")
      }
    }
    // Sin segregación en plantillas, a diferencia de las ejecuciones. El
    // contenido no lo redacta nadie acá: viene del catálogo versionado en el
    // repositorio, ya revisado, y quien "incorpora" sólo elige cuál instalar.
    // Exigir un segundo par de ojos sobre una copia literal no revisaba nada y
    // dejaba el instrumento inservible cuando el Jefe de Prevención era quien
    // lo instalaba. La segregación que sí importa —que el revisor de una
    // inspección no sea quien la ejecutó— sigue intacta en `assessRunReview`.

    const now = nowIso()
    const previousApproved = await tx.select({ id: preventionInspectionTemplates.id })
      .from(preventionInspectionTemplates)
      .where(and(
        eq(preventionInspectionTemplates.code, template.code),
        eq(preventionInspectionTemplates.status, "approved"),
        ne(preventionInspectionTemplates.id, template.id),
      ))
    // Aprobar una versión reemplaza a la anterior vigente del mismo código.
    await supersedePreviousApproved(tx, { code: template.code, keepTemplateId: template.id, now })

    const [updated] = await tx.update(preventionInspectionTemplates).set({
      status: "approved",
      approvedByUserId: access.userId,
      approvedAt: now,
      version: template.version + 1,
      updatedAt: now,
    }).where(and(eq(preventionInspectionTemplates.id, template.id), eq(preventionInspectionTemplates.version, data.expectedVersion))).returning()
    if (!updated) throw new Error("La plantilla cambió mientras la revisabas. Recarga y reintenta.")
    const previousIds = previousApproved.map((item) => item.id)
    if (previousIds.length > 0) {
      const movedPrograms = await tx.update(preventionInspectionPrograms).set({
        templateId: updated.id,
        version: sql`${preventionInspectionPrograms.version} + 1`,
        updatedAt: now,
      }).where(inArray(preventionInspectionPrograms.templateId, previousIds)).returning({ id: preventionInspectionPrograms.id })
      const movedRuns = await tx.update(preventionInspectionRuns).set({
        templateId: updated.id,
        version: sql`${preventionInspectionRuns.version} + 1`,
        updatedAt: now,
      }).where(and(
        inArray(preventionInspectionRuns.templateId, previousIds),
        eq(preventionInspectionRuns.status, "planned"),
      )).returning({ id: preventionInspectionRuns.id })
      await history(tx, {
        entityType: "template", entityId: template.id, changeType: "dependents_rebound",
        reason: `Reasignados ${movedPrograms.length} programa(s) y ${movedRuns.length} ejecución(es) no iniciadas a ${updated.versionLabel}.`,
        beforeState: { templateIds: previousIds },
        afterState: { templateId: updated.id, programIds: movedPrograms.map((item) => item.id), runIds: movedRuns.map((item) => item.id) },
        actorUserId: access.userId,
      })
    }
    await history(tx, { entityType: "template", entityId: template.id, changeType: "approved", reason: data.reason, beforeState: template, afterState: updated, actorUserId: access.userId })
    return updated
  })
}

/** Revierte la versión vigente sin tocar ejecuciones iniciadas ni evidencia. */
export async function rollbackInspectionTemplate(input: unknown, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:approve")
  const data = z.object({
    currentTemplateId: z.string().min(1),
    previousTemplateId: z.string().min(1),
    reason: z.string().trim().min(10).max(2000),
  }).parse(input)
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(preventionInspectionTemplates)
      .where(inArray(preventionInspectionTemplates.id, [data.currentTemplateId, data.previousTemplateId]))
      .for("update")
    const current = rows.find((row) => row.id === data.currentTemplateId)
    const previous = rows.find((row) => row.id === data.previousTemplateId)
    if (!current || !previous || current.code !== previous.code) throw new Error("Las versiones no pertenecen al mismo instrumento.")
    if (current.status !== "approved" || previous.status !== "superseded") throw new Error("La reversión exige una versión vigente y una anterior reemplazada.")
    const now = nowIso()
    await tx.update(preventionInspectionTemplates).set({
      status: "superseded", supersededAt: now, supersededByTemplateId: previous.id,
      version: current.version + 1, updatedAt: now,
    }).where(eq(preventionInspectionTemplates.id, current.id))
    await tx.update(preventionInspectionTemplates).set({
      status: "approved", supersededAt: null, supersededByTemplateId: null,
      approvedByUserId: access.userId, approvedAt: now,
      version: previous.version + 1, updatedAt: now,
    }).where(eq(preventionInspectionTemplates.id, previous.id))
    const programs = await tx.update(preventionInspectionPrograms).set({ templateId: previous.id, updatedAt: now })
      .where(eq(preventionInspectionPrograms.templateId, current.id)).returning({ id: preventionInspectionPrograms.id })
    const planned = await tx.update(preventionInspectionRuns).set({ templateId: previous.id, updatedAt: now })
      .where(and(eq(preventionInspectionRuns.templateId, current.id), eq(preventionInspectionRuns.status, "planned")))
      .returning({ id: preventionInspectionRuns.id })
    await history(tx, {
      entityType: "template", entityId: current.id, changeType: "version_rolled_back", reason: data.reason,
      beforeState: { currentTemplateId: current.id },
      afterState: { restoredTemplateId: previous.id, programs: programs.length, plannedRuns: planned.length },
      actorUserId: access.userId,
    })
    return { restored: previous.id, programs: programs.length, plannedRuns: planned.length }
  })
}

/**
 * Retira una plantilla del uso.
 *
 * Borra la fila si nunca se usó; si tiene ejecuciones o programaciones, la
 * marca `superseded`. Esa asimetría no es una comodidad: las ejecuciones son
 * evidencia legal y su plantilla guarda el cuestionario congelado con el que se
 * firmaron. Borrarla dejaría inspecciones sin las preguntas que respondieron
 * —la FK es `ON DELETE restrict` y lo impediría igual, pero con un error de
 * Postgres en vez de una explicación.
 *
 * Hasta ahora no existía ninguna forma de retirar una plantilla desde la
 * plataforma: había que hacerlo por SQL.
 */
export async function retireInspectionTemplate(input: unknown, access: InspectionAccess) {
  const data = z.object({
    templateId: z.string().min(1),
    reason: z.string().trim().min(TRANSITION_REASON_MIN_LENGTH).max(3000),
  }).parse(input)
  requireAccess(access, "prevention:inspections:approve")

  return db.transaction(async (tx) => {
    const [template] = await tx.select().from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
    if (!template) throw new Error(NOT_FOUND)
    if (template.status === "superseded") throw new Error("La plantilla ya está retirada.")

    const [runRow] = await tx.select({ total: sql<number>`count(*)::int` })
      .from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.templateId, template.id))
    const [programRow] = await tx.select({ total: sql<number>`count(*)::int` })
      .from(preventionInspectionPrograms)
      .where(eq(preventionInspectionPrograms.templateId, template.id))
    const runs = runRow?.total ?? 0
    const programs = programRow?.total ?? 0

    const now = nowIso()
    if (runs === 0 && programs === 0) {
      await history(tx, {
        entityType: "template", entityId: template.id, changeType: "deleted",
        reason: data.reason, beforeState: template, actorUserId: access.userId,
      })
      await tx.delete(preventionInspectionTemplates)
        .where(eq(preventionInspectionTemplates.id, template.id))
      return { outcome: "deleted" as const, runs, programs }
    }

    const [updated] = await tx.update(preventionInspectionTemplates).set({
      status: "superseded",
      supersededAt: now,
      version: template.version + 1,
      updatedAt: now,
    }).where(eq(preventionInspectionTemplates.id, template.id)).returning()
    if (!updated) throw new Error("No se pudo retirar la plantilla.")
    await history(tx, {
      entityType: "template", entityId: template.id, changeType: "superseded",
      reason: data.reason, beforeState: template, afterState: updated, actorUserId: access.userId,
    })
    return { outcome: "superseded" as const, runs, programs }
  })
}

/* ── Programación ─────────────────────────────────────────────────────────── */

const programSchema = z.object({
  templateId: z.string().min(1),
  worksiteId: z.string().min(1),
  frequency: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly", "biannual", "annual", "on_demand"]),
  intervalDays: z.number().int().positive().max(3650).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assignedToUserId: z.string().min(1).nullable().optional(),
  riskEntryId: z.string().min(1).nullable().optional(),
  subjectType: z.string().trim().max(120).nullable().optional(),
  /* El sujeto del programa existía como columna desde 0190 y ningún servicio
   * lo escribía ni lo propagaba al run: programar "el extintor del pañol" era
   * imposible. Se activa acá junto con el equipo de flota. */
  subjectResourceId: z.string().min(1).nullable().optional(),
  subjectVehicleId: z.string().min(1).nullable().optional(),
  /** Contenedor del catálogo; obligatorio en la plantilla de contenedores. */
  subjectContainerId: z.string().min(1).nullable().optional(),
})

export async function createInspectionProgram(input: unknown, access: InspectionAccess) {
  const data = programSchema.parse(input)
  requireAccess(access, "prevention:inspections:manage", data.worksiteId)

  const [template] = await db.select().from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
  if (!template) throw new Error(NOT_FOUND)
  if (template.status !== "approved") throw new Error("Sólo puede programarse una plantilla aprobada.")
  if (data.riskEntryId) await assertRiskEntryInWorksite(db, data.riskEntryId, data.worksiteId)
  assertContainerSubject(template.sourceDefinitionCode, data.subjectContainerId)
  await resolveSubject(db, {
    worksiteId: data.worksiteId,
    subjectResourceId: data.subjectResourceId,
    subjectVehicleId: data.subjectVehicleId,
    subjectContainerId: data.subjectContainerId,
  }, true)

  const [created] = await db.insert(preventionInspectionPrograms).values({
    id: `insprog-${nanoid()}`,
    templateId: data.templateId,
    worksiteId: data.worksiteId,
    frequency: data.frequency,
    intervalDays: data.intervalDays ?? FREQUENCY_INTERVAL_DAYS[data.frequency] ?? 30,
    nextDueOn: data.startsOn,
    assignedToUserId: data.assignedToUserId ?? null,
    riskEntryId: data.riskEntryId ?? null,
    subjectType: data.subjectType ?? (data.subjectContainerId ? "contenedor" : null),
    subjectResourceId: data.subjectResourceId ?? null,
    subjectVehicleId: data.subjectVehicleId ?? null,
    subjectContainerId: data.subjectContainerId ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear la programación.")
  await history(db, { entityType: "program", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: `Programación ${data.frequency} desde ${data.startsOn}`, afterState: created, actorUserId: access.userId })
  return created
}

/**
 * Editar y activar/desactivar una programación (A-10, A-11).
 *
 * No hay borrado físico: `isActive=false` es el borrado. Las ejecuciones ya
 * creadas apuntan al programa con `onDelete: set null`, y borrarlo les quitaría
 * el origen — que es justamente lo que explica por qué existen.
 */
export async function updateInspectionProgram(input: unknown, access: InspectionAccess) {
  const data = z.object({
    programId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    frequency: z.enum(["daily", "weekly", "biweekly", "monthly", "quarterly", "biannual", "annual", "on_demand"]).optional(),
    intervalDays: z.number().int().positive().max(3650).optional(),
    nextDueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    assignedToUserId: z.string().min(1).nullable().optional(),
    riskEntryId: z.string().min(1).nullable().optional(),
    subjectType: z.string().trim().max(120).nullable().optional(),
    subjectResourceId: z.string().min(1).nullable().optional(),
    subjectVehicleId: z.string().min(1).nullable().optional(),
    subjectContainerId: z.string().min(1).nullable().optional(),
    isActive: z.boolean().optional(),
    reason: z.string().trim().min(10).max(2000).optional(),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [program] = await tx.select().from(preventionInspectionPrograms)
      .where(eq(preventionInspectionPrograms.id, data.programId)).limit(1)
    if (!program) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:manage", program.worksiteId)
    if (program.version !== data.expectedVersion) {
      throw new Error("La programación cambió mientras la editabas. Recarga y reintenta.")
    }
    if (data.isActive !== undefined && data.isActive !== program.isActive && !data.reason) {
      throw new Error("Activar o detener una programación requiere un motivo de al menos 10 caracteres.")
    }
    if (data.riskEntryId) await assertRiskEntryInWorksite(tx, data.riskEntryId, program.worksiteId)
    // `undefined` = no se toca; para validar hay que mirar el valor resultante,
    // no el enviado, o cambiar sólo uno de los dos dejaría pasar el par.
    const nextResourceId = data.subjectResourceId === undefined ? program.subjectResourceId : data.subjectResourceId
    const nextVehicleId = data.subjectVehicleId === undefined ? program.subjectVehicleId : data.subjectVehicleId
    const nextContainerId = data.subjectContainerId === undefined ? program.subjectContainerId : data.subjectContainerId
    const [template] = await tx.select({ sourceDefinitionCode: preventionInspectionTemplates.sourceDefinitionCode })
      .from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, program.templateId)).limit(1)
    /* Sólo cuando el llamador toca el sujeto. Aplicarlo a toda edición dejaba
     * sin poder detener las programaciones de contenedores anteriores al
     * catálogo —su columna es nula y "Detener" no envía sujeto—, mientras el
     * materializador, que no pasa por acá, las seguía ejecutando. */
    if (data.subjectContainerId !== undefined) {
      assertContainerSubject(template?.sourceDefinitionCode ?? null, nextContainerId)
    }
    await resolveSubject(tx, {
      worksiteId: program.worksiteId,
      subjectResourceId: nextResourceId,
      subjectVehicleId: nextVehicleId,
      subjectContainerId: nextContainerId,
      // Vigencia sólo si el sujeto es el que se está eligiendo ahora: si no,
      // retirar una ficha bloquearía hasta el botón de detener el programa.
    }, data.subjectContainerId !== undefined)

    const now = nowIso()
    const [updated] = await tx.update(preventionInspectionPrograms).set({
      frequency: data.frequency ?? program.frequency,
      // Cambiar la frecuencia sin tocar el intervalo dejaría "Mensual" con el
      // intervalo de la frecuencia anterior; el default sigue a la frecuencia
      // salvo que el usuario declare uno propio.
      intervalDays: data.intervalDays
        ?? (data.frequency ? FREQUENCY_INTERVAL_DAYS[data.frequency] ?? program.intervalDays : program.intervalDays),
      nextDueOn: data.nextDueOn ?? program.nextDueOn,
      assignedToUserId: data.assignedToUserId === undefined ? program.assignedToUserId : data.assignedToUserId,
      riskEntryId: data.riskEntryId === undefined ? program.riskEntryId : data.riskEntryId,
      subjectType: data.subjectType === undefined ? program.subjectType : data.subjectType,
      subjectResourceId: nextResourceId,
      subjectVehicleId: nextVehicleId,
      subjectContainerId: nextContainerId,
      isActive: data.isActive ?? program.isActive,
      version: program.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionPrograms.id, program.id),
      eq(preventionInspectionPrograms.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La programación cambió mientras la editabas. Recarga y reintenta.")

    await history(tx, {
      entityType: "program", entityId: program.id, worksiteId: program.worksiteId,
      changeType: updated.isActive === program.isActive ? "updated" : (updated.isActive ? "reactivated" : "deactivated"),
      reason: data.reason ?? `Programación ${updated.frequency} cada ${updated.intervalDays} día(s), próxima ${updated.nextDueOn}`,
      beforeState: program, afterState: updated, actorUserId: access.userId,
    })
    return updated
  })
}

/**
 * A-09: el diálogo pedía escribir el ID de la MIPER a mano en un campo de
 * texto libre, sin validar existencia ni pertenencia a la faena. Un ID mal
 * tipeado daba una violación de FK cruda.
 */
async function assertRiskEntryInWorksite(client: Client, riskEntryId: string, worksiteId: string) {
  const [entry] = await client.select({ id: preventionRiskEntries.id })
    .from(preventionRiskEntries)
    .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
    .where(and(
      eq(preventionRiskEntries.id, riskEntryId),
      eq(preventionRiskMatrices.worksiteId, worksiteId),
    )).limit(1)
  if (!entry) throw new Error("El peligro MIPER no existe o pertenece a otra faena.")
}

/**
 * Comprueba que el programa esté dentro del alcance de faena del usuario.
 *
 * `materializeProgramRuns` corre también desde el cron, que no tiene sesión, y
 * por eso no recibe `InspectionAccess`: cuando lo dispara una persona, el
 * alcance se valida aquí antes de invocarlo.
 */
export async function assertProgramInScope(programId: string, access: InspectionAccess) {
  const [program] = await db.select({ worksiteId: preventionInspectionPrograms.worksiteId })
    .from(preventionInspectionPrograms)
    .where(eq(preventionInspectionPrograms.id, programId)).limit(1)
  if (!program) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:manage", program.worksiteId)
}

/**
 * Resuelve el sujeto declarado y devuelve la etiqueta a congelar.
 *
 * Puerta única para programa y ejecución: el sujeto debe existir Y pertenecer
 * a la faena. Sin esto, un id de otra faena entra por la acción y filtra el
 * nombre del recurso o la patente ajena. El CHECK
 * `prevention_inspection_run_single_subject` cubre la exclusión mutua en la
 * base; acá se rechaza antes, con un mensaje que se entiende.
 *
 * Exportada para el materializador de programas, que crea ejecuciones sin
 * sesión y necesita la MISMA etiqueta congelada: sin ella, un run programado
 * quedaba con el sujeto apuntado pero sin nombre, y la bandeja, la cabecera y
 * el acta lo mostraban vacío (INS-05).
 */
export async function resolveSubject(
  client: Client,
  args: {
    worksiteId: string
    subjectResourceId?: string | null
    subjectVehicleId?: string | null
    subjectContainerId?: string | null
  },
  /** Alta nueva: exige que el sujeto siga vigente. El cron no lo exige. */
  requireActiveSubject = false,
): Promise<string | null> {
  const declared = [args.subjectResourceId, args.subjectVehicleId, args.subjectContainerId]
    .filter(Boolean).length
  if (declared > 1) {
    throw new Error("Una inspección tiene un solo sujeto: recurso de emergencia, equipo o contenedor, no varios.")
  }
  if (args.subjectResourceId) {
    const [found] = await client.select({ name: preventionEmergencyResources.name })
      .from(preventionEmergencyResources)
      .where(and(
        eq(preventionEmergencyResources.id, args.subjectResourceId),
        eq(preventionEmergencyResources.worksiteId, args.worksiteId),
      )).limit(1)
    if (!found) throw new Error("El sujeto no existe o pertenece a otra faena.")
    return found.name
  }
  if (args.subjectVehicleId) {
    const [found] = await client.select({ plate: fuelVehicles.plate, code: fuelVehicles.code })
      .from(fuelVehicles)
      .where(and(
        eq(fuelVehicles.id, args.subjectVehicleId),
        eq(fuelVehicles.worksiteId, args.worksiteId),
      )).limit(1)
    if (!found) throw new Error("El equipo no existe o pertenece a otra faena.")
    return vehicleLabel(found)
  }
  if (args.subjectContainerId) {
    const [found] = await client.select({
      code: preventionContainers.code,
      location: preventionContainers.location,
      isActive: preventionContainers.isActive,
    })
      .from(preventionContainers)
      .where(and(
        eq(preventionContainers.id, args.subjectContainerId),
        eq(preventionContainers.worksiteId, args.worksiteId),
      )).limit(1)
    if (!found) throw new Error("El contenedor no existe o pertenece a otra faena.")
    /* Retirado del catálogo = no recibe trabajo nuevo. La comprobación es de
     * alta y no de resolución: el materializador también pasa por acá, y
     * hacerlo fallar dejaría a un programa vivo sin generar nada y en silencio.
     * Retirar un contenedor con programación es, por eso, un acto en dos pasos:
     * detener el programa y luego retirar la ficha. */
    if (requireActiveSubject && !found.isActive) {
      throw new Error("Ese contenedor está retirado del catálogo. Reactívalo o elige otro.")
    }
    return containerLabel(found)
  }
  return null
}

/**
 * Plantillas que exigen sujeto del catálogo, por `sourceDefinitionCode`.
 *
 * La inspección de contenedores nombraba su sujeto con texto libre porque el
 * catálogo no existía: dos inspectores escribían la misma unidad de dos formas
 * y el historial por contenedor era imposible de armar. Con el padrón en pie,
 * el texto libre deja de ser una opción para esta plantilla.
 */
const CONTAINER_DEFINITION_CODE = "inspeccion_contenedores"

function assertContainerSubject(
  sourceDefinitionCode: string | null,
  subjectContainerId: string | null | undefined,
) {
  if (sourceDefinitionCode !== CONTAINER_DEFINITION_CODE) return
  if (!subjectContainerId) {
    throw new Error("Selecciona un contenedor del catálogo de la faena.")
  }
}

/**
 * Sujetos inspeccionables de la faena (función #11).
 *
 * Reusa `preventionEmergencyResources`, que ya es el inventario por faena
 * —nombre, tipo, ubicación, serie— con su CRUD y sus alertas de vencimiento.
 * Se lista bajo el alcance de faena de inspecciones, sin exigir permisos del
 * módulo de emergencias: mismo criterio que ya aplica la certificación CPHS
 * para sus lecturas directas de tablas de otros módulos.
 */
export async function listInspectionSubjects(worksiteId: string, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view", worksiteId)
  const [resources, vehicles, containers] = await Promise.all([
    db.select({
      id: preventionEmergencyResources.id,
      name: preventionEmergencyResources.name,
      kind: preventionEmergencyResources.kind,
      location: preventionEmergencyResources.location,
      serialNumber: preventionEmergencyResources.serialNumber,
    })
      .from(preventionEmergencyResources)
      .where(eq(preventionEmergencyResources.worksiteId, worksiteId))
      .orderBy(asc(preventionEmergencyResources.name))
      .limit(500),
    // El inventario de emergencias no modela camiones ni maquinaria; el padrón
    // de equipos vive en flota y hasta ahora sólo llegaba como texto libre.
    listWorksiteVehicles({ worksiteId }),
    // Tercer padrón: los contenedores del Anexo 14, que hasta que existió el
    // catálogo sólo llegaban como etiqueta escrita a mano.
    listContainersForWorksite(worksiteId),
  ])
  return [
    ...resources.map((item) => ({
      source: "resource" as const,
      id: item.id,
      name: item.name,
      kind: item.kind,
      location: item.location,
      serialNumber: item.serialNumber,
    })),
    ...vehicles.map((item) => ({
      source: "vehicle" as const,
      id: item.id,
      name: vehicleLabel(item),
      kind: item.type,
      location: "",
      serialNumber: item.plate,
    })),
    ...containers.map((item) => ({
      source: "container" as const,
      id: item.id,
      name: containerLabel(item),
      kind: "Contenedor",
      location: item.location,
      serialNumber: item.code,
    })),
  ]
}

/**
 * Inventario de varias faenas de una vez, agrupado por faena.
 *
 * La bandeja y la programación precargan el picker de sujeto para todas las
 * faenas del alcance, y hacerlo faena por faena eran dos consultas por cada una
 * en CADA carga de pantalla — con alcance global, cuarenta consultas para
 * poblar un `Select` que la mayoría de las veces nadie abre (INS-12).
 */
export async function listInspectionSubjectsByWorksite(
  worksiteIds: string[],
  access: InspectionAccess,
): Promise<Record<string, Awaited<ReturnType<typeof listInspectionSubjects>>>> {
  const grouped: Record<string, Awaited<ReturnType<typeof listInspectionSubjects>>> = {}
  const allowed = worksiteIds.filter((worksiteId) => scopeAllows(access.scope, worksiteId))
  for (const worksiteId of allowed) grouped[worksiteId] = []
  if (allowed.length === 0) return grouped
  requireAccess(access, "prevention:inspections:view")

  const [resources, vehicles, containersByWorksite] = await Promise.all([
    db.select({
      worksiteId: preventionEmergencyResources.worksiteId,
      id: preventionEmergencyResources.id,
      name: preventionEmergencyResources.name,
      kind: preventionEmergencyResources.kind,
      location: preventionEmergencyResources.location,
      serialNumber: preventionEmergencyResources.serialNumber,
    })
      .from(preventionEmergencyResources)
      .where(inArray(preventionEmergencyResources.worksiteId, allowed))
      .orderBy(asc(preventionEmergencyResources.name))
      .limit(500 * allowed.length),
    db.select({
      worksiteId: fuelVehicles.worksiteId,
      id: fuelVehicles.id,
      plate: fuelVehicles.plate,
      code: fuelVehicles.code,
      type: fuelVehicles.type,
    })
      .from(fuelVehicles)
      .where(and(inArray(fuelVehicles.worksiteId, allowed), eq(fuelVehicles.isActive, true))),
    listContainersByWorksite(allowed),
  ])

  for (const item of resources) {
    grouped[item.worksiteId]?.push({
      source: "resource", id: item.id, name: item.name, kind: item.kind,
      location: item.location, serialNumber: item.serialNumber,
    })
  }
  for (const item of vehicles) {
    grouped[item.worksiteId]?.push({
      source: "vehicle", id: item.id, name: vehicleLabel(item), kind: item.type,
      location: "", serialNumber: item.plate,
    })
  }
  for (const [worksiteId, containers] of Object.entries(containersByWorksite)) {
    for (const item of containers) {
      grouped[worksiteId]?.push({
        source: "container", id: item.id, name: containerLabel(item), kind: "Contenedor",
        location: item.location, serialNumber: item.code,
      })
    }
  }
  return grouped
}

/** Peligros de la MIPER de la faena, para el picker de la programación (A-09). */
export async function listRiskEntriesForWorksite(worksiteId: string, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view", worksiteId)
  return db.select({
    id: preventionRiskEntries.id,
    hazardCode: preventionRiskEntries.hazardCode,
    hazard: preventionRiskEntries.hazard,
  })
    .from(preventionRiskEntries)
    .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
    .where(eq(preventionRiskMatrices.worksiteId, worksiteId))
    .orderBy(asc(preventionRiskEntries.hazardCode))
    .limit(500)
}

/* ── Ejecución ────────────────────────────────────────────────────────────── */

const runSchema = z.object({
  templateId: z.string().min(1),
  worksiteId: z.string().min(1),
  programId: z.string().min(1).nullable().optional(),
  subjectType: z.string().trim().max(120).nullable().optional(),
  subjectLabel: z.string().trim().max(300).nullable().optional(),
  /** Sujeto del inventario (función #11); `subjectLabel` sigue admitiendo texto libre. */
  subjectResourceId: z.string().min(1).nullable().optional(),
  /** Equipo de flota inspeccionado. Excluyente con `subjectResourceId`. */
  subjectVehicleId: z.string().min(1).nullable().optional(),
  /** Contenedor del catálogo; obligatorio en la plantilla de contenedores. */
  subjectContainerId: z.string().min(1).nullable().optional(),
  origin: z.enum(["prevencion", "cphs", "mandante"]).default("prevencion"),
  scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  assignedToUserId: z.string().min(1).nullable().optional(),
  clientSubmissionId: z.string().trim().min(1).max(200).nullable().optional(),
})

export async function createInspectionRun(input: unknown, access: InspectionAccess) {
  const data = runSchema.parse(input)
  requireAccess(access, "prevention:inspections:execute", data.worksiteId)

  const [template] = await db.select().from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
  if (!template) throw new Error(NOT_FOUND)
  if (template.status !== "approved") throw new Error("Sólo puede ejecutarse una plantilla aprobada.")

  // A-13: sin esto, un `programId` cualquiera hacía que completar la ejecución
  // avanzara el `nextDueOn` de un programa ajeno. Era inalcanzable mientras
  // nada enviaba `programId`; el materializador de B-04 lo activa.
  if (data.programId) {
    const [program] = await db.select().from(preventionInspectionPrograms)
      .where(eq(preventionInspectionPrograms.id, data.programId)).limit(1)
    if (!program) throw new Error(NOT_FOUND)
    if (program.templateId !== data.templateId || program.worksiteId !== data.worksiteId) {
      throw new Error("La programación no corresponde a esta plantilla y faena.")
    }
  }

  // El sujeto debe existir y pertenecer a la faena: sin esto, un id de otra
  // faena entraría por la acción y filtraría el nombre del recurso ajeno.
  assertContainerSubject(template.sourceDefinitionCode, data.subjectContainerId)
  const subjectName = await resolveSubject(db, {
    worksiteId: data.worksiteId,
    subjectResourceId: data.subjectResourceId,
    subjectVehicleId: data.subjectVehicleId,
    subjectContainerId: data.subjectContainerId,
  }, true)

  // La sincronización offline reenvía: el identificador de envío hace la
  // creación idempotente en vez de duplicar la inspección.
  if (data.clientSubmissionId) {
    const [existing] = await db.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.clientSubmissionId, data.clientSubmissionId)).limit(1)
    if (existing) return { run: existing, idempotentReplay: true }
  }

  const [created] = await db.insert(preventionInspectionRuns).values({
    id: `insrun-${nanoid()}`,
    code: `INSP-${codeYear()}-${nanoid(8).toUpperCase()}`,
    templateId: data.templateId,
    programId: data.programId ?? null,
    worksiteId: data.worksiteId,
    subjectType: data.subjectType ?? (data.subjectContainerId ? "contenedor" : null),
    // El nombre del recurso se congela como etiqueta: renombrarlo después no
    // debe cambiar qué decía la inspección que se inspeccionó.
    subjectLabel: subjectName ?? data.subjectLabel ?? null,
    subjectResourceId: data.subjectResourceId ?? null,
    subjectVehicleId: data.subjectVehicleId ?? null,
    subjectContainerId: data.subjectContainerId ?? null,
    origin: data.origin,
    scheduledFor: data.scheduledFor ?? null,
    status: "planned",
    assignedToUserId: data.assignedToUserId ?? access.userId,
    clientSubmissionId: data.clientSubmissionId ?? null,
    createdByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo crear la inspección.")
  await history(db, { entityType: "run", entityId: created.id, worksiteId: data.worksiteId, changeType: "created", reason: `Inspección ${template.name} planificada`, afterState: created, actorUserId: access.userId })

  // A-08: sin esto, a quien se le asignaba una inspección sólo se enteraba si
  // miraba la bandeja por su cuenta. Asignársela a uno mismo no notifica.
  if (created.assignedToUserId && created.assignedToUserId !== access.userId) {
    await notifySafely("asignación", () => createNotifications([created.assignedToUserId!], {
      type: "system_alert",
      title: "Inspección asignada",
      body: `${template.name}${created.scheduledFor ? ` · programada para el ${created.scheduledFor}` : ""}.`,
      entityType: "inspection_run",
      entityId: created.id,
      entityHref: `/prevencion/inspecciones/${created.id}`,
      dedupeKey: `inspection:assigned:${created.id}:${created.assignedToUserId}`,
    }))
  }
  return { run: created, idempotentReplay: false }
}

/**
 * Conjunto completo de respuestas del run, no un delta.
 *
 * `.min(1)` se quitó a propósito (B-02): un array vacío significa "ninguna
 * respuesta", y debe poder borrar la última que quedaba.
 */
const answerRowSchema = z.object({
  sectionId: z.string().min(1),
  itemId: z.string().min(1),
  /* `not_present` ("No tiene", Anexo 14) faltaba acá y estaba en todas las
   * demás capas: el CHECK de la base, `InspectionResult`, `EXCLUDED_RESULTS` y
   * `statusOptionsForKind` para la escala `bueno_regular_malo_na_nt_obs`. El
   * botón se renderizaba y el servidor rechazaba el lote completo. En terreno
   * era peor: el emisor de la cola offline marca toda respuesta no-ok como
   * `retriable: false`, así que la corrida encolada se quemaba sin vuelta. */
  result: z.enum(["conforming", "partial", "non_conforming", "not_applicable", "not_present", "recorded"]),
  value: z.string().trim().max(2000).nullable().optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
  evidenceReference: z.string().trim().max(2000).nullable().optional(),
  /** La marca la ingesta al pre-llenar un ítem `fatal`; el cliente la apaga al responderlo. */
  needsConfirmation: z.boolean().optional(),
})

const answersSchema = z.object({
  runId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  answers: z.array(answerRowSchema),
  locationLatitude: z.string().trim().max(40).nullable().optional(),
  locationLongitude: z.string().trim().max(40).nullable().optional(),
})

type AnswerRowInput = z.infer<typeof answerRowSchema>

/**
 * Persiste el conjunto de respuestas dentro de una transacción existente y
 * devuelve la nueva versión del run.
 *
 * Extraída para que **guardar** y **declarar ejecutada** compartan exactamente
 * el mismo camino de escritura. Antes de B-01 el botón de completar no
 * persistía nada: el gate del cliente se evaluaba sobre el borrador en memoria
 * y el servidor calculaba cumplimiento y hallazgos sobre lo que hubiera en BD,
 * que podía ser más viejo. Ahora hay una sola transacción y una sola verdad.
 */
async function saveAnswersWithClient(tx: Tx, args: {
  runId: string
  expectedVersion: number
  answers: AnswerRowInput[]
  locationLatitude?: string | null
  locationLongitude?: string | null
  access: InspectionAccess
}) {
  const [run] = await tx.select().from(preventionInspectionRuns)
    .where(eq(preventionInspectionRuns.id, args.runId)).limit(1)
  if (!run) throw new Error(NOT_FOUND)
  requireAccess(args.access, "prevention:inspections:execute", run.worksiteId)
  if (["reviewed", "cancelled"].includes(run.status)) {
    throw new Error("No se pueden modificar respuestas de una inspección cerrada o cancelada.")
  }
  // C-02: antes no había control de concurrencia y dos inspectores con el
  // mismo run abierto se pisaban en silencio. El cliente recibe de vuelta la
  // versión nueva, que es lo que el comentario anterior temía perder.
  if (run.version !== args.expectedVersion) {
    throw new Error("La inspección cambió en otra sesión. Recarga y reintenta.")
  }

  const [template] = await tx.select().from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.id, run.templateId)).limit(1)
  if (!template) throw new Error(NOT_FOUND)
  const items = itemsFromDefinition(template.definitionSnapshot as unknown as ChecklistDefinition)
  const itemBySpec = new Map(items.map((item) => [`${item.sectionId}::${item.itemId}`, item]))

  // B-03: validar TODO antes de escribir nada. El CHECK de Postgres queda como
  // red de seguridad del dato, no como mecanismo de UX.
  for (const answer of args.answers) {
    const item = itemBySpec.get(`${answer.sectionId}::${answer.itemId}`)
    if (!item) throw new Error("Una respuesta no corresponde a ningún ítem de la plantilla.")
    const problem = validateAnswerRow(item, answer)
    if (problem) throw new Error(problem)
  }

  const now = nowIso()

  /* INS-03: una respuesta que se borra se lleva su evidencia por cascada
   * (`prevention_inspection_answer_evidence.answer_id` es ON DELETE cascade).
   * Dejar un ítem en "Sin responder" —o vaciar el campo de uno que no puntúa,
   * que pone `result: ""` solo— destruía sus fotografías sin preguntar, en el
   * módulo cuyo propósito es que un hallazgo tenga foto.
   *
   * La guarda vive acá y no en el formulario porque este camino lo comparten
   * el guardado manual, el autoguardado y la sincronización offline: avisarlo
   * en el cliente serían tres avisos y uno de ellos se quedaría atrás. */
  const keepKeys = new Set(args.answers.map((answer) => `${answer.sectionId}::${answer.itemId}`))
  const droppedWithEvidence = await tx.select({
    itemLabel: preventionInspectionAnswers.itemLabel,
    sectionId: preventionInspectionAnswers.sectionId,
    itemId: preventionInspectionAnswers.itemId,
    photos: sql<number>`count(${preventionInspectionAnswerEvidence.id})::int`,
  })
    .from(preventionInspectionAnswers)
    .innerJoin(
      preventionInspectionAnswerEvidence,
      eq(preventionInspectionAnswerEvidence.answerId, preventionInspectionAnswers.id),
    )
    .where(eq(preventionInspectionAnswers.runId, run.id))
    .groupBy(
      preventionInspectionAnswers.itemLabel,
      preventionInspectionAnswers.sectionId,
      preventionInspectionAnswers.itemId,
    )
  const blocked = droppedWithEvidence.filter((row) => !keepKeys.has(`${row.sectionId}::${row.itemId}`))
  if (blocked.length > 0) {
    const detail = blocked
      .map((row) => `"${row.itemLabel}" (${row.photos} ${row.photos === 1 ? "fotografía" : "fotografías"})`)
      .join(", ")
    throw new Error(
      `No se puede dejar sin responder ${detail}: se perdería la evidencia adjunta. Quita las fotografías primero, o vuelve a responder el ítem.`,
    )
  }

  // B-02: el payload declara el conjunto completo, así que lo que no viene se
  // borra. Sin esto, devolver un ítem a "Sin responder" en el formulario no
  // producía ningún cambio y la fila anterior sobrevivía: el cliente contaba
  // 9 respuestas y el servidor 10.
  const keepPairs = args.answers.map((answer) => sql`(${answer.sectionId}, ${answer.itemId})`)
  const deleted = await tx.delete(preventionInspectionAnswers)
    .where(and(
      eq(preventionInspectionAnswers.runId, run.id),
      // Comparación por tupla, no por clave concatenada: un `sectionId` que
      // contuviera el separador produciría colisiones silenciosas.
      keepPairs.length > 0
        ? sql`(${preventionInspectionAnswers.sectionId}, ${preventionInspectionAnswers.itemId}) NOT IN (${sql.join(keepPairs, sql`, `)})`
        : undefined,
    ))
    .returning({ id: preventionInspectionAnswers.id })

  if (args.answers.length > 0) {
    await tx.insert(preventionInspectionAnswers).values(args.answers.map((answer) => {
      const item = itemBySpec.get(`${answer.sectionId}::${answer.itemId}`)!
      return {
        id: `insans-${nanoid()}`,
        runId: run.id,
        sectionId: answer.sectionId,
        itemId: answer.itemId,
        itemLabel: item.label,
        result: answer.result,
        value: answer.value ?? null,
        comment: answer.comment ?? null,
        evidenceReference: answer.evidenceReference ?? null,
        danoPotencial: item.danoPotencial ?? null,
        // Sólo los ítems que matan quedan pendientes de ratificar; marcar el
        // resto convertiría la puerta en un trámite de 28 clics que nadie lee.
        needsConfirmation: (answer.needsConfirmation ?? false) && requiresHumanConfirmation(item),
      }
    })).onConflictDoUpdate({
      target: [preventionInspectionAnswers.runId, preventionInspectionAnswers.sectionId, preventionInspectionAnswers.itemId],
      set: {
        result: sql`excluded.result`,
        value: sql`excluded.value`,
        comment: sql`excluded.comment`,
        evidenceReference: sql`excluded.evidence_reference`,
        needsConfirmation: sql`excluded.needs_confirmation`,
        updatedAt: now,
      },
    })
  }

  const [updated] = await tx.update(preventionInspectionRuns).set({
    status: run.status === "planned" ? "in_progress" : run.status,
    locationLatitude: args.locationLatitude ?? run.locationLatitude,
    locationLongitude: args.locationLongitude ?? run.locationLongitude,
    version: run.version + 1,
    updatedAt: now,
  }).where(and(
    eq(preventionInspectionRuns.id, run.id),
    eq(preventionInspectionRuns.version, args.expectedVersion),
  )).returning()
  if (!updated) throw new Error("La inspección cambió en otra sesión. Recarga y reintenta.")

  // La UI puede adjuntar una foto en el mismo gesto de responder: después del
  // autosave necesita el id persistido al que colgar la evidencia, sin recargar
  // ni obligar a recorrer el checklist por segunda vez.
  const answerRefs = args.answers.length === 0 ? [] : await tx.select({
    answerId: preventionInspectionAnswers.id,
    sectionId: preventionInspectionAnswers.sectionId,
    itemId: preventionInspectionAnswers.itemId,
  }).from(preventionInspectionAnswers)
    .where(eq(preventionInspectionAnswers.runId, run.id))

  return { run: updated, saved: args.answers.length, removed: deleted.length, answerRefs }
}

export async function saveInspectionAnswers(input: unknown, access: InspectionAccess) {
  const data = answersSchema.parse(input)
  return db.transaction(async (tx) => {
    const result = await saveAnswersWithClient(tx, { ...data, access })
    // C-01: guardar una respuesta es lo único que el inspector hace en terreno
    // y no dejaba rastro en la bitácora "inmutable". Se registran conteos, no
    // el array completo: 80 ítems guardados 10 veces son 800 filas JSON sin
    // valor probatorio adicional.
    await history(tx, {
      entityType: "run", entityId: result.run.id, worksiteId: result.run.worksiteId,
      changeType: "answers_saved",
      reason: `${result.saved} respuesta(s) guardada(s), ${result.removed} eliminada(s)`,
      beforeState: { version: data.expectedVersion },
      afterState: { version: result.run.version, saved: result.saved, removed: result.removed },
      actorUserId: access.userId,
    })
    return { saved: result.saved, removed: result.removed, version: result.run.version, answerRefs: result.answerRefs }
  })
}

/**
 * Declara la inspección ejecutada: valida obligatorios, calcula cumplimiento y
 * materializa un hallazgo por cada incumplimiento con su criticidad derivada.
 */
export async function completeInspectionRun(input: unknown, access: InspectionAccess) {
  const data = z.object({
    runId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    /**
     * Conjunto completo de respuestas al momento de declarar ejecutada.
     *
     * B-01: sin esto, el cliente evaluaba el gate de completitud sobre su
     * borrador en memoria y el servidor calculaba cumplimiento y hallazgos
     * sobre lo último persistido — que podía ser más viejo. Se persiste y se
     * completa en la MISMA transacción. Omitirlo conserva el comportamiento
     * anterior (evalúa lo ya guardado), que es lo que necesitan los llamadores
     * sin formulario.
     */
    answers: z.array(answerRowSchema).optional(),
    locationLatitude: z.string().trim().max(40).nullable().optional(),
    locationLongitude: z.string().trim().max(40).nullable().optional(),
    /** Acta de cierre (función #2). La plantilla declara qué exige. */
    closingAct: z.object({
      result: z.string().trim().min(1),
      restrictions: z.string().trim().max(3000).nullable().optional(),
      signatures: z.array(z.object({
        role: z.string().trim().min(1).max(120),
        name: z.string().trim().min(1).max(200),
        userId: z.string().min(1).nullable().optional(),
      })).max(20),
    }).optional(),
  }).parse(input)

  const result = await db.transaction(async (tx) => {
    // Función #9: el reintento de una cola offline vuelve a mandar el mismo
    // cierre. Si el run ya quedó ejecutado por ESTE mismo usuario, la primera
    // entrega sí llegó y la segunda es un eco — devolverlo como éxito
    // idempotente es lo que permite a la cola borrar la entrada. Va ANTES del
    // guardado: si no, el CAS de `saveAnswersWithClient` fallaría con la
    // versión que el cliente traía desde antes de la primera entrega, y el
    // reintento parecería un conflicto real y se repetiría para siempre.
    const [existing] = await tx.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
    if (!existing) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:execute", existing.worksiteId)
    if ((existing.status === "completed" || existing.status === "reviewed") && existing.executedByUserId === access.userId) {
      const [template] = await tx.select({ numbers: preventionInspectionTemplates.pdtpActivityNumbers })
        .from(preventionInspectionTemplates)
        .where(eq(preventionInspectionTemplates.id, existing.templateId)).limit(1)
      const activityNumbers = Array.isArray(template?.numbers) ? template.numbers : []
      const target = await resolvePdtpAccreditationTarget({ sourceType: "inspeccion", sourceId: existing.templateId, eventType: "execute", legacyActivityNumbers: activityNumbers }, tx)
      if ((target.catalogActivityIds?.length || target.activityNumbers?.length) && existing.executedAt) {
        await onInspectionCompleted({
          runId: existing.id,
          worksiteId: existing.worksiteId,
          completedAt: existing.executedAt,
          completedByUserId: existing.executedByUserId,
          ...target,
        }, tx)
      }
      return {
        run: existing,
        findings: 0,
        compliancePercent: existing.compliancePercent,
        officialCompliancePercent: existing.officialComplianceBasisPoints === null ? null : existing.officialComplianceBasisPoints / 100,
        normalizedCompliancePercent: existing.normalizedComplianceBasisPoints === null ? null : existing.normalizedComplianceBasisPoints / 100,
        alreadyCompleted: true as const,
      }
    }

    // El guardado ya valida alcance, estado editable y versión, y devuelve el
    // run con la versión avanzada — de ahí que el `expectedVersion` posterior
    // se tome de su resultado y no del input.
    let expectedVersion = data.expectedVersion
    if (data.answers) {
      const saved = await saveAnswersWithClient(tx, {
        runId: data.runId,
        expectedVersion: data.expectedVersion,
        answers: data.answers,
        locationLatitude: data.locationLatitude,
        locationLongitude: data.locationLongitude,
        access,
      })
      expectedVersion = saved.run.version
    }

    const [run] = await tx.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
    if (!run) throw new Error(NOT_FOUND)
    if (run.version !== expectedVersion) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")
    if (run.status === "completed" || run.status === "reviewed") throw new Error("La inspección ya fue ejecutada.")
    if (run.status === "cancelled") throw new Error("Una inspección cancelada no puede ejecutarse.")

    const [template] = await tx.select().from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, run.templateId)).limit(1)
    if (!template) throw new Error(NOT_FOUND)
    const definition = template.definitionSnapshot as unknown as ChecklistDefinition
    const items = itemsFromDefinition(definition)
    if (template.sourceDefinitionCode === "inspeccion_no_planeada") {
      const participants = await tx.select({ id: preventionInspectionRunParticipants.id })
        .from(preventionInspectionRunParticipants)
        .where(eq(preventionInspectionRunParticipants.runId, run.id))
      if (participants.length === 0) throw new Error("El Anexo 08 exige registrar al menos una persona participante.")
    }

    const stored = await tx.select().from(preventionInspectionAnswers)
      .where(eq(preventionInspectionAnswers.runId, run.id))
    const answers: InspectionAnswerInput[] = stored.map((row) => ({
      sectionId: row.sectionId,
      itemId: row.itemId,
      result: row.result as InspectionAnswerInput["result"],
      comment: row.comment,
      // `assessRunCompletion` exige contenido en los ítems que no puntúan.
      value: row.value,
      // Sin esto la puerta `unconfirmed_critical` nunca ve la marca: el
      // servidor reconstruye las respuestas desde la BD y esta proyección la
      // descartaba, así que el bloqueo sólo existía en el cliente — que es
      // justo donde no vale.
      needsConfirmation: row.needsConfirmation,
    }))

    /*
     * INS-002: se resuelven los firmantes declarados en una sola consulta. Un
     * `userId` que no existe o está inactivo **no hace fallar el cierre** —el
     * acta puede venir de una cola offline con un id rancio, y perder el acta
     * entera por eso sería peor—: esa firma pasa a declarada, que es lo que de
     * verdad es.
     */
    const declaredSignerIds = [...new Set(
      (data.closingAct?.signatures ?? []).flatMap((item) => (item.userId ? [item.userId] : [])),
    )]
    const signerById = new Map(
      (declaredSignerIds.length === 0 ? [] : await tx.select({ id: users.id, name: users.name })
        .from(users)
        .where(and(inArray(users.id, declaredSignerIds), eq(users.isActive, true)))
      ).map((row) => [row.id, row] as const),
    )

    const closingSpec = closingActFromDefinition(template.definitionSnapshot as unknown as ChecklistDefinition)
    const completion = assessRunCompletion(items, answers, { spec: closingSpec, act: data.closingAct })
    if (!completion.allowed) {
      throw new Error(`No se puede declarar ejecutada: ${completion.blockers.map((item) => item.detail).join(", ")}`)
    }

    const summary = summarizeCompliance(items, answers, definition.scoringPolicy)
    const derived = deriveFindings(items, answers)
    const answerId = new Map(stored.map((row) => [`${row.sectionId}::${row.itemId}`, row.id]))
    const now = nowIso()

    /* Rehacer los hallazgos DERIVADOS mantiene la coherencia si se corrigió una
     * respuesta antes de cerrar; los que ya tienen CAPA no se tocan.
     *
     * El filtro por `origin` no es decorativo: sin él este borrado se llevaba
     * también las desviaciones que una persona registró a mano —abiertas y sin
     * CAPA, como cualquier hallazgo nuevo—, así que declarar ejecutada una
     * inspección de área borraba justamente lo que se había ido a buscar. */
    await tx.delete(preventionInspectionFindings).where(and(
      eq(preventionInspectionFindings.runId, run.id),
      eq(preventionInspectionFindings.origin, "derived"),
      eq(preventionInspectionFindings.status, "open"),
      sql`${preventionInspectionFindings.capaActionId} IS NULL`,
    ))
    if (derived.length > 0) {
      await tx.insert(preventionInspectionFindings).values(derived.map((finding) => ({
        id: `insfnd-${nanoid()}`,
        runId: run.id,
        answerId: answerId.get(`${finding.sectionId}::${finding.itemId}`) ?? null,
        description: finding.description,
        danoPotencial: finding.danoPotencial,
        criticality: finding.criticality,
        origin: "derived" as const,
        status: "open" as const,
      })))
    }

    /* Cierre al completar, para los instrumentos donde declarar ejecutada YA es
     * la revisión (`closesOnCompletion`). Sin esto, un reporte por equipo y por
     * turno quedaba "Esperando revisión" para siempre y ese indicador dejaba de
     * servir para lo que sí necesita atención.
     *
     * NO se salta la regla del hallazgo que exige acción correctiva: si la
     * ejecución levantó alguno sin CAPA, la inspección se queda en `completed` y
     * entra a la cola igual. Un reporte con los frenos en falla tiene que caer
     * en las manos de alguien, y a esta altura nadie tuvo ocasión de derivar la
     * CAPA todavía. Se miran TODOS los hallazgos abiertos del run, no sólo los
     * recién derivados: uno de una ejecución anterior que sobrevivió a un
     * reabrir también bloquea. */
    const openFindings = await tx.select({
      criticality: preventionInspectionFindings.criticality,
      capaActionId: preventionInspectionFindings.capaActionId,
    })
      .from(preventionInspectionFindings)
      .where(and(
        eq(preventionInspectionFindings.runId, run.id),
        ne(preventionInspectionFindings.status, "closed"),
      ))
    const blockedByFinding = openFindings.some((finding) => requiresCapa(finding.criticality) && !finding.capaActionId)
    const autoCloses = Boolean(
      (template.definitionSnapshot as unknown as ChecklistDefinition)?.closesOnCompletion,
    ) && !blockedByFinding

    const [updated] = await tx.update(preventionInspectionRuns).set({
      status: autoCloses ? "reviewed" : "completed",
      executedByUserId: access.userId,
      executedAt: now,
      /* Quien transcribió es quien revisó: es literalmente lo que hizo al
       * pasar el papel al sistema, y el CHECK de la tabla exige los dos campos
       * juntos. Queda dicho en el comentario para que la trazabilidad no
       * insinúe una segunda persona que no existió. */
      ...(autoCloses ? {
        reviewedByUserId: access.userId,
        reviewedAt: now,
        reviewComment: "Cerrada al declararse ejecutada: transcribir el reporte firmado es su revisión.",
      } : {}),
      conformingCount: summary.conforming,
      partialCount: summary.partial,
      nonConformingCount: summary.nonConforming,
      notApplicableCount: summary.notApplicable,
      compliancePercent: summary.compliancePercent,
      officialComplianceBasisPoints: summary.officialComplianceBasisPoints,
      normalizedComplianceBasisPoints: summary.normalizedComplianceBasisPoints,
      closingResult: data.closingAct?.result ?? null,
      closingRestrictions: data.closingAct?.restrictions ?? null,
      // `signedAt` lo estampa el servidor: la hora de firma no la declara el
      // cliente. Firma registrada (rol + nombre + momento), sin trazo.
      /*
       * INS-002 (auditoría 2026-09-14): un `userId` tecleado no se creía; ahora
       * se comprueba contra el registro de usuarios activos y, cuando existe, el
       * nombre lo pone la plataforma en vez del formulario. Una firma sin
       * `userId` —el representante del mandante, por ejemplo— sigue admitida,
       * pero queda marcada como declarada y no como verificada.
       */
      closingSignatures: data.closingAct
        ? data.closingAct.signatures.map((item) => {
            const verifiedUser = item.userId ? signerById.get(item.userId) : undefined
            return {
              role: item.role,
              name: verifiedUser?.name ?? item.name,
              userId: verifiedUser?.id ?? null,
              verified: Boolean(verifiedUser),
              capturedByUserId: access.userId,
              signedAt: now,
            }
          })
        : null,
      version: run.version + 1,
      updatedAt: now,
    }).where(and(eq(preventionInspectionRuns.id, run.id), eq(preventionInspectionRuns.version, expectedVersion))).returning()
    if (!updated) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")

    // `nextDueOn` NO se toca aquí (D-3, auditoría 2026-08-18). Lo mueve sólo
    // el materializador (`lib/services/prevention-inspection-scheduler.ts`) al
    // crear la ejecución del período. Avanzarlo también al completar contaba
    // dos veces el mismo ciclo, y hacerlo desde `hoy` en vez de desde el
    // vencimiento arrastraba el calendario legal (A-12).

    // Función #11: cerrar el círculo del inventario. `lastInspectedAt` y
    // `nextInspectionAt` existían con sus índices y sus alertas de vencimiento,
    // y nadie los escribía nunca desde una inspección real.
    if (run.subjectResourceId) {
      const today = todayInChile()
      let nextInspectionAt: string | null = null
      if (run.programId) {
        const [program] = await tx.select({ intervalDays: preventionInspectionPrograms.intervalDays })
          .from(preventionInspectionPrograms)
          .where(eq(preventionInspectionPrograms.id, run.programId)).limit(1)
        if (program) nextInspectionAt = nextDueAfter(today, program.intervalDays, today)
      }
      await tx.update(preventionEmergencyResources).set({
        lastInspectedAt: today,
        // Sólo se pisa si esta inspección define una cadencia; una ejecución
        // suelta no debe borrar la fecha que puso el módulo de emergencias.
        ...(nextInspectionAt ? { nextInspectionAt } : {}),
        updatedAt: now,
      }).where(eq(preventionEmergencyResources.id, run.subjectResourceId))
    }

    await history(tx, { entityType: "run", entityId: run.id, worksiteId: run.worksiteId, changeType: "completed", reason: `Ejecutada con ${summary.nonConforming} incumplimiento(s) y ${derived.length} hallazgo(s)`, beforeState: run, afterState: updated, actorUserId: access.userId })
    await recordOperationalActivity({
      eventType: "inspection.completed",
      module: "inspecciones",
      entityType: "inspection_run",
      entityId: updated.id,
      entityCode: updated.code,
      worksiteId: updated.worksiteId,
      actorUserId: access.userId,
      payload: { nonConforming: summary.nonConforming, findings: derived.length },
    }, tx)

    // Auto-acreditación PDTP: actividades declaradas en la plantilla. Comparte
    // la transacción con el cierre: nunca puede quedar el run completado sin su
    // cumplimiento ni una ejecución PDTP sin la inspección que la respalda.
    const pdtpActivityNumbers = Array.isArray((template as { pdtpActivityNumbers?: number[] }).pdtpActivityNumbers)
      ? (template as { pdtpActivityNumbers?: number[] }).pdtpActivityNumbers!
      : []
    const target = await resolvePdtpAccreditationTarget({ sourceType: "inspeccion", sourceId: run.templateId, eventType: "execute", legacyActivityNumbers: pdtpActivityNumbers }, tx)
    if (target.catalogActivityIds?.length || target.activityNumbers?.length) {
      await onInspectionCompleted({
        runId: run.id,
        worksiteId: run.worksiteId,
        completedAt: updated.executedAt ?? now,
        completedByUserId: access.userId,
        ...target,
      }, tx)
    }

    // El informe queda en Cloudreve con el estado que dejó este cierre. La
    // versión del run identifica la copia: reabrir y volver a cerrar es otra.
    await enqueueGeneratedDocumentTx(tx, {
      kind: "inspeccion",
      entityId: updated.id,
      milestone: updated.status === "reviewed" ? "revisada" : "completada",
      revision: updated.version,
      worksiteId: updated.worksiteId,
      occurredAt: now,
      actorUserId: access.userId,
    })

    return {
      run: updated,
      findings: derived.length,
      compliancePercent: summary.compliancePercent,
      officialCompliancePercent: summary.officialComplianceBasisPoints === null ? null : summary.officialComplianceBasisPoints / 100,
      normalizedCompliancePercent: summary.normalizedComplianceBasisPoints === null ? null : summary.normalizedComplianceBasisPoints / 100,
    }
  })

  // Un reintento offline no vuelve a notificar. El `dedupeKey` ya lo evitaría,
  // pero salir temprano ahorra la consulta de destinatarios.
  if ("alreadyCompleted" in result) return result

  // Cerrada al completar: no hay nada esperando a nadie.
  if (result.run.status === "reviewed") return result

  // A-08: quien puede revisar necesita enterarse de que hay algo esperándolo.
  // Post-commit y sin propagar el error, igual que la acreditación PDTP: una
  // notificación caída no puede revertir una inspección ya ejecutada.
  await notifySafely("pendiente de revisión", async () => {
    const reviewers = (await getUserIdsWithPermissionForWorksite("prevention:inspections:review", result.run.worksiteId))
      // Quien ejecutó no puede revisar (lo bloquea `assessRunReview`), así que
      // avisarle sería mandarlo a una acción que le va a ser negada.
      .filter((userId) => userId !== access.userId)
    if (reviewers.length === 0) return
    await createNotifications(reviewers, {
      type: "system_alert",
      title: "Inspección pendiente de revisión",
      body: `${result.run.code} fue declarada ejecutada${result.findings > 0 ? ` con ${result.findings} hallazgo(s)` : ""}.`,
      entityType: "inspection_run",
      entityId: result.run.id,
      entityHref: `/prevencion/inspecciones/${result.run.id}`,
      dedupeKey: `inspection:review:${result.run.id}`,
    })
  })

  return result
}

/**
 * Envía una notificación sin dejar que su fallo tumbe la operación de negocio
 * que ya se confirmó. Mismo criterio que `onInspectionCompleted`.
 */
async function notifySafely(label: string, send: () => Promise<void>) {
  try {
    await send()
  } catch (error) {
    logger.error({ err: error }, `[inspections] no se pudo notificar (${label})`)
  }
}

/**
 * Ítem del que se lee la lectura del medidor al derivar una mantención.
 *
 * Acopla el motor genérico a un `itemId` de una plantilla concreta, y eso es
 * deliberado: es el único checklist del catálogo que captura el horómetro, y
 * una plantilla que no lo declare simplemente deriva la mantención sin lectura
 * (`null`), no falla. La alternativa —declarar el rol del ítem en
 * `ChecklistItem`— es un campo nuevo en las 13 definiciones para un solo caso.
 * Si aparece un segundo checklist con medidor, ése es el momento de moverlo.
 */
const METER_ITEM_ID = "horometro_inicio"

/**
 * Lectura declarada en el run para el ítem de horómetro/odómetro, si la
 * plantilla lo pide. Viaja a la mantención derivada, que es lo que después
 * cruza `getUsageMaintenanceAlerts` contra los umbrales por uso.
 */
async function readMeterFromRun(client: Client, runId: string): Promise<number | null> {
  const [answer] = await client.select({ value: preventionInspectionAnswers.value })
    .from(preventionInspectionAnswers)
    .where(and(
      eq(preventionInspectionAnswers.runId, runId),
      eq(preventionInspectionAnswers.itemId, METER_ITEM_ID),
    )).limit(1)
  if (!answer?.value) return null
  const parsed = Number(answer.value.replace(",", "."))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/** Deriva un hallazgo a CAPA común con prioridad y plazo según su criticidad. */
export async function createFindingCapa(input: unknown, access: InspectionAccess) {
  const data = z.object({
    findingId: z.string().min(1),
    // I-24: alineado con el mínimo de los diálogos de motivo (ReasonDialog,
    // TRANSITION_REASON_MIN_LENGTH) — 3 caracteres no describe una acción correctiva.
    actionDescription: z.string().trim().min(10).max(3000),
    responsibleUserId: z.string().min(1),
    immediateMeasure: z.string().trim().max(3000).nullable().optional(),
  }).parse(input)

  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select({ finding: preventionInspectionFindings, run: preventionInspectionRuns })
      .from(preventionInspectionFindings)
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionFindings.runId, preventionInspectionRuns.id))
      .where(eq(preventionInspectionFindings.id, data.findingId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:execute", row.run.worksiteId)
    if (row.finding.capaActionId) throw new Error("El hallazgo ya tiene una acción CAPA enlazada.")

    const { priority, dueInDays, requiresImmediateStop } = capaPriorityForCriticality(row.finding.criticality)
    const capa = await createCapaActionWithClient(tx, {
      sourceType: "inspection",
      sourceId: row.run.id,
      worksiteId: row.run.worksiteId,
      finding: row.finding.description,
      potentialDamageDescription: row.finding.potentialDamageDescription,
      immediateMeasure: data.immediateMeasure ?? row.finding.immediateMeasure ?? null,
      actionDescription: data.actionDescription,
      responsibleUserId: data.responsibleUserId,
      priority,
      targetDate: addDays(todayInChile(), dueInDays),
      evidenceRequired: true,
      requiresImmediateStop,
      danoPotencial: row.finding.danoPotencial as "leve" | "moderado" | "grave" | "fatal" | null,
      normativaLegal: row.finding.applicableLaw,
    }, access.userId)

    const now = nowIso()
    const [updated] = await tx.update(preventionInspectionFindings).set({
      capaActionId: capa.id,
      immediateMeasure: data.immediateMeasure ?? row.finding.immediateMeasure,
      status: "capa_linked",
      updatedAt: now,
    }).where(eq(preventionInspectionFindings.id, data.findingId)).returning()
    if (!updated) throw new Error("No se pudo enlazar la acción CAPA.")
    await history(tx, { entityType: "finding", entityId: data.findingId, worksiteId: row.run.worksiteId, changeType: "capa_linked", reason: data.actionDescription, actorUserId: access.userId })

    // Mantención correctiva automática. Se engancha acá y no en `completeInspectionRun`
    // porque completar borra y recrea los hallazgos abiertos sin CAPA: colgarlo
    // de ahí dejaría órdenes huérfanas cada vez que alguien reabre y vuelve a
    // cerrar. Derivar, en cambio, es el acto deliberado que confirma el hallazgo
    // y, cuando el sujeto es un equipo, debe abrir siempre su trabajo correctivo.
    let maintenanceId: string | null = null
    if (row.run.subjectVehicleId) {
      const meter = await readMeterFromRun(tx, row.run.id)
      const [vehicle] = await tx.select({ meterType: fuelVehicles.meterType, worksiteId: fuelVehicles.worksiteId })
        .from(fuelVehicles).where(eq(fuelVehicles.id, row.run.subjectVehicleId)).limit(1)
      // El permiso se validó contra la faena de la inspección, pero la mantención
      // se escribe en la faena del equipo. Si el equipo ya fue trasladado, derivar
      // crearía una orden en una faena que este actor no autorizó.
      if (!vehicle) throw new Error("El equipo de la inspección ya no existe.")
      if (vehicle.worksiteId !== row.run.worksiteId) {
        throw new Error("El equipo pertenece a otra faena; actualiza la inspección antes de derivar la mantención.")
      }
      maintenanceId = await createMaintenanceRecordWithClient(tx, {
        vehicleId: row.run.subjectVehicleId,
        supplierId: "",
        costCenterId: "",
        // El plazo de la CAPA manda: la reparación y su acción correctiva
        // vencen el mismo día, o el taller y Prevención llevan dos calendarios.
        maintenanceDate: capa.targetDate,
        maintenanceType: "correctiva",
        status: "scheduled",
        odometerReading: vehicle.meterType === "odometer" ? meter : null,
        hourMeterReading: vehicle.meterType === "hour_meter" ? meter : null,
        netAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
        documentNumber: "",
        documentName: "",
        notes: `Deriva de ${row.run.code} · ${row.finding.description}`,
        inspectionFindingId: data.findingId,
      }, { actorUserId: access.userId, vehicle })
    }

    return { finding: updated, capaId: capa.id, maintenanceId, run: row.run, criticality: row.finding.criticality }
  })

  // Propuesta de fuera de servicio: se avisa, no se escribe. Bloquear el equipo
  // solo pararía la faena por un error de digitación, y quien decide sacarlo de
  // circulación es quien administra la flota. La confirmación es un clic con
  // `combustibles:manage_vehicles` — ver `stopVehicleForFinding`.
  // Post-commit y sin propagar el error, igual que el resto de los avisos.
  if (result.run.subjectVehicleId && ["high", "critical"].includes(result.criticality)) {
    const vehicleId = result.run.subjectVehicleId
    await notifySafely("equipo con falla grave", async () => {
      const targets = await getUserIdsWithPermissionForWorksite("combustibles:manage_vehicles", result.run.worksiteId)
      if (targets.length === 0) return
      await createNotifications(targets, {
        type: "system_alert",
        title: result.criticality === "critical" ? "Equipo con falla crítica" : "Equipo con falla grave",
        body: `${result.run.subjectLabel ?? "Equipo"} · ${result.run.code}: ${result.finding.description}. Revisa si corresponde sacarlo de servicio.`,
        entityType: "fuel_vehicle",
        entityId: vehicleId,
        entityHref: `/flota/${vehicleId}`,
        // Una vez por hallazgo: el aviso es la propuesta, no un recordatorio.
        dedupeKey: `inspection:vehicle-stop:${result.finding.id}`,
      })
    })
  }

  return result
}

/**
 * Confirma sacar de servicio el equipo de un hallazgo. Puerta aparte y con
 * permiso de flota a propósito: quien ejecuta la inspección detecta la falla,
 * pero detener un equipo es una decisión de quien administra la flota.
 */
export async function stopVehicleForFinding(input: unknown, access: InspectionAccess) {
  const data = z.object({
    findingId: z.string().min(1),
    reason: z.string().trim().min(TRANSITION_REASON_MIN_LENGTH).max(3000),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({ finding: preventionInspectionFindings, run: preventionInspectionRuns })
      .from(preventionInspectionFindings)
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionFindings.runId, preventionInspectionRuns.id))
      .where(eq(preventionInspectionFindings.id, data.findingId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    // Alcance de faena del actor; el permiso de flota lo exige la server action.
    if (!scopeAllows(access.scope, row.run.worksiteId)) throw new Error(NOT_FOUND)
    if (!row.run.subjectVehicleId) throw new Error("La inspección no tiene un equipo como sujeto.")

    await setVehicleOperationalStatus(tx, {
      vehicleId: row.run.subjectVehicleId,
      status: "fuera_servicio",
      reason: `${row.run.code} · ${row.finding.description} — ${data.reason}`,
      actorUserId: access.userId,
    })
    await history(tx, {
      entityType: "finding", entityId: row.finding.id, worksiteId: row.run.worksiteId,
      changeType: "vehicle_stopped", reason: data.reason, actorUserId: access.userId,
    })
    return { vehicleId: row.run.subjectVehicleId }
  })
}

/** Revisión y cierre independientes de quien ejecutó. */
export async function reviewInspectionRun(input: unknown, access: InspectionAccess) {
  const data = z.object({
    runId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    reviewComment: z.string().trim().min(10).max(3000),
  }).parse(input)

  return transitionInspectionRun({
    runId: data.runId,
    expectedVersion: data.expectedVersion,
    toStatus: "reviewed",
    reason: data.reviewComment,
  }, access)
}

/* ── Motor de transiciones ────────────────────────────────────────────────
 * Puerta única para revisar, cancelar y reabrir. Copia la estructura de
 * `transitionCapaActionWithClient` (lib/services/prevention-capa.ts): guarda
 * pura + doble CAS (chequeo previo y UPDATE condicionado por estado y versión)
 * + historial + actividad operacional.
 */

const runTransitionSchema = z.object({
  runId: z.string().min(1),
  expectedVersion: z.number().int().positive(),
  toStatus: z.enum(["in_progress", "reviewed", "cancelled"]),
  reason: z.string().trim().max(3000).optional(),
})

/** Campos que cada destino escribe, más allá del estado y la versión. */
function transitionChangeSet(toStatus: string, actorUserId: string, reason: string | undefined, now: string) {
  if (toStatus === "reviewed") {
    return { reviewedByUserId: actorUserId, reviewedAt: now, reviewComment: reason ?? null }
  }
  if (toStatus === "cancelled") {
    // El CHECK `prevention_inspection_run_cancel_consistent` exige los tres juntos.
    return { cancelledByUserId: actorUserId, cancelledAt: now, cancellationReason: reason ?? null }
  }
  // Reabrir: la ejecución deja de existir, así que se limpia todo lo que la
  // declaraba. Conservar `compliancePercent` afirmaría un resultado que ya no
  // corresponde a ninguna respuesta cerrada.
  return {
    executedByUserId: null, executedAt: null,
    reviewedByUserId: null, reviewedAt: null, reviewComment: null,
    compliancePercent: null,
    officialComplianceBasisPoints: null,
    normalizedComplianceBasisPoints: null,
    conformingCount: 0, partialCount: 0, nonConformingCount: 0, notApplicableCount: 0,
  }
}

export async function transitionInspectionRun(input: unknown, access: InspectionAccess) {
  const data = runTransitionSchema.parse(input)

  // La acreditación de revisión y su reversión comparten esta transacción. La
  // firma de la inspección y el cumplimiento anual son una única verdad de BD:
  // o se confirman ambos, o ninguno.
  const result = await db.transaction(async (tx) => {
    const [run] = await tx.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
    if (!run) throw new Error(NOT_FOUND)
    // El alcance de faena se comprueba siempre; el permiso concreto lo decide
    // la guarda según el destino.
    if (!scopeAllows(access.scope, run.worksiteId)) throw new Error(NOT_FOUND)
    if (run.version !== data.expectedVersion) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")

    const findings = await tx.select().from(preventionInspectionFindings)
      .where(eq(preventionInspectionFindings.runId, run.id))

    // Quién es el ejecutante de registro lo declara la plantilla: en el report de
    // uso diario lo ejecuta el operador en papel y quien completa el run sólo lo
    // transcribe, así que el candado de independencia no debe bloquearle la firma
    // (D04). Ver `assessRunReview`.
    const [runTemplate] = await tx.select({ executorOfRecord: preventionInspectionTemplates.executorOfRecord })
      .from(preventionInspectionTemplates)
      .where(eq(preventionInspectionTemplates.id, run.templateId)).limit(1)

    assertInspectionRunTransition({
      fromStatus: run.status as InspectionRunStatus,
      toStatus: data.toStatus,
      permissions: access.permissions,
      actorUserId: access.userId,
      executedByUserId: run.executedByUserId,
      executorOfRecord: runTemplate?.executorOfRecord ?? null,
      reason: data.reason,
      findings: findings.map((finding) => ({
        id: finding.id,
        description: finding.description,
        criticality: finding.criticality,
        capaActionId: finding.capaActionId,
      })),
    })

    const now = nowIso()

    if (data.toStatus === "in_progress") {
      /* Los hallazgos con CAPA sobreviven: la acción correctiva ya vive en otro
       * módulo y borrarla en cascada destruiría evidencia. Es la misma
       * sentencia que usa `completeInspectionRun` al rehacerlos.
       *
       * Las desviaciones también sobreviven: son lo que una persona encontró en
       * terreno, no un artefacto recalculable a partir de las respuestas.
       * Reabrir para corregir un dato no puede obligar a volver a escribirlas. */
      await tx.delete(preventionInspectionFindings).where(and(
        eq(preventionInspectionFindings.runId, run.id),
        eq(preventionInspectionFindings.origin, "derived"),
        sql`${preventionInspectionFindings.capaActionId} IS NULL`,
      ))
    }

    const [updated] = await tx.update(preventionInspectionRuns).set({
      status: data.toStatus,
      ...transitionChangeSet(data.toStatus, access.userId, data.reason, now),
      version: run.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionRuns.id, run.id),
      eq(preventionInspectionRuns.status, run.status),
      eq(preventionInspectionRuns.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")

    await history(tx, {
      entityType: "run", entityId: run.id, worksiteId: run.worksiteId,
      changeType: data.toStatus === "in_progress" ? "reopened" : data.toStatus,
      reason: data.reason ?? "",
      beforeState: run, afterState: updated, actorUserId: access.userId,
    })
    await recordOperationalActivity({
      // La reapertura anula un `compliancePercent` ya publicado: sin su propio
      // evento, la serie temporal no puede explicar la discontinuidad.
      eventType: data.toStatus === "in_progress" ? "inspection.reopened" : `inspection.${data.toStatus}`,
      module: "inspecciones",
      entityType: "inspection_run",
      entityId: updated.id,
      entityCode: updated.code,
      worksiteId: updated.worksiteId,
      actorUserId: access.userId,
      payload: { status: updated.status },
    }, tx)

    // El programa distingue ejecutar de revisar y firmar, y les pone
    // responsables distintos. La firma es este acto, no el anterior: acá el
    // servicio ya garantizó que el revisor no es quien ejecutó
    // (`assertInspectionRunTransition` → `assessRunReview`), que es justo la
    // independencia que la actividad exige.
    if (data.toStatus === "reviewed") {
      const [template] = await tx.select({ numbers: preventionInspectionTemplates.pdtpReviewActivityNumbers })
        .from(preventionInspectionTemplates)
        .where(eq(preventionInspectionTemplates.id, run.templateId)).limit(1)
      const activityNumbers = Array.isArray(template?.numbers) ? template.numbers : []
      const target = await resolvePdtpAccreditationTarget({ sourceType: "inspeccion", sourceId: run.templateId, eventType: "review", legacyActivityNumbers: activityNumbers }, tx)
      if (target.catalogActivityIds?.length || target.activityNumbers?.length) {
        await onInspectionCompleted({
          runId: run.id,
          worksiteId: run.worksiteId,
          completedAt: updated.reviewedAt ?? now,
          completedByUserId: access.userId,
          ...target,
        }, tx)
      }
    }
    // Sólo se revoca lo que alguna vez se acreditó: un run que nunca pasó de
    // `planned` no tiene nada que devolver, y llamar igual gastaría una consulta
    // por cada cancelación de una inspección jamás ejecutada.
    if ((data.toStatus === "cancelled" || data.toStatus === "in_progress") && run.executedAt) {
      await onInspectionReverted({
        runId: run.id,
        worksiteId: run.worksiteId,
        reason: data.toStatus === "cancelled"
          ? `Inspección ${run.code} cancelada: ${data.reason ?? "sin motivo declarado"}`
          : `Inspección ${run.code} reabierta para rectificar: ${data.reason ?? "sin motivo declarado"}`,
        revokedBy: access.userId,
      }, tx)
    }
    // La revisión firma el informe: es una copia nueva en Cloudreve, además de
    // la que dejó el cierre en `completed`.
    if (data.toStatus === "reviewed") {
      await enqueueGeneratedDocumentTx(tx, {
        kind: "inspeccion",
        entityId: updated.id,
        milestone: "revisada",
        revision: updated.version,
        worksiteId: updated.worksiteId,
        occurredAt: now,
        actorUserId: access.userId,
      })
    }
    return updated
  })

  return result
}

/* ── Evidencia fotográfica (función #1) ───────────────────────────────────
 * `evidenceReference` existía en el esquema y en el export desde el principio,
 * y ninguna pantalla adjuntaba nada: una inspección sin foto del hallazgo no
 * sirve como evidencia. Se modela 1-a-N porque un incumplimiento suele
 * necesitar más de un ángulo.
 */

/** Resuelve la respuesta y comprueba que su inspección siga siendo editable. */
async function requireEditableAnswer(client: Client, answerId: string, access: InspectionAccess) {
  const [row] = await client.select({ answer: preventionInspectionAnswers, run: preventionInspectionRuns })
    .from(preventionInspectionAnswers)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionAnswers.runId))
    .where(eq(preventionInspectionAnswers.id, answerId)).limit(1)
  if (!row) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:execute", row.run.worksiteId)
  // Mismo criterio que `saveAnswersWithClient`: sin esto se podría adjuntar o
  // borrar evidencia de una inspección ya revisada.
  if (!["planned", "in_progress"].includes(row.run.status)) {
    throw new Error("No se puede modificar la evidencia de una inspección ya ejecutada.")
  }
  return row
}

/* ── Documento origen: la foto de la planilla ─────────────────────────────── */

/**
 * Adjunta la foto de la planilla física al run.
 *
 * El alcance y la editabilidad se comprueban contra el run real, no contra un
 * `worksiteId` que venga en el formulario — mismo criterio que
 * `addAnswerEvidence`.
 */
export async function addRunDocument(input: {
  runId: string
  path: string
  fileName?: string | null
  mimeType?: string | null
  fileSize?: number | null
  checksumSha256?: string | null
  caption?: string | null
  kind?: "source_form" | "attachment"
  /**
   * Lo que leyó el detector de marcas. **Modo sombra**: se guarda para poder
   * medirlo contra lo que teclee la persona, y NO pre-llena respuestas. El
   * pre-llenado se enciende cuando la medición lo respalde.
   */
  extraction?: {
    layoutVersion: string
    cells: { sectionId: string; itemId: string; result: string; confidence: number }[]
  } | null
}, access: InspectionAccess) {
  const [run] = await db.select().from(preventionInspectionRuns)
    .where(eq(preventionInspectionRuns.id, input.runId)).limit(1)
  if (!run) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:ingest", run.worksiteId)
  if (["reviewed", "cancelled"].includes(run.status)) {
    throw new Error("No se pueden adjuntar documentos a una inspección cerrada o cancelada.")
  }
  const [created] = await db.insert(preventionInspectionRunDocuments).values({
    id: `insdoc-${nanoid()}`,
    runId: input.runId,
    path: input.path,
    fileName: input.fileName ?? null,
    mimeType: input.mimeType ?? null,
    fileSize: input.fileSize ?? null,
    checksumSha256: input.checksumSha256 ?? null,
    kind: input.kind ?? "source_form",
    caption: input.caption ?? null,
    extraction: input.extraction ?? null,
    uploadedByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo adjuntar el documento.")
  await history(db, {
    entityType: "run", entityId: run.id, worksiteId: run.worksiteId,
    changeType: "document_attached", reason: input.caption ?? "Planilla adjunta",
    actorUserId: access.userId,
  })
  return created
}

export async function deleteRunDocument(input: { documentId: string }, access: InspectionAccess) {
  const [row] = await db.select({ document: preventionInspectionRunDocuments, run: preventionInspectionRuns })
    .from(preventionInspectionRunDocuments)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionRunDocuments.runId))
    .where(eq(preventionInspectionRunDocuments.id, input.documentId)).limit(1)
  if (!row) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:ingest", row.run.worksiteId)
  if (["reviewed", "cancelled"].includes(row.run.status)) {
    throw new Error("No se pueden quitar documentos de una inspección cerrada o cancelada.")
  }
  await db.delete(preventionInspectionRunDocuments)
    .where(eq(preventionInspectionRunDocuments.id, input.documentId))
  // El archivo físico lo recoge el GC de evidencias, igual que las fotos de respuesta.
  return { id: input.documentId }
}

export async function addAnswerEvidence(input: {
  answerId: string
  path: string
  caption?: string | null
}, access: InspectionAccess) {
  const data = z.object({
    answerId: z.string().min(1),
    // El path lo produce la ruta de subida, nunca el usuario: se valida el
    // prefijo igual que hace PDTP para que nadie inyecte una ruta arbitraria.
    path: z.string().regex(/^storage\/inspection-evidence\/[A-Za-z0-9._-]+$/, "Ruta de evidencia inválida."),
    caption: z.string().trim().max(300).nullable().optional(),
  }).parse(input)

  const row = await requireEditableAnswer(db, data.answerId, access)
  const [created] = await db.insert(preventionInspectionAnswerEvidence).values({
    id: `insev-${nanoid()}`,
    answerId: data.answerId,
    path: data.path,
    caption: data.caption ?? null,
    uploadedByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo adjuntar la evidencia.")
  await history(db, {
    entityType: "answer", entityId: data.answerId, worksiteId: row.run.worksiteId,
    changeType: "evidence_added", reason: `Evidencia adjuntada a "${row.answer.itemLabel}"`,
    actorUserId: access.userId,
  })
  return created
}

async function requireFindingEvidenceTarget(findingId: string, access: InspectionAccess) {
  const [row] = await db.select({ finding: preventionInspectionFindings, run: preventionInspectionRuns })
    .from(preventionInspectionFindings)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionFindings.runId))
    .where(eq(preventionInspectionFindings.id, findingId)).limit(1)
  if (!row) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:execute", row.run.worksiteId)
  if (!["planned", "in_progress", "completed"].includes(row.run.status)) {
    throw new Error("No se puede adjuntar evidencia a una inspección cerrada o cancelada.")
  }
  return row
}

/** Valida autorización y estado antes de escribir el archivo físico. */
export async function assertFindingEvidenceUploadAllowed(findingId: string, access: InspectionAccess) {
  await requireFindingEvidenceTarget(z.string().min(1).parse(findingId), access)
}

export async function addFindingEvidence(input: {
  findingId: string
  path: string
  fileName: string
  mimeType: string
  fileSize: number
  checksumSha256: string
  caption?: string | null
}, access: InspectionAccess) {
  const data = z.object({
    findingId: z.string().min(1),
    path: z.string().regex(/^storage\/inspection-evidence\/[A-Za-z0-9._-]+$/, "Ruta de evidencia inválida."),
    fileName: z.string().trim().min(1).max(500),
    mimeType: z.string().trim().min(1).max(200),
    fileSize: z.number().int().positive().max(25 * 1024 * 1024),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    caption: z.string().trim().max(500).nullable().optional(),
  }).parse(input)

  const row = await requireFindingEvidenceTarget(data.findingId, access)
  const [created] = await db.insert(preventionInspectionFindingEvidence).values({
    id: `insfev-${nanoid()}`,
    findingId: row.finding.id,
    path: data.path,
    fileName: data.fileName,
    mimeType: data.mimeType,
    fileSize: data.fileSize,
    checksumSha256: data.checksumSha256,
    caption: data.caption ?? null,
    uploadedByUserId: access.userId,
  }).returning()
  if (!created) throw new Error("No se pudo adjuntar la evidencia al hallazgo.")
  await history(db, {
    entityType: "finding", entityId: row.finding.id, worksiteId: row.run.worksiteId,
    changeType: "evidence_added", reason: data.caption ?? data.fileName,
    actorUserId: access.userId,
  })
  return created
}

export async function deleteAnswerEvidence(input: { evidenceId: string }, access: InspectionAccess) {
  const data = z.object({ evidenceId: z.string().min(1) }).parse(input)
  const [evidence] = await db.select().from(preventionInspectionAnswerEvidence)
    .where(eq(preventionInspectionAnswerEvidence.id, data.evidenceId)).limit(1)
  if (!evidence) throw new Error(NOT_FOUND)
  const row = await requireEditableAnswer(db, evidence.answerId, access)

  await db.delete(preventionInspectionAnswerEvidence)
    .where(eq(preventionInspectionAnswerEvidence.id, data.evidenceId))
  // El archivo físico no se borra aquí: lo recoge el GC de evidencias, que ya
  // recorre el directorio comparándolo contra las referencias en BD.
  await history(db, {
    entityType: "answer", entityId: evidence.answerId, worksiteId: row.run.worksiteId,
    changeType: "evidence_removed", reason: `Evidencia eliminada de "${row.answer.itemLabel}"`,
    actorUserId: access.userId,
  })
  return { deleted: 1 }
}

/**
 * Reasignar el ejecutante de una inspección aún no ejecutada (función #12).
 *
 * Función hermana del motor de transiciones, no un destino más: no cambia de
 * estado. Meter cambios de campo arbitrarios en `transitionInspectionRun` lo
 * convertiría en un `update` genérico y le haría perder su valor como guarda.
 */
export async function reassignInspectionRun(input: unknown, access: InspectionAccess) {
  const data = z.object({
    runId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    assignedToUserId: z.string().min(1).nullable(),
    reason: z.string().trim().min(TRANSITION_REASON_MIN_LENGTH).max(3000),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(preventionInspectionRuns)
      .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
    if (!run) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:manage", run.worksiteId)
    if (run.version !== data.expectedVersion) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")
    if (!["planned", "in_progress"].includes(run.status)) {
      throw new Error("Sólo puede reasignarse una inspección que aún no fue ejecutada.")
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionInspectionRuns).set({
      assignedToUserId: data.assignedToUserId,
      version: run.version + 1,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionRuns.id, run.id),
      eq(preventionInspectionRuns.version, data.expectedVersion),
    )).returning()
    if (!updated) throw new Error("La inspección cambió mientras la editabas. Recarga y reintenta.")

    await history(tx, {
      entityType: "run", entityId: run.id, worksiteId: run.worksiteId,
      changeType: "reassigned", reason: data.reason,
      beforeState: run, afterState: updated, actorUserId: access.userId,
    })
    return updated
  })
}

/**
 * Cierre manual de un hallazgo, para los que no derivaron en CAPA (típicamente
 * bajos y medios, que `assessRunReview` no obliga a derivar).
 *
 * Los que sí tienen CAPA se cierran solos cuando su acción se verifica o
 * cierra — ver la cascada en `transitionCapaActionWithClient`. Cerrar a mano
 * uno con CAPA abierta sería declarar resuelto lo que la acción aún no resolvió.
 */
export async function closeInspectionFinding(input: unknown, access: InspectionAccess) {
  const data = z.object({
    findingId: z.string().min(1),
    reason: z.string().trim().min(TRANSITION_REASON_MIN_LENGTH).max(3000),
  }).parse(input)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({ finding: preventionInspectionFindings, run: preventionInspectionRuns })
      .from(preventionInspectionFindings)
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionFindings.runId, preventionInspectionRuns.id))
      .where(eq(preventionInspectionFindings.id, data.findingId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:review", row.run.worksiteId)
    if (row.finding.status === "closed") throw new Error("El hallazgo ya está cerrado.")
    if (row.finding.capaActionId) {
      throw new Error("El hallazgo tiene una acción CAPA: se cierra al verificar o cerrar esa acción.")
    }

    const now = nowIso()
    const [updated] = await tx.update(preventionInspectionFindings).set({
      status: "closed",
      closedByUserId: access.userId,
      closedAt: now,
      updatedAt: now,
    }).where(and(
      eq(preventionInspectionFindings.id, data.findingId),
      eq(preventionInspectionFindings.status, row.finding.status),
    )).returning()
    if (!updated) throw new Error("El hallazgo cambió mientras lo cerrabas. Recarga y reintenta.")

    await history(tx, {
      entityType: "finding", entityId: data.findingId, worksiteId: row.run.worksiteId,
      changeType: "closed", reason: data.reason,
      beforeState: row.finding, afterState: updated, actorUserId: access.userId,
    })
    return updated
  })
}

/* ── Consultas ────────────────────────────────────────────────────────────── */

/**
 * Las auditorías del Sistema de Gestión (`kind: 'audit'`) viven en su propia
 * pantalla, así que cada listado declara qué tipos muestra. Sin el filtro, una
 * auditoría aparecería a la vez en Inspecciones y en Auditorías.
 */
export type InspectionKindFilter = { kinds?: readonly string[] }

function kindCondition({ kinds }: InspectionKindFilter = {}) {
  return kinds?.length ? inArray(preventionInspectionTemplates.kind, [...kinds]) : undefined
}

/**
 * C-09: el listado traía 500 filas y la pantalla calculaba filtros y KPIs sobre
 * ellas. Pasadas las 500 ejecuciones los contadores mentían en silencio y el
 * export truncaba sin avisar.
 *
 * Tres piezas separadas a propósito:
 *   - `listInspectionRuns`: una página de datos.
 *   - `summarizeInspectionRuns`: los KPIs sobre el universo completo.
 *   - `listAllInspectionRunsForExport`: sin paginar, porque exportar la primera
 *     página sería un fallo silencioso de integridad.
 */
export interface InspectionListFilters extends InspectionKindFilter {
  status?: string
  worksiteId?: string
  /** Texto libre sobre código, plantilla, sujeto y faena. */
  search?: string
  /** Vista rápida de la pantalla: pendientes de revisión, con hallazgos, graves. */
  view?: "pending_review" | "open_findings" | "critical" | "overdue"
  /** I-10: "¿qué le debe cada prevencionista?" — sin esto la jefa no podía gestionar por responsable. */
  assignedToUserId?: string
  /**
   * I-10: rango sobre la fecha de EJECUCIÓN (no la programada) — responde
   * "cómo cerró [mes]", que es la pregunta real de cierre de período. Los
   * nombres llevan `executed` y no `scheduled` para que no mientan sobre qué
   * comparan. `executedAt` es `timestamptz`; se castea a día de Chile con el
   * mismo patrón que `prevention-incidents.ts` y `operational-trend-history.ts`.
   */
  executedFrom?: string
  executedTo?: string
}

const OPEN_FINDINGS_SQL = sql<number>`(SELECT COUNT(*)::int FROM prevention_inspection_findings f WHERE f.run_id = ${preventionInspectionRuns.id} AND f.status <> 'closed')`
const CRITICAL_FINDINGS_SQL = sql<number>`(SELECT COUNT(*)::int FROM prevention_inspection_findings f WHERE f.run_id = ${preventionInspectionRuns.id} AND f.criticality IN ('high','critical') AND f.status <> 'closed')`

function listFilterConditions(access: InspectionAccess, filter: InspectionListFilters) {
  const conditions = [
    scopeCondition(access.scope, preventionInspectionRuns.worksiteId),
    kindCondition(filter),
  ]
  if (filter.status) conditions.push(eq(preventionInspectionRuns.status, filter.status))
  if (filter.worksiteId) conditions.push(eq(preventionInspectionRuns.worksiteId, filter.worksiteId))
  if (filter.assignedToUserId) conditions.push(eq(preventionInspectionRuns.assignedToUserId, filter.assignedToUserId))
  if (filter.executedFrom) conditions.push(sql`(${preventionInspectionRuns.executedAt} AT TIME ZONE 'America/Santiago')::date >= ${filter.executedFrom}`)
  if (filter.executedTo) conditions.push(sql`(${preventionInspectionRuns.executedAt} AT TIME ZONE 'America/Santiago')::date <= ${filter.executedTo}`)
  if (filter.view === "pending_review") conditions.push(eq(preventionInspectionRuns.status, "completed"))
  if (filter.view === "open_findings") conditions.push(sql`${OPEN_FINDINGS_SQL} > 0`)
  if (filter.view === "critical") conditions.push(sql`${CRITICAL_FINDINGS_SQL} > 0`)
  // I-31: mismo predicado que ya usa el `ORDER BY` para priorizar vencidas.
  if (filter.view === "overdue") {
    conditions.push(sql`${preventionInspectionRuns.status} IN ('planned', 'in_progress')
      AND ${preventionInspectionRuns.scheduledFor} IS NOT NULL
      AND ${preventionInspectionRuns.scheduledFor} < ${todayInChile()}`)
  }
  if (filter.search?.trim()) {
    // `unaccent` no está garantizado en la base; `ILIKE` cubre el caso real
    // (buscar por código o por nombre de plantilla) sin depender de extensiones.
    const pattern = `%${filter.search.trim().replace(/[%_]/g, (match) => `\\${match}`)}%`
    conditions.push(sql`(
      ${preventionInspectionRuns.code} ILIKE ${pattern}
      OR ${preventionInspectionTemplates.name} ILIKE ${pattern}
      OR COALESCE(${preventionInspectionRuns.subjectLabel}, '') ILIKE ${pattern}
      OR ${worksites.name} ILIKE ${pattern}
    )`)
  }
  return and(...conditions)
}

/**
 * I-10/I-18: `assigneeName` sustituye a la columna "Origen" de la bandeja, que
 * decía "Departamento de Prevención" en prácticamente todas las filas.
 * Función, no objeto: el alias de `users` se crea una vez por llamada (mismo
 * patrón que `executor`/`reviewer` más abajo), así que cada consumidor pasa
 * el suyo.
 */
function runListSelection(assignee: { name: AnyPgColumn }) {
  return {
    run: preventionInspectionRuns,
    templateName: preventionInspectionTemplates.name,
    templateKind: preventionInspectionTemplates.kind,
    worksiteName: worksites.name,
    assigneeName: assignee.name,
    openFindings: OPEN_FINDINGS_SQL,
    criticalFindings: CRITICAL_FINDINGS_SQL,
  }
}

export const INSPECTION_PAGE_SIZE = 50

export async function listInspectionRuns(
  access: InspectionAccess,
  filter: InspectionListFilters = {},
  page: { limit?: number; offset?: number } = {},
) {
  requireAccess(access, "prevention:inspections:view")
  const assignee = alias(users, "inspection_list_assignee")
  return db.select(runListSelection(assignee))
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
    .leftJoin(assignee, eq(preventionInspectionRuns.assignedToUserId, assignee.id))
    .where(listFilterConditions(access, filter))
    // Bandeja orientada a la tarea: primero lo vencido, luego lo que espera
    // revisión y después el resto. La fecha y el id mantienen el orden estable
    // entre ejecuciones creadas por un mismo barrido.
    .orderBy(
      sql`CASE
        WHEN ${preventionInspectionRuns.status} IN ('planned', 'in_progress')
          AND ${preventionInspectionRuns.scheduledFor} IS NOT NULL
          AND ${preventionInspectionRuns.scheduledFor} < ${todayInChile()} THEN 0
        WHEN ${preventionInspectionRuns.status} = 'completed' THEN 1
        WHEN ${preventionInspectionRuns.status} = 'in_progress' THEN 2
        WHEN ${preventionInspectionRuns.status} = 'planned' THEN 3
        ELSE 4
      END`,
      asc(preventionInspectionRuns.scheduledFor),
      desc(preventionInspectionRuns.createdAt),
      desc(preventionInspectionRuns.id),
    )
    .limit(page.limit ?? INSPECTION_PAGE_SIZE)
    .offset(page.offset ?? 0)
}

/** KPIs sobre el universo completo, no sobre la página visible (C-09). */
export async function summarizeInspectionRuns(access: InspectionAccess, filter: InspectionListFilters = {}) {
  requireAccess(access, "prevention:inspections:view")
  const [row] = await db.select({
    total: sql<number>`COUNT(*)::int`,
    // I-30: sin la exclusión, contaba también lo que el propio usuario
    // ejecutó — que no puede revisar (assessRunReview) — sobrestimando la
    // cola accionable de quien también ejecuta.
    pendingReview: sql<number>`COUNT(*) FILTER (WHERE ${preventionInspectionRuns.status} = 'completed' AND ${preventionInspectionRuns.executedByUserId} IS DISTINCT FROM ${access.userId})::int`,
    withOpenFindings: sql<number>`COUNT(*) FILTER (WHERE ${OPEN_FINDINGS_SQL} > 0)::int`,
    withCriticalFindings: sql<number>`COUNT(*) FILTER (WHERE ${CRITICAL_FINDINGS_SQL} > 0)::int`,
    // I-31: mismo predicado que la vista rápida "Vencidas" y que el ORDER BY.
    overdueRuns: sql<number>`COUNT(*) FILTER (WHERE ${preventionInspectionRuns.status} IN ('planned', 'in_progress') AND ${preventionInspectionRuns.scheduledFor} IS NOT NULL AND ${preventionInspectionRuns.scheduledFor} < ${todayInChile()})::int`,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
    .where(listFilterConditions(access, filter))
  return row ?? { total: 0, pendingReview: 0, withOpenFindings: 0, withCriticalFindings: 0, overdueRuns: 0 }
}

/**
 * Universo completo para el export. NO comparte función con la vista paginada
 * a propósito: si alguien las unifica más adelante, el Excel vuelve a truncarse
 * en silencio, que es el defecto que C-09 corrige.
 */
export async function listAllInspectionRunsForExport(access: InspectionAccess, filter: InspectionListFilters = {}) {
  requireAccess(access, "prevention:inspections:view")
  // Los alias se crean UNA vez: `alias()` devuelve un objeto nuevo en cada
  // llamada, así que repetirlo en el select y en el join produciría dos tablas
  // distintas con el mismo nombre.
  const assignee = alias(users, "inspection_export_assignee")
  const executor = alias(users, "inspection_export_executor")
  const reviewer = alias(users, "inspection_export_reviewer")
  return db.select({
    ...runListSelection(assignee),
    // A-07: el Excel volcaba los IDs crudos de usuario.
    executorName: executor.name,
    reviewerName: reviewer.name,
    // El cuestionario congelado, para que la hoja de respuestas pueda nombrar
    // la sección y traducir el resultado con la escala del instrumento
    // (INS-07/INS-13). No va en `runListSelection`: la bandeja paginada no lo
    // usa y arrastraría el JSON completo en cada página.
    templateSnapshot: preventionInspectionTemplates.definitionSnapshot,
    templateProvenanceKind: preventionInspectionTemplates.provenanceKind,
    templateSourceSnapshot: preventionInspectionTemplates.sourceSnapshot,
    templateContentHash: preventionInspectionTemplates.contentHash,
    templateParityReport: preventionInspectionTemplates.parityReport,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
    .leftJoin(assignee, eq(preventionInspectionRuns.assignedToUserId, assignee.id))
    .leftJoin(executor, eq(preventionInspectionRuns.executedByUserId, executor.id))
    .leftJoin(reviewer, eq(preventionInspectionRuns.reviewedByUserId, reviewer.id))
    .where(listFilterConditions(access, filter))
    .orderBy(
      sql`CASE
        WHEN ${preventionInspectionRuns.status} IN ('planned', 'in_progress')
          AND ${preventionInspectionRuns.scheduledFor} IS NOT NULL
          AND ${preventionInspectionRuns.scheduledFor} < ${todayInChile()} THEN 0
        WHEN ${preventionInspectionRuns.status} = 'completed' THEN 1
        WHEN ${preventionInspectionRuns.status} = 'in_progress' THEN 2
        WHEN ${preventionInspectionRuns.status} = 'planned' THEN 3
        ELSE 4
      END`,
      asc(preventionInspectionRuns.scheduledFor),
      desc(preventionInspectionRuns.createdAt),
      desc(preventionInspectionRuns.id),
    )
}

export async function getInspectionRunDetail(runId: string, access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view")
  const assignee = alias(users, "inspection_assignee")
  const executor = alias(users, "inspection_executor")
  const reviewer = alias(users, "inspection_reviewer")
  const [run] = await db.select({
    run: preventionInspectionRuns,
    templateName: preventionInspectionTemplates.name,
    templateKind: preventionInspectionTemplates.kind,
    sourceDefinitionCode: preventionInspectionTemplates.sourceDefinitionCode,
    definitionSnapshot: preventionInspectionTemplates.definitionSnapshot,
    // Enlace fuente → PDTP: hasta ahora sólo existía el inverso
    // (`findInspectionTemplateForPdtpActivity`), así que quien abría una
    // inspección no podía saber si alimentaba el programa anual ni con qué.
    pdtpActivityNumbers: preventionInspectionTemplates.pdtpActivityNumbers,
    pdtpReviewActivityNumbers: preventionInspectionTemplates.pdtpReviewActivityNumbers,
    templateId: preventionInspectionTemplates.id,
    templateCode: preventionInspectionTemplates.code,
    worksiteName: worksites.name,
    assigneeName: assignee.name,
    executorName: executor.name,
    reviewerName: reviewer.name,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionRuns.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionRuns.worksiteId, worksites.id))
    .leftJoin(assignee, eq(preventionInspectionRuns.assignedToUserId, assignee.id))
    .leftJoin(executor, eq(preventionInspectionRuns.executedByUserId, executor.id))
    .leftJoin(reviewer, eq(preventionInspectionRuns.reviewedByUserId, reviewer.id))
    .where(eq(preventionInspectionRuns.id, runId)).limit(1)
  if (!run || !scopeAllows(access.scope, run.run.worksiteId)) return null

  const [answers, findings, documents, participants] = await Promise.all([
    db.select().from(preventionInspectionAnswers).where(eq(preventionInspectionAnswers.runId, runId)),
    db.select().from(preventionInspectionFindings).where(eq(preventionInspectionFindings.runId, runId)),
    db.select().from(preventionInspectionRunDocuments)
      .where(eq(preventionInspectionRunDocuments.runId, runId))
      .orderBy(asc(preventionInspectionRunDocuments.createdAt)),
    db.select().from(preventionInspectionRunParticipants)
      .where(eq(preventionInspectionRunParticipants.runId, runId))
      .orderBy(asc(preventionInspectionRunParticipants.sortOrder)),
  ])
  // Evidencia por respuesta (función #1). Se consulta aparte y se agrupa en
  // memoria: son pocas filas por inspección y evita un join que duplicaría
  // cada respuesta por cada foto.
  const evidence = answers.length === 0 ? [] : await db.select()
    .from(preventionInspectionAnswerEvidence)
    .where(inArray(preventionInspectionAnswerEvidence.answerId, answers.map((row) => row.id)))
  const evidenceByAnswer = new Map<string, typeof evidence>()
  for (const item of evidence) {
    const list = evidenceByAnswer.get(item.answerId) ?? []
    list.push(item)
    evidenceByAnswer.set(item.answerId, list)
  }
  const findingEvidence = findings.length === 0 ? [] : await db.select()
    .from(preventionInspectionFindingEvidence)
    .where(inArray(preventionInspectionFindingEvidence.findingId, findings.map((row) => row.id)))
  const evidenceByFinding = new Map<string, typeof findingEvidence>()
  for (const item of findingEvidence) {
    const list = evidenceByFinding.get(item.findingId) ?? []
    list.push(item)
    evidenceByFinding.set(item.findingId, list)
  }
  /* Lo que este instrumento ofrece, sólo si registra desviaciones. Una
   * plantilla de checklist no lo necesita: ahí la gravedad la declara el ítem.
   * Por CÓDIGO y no por id de fila: la selección pertenece al instrumento, no a
   * la versión, y así sobrevive a un versionado. */
  const definition = run.definitionSnapshot as unknown as ChecklistDefinition
  const deviationCatalog = definition?.recordsDeviations
    ? await listOfferedDeviations(run.templateCode)
    : []

  return {
    ...run,
    answers: answers.map((row) => ({ ...row, evidence: evidenceByAnswer.get(row.id) ?? [] })),
    findings: findings.map((row) => ({ ...row, evidence: evidenceByFinding.get(row.id) ?? [] })),
    documents,
    participants,
    /** El instrumento registra desviaciones en vez de puntuar ítems. */
    recordsDeviations: Boolean(definition?.recordsDeviations),
    recordsPreventiveActions: Boolean(definition?.recordsPreventiveActions),
    /* Ya vienen con la gravedad efectiva y su criticidad resueltas. */
    deviationCatalog,
  }
}

/** Reemplaza atómicamente la lista ordenada de participantes del Anexo 08. */
export async function saveInspectionParticipants(input: unknown, access: InspectionAccess) {
  const data = z.object({
    runId: z.string().min(1),
    participants: z.array(z.object({
      name: z.string().trim().min(2).max(200),
      position: z.string().trim().min(2).max(200),
      userId: z.string().min(1).nullable().optional(),
    })).min(1).max(30),
  }).parse(input)

  return db.transaction(async (tx) => {
    const { run, sourceDefinitionCode } = await requireEditableRunForDeviation(tx, data.runId, access)
    if (sourceDefinitionCode !== "inspeccion_no_planeada") {
      throw new Error("Los participantes estructurados corresponden al Anexo 08.")
    }
    await tx.delete(preventionInspectionRunParticipants)
      .where(eq(preventionInspectionRunParticipants.runId, run.id))
    await tx.insert(preventionInspectionRunParticipants).values(data.participants.map((participant, sortOrder) => ({
      id: `inspar-${nanoid()}`,
      runId: run.id,
      name: participant.name,
      position: participant.position,
      userId: participant.userId ?? null,
      sortOrder,
    })))
    await history(tx, {
      entityType: "run",
      entityId: run.id,
      worksiteId: run.worksiteId,
      changeType: "participants_saved",
      reason: `${data.participants.length} participante(s) registrados`,
      afterState: { participants: data.participants },
      actorUserId: access.userId,
    })
    return { saved: data.participants.length }
  })
}

/** Anexo 7: registra una acción preventiva directamente en CAPA (máximo seis). */
export async function registerInspectionPreventiveAction(input: unknown, access: InspectionAccess) {
  const data = z.object({
    runId: z.string().min(1),
    actionDescription: z.string().trim().min(10).max(3000),
    responsibleUserId: z.string().min(1),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).parse(input)
  return db.transaction(async (tx) => {
    const { run, sourceDefinitionCode } = await requireEditableRunForDeviation(tx, data.runId, access)
    if (sourceDefinitionCode !== "observacion_planeada") throw new Error("Las acciones preventivas directas corresponden al Anexo 7.")
    const existing = await tx.select({ id: preventionInspectionFindings.id })
      .from(preventionInspectionFindings)
      .where(and(eq(preventionInspectionFindings.runId, run.id), eq(preventionInspectionFindings.origin, "deviation")))
    if (existing.length >= 6) throw new Error("El Anexo 7 admite hasta seis acciones preventivas.")
    const [finding] = await tx.insert(preventionInspectionFindings).values({
      id: `insfnd-${nanoid()}`, runId: run.id, origin: "deviation", answerId: null,
      description: data.actionDescription, criticality: "medium", status: "open",
    }).returning()
    if (!finding) throw new Error("No se pudo registrar la acción preventiva.")
    const capa = await createCapaActionWithClient(tx, {
      sourceType: "inspection", sourceId: run.id, worksiteId: run.worksiteId,
      finding: data.actionDescription, actionDescription: data.actionDescription,
      responsibleUserId: data.responsibleUserId, priority: "medium", targetDate: data.targetDate,
      evidenceRequired: true,
    }, access.userId)
    await tx.update(preventionInspectionFindings).set({ capaActionId: capa.id, status: "capa_linked", updatedAt: nowIso() })
      .where(eq(preventionInspectionFindings.id, finding.id))
    if (run.status === "planned") await tx.update(preventionInspectionRuns).set({ status: "in_progress", version: run.version + 1, updatedAt: nowIso() })
      .where(and(eq(preventionInspectionRuns.id, run.id), eq(preventionInspectionRuns.version, run.version)))
    await history(tx, {
      entityType: "run", entityId: run.id, worksiteId: run.worksiteId,
      changeType: "preventive_action_created", reason: data.actionDescription,
      afterState: { findingId: finding.id, capaActionId: capa.id, targetDate: data.targetDate }, actorUserId: access.userId,
    })
    return { findingId: finding.id, capaActionId: capa.id }
  })
}

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
  return db.select({
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
  })
    .from(preventionInspectionPrograms)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionPrograms.templateId, preventionInspectionTemplates.id))
    .innerJoin(worksites, eq(preventionInspectionPrograms.worksiteId, worksites.id))
    .leftJoin(users, eq(preventionInspectionPrograms.assignedToUserId, users.id))
    .leftJoin(preventionRiskEntries, eq(preventionInspectionPrograms.riskEntryId, preventionRiskEntries.id))
    .where(and(scopeCondition(access.scope, preventionInspectionPrograms.worksiteId), kindCondition(filter)))
    .orderBy(asc(preventionInspectionPrograms.nextDueOn))
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

/**
 * Recordatorio manual de que una inspección espera revisión. No es
 * destructivo: cualquiera con `view` sobre la faena puede empujarla — el tope
 * de un recordatorio por día lo da la deduplicación de `createNotifications`,
 * no el permiso.
 */
export async function remindInspectionReview(input: unknown, access: InspectionAccess) {
  const data = z.object({ runId: z.string().min(1) }).parse(input)
  const [run] = await db.select().from(preventionInspectionRuns)
    .where(eq(preventionInspectionRuns.id, data.runId)).limit(1)
  if (!run) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:view", run.worksiteId)
  if (run.status !== "completed") throw new Error("Sólo una inspección ejecutada espera revisión.")

  const reviewers = await listInspectionReviewers(access, run.worksiteId)
  if (reviewers.length === 0) throw new Error("Nadie tiene permiso de revisión en esta faena. Avisa a Prevención.")

  await createNotifications(reviewers.map((reviewer) => reviewer.id), {
    type: "system_alert",
    title: "Recordatorio: inspección pendiente de revisión",
    body: `${run.code} espera revisión desde ${run.executedAt ? formatDate(run.executedAt) : run.scheduledFor ?? "hace un tiempo"}.`,
    entityType: "inspection_run",
    entityId: run.id,
    entityHref: `/prevencion/inspecciones/${run.id}`,
    // Distinto del que usa `completeInspectionRun` (`inspection:review:${id}`):
    // con ése el recordatorio sería un no-op para siempre. Con fecha: como
    // máximo uno por día.
    dedupeKey: `inspection:review-reminder:${run.id}:${todayInChile()}`,
  })
  return { notified: reviewers.map((reviewer) => reviewer.name) }
}

/**
 * I-15 (auditoría UI/UX 2026-08-25): quien incorpora un borrador (`manage`)
 * puede no tener `approve` — las plantillas no son por faena, así que a
 * diferencia de I-08 el permiso se resuelve global, no por faena.
 */
export async function remindTemplateApproval(input: unknown, access: InspectionAccess) {
  const data = z.object({ templateId: z.string().min(1) }).parse(input)
  requireAccess(access, "prevention:inspections:manage")
  const [template] = await db.select().from(preventionInspectionTemplates)
    .where(eq(preventionInspectionTemplates.id, data.templateId)).limit(1)
  if (!template) throw new Error(NOT_FOUND)
  if (template.status !== "draft") throw new Error("Sólo un borrador espera aprobación.")

  const approverIds = await getUserIdsWithPermission("prevention:inspections:approve")
  const approvers = approverIds.length === 0 ? [] : await db.select({ id: users.id, name: users.name }).from(users)
    .where(and(inArray(users.id, approverIds), eq(users.isActive, true)))
  if (approvers.length === 0) throw new Error("Nadie tiene permiso de aprobación. Avisa a un administrador.")

  await createNotifications(approvers.map((approver) => approver.id), {
    type: "system_alert",
    title: "Solicitud de aprobación de plantilla",
    body: `${template.name} (${template.versionLabel}) espera aprobación para habilitarse.`,
    entityType: "inspection_template",
    entityId: template.id,
    entityHref: "/prevencion/inspecciones/plantillas",
    // Con fecha: como máximo una solicitud por día para el mismo borrador.
    dedupeKey: `inspection:template-approval:${template.id}:${todayInChile()}`,
  })
  return { notified: approvers.map((approver) => approver.name) }
}

/** Actividades del PDTP vigente para elegir por número y nombre, sin pedirle
 * al prevencionista que memorice o transcriba números sueltos. */
export async function listInspectionPdtpActivityOptions(access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:view")
  return db.select({
    n: pdtpActivities.n,
    name: pdtpActivities.activity,
    year: pdtpPrograms.year,
  }).from(pdtpActivities)
    .innerJoin(pdtpPrograms, eq(pdtpPrograms.id, pdtpActivities.programId))
    .where(and(eq(pdtpPrograms.status, "active"), eq(pdtpActivities.status, "active")))
    .orderBy(desc(pdtpPrograms.year), asc(pdtpActivities.n))
}

/**
 * Cierre oportuno de hallazgos (B-07) y serie mensual (función #10).
 *
 * `summarizeTimelyClosure` estaba escrita, documentada y probada, y no tenía un
 * solo caller fuera de su test: el indicador que la certificación Mutual pide
 * demostrar —seguimiento de las medidas, no cuántos hallazgos hubo— no existía
 * en ninguna pantalla. Su insumo es `targetDate` de la CAPA y `closedAt` del
 * hallazgo, que sólo empezó a escribirse con la cascada de cierre.
 */
export async function summarizeInspectionTimelyClosure(access: InspectionAccess, filter: InspectionListFilters = {}) {
  requireAccess(access, "prevention:inspections:view")
  const rows = await db.select({
    targetDate: preventionCapaActions.targetDate,
    closedAt: preventionInspectionFindings.closedAt,
  })
    .from(preventionInspectionFindings)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionFindings.runId))
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId))
    .innerJoin(worksites, eq(worksites.id, preventionInspectionRuns.worksiteId))
    .leftJoin(preventionCapaActions, eq(preventionCapaActions.id, preventionInspectionFindings.capaActionId))
    .where(listFilterConditions(access, filter))
  return summarizeTimelyClosure(
    rows.map((row) => ({
      targetDate: row.targetDate ?? null,
      // `closedAt` es timestamp y el indicador compara días civiles.
      closedOn: row.closedAt ? row.closedAt.slice(0, 10) : null,
    })),
    todayInChile(),
  )
}

/** Serie mensual de cumplimiento y hallazgos (función #10). */
export async function summarizeInspectionTrends(access: InspectionAccess, filter: InspectionListFilters = {}) {
  requireAccess(access, "prevention:inspections:view")
  return db.select({
    // I-08/INS-08: sin `AT TIME ZONE`, una inspección cerrada a las 21:30 del
    // 31 de agosto caía en septiembre acá y en agosto en el filtro
    // `executedFrom` de este mismo archivo. Mismo patrón que
    // `operational-trend-history.ts`.
    month: sql<string>`to_char(${preventionInspectionRuns.executedAt} AT TIME ZONE 'America/Santiago', 'YYYY-MM')`,
    executed: sql<number>`COUNT(*)::int`,
    avgCompliance: sql<number | null>`ROUND(AVG(${preventionInspectionRuns.compliancePercent}))::int`,
    nonConforming: sql<number>`COALESCE(SUM(${preventionInspectionRuns.nonConformingCount}), 0)::int`,
    openFindings: sql<number>`COALESCE(SUM(${OPEN_FINDINGS_SQL}), 0)::int`,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId))
    .innerJoin(worksites, eq(worksites.id, preventionInspectionRuns.worksiteId))
    .where(and(
      listFilterConditions(access, filter),
      isNotNull(preventionInspectionRuns.executedAt),
    ))
    .groupBy(sql`to_char(${preventionInspectionRuns.executedAt} AT TIME ZONE 'America/Santiago', 'YYYY-MM')`)
    .orderBy(sql`to_char(${preventionInspectionRuns.executedAt} AT TIME ZONE 'America/Santiago', 'YYYY-MM')`)
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
        }])
}

/* ── Catálogo de desviaciones por instrumento ─────────────────────────────
 * Quien registra una desviación no decide su gravedad: la declara este
 * catálogo, igual que en un checklist la declara el ítem. La excepción es
 * "Otra desviación", donde sí la elige —porque la alternativa es que fuerce la
 * desviación más parecida y ensucie el dato con una gravedad que no
 * corresponde—, y queda marcada para que Prevención la incorpore.
 */

/** Desviaciones sin catalogar de varias plantillas, agrupadas por plantilla. */
export async function listUnclassifiedDeviationsFor(templateIds: string[], access: InspectionAccess) {
  requireAccess(access, "prevention:inspections:manage")
  const byTemplate = new Map<string, { description: string; criticality: string; occurrences: number }[]>()
  if (templateIds.length === 0) return byTemplate
  const rows = await db.select({
    templateId: preventionInspectionRuns.templateId,
    description: preventionInspectionFindings.description,
    criticality: preventionInspectionFindings.criticality,
    occurrences: sql<number>`COUNT(*)::int`,
  })
    .from(preventionInspectionFindings)
    .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionFindings.runId))
    .where(and(
      inArray(preventionInspectionRuns.templateId, templateIds),
      scopeCondition(access.scope, preventionInspectionRuns.worksiteId),
      // Ni de un ítem ni del catálogo: la gravedad la puso quien registró.
      isNull(preventionInspectionFindings.answerId),
      isNull(preventionInspectionFindings.catalogEntryId),
    ))
    .groupBy(
      preventionInspectionRuns.templateId,
      preventionInspectionFindings.description,
      preventionInspectionFindings.criticality,
    )
    .orderBy(sql`COUNT(*) DESC`)
    .limit(500)
  for (const row of rows) {
    const list = byTemplate.get(row.templateId) ?? []
    list.push({ description: row.description, criticality: row.criticality, occurrences: row.occurrences })
    byTemplate.set(row.templateId, list)
  }
  return byTemplate
}

/** Desviaciones ofrecidas al registrar, con la criticidad que producirán. */

/* ── Registrar desviaciones en una inspección ─────────────────────────────
 * La contraparte del catálogo: lo que se ejecuta en terreno.
 *
 * Una desviación es un hallazgo con `origin: 'deviation'`. No hizo falta tabla
 * nueva —la de hallazgos ya admite filas variables por inspección— y con eso
 * hereda todo lo que viene después: criticidad, derivación a CAPA con su plazo,
 * revisión independiente, acta y acreditación al PDTP.
 */

/** Inspección editable y dentro de alcance, con la plantilla que la gobierna. */
async function requireEditableRunForDeviation(tx: Tx, runId: string, access: InspectionAccess) {
  const [row] = await tx.select({
    run: preventionInspectionRuns,
    templateId: preventionInspectionTemplates.id,
    /* El código, porque la selección de desviaciones cuelga del instrumento y
     * no de la fila de su versión. */
    templateCode: preventionInspectionTemplates.code,
    sourceDefinitionCode: preventionInspectionTemplates.sourceDefinitionCode,
  })
    .from(preventionInspectionRuns)
    .innerJoin(preventionInspectionTemplates, eq(preventionInspectionTemplates.id, preventionInspectionRuns.templateId))
    .where(eq(preventionInspectionRuns.id, runId)).limit(1)
  if (!row) throw new Error(NOT_FOUND)
  requireAccess(access, "prevention:inspections:execute", row.run.worksiteId)
  if (!["planned", "in_progress"].includes(row.run.status)) {
    throw new Error("Sólo se pueden registrar desviaciones mientras la inspección sigue en ejecución.")
  }
  return row
}

/**
 * Registra una desviación encontrada.
 *
 * Del catálogo: el cliente manda `catalogEntryId` y **nada más**. La descripción
 * y la gravedad salen de la entrada, que es lo que garantiza que quien registra
 * en terreno no decida el plazo de la acción correctiva.
 *
 * "Otra desviación": manda descripción y gravedad, y queda sin `catalogEntryId`.
 * Es el único caso donde la gravedad depende de una persona, y existe porque la
 * alternativa —forzar la desviación más parecida del catálogo— ensucia el dato
 * con una gravedad que no corresponde. Queda en la cola de
 * `listUnclassifiedDeviationsFor` para que Prevención la incorpore.
 */
export async function registerDeviation(input: unknown, access: InspectionAccess) {
  const narrativeFields = {
    potentialDamageDescription: z.string().trim().min(3).max(3000).optional(),
    immediateMeasure: z.string().trim().min(3).max(3000).optional(),
    applicableLaw: z.string().trim().min(2).max(1000).optional(),
  }
  const data = z.union([
    z.object({ runId: z.string().min(1), catalogEntryId: z.string().min(1), ...narrativeFields }),
    z.object({
      runId: z.string().min(1),
      description: z.string().trim().min(3).max(3000),
      danoPotencial: z.enum(["leve", "moderado", "grave", "fatal"]),
      ...narrativeFields,
    }),
  ]).parse(input)

  return db.transaction(async (tx) => {
    const { run, templateCode, sourceDefinitionCode } = await requireEditableRunForDeviation(tx, data.runId, access)

    if (sourceDefinitionCode === "inspeccion_no_planeada") {
      if ("catalogEntryId" in data) throw new Error("El Anexo 08 exige describir cada hallazgo; no admite una desviación abreviada del catálogo.")
      if (!data.potentialDamageDescription || !data.immediateMeasure || !data.applicableLaw) {
        throw new Error("El Anexo 08 exige daño potencial, medida preventiva y normativa aplicable.")
      }
    }

    let description: string
    let danoPotencial: string
    let catalogEntryId: string | null = null

    if ("catalogEntryId" in data) {
      const entry = await findOfferedDeviation(templateCode, data.catalogEntryId)
      if (!entry) throw new Error(NOT_FOUND)
      /* Dos formas de no estar disponible, y conviene distinguirlas: el
       * instrumento no la ofrece, o el maestro la retiró para todos. */
      if (!entry.offered) {
        throw new Error(entry.retired
          ? "Esa desviación fue retirada del catálogo."
          : "Este instrumento no ofrece esa desviación.")
      }
      description = entry.label
      // La gravedad efectiva: el ajuste del instrumento si lo tiene, si no la del maestro.
      danoPotencial = entry.danoPotencial
      catalogEntryId = entry.id
    } else {
      description = data.description
      danoPotencial = data.danoPotencial
    }

    const now = nowIso()
    const [created] = await tx.insert(preventionInspectionFindings).values({
      id: `insfnd-${nanoid()}`,
      runId: run.id,
      origin: "deviation",
      // Una desviación no sale de una respuesta; el CHECK de la tabla lo exige.
      answerId: null,
      catalogEntryId,
      description,
      danoPotencial,
      criticality: criticalityFromDanoPotencial(danoPotencial),
      potentialDamageDescription: data.potentialDamageDescription ?? null,
      immediateMeasure: data.immediateMeasure ?? null,
      applicableLaw: data.applicableLaw ?? null,
      status: "open",
    }).returning()
    if (!created) throw new Error("No se pudo registrar la desviación.")

    /* La inspección pasa a `in_progress` igual que al guardar respuestas:
     * registrar una desviación ES trabajo de terreno, y dejarla en `planned`
     * la mantendría contada como no iniciada. */
    if (run.status === "planned") {
      await tx.update(preventionInspectionRuns)
        .set({ status: "in_progress", version: run.version + 1, updatedAt: now })
        .where(and(eq(preventionInspectionRuns.id, run.id), eq(preventionInspectionRuns.version, run.version)))
    }

    await history(tx, {
      entityType: "run", entityId: run.id, worksiteId: run.worksiteId,
      changeType: "deviation_registered",
      reason: `${description} (${danoPotencial}${catalogEntryId ? "" : " · fuera de catálogo"})`,
      afterState: created, actorUserId: access.userId,
    })
    return created
  })
}

/**
 * Quita una desviación mal registrada, sólo mientras la inspección siga
 * editable y el hallazgo no tenga CAPA: con acción correctiva enlazada ya hay
 * trabajo colgando de ella y quitarla dejaría la CAPA sin origen.
 */
export async function removeDeviation(input: unknown, access: InspectionAccess) {
  const data = z.object({ findingId: z.string().min(1) }).parse(input)

  return db.transaction(async (tx) => {
    const [row] = await tx.select({ finding: preventionInspectionFindings, run: preventionInspectionRuns })
      .from(preventionInspectionFindings)
      .innerJoin(preventionInspectionRuns, eq(preventionInspectionRuns.id, preventionInspectionFindings.runId))
      .where(eq(preventionInspectionFindings.id, data.findingId)).limit(1)
    if (!row) throw new Error(NOT_FOUND)
    requireAccess(access, "prevention:inspections:execute", row.run.worksiteId)
    if (row.finding.origin !== "deviation") throw new Error("Ese hallazgo lo derivó un ítem del checklist: se corrige cambiando la respuesta.")
    if (!["planned", "in_progress"].includes(row.run.status)) {
      throw new Error("La inspección ya no está en ejecución.")
    }
    if (row.finding.capaActionId) throw new Error("La desviación ya tiene una acción correctiva: ciérrala desde la CAPA.")

    await tx.delete(preventionInspectionFindings).where(eq(preventionInspectionFindings.id, row.finding.id))
    await history(tx, {
      entityType: "run", entityId: row.run.id, worksiteId: row.run.worksiteId,
      changeType: "deviation_removed",
      reason: row.finding.description,
      beforeState: row.finding, actorUserId: access.userId,
    })
    return { removed: true as const }
  })
}
