/**
 * Programa de Trabajo Preventivo de MIPER = CAPA con `sourceType:'risk'`.
 *
 * Archivo separado a propósito: `prevention-capa.ts` documenta en sus
 * primeras líneas el ciclo de imports que provocaría importarlo desde ahí
 * (mismo precedente que `prevention-inspections.ts`), y `prevention-risk-legal.ts`
 * ya es demasiado grande. Importa HACIA CAPA, nunca al revés.
 */
import { and, asc, eq, inArray, notInArray } from "drizzle-orm"
import { z } from "zod"
import { db, type DB, type Tx } from "@/db"
import {
  preventionCapaActions,
  preventionCapaRiskLinks,
  preventionRiskControls,
  preventionRiskEntries,
  preventionRiskMatrices,
  users,
} from "@/db/schema"
import { nanoid } from "@/lib/id"
import { recordAudit } from "@/lib/audit"
import { RISK_CLASSIFICATION_TO_LEVEL, type RiskClassification } from "@/lib/prevention/risk-engine"
import { createCapaActionWithClient } from "@/lib/services/prevention-capa"
import type { RiskLegalAccess } from "@/lib/services/prevention-risk-legal"

type Client = DB | Tx

const CONTROL_HIERARCHY_ORDER = ["elimination", "substitution", "engineering", "administrative", "ppe"] as const
const PRIORITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 }

function assertGenerateAccess(access: RiskLegalAccess) {
  if (!access.permissions.includes("prevention:capa:manage")) throw new Error("Sin permiso para gestionar el Programa de Trabajo.")
  if (!access.permissions.includes("prevention:risk:edit")) throw new Error("Sin permiso para generar acciones desde MIPER.")
}

function scopeAllowsWorksite(access: RiskLegalAccess, worksiteId: string) {
  return access.scope.mode === "all" || (access.scope.mode === "some" && access.scope.ids.includes(worksiteId))
}

/**
 * Primera medida de control por jerarquía de control (elimination >
 * substitution > engineering > administrative > ppe). Exportada: la ficha de
 * riesgo la reutiliza para prellenar la sugerencia del formulario "Agregar al
 * Programa de Trabajo" — la misma que el servidor elige al generar sin
 * descripción explícita.
 */
export function firstControlDescription(controls: Array<{ hierarchy: string; description: string }>) {
  const sorted = [...controls].sort((a, b) => CONTROL_HIERARCHY_ORDER.indexOf(a.hierarchy as never) - CONTROL_HIERARCHY_ORDER.indexOf(b.hierarchy as never))
  return sorted[0]?.description ?? null
}

function priorityFromClassification(classification: string | null): "low" | "medium" | "high" | "critical" {
  return classification ? RISK_CLASSIFICATION_TO_LEVEL[classification as RiskClassification] : "medium"
}

export interface GenerateCapaFromRisksResult {
  created: Array<{ capaActionId: string; code: string; riskEntryIds: string[] }>
  skipped: Array<{ riskEntryId: string; reason: string }>
}

const generateCapaFromRisksSchema = z.object({
  riskEntryIds: z.array(z.string().min(1)).min(1).max(200),
  defaults: z.object({
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
    priority: z.enum(["low", "medium", "high", "critical"]).optional(),
    responsibleUserId: z.string().min(1).nullable().optional(),
    evidenceRequired: z.boolean().optional(),
    groupIntoSingleAction: z.boolean().optional(),
    actionDescription: z.string().trim().min(3).max(3000).optional(),
  }),
})

/**
 * Genera una o varias CAPA desde riesgos seleccionados. Camino común: una
 * CAPA por riesgo (`sourceId = riskEntryId`). Con `groupIntoSingleAction`,
 * agrupa todos los riesgos seleccionados en una sola CAPA usando la tabla
 * puente `prevention_capa_risk_links` (todos deben ser de la misma faena).
 *
 * Pre-valida responsables activos ANTES de abrir la transacción real de
 * escritura por fila: `assertActiveResponsible` dentro de
 * `createCapaActionWithClient` revienta la transacción entera si UN
 * responsable está inactivo, lo que mataría una generación en lote de 40
 * filas por un solo caso — se degrada a `null` + `needs_assignment` en vez de
 * fallar todo el lote.
 */
export async function generateCapaActionsFromRiskEntries(input: unknown, access: RiskLegalAccess): Promise<GenerateCapaFromRisksResult> {
  assertGenerateAccess(access)
  const args = generateCapaFromRisksSchema.parse(input)
  const entryIds = [...new Set(args.riskEntryIds)]
  if (args.defaults.groupIntoSingleAction && !args.defaults.actionDescription?.trim()) throw new Error("Agrupar riesgos en una sola acción exige una descripción.")

  return db.transaction(async (tx) => {
    const rows = await tx.select({ entry: preventionRiskEntries, matrix: preventionRiskMatrices })
      .from(preventionRiskEntries)
      .innerJoin(preventionRiskMatrices, eq(preventionRiskMatrices.id, preventionRiskEntries.matrixId))
      .where(inArray(preventionRiskEntries.id, entryIds))
    if (rows.length !== entryIds.length) throw new Error("Uno o más riesgos no se encontraron o están fuera de alcance.")
    for (const row of rows) if (!scopeAllowsWorksite(access, row.matrix.worksiteId)) throw new Error("Uno o más riesgos están fuera de alcance.")

    const worksiteIds = new Set(rows.map((row) => row.matrix.worksiteId))
    if (args.defaults.groupIntoSingleAction && worksiteIds.size > 1) throw new Error("No se puede agrupar en una sola acción riesgos de faenas distintas.")

    const responsibleCandidates = [...new Set([
      ...rows.map((row) => row.entry.responsibleUserId),
      args.defaults.responsibleUserId,
    ].filter((id): id is string => Boolean(id)))]
    const activeResponsibleIds = responsibleCandidates.length
      ? new Set((await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, responsibleCandidates), eq(users.isActive, true)))).map((row) => row.id))
      : new Set<string>()

    const controls = rows.length
      ? await tx.select().from(preventionRiskControls).where(inArray(preventionRiskControls.riskEntryId, rows.map((row) => row.entry.id))).orderBy(asc(preventionRiskControls.createdAt))
      : []
    const controlsByEntry = new Map<string, typeof controls>()
    for (const control of controls) controlsByEntry.set(control.riskEntryId, [...(controlsByEntry.get(control.riskEntryId) ?? []), control])

    const result: GenerateCapaFromRisksResult = { created: [], skipped: [] }
    const now = new Date().toISOString()

    if (args.defaults.groupIntoSingleAction) {
      const worksiteId = [...worksiteIds][0]!
      const responsibleUserId = args.defaults.responsibleUserId && activeResponsibleIds.has(args.defaults.responsibleUserId) ? args.defaults.responsibleUserId : null
      const priority = args.defaults.priority ?? rows
        .map((row) => priorityFromClassification(row.entry.riskClassification))
        .reduce((max, current) => (PRIORITY_RANK[current]! > PRIORITY_RANK[max]! ? current : max), "low" as ReturnType<typeof priorityFromClassification>)
      const capa = await createCapaActionWithClient(tx, {
        sourceType: "risk",
        // No hay UN riesgo que identifique la fuente cuando se agrupan varios
        // — la relación real vive en `prevention_capa_risk_links`. El id de
        // la matriz del primer riesgo ancla `sourceId` a algo estable.
        sourceId: rows[0]!.matrix.id,
        worksiteId,
        finding: rows.map((row) => row.entry.hazard).join(" · "),
        actionDescription: args.defaults.actionDescription!.trim(),
        responsibleUserId,
        priority,
        targetDate: args.defaults.targetDate,
        evidenceRequired: args.defaults.evidenceRequired ?? true,
        reconciliationStatus: responsibleUserId ? "reconciled" : "needs_assignment",
      }, access.userId)
      await tx.insert(preventionCapaRiskLinks).values(rows.map((row) => ({
        id: `capariskl-${nanoid()}`, capaActionId: capa.id, riskEntryId: row.entry.id, createdByUserId: access.userId, createdAt: now,
      })))
      result.created.push({ capaActionId: capa.id, code: capa.code, riskEntryIds: rows.map((row) => row.entry.id) })
      await recordAudit({ userId: access.userId, action: "create", entityType: "prevention_capa_action", entityId: capa.id, entityCode: capa.code, newState: { sourceType: "risk", riskEntryIds: rows.map((row) => row.entry.id) }, reason: "Acción preventiva agrupada generada desde riesgos MIPER seleccionados." }, tx)
      return result
    }

    for (const row of rows) {
      const { entry, matrix } = row
      const actionDescription = args.defaults.actionDescription?.trim() || firstControlDescription(controlsByEntry.get(entry.id) ?? [])
      if (!actionDescription) { result.skipped.push({ riskEntryId: entry.id, reason: "Sin medida de control registrada ni descripción de acción provista." }); continue }
      // Idempotencia: doble clic en "generar" no duplica.
      const [existing] = await tx.select({ id: preventionCapaActions.id }).from(preventionCapaActions).where(and(
        eq(preventionCapaActions.sourceType, "risk"),
        eq(preventionCapaActions.sourceId, entry.id),
        eq(preventionCapaActions.actionDescription, actionDescription),
        notInArray(preventionCapaActions.status, ["cancelled"]),
      )).limit(1)
      if (existing) { result.skipped.push({ riskEntryId: entry.id, reason: "Ya existe una acción con esta descripción para este riesgo." }); continue }
      const responsibleUserId = entry.responsibleUserId && activeResponsibleIds.has(entry.responsibleUserId)
        ? entry.responsibleUserId
        : (args.defaults.responsibleUserId && activeResponsibleIds.has(args.defaults.responsibleUserId) ? args.defaults.responsibleUserId : null)
      const priority = args.defaults.priority ?? priorityFromClassification(entry.riskClassification)
      const capa = await createCapaActionWithClient(tx, {
        sourceType: "risk",
        sourceId: entry.id,
        worksiteId: matrix.worksiteId,
        finding: entry.hazard,
        actionDescription,
        responsibleUserId,
        priority,
        targetDate: args.defaults.targetDate,
        evidenceRequired: args.defaults.evidenceRequired ?? true,
        reconciliationStatus: responsibleUserId ? "reconciled" : "needs_assignment",
      }, access.userId)
      result.created.push({ capaActionId: capa.id, code: capa.code, riskEntryIds: [entry.id] })
    }
    // Una entrada de auditoría por operación, no una por CAPA generada — ancla
    // a la matriz de origen, no a una CAPA arbitraria entre las creadas.
    if (result.created.length > 0) {
      await recordAudit({ userId: access.userId, action: "create", entityType: "prevention_risk_matrix", entityId: rows[0]!.matrix.id, entityCode: `MIPER-v${rows[0]!.matrix.matrixVersion}`, newState: { created: result.created.map((item) => item.capaActionId), skipped: result.skipped.length }, reason: "Programa de Trabajo generado desde riesgos MIPER seleccionados." }, tx)
    }
    return result
  })
}

/**
 * Une el camino directo (`sourceId = riskEntryId`) con la tabla puente
 * (caso N:N), sin duplicar cuando ambos coincidieran.
 */
export async function listCapaForRiskEntry(args: { riskEntryId: string; client?: Client }) {
  const client = args.client ?? db
  const [direct, linked] = await Promise.all([
    client.select().from(preventionCapaActions).where(and(eq(preventionCapaActions.sourceType, "risk"), eq(preventionCapaActions.sourceId, args.riskEntryId))),
    client.select({ capa: preventionCapaActions }).from(preventionCapaRiskLinks)
      .innerJoin(preventionCapaActions, eq(preventionCapaActions.id, preventionCapaRiskLinks.capaActionId))
      .where(eq(preventionCapaRiskLinks.riskEntryId, args.riskEntryId)),
  ])
  const byId = new Map(direct.map((item) => [item.id, item]))
  for (const row of linked) byId.set(row.capa.id, row.capa)
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/* Se retiró `getCapaCountsForRiskMatrix` (conteo CAPA por matriz): nadie la
 * llamaba. El tablero muestra el conteo POR FAENA vía
 * `getCapaCountsByWorksite` (con su chequeo de permiso) y la vista matriz ya
 * trae `openCapaCount` por fila desde `listRiskEntriesPage`, así que sólo
 * quedaba como un export sin alcance ni permiso esperando un llamador
 * descuidado. */
