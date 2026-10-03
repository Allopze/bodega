import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import {
  preventionRiskControls, preventionRiskEntries, preventionRiskFactors, preventionRiskLocations, preventionRiskMatrices,
  preventionRiskPositions, preventionRiskProcesses, preventionRiskReviewRounds, preventionRiskTasks,
} from "@/db/schema"
import type { RiskClassification } from "@/lib/prevention/miper/methodology"
import type { ControlHierarchy, ControlledStatus, MiperSnapshot } from "@/lib/prevention/miper/snapshot"
import { RiskLegalDomainError } from "@/lib/services/prevention-risk-legal-errors"
import { type Client, sha256 } from "./shared"

export function snapshotSha(snapshot: MiperSnapshot) {
  return sha256(snapshot)
}

type MatrixRow = typeof preventionRiskMatrices.$inferSelect
type ControlRow = typeof preventionRiskControls.$inferSelect
type EntryRow = {
  entry: typeof preventionRiskEntries.$inferSelect
  activity: string | null; task: string | null; position: string | null; location: string | null; riskFactor: string | null
}

/**
 * Fotos vivas de varias MIPER con TRES consultas, sin importar cuántas sean (la
 * portada por faena necesita la de cada una para la completitud; una por MIPER
 * era N+1). Las consultas se encadenan, no van en paralelo: dentro de una
 * transacción (`submitMiperForReview` pasa un `tx`) usan la misma conexión.
 * Los ids repetidos se ignoran y los que no existen no vienen en el mapa.
 */
export async function buildMiperSnapshots(client: Client, matrixIds: readonly string[]): Promise<Map<string, MiperSnapshot>> {
  const snapshots = new Map<string, MiperSnapshot>()
  const ids = [...new Set(matrixIds)]
  if (ids.length === 0) return snapshots
  const matrices = await client.select().from(preventionRiskMatrices).where(inArray(preventionRiskMatrices.id, ids))
  if (matrices.length === 0) return snapshots
  const found = matrices.map((matrix) => matrix.id)
  // Mismo ORDER BY que la foto de una sola: agrupar por MIPER conserva, dentro de cada una, el orden de la consulta.
  const rows: EntryRow[] = await client.select({
    entry: preventionRiskEntries,
    activity: preventionRiskProcesses.name,
    task: preventionRiskTasks.name,
    position: preventionRiskPositions.name,
    location: preventionRiskLocations.name,
    riskFactor: preventionRiskFactors.name,
  }).from(preventionRiskEntries)
    .leftJoin(preventionRiskProcesses, eq(preventionRiskProcesses.id, preventionRiskEntries.processId))
    .leftJoin(preventionRiskTasks, eq(preventionRiskTasks.id, preventionRiskEntries.taskId))
    .leftJoin(preventionRiskPositions, eq(preventionRiskPositions.id, preventionRiskEntries.positionId))
    .leftJoin(preventionRiskLocations, eq(preventionRiskLocations.id, preventionRiskEntries.locationId))
    .leftJoin(preventionRiskFactors, eq(preventionRiskFactors.id, preventionRiskEntries.riskFactorId))
    .where(inArray(preventionRiskEntries.matrixId, found))
    .orderBy(asc(preventionRiskEntries.rowNumber), asc(preventionRiskEntries.createdAt))
  // Las medidas por JOIN a sus filas: el mismo conjunto que `riskEntryId IN (…)`, sin una lista de miles de ids.
  // Desempate por id: las medidas de un riesgo duplicado o importado nacen en la misma transacción
  // (mismo `created_at`) y Postgres no garantiza su orden, que entra al `snapshotSha` de la ronda.
  const controls = rows.length === 0 ? [] : await client.select({ control: preventionRiskControls }).from(preventionRiskControls)
    .innerJoin(preventionRiskEntries, eq(preventionRiskEntries.id, preventionRiskControls.riskEntryId))
    .where(inArray(preventionRiskEntries.matrixId, found))
    .orderBy(asc(preventionRiskControls.createdAt), asc(preventionRiskControls.id))
  const controlsByEntry = new Map<string, ControlRow[]>()
  for (const { control } of controls) {
    const list = controlsByEntry.get(control.riskEntryId)
    if (list) list.push(control)
    else controlsByEntry.set(control.riskEntryId, [control])
  }
  const rowsByMatrix = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const list = rowsByMatrix.get(row.entry.matrixId)
    if (list) list.push(row)
    else rowsByMatrix.set(row.entry.matrixId, [row])
  }
  for (const matrix of matrices) snapshots.set(matrix.id, snapshotOf(matrix, rowsByMatrix.get(matrix.id) ?? [], controlsByEntry))
  return snapshots
}

/**
 * La foto de UNA MIPER: la que se sella en cada ronda y se hashea con
 * `snapshotSha`. Desde la Fase B es el caso de una de `buildMiperSnapshots`;
 * su salida, orden de claves incluido, no cambió (prueba dorada en
 * `lib/__tests__/miper-snapshot-batch.test.ts`).
 */
export async function buildMiperSnapshot(client: Client, matrixId: string): Promise<MiperSnapshot> {
  const snapshot = (await buildMiperSnapshots(client, [matrixId])).get(matrixId)
  if (!snapshot) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  return snapshot
}

/**
 * Arma la foto con el MISMO orden de claves de siempre, porque `snapshotSha`
 * hashea su `JSON.stringify`. No reordenar campos. `index` es la posición de la
 * fila dentro de SU MIPER: es el N° de respaldo de una fila sin número.
 */
function snapshotOf(matrix: MatrixRow, rows: readonly EntryRow[], controlsByEntry: ReadonlyMap<string, ControlRow[]>): MiperSnapshot {
  return {
    header: {
      period: matrix.period, iperCode: matrix.iperCode, elaboratedOn: matrix.elaboratedOn, updatedOn: matrix.updatedOn,
      companyName: matrix.companyName, companyRut: matrix.companyRut, companyAddress: matrix.companyAddress, companyCommune: matrix.companyCommune,
      economicActivity: matrix.economicActivity, adherentNumber: matrix.adherentNumber, worksiteName: matrix.worksiteName,
      siteRepresentativeUserId: matrix.siteRepresentativeUserId, siteRepresentativeName: matrix.siteRepresentativeName,
      headcountTotal: matrix.headcountTotal, headcountMale: matrix.headcountMale, headcountFemale: matrix.headcountFemale, headcountOther: matrix.headcountOther,
      participationSummary: matrix.participationSummary, consultationEvidenceReference: matrix.consultationEvidenceReference,
    },
    entries: rows.map(({ entry, activity, task, position, location, riskFactor }, index) => ({
      id: entry.id,
      rowNumber: entry.rowNumber ?? index + 1,
      activity, task, position, location,
      exposedFemale: entry.exposedFemale, exposedMale: entry.exposedMale, exposedOther: entry.exposedOther,
      riskFactorId: entry.riskFactorId, riskFactor,
      isRoutine: entry.isRoutine,
      hazard: entry.hazard, risk: entry.risk, probableDamage: entry.probableDamage,
      probability: entry.probability, consequence: entry.consequence, magnitude: entry.magnitude,
      classification: entry.classification as RiskClassification | null,
      controlledStatus: entry.controlledStatus as ControlledStatus | null,
      controls: (controlsByEntry.get(entry.id) ?? []).map((control) => ({
        id: control.id, hierarchy: control.hierarchy as ControlHierarchy, description: control.description,
        responsibleUserId: control.responsibleUserId, responsibleName: control.responsibleSnapshot, dueDate: control.dueDate, status: control.status,
      })),
    })),
  }
}

export async function openRound(client: Client, matrixId: string) {
  const [round] = await client.select().from(preventionRiskReviewRounds)
    .where(and(eq(preventionRiskReviewRounds.matrixId, matrixId), isNull(preventionRiskReviewRounds.decision))).limit(1)
  return round ?? null
}
