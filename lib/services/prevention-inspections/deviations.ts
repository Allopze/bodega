import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { db, type Tx } from "@/db"
import {
  preventionInspectionFindings,
  preventionInspectionRuns,
  preventionInspectionTemplates,
} from "@/db/schema"
import { history, NOT_FOUND, nowIso, requireAccess, scopeCondition, type InspectionAccess } from "@/lib/services/prevention-inspections-access"
import { nanoid } from "@/lib/id"
import { criticalityFromDanoPotencial } from "@/lib/prevention/inspections"
import { findOfferedDeviation } from "@/lib/services/prevention-deviations"

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
export async function requireEditableRunForDeviation(tx: Tx, runId: string, access: InspectionAccess) {
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
