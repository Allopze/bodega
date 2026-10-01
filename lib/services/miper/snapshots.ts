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

export async function buildMiperSnapshot(client: Client, matrixId: string): Promise<MiperSnapshot> {
  const [matrix] = await client.select().from(preventionRiskMatrices).where(eq(preventionRiskMatrices.id, matrixId)).limit(1)
  if (!matrix) throw new RiskLegalDomainError("MIPER no encontrada o fuera de alcance.")
  const rows = await client.select({
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
    .where(eq(preventionRiskEntries.matrixId, matrixId))
    .orderBy(asc(preventionRiskEntries.rowNumber), asc(preventionRiskEntries.createdAt))
  const controls = rows.length === 0 ? [] : await client.select().from(preventionRiskControls)
    .where(inArray(preventionRiskControls.riskEntryId, rows.map((row) => row.entry.id)))
    .orderBy(asc(preventionRiskControls.createdAt))
  const controlsByEntry = new Map<string, typeof controls>()
  for (const control of controls) controlsByEntry.set(control.riskEntryId, [...(controlsByEntry.get(control.riskEntryId) ?? []), control])
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
