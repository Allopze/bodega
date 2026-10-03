import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm"
import { db } from "@/db"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskMatrices, preventionRiskMethodologies,
  preventionRiskReviewRounds, worksites,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { RE04_METHODOLOGY } from "@/lib/prevention/miper/methodology"
import { todayInChile } from "@/lib/utils"
import { createMiperSchema, miperDiscardSchema, miperHeaderSchema } from "@/lib/validation/prevention-module/miper"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { buildMiperHeaderPrefill } from "./prefill"
import { assertActiveUsers, assertEditable, type Client, lockMatrix, type MiperAccess, miperHistory, nowIso, requireAccess } from "./shared"

const STALE = "La MIPER cambió mientras la editabas. Recarga antes de continuar."

export async function ensureRe04Methodology(client: Client, actorUserId: string) {
  await client.insert(preventionRiskMethodologies).values({ ...RE04_METHODOLOGY, createdByUserId: actorUserId }).onConflictDoNothing()
  const [methodology] = await client.select().from(preventionRiskMethodologies).where(eq(preventionRiskMethodologies.id, RE04_METHODOLOGY.id)).limit(1)
  if (!methodology) throw new Error("No se pudo preparar la metodología RE-04.")
  return methodology
}

export async function createMiper(input: unknown, access: MiperAccess) {
  const data = createMiperSchema.parse(input)
  requireAccess(access, "prevention:risk:edit", data.worksiteId)
  return db.transaction((tx) => createMiperWithClient(tx, data, access))
}

/**
 * El alta de una MIPER dentro de una transacción ajena (Fase C): la importación
 * crea el borrador en LA MISMA transacción que sus riesgos y medidas, así que un
 * fallo a mitad no deja un borrador vacío. Valida y autoriza igual que
 * `createMiper`: quien la llama no se salta nada.
 */
export async function createMiperWithClient(tx: Client, input: unknown, access: MiperAccess) {
  const data = createMiperSchema.parse(input)
  requireAccess(access, "prevention:risk:edit", data.worksiteId)
  const [worksite] = await tx.select({ id: worksites.id, name: worksites.name }).from(worksites)
    .where(and(eq(worksites.id, data.worksiteId), eq(worksites.isActive, true))).limit(1)
  if (!worksite) throw new RiskLegalDomainError("Faena no encontrada o inactiva.")
  const [open] = await tx.select({ id: preventionRiskMatrices.id }).from(preventionRiskMatrices).where(and(
    eq(preventionRiskMatrices.worksiteId, data.worksiteId), eq(preventionRiskMatrices.period, data.period), ne(preventionRiskMatrices.status, "superseded"),
  )).limit(1)
  if (open) throw new RiskLegalDomainError(`Ya existe un MIPER del período ${data.period} para esta faena: ábrelo desde la lista.`)

  let source: typeof preventionRiskMatrices.$inferSelect | null = null
  if (data.sourceMatrixId) {
    const [row] = await tx.select().from(preventionRiskMatrices).where(and(
      eq(preventionRiskMatrices.id, data.sourceMatrixId), eq(preventionRiskMatrices.worksiteId, data.worksiteId), eq(preventionRiskMatrices.status, "published"),
    )).limit(1)
    if (!row) throw new RiskLegalDomainError("La MIPER de origen no está vigente o es de otra faena.")
    if (row.isLegacy) throw new RiskLegalDomainError("La MIPER vigente usa la metodología anterior y no se puede copiar: crea la matriz vacía.")
    source = row
  }

  const methodology = await ensureRe04Methodology(tx, access.userId)
  const prefill = await buildMiperHeaderPrefill(tx, data.worksiteId)
  const [last] = await tx.select({ matrixVersion: preventionRiskMatrices.matrixVersion }).from(preventionRiskMatrices)
    .where(eq(preventionRiskMatrices.worksiteId, data.worksiteId)).orderBy(desc(preventionRiskMatrices.matrixVersion)).limit(1)
  const now = nowIso()
  const id = `riskmatrix-${nanoid()}`
  await tx.insert(preventionRiskMatrices).values({
    id,
    worksiteId: data.worksiteId,
    matrixVersion: (last?.matrixVersion ?? 0) + 1,
    title: `MIPER ${worksite.name} ${data.period}`,
    status: "draft",
    reviewState: "none",
    period: data.period,
    methodologyId: methodology.id,
    methodologySnapshot: { code: methodology.code, name: methodology.name, versionLabel: methodology.versionLabel, kind: methodology.kind, authoritySource: methodology.authoritySource, configuration: methodology.configuration },
    revisionReason: data.revisionReason,
    participationSummary: source?.participationSummary ?? "",
    consultationEvidenceReference: "",
    supersedesMatrixId: source?.id ?? null,
    iperCode: "RE-04",
    elaboratedOn: todayInChile(),
    updatedOn: null,
    companyName: prefill.companyName,
    companyRut: prefill.companyRut,
    companyAddress: prefill.companyAddress,
    companyCommune: prefill.companyCommune,
    economicActivity: prefill.economicActivity,
    adherentNumber: prefill.adherentNumber || null,
    worksiteName: prefill.worksiteName,
    siteRepresentativeUserId: prefill.siteRepresentativeUserId,
    siteRepresentativeName: prefill.siteRepresentativeName,
    headcountTotal: prefill.headcount.total,
    headcountMale: prefill.headcount.male,
    headcountFemale: prefill.headcount.female,
    headcountOther: prefill.headcount.other,
    createdByUserId: access.userId,
    createdAt: now,
    updatedAt: now,
  })

  if (source) {
    const sourceEntries = await tx.select().from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, source.id)).orderBy(asc(preventionRiskEntries.rowNumber))
    const newIdBySource = new Map(sourceEntries.map((entry) => [entry.id, `riskentry-${nanoid()}`]))
    if (sourceEntries.length > 0) {
      // `magnitude` y `classification` son generadas: no se insertan.
      await tx.insert(preventionRiskEntries).values(sourceEntries.map(({ magnitude: _m, classification: _c, ...entry }) => ({
        ...entry, id: newIdBySource.get(entry.id)!, matrixId: id, version: 1, createdAt: now, updatedAt: now,
      })))
      const sourceControls = await tx.select().from(preventionRiskControls).where(inArray(preventionRiskControls.riskEntryId, sourceEntries.map((entry) => entry.id)))
      if (sourceControls.length > 0) {
        await tx.insert(preventionRiskControls).values(sourceControls.map((control) => ({
          ...control,
          id: `riskcontrol-${nanoid()}`,
          riskEntryId: newIdBySource.get(control.riskEntryId)!,
          // La verificación es del período anterior: el nuevo parte sin ella.
          status: control.status === "verified" ? "implemented" : control.status,
          effectivenessStatus: "not_assessed",
          lastVerifiedByUserId: null,
          lastVerifiedAt: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })))
      }
    }
  }

  await miperHistory(tx, {
    matrixId: id, worksiteId: data.worksiteId, object: "matrix", objectId: id, changeType: "created",
    reason: data.revisionReason, after: { period: data.period, sourceMatrixId: source?.id ?? null }, actorUserId: access.userId, actingAs: "prevention:risk:edit",
  })
  return { id }
}

export async function updateMiperHeader(input: unknown, access: MiperAccess) {
  const data = miperHeaderSchema.parse(input)
  return db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, "prevention:risk:edit", matrix.worksiteId)
    assertEditable(matrix)
    if (matrix.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE)
    await assertActiveUsers(tx, [data.siteRepresentativeUserId])
    const { matrixId: _id, expectedVersion: _v, ...fields } = data
    const changed = Object.fromEntries(Object.entries(fields).filter(([key, value]) => matrix[key as keyof typeof matrix] !== value))
    const [updated] = await tx.update(preventionRiskMatrices).set({ ...fields, version: matrix.version + 1, updatedAt: nowIso() })
      .where(and(eq(preventionRiskMatrices.id, matrix.id), eq(preventionRiskMatrices.version, data.expectedVersion))).returning({ version: preventionRiskMatrices.version })
    if (!updated) throw new RiskLegalDomainError(STALE)
    if (Object.keys(changed).length > 0) {
      await miperHistory(tx, {
        matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "header", objectId: matrix.id, changeType: "header_updated",
        before: Object.fromEntries(Object.keys(changed).map((key) => [key, matrix[key as keyof typeof matrix]])), after: changed,
        actorUserId: access.userId, actingAs: "prevention:risk:edit",
      })
    }
    return { version: updated.version }
  })
}

export async function discardMiperDraft(input: unknown, access: MiperAccess) {
  const data = miperDiscardSchema.parse(input)
  await db.transaction(async (tx) => {
    const matrix = await lockMatrix(tx, data.matrixId)
    requireAccess(access, "prevention:risk:edit", matrix.worksiteId)
    if (matrix.status !== "draft" || matrix.isLegacy) throw new RiskLegalDomainError("Sólo se descarta un borrador RE-04 que nunca fue aprobado.")
    if (matrix.version !== data.expectedVersion) throw new RiskLegalDomainError(STALE)
    const [round] = await tx.select({ id: preventionRiskReviewRounds.id }).from(preventionRiskReviewRounds).where(eq(preventionRiskReviewRounds.matrixId, matrix.id)).limit(1)
    if (round) throw new RiskLegalDomainError("Este borrador ya pasó por revisión: su historia se conserva y no se puede descartar.")
    const [counted] = await tx.select({ count: sql<number>`count(*)::int` }).from(preventionRiskEntries).where(eq(preventionRiskEntries.matrixId, matrix.id))
    const count = counted?.count ?? 0
    // La traza sobrevive a la matriz: audit_log no tiene FK a ella.
    await miperHistory(tx, {
      matrixId: matrix.id, worksiteId: matrix.worksiteId, object: "matrix", objectId: matrix.id, changeType: "deleted",
      reason: data.reason, before: { period: matrix.period, entryCount: count }, actorUserId: access.userId, actingAs: "prevention:risk:edit",
    })
    await tx.delete(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, matrix.id))
  })
}
