import { createHash } from "node:crypto"
import { and, eq, inArray, ne, sql } from "drizzle-orm"
import { z } from "zod"
import { db, type Tx } from "@/db"
import {
  preventionInspectionPrograms,
  preventionInspectionRuns,
  preventionInspectionTemplates,
  sstDocuments,
  sstDocumentVersions,
} from "@/db/schema"
import {
  history,
  isUniqueViolation,
  NOT_FOUND,
  nowIso,
  requireAccess,
  type InspectionAccess,
} from "@/lib/services/prevention-inspections-access"
import { nanoid } from "@/lib/id"
import { TRANSITION_REASON_MIN_LENGTH, type InspectionItemSpec } from "@/lib/prevention/inspections"
import { CHECKLIST_DEFINITIONS, isNonInspectionDefinition, isPersonEvaluationDefinition } from "@/lib/sst/definitions"
import { officialInspectionSourceFor } from "@/lib/sst/official-inspection-sources"
import type { ChecklistDefinition } from "@/lib/sst/types"
import { replacePdtpAccreditationBindings } from "@/lib/services/pdtp/accreditation-bindings"
import {
  defaultPdtpActivityNumbers,
  defaultPdtpReviewActivityNumbers,
  inspectionTemplateCodeFor,
} from "@/lib/services/pdtp-adapters/inspection-templates-2026"

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
