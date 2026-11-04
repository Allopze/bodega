import { eq } from "drizzle-orm"
import * as schema from "../../db/schema"
import {
  countRows,
  dateOnly,
  daysAgo,
  devId,
  insertInBatches,
  int,
  iso,
  shortHash,
  type SeedContext,
  type SeedResult,
} from "./shared"

export async function seedMiper(context: SeedContext): Promise<SeedResult> {
  const { db, sql, apply, today, rng, base, actors, log } = context
  const notes: string[] = []
  let inserted = 0
  let skipped = 0

  const insertBatch = async <T>(rows: T[], run: (chunk: T[]) => Promise<number>): Promise<number> =>
    insertInBatches(rows, run)

  const matrices = await db.select().from(schema.preventionRiskMatrices).limit(5)
  if (matrices.length === 0) {
    return { domain: "miper", inserted: 0, skipped: 0, notes: ["No hay matrices MIPER; no se sembró."] }
  }

  // ── Rondas de revisión ────────────────────────────────────────────────────
  const roundCount = await countRows(sql, "prevention_risk_review_rounds")
  const rounds: (typeof schema.preventionRiskReviewRounds.$inferInsert)[] = roundCount >= 2
    ? []
    : matrices.slice(0, 2).map((matrix, index) => ({
        id: devId("miper-round", index + 1),
        matrixId: matrix.id,
        roundNumber: 1,
        stage: "technical",
        snapshot: { origen: "dev-seed", matriz: matrix.id },
        snapshotSha256: shortHash(`dev-miper-round-${index + 1}`),
        submittedByUserId: actors.adminUserId,
        submittedAt: iso(daysAgo(today, 15 + index)),
        openedAt: iso(daysAgo(today, 14 + index)),
        openedByUserId: actors.adminUserId,
        decision: index === 0 ? null : "approved",
        decidedByUserId: index === 0 ? null : actors.adminUserId,
        decidedAt: index === 0 ? null : iso(daysAgo(today, 5)),
        decisionComment: index === 0 ? null : "Ronda de demostración aprobada.",
      }))
  if (rounds.length > 0) {
    if (apply) {
      inserted += await insertBatch(rounds, async (chunk) =>
        (await db.insert(schema.preventionRiskReviewRounds).values(chunk).onConflictDoNothing().returning({ id: schema.preventionRiskReviewRounds.id })).length,
      )
    } else {
      skipped += rounds.length
    }
  } else {
    skipped += 2
  }
  const usableRounds = roundCount >= 2 ? await db.select().from(schema.preventionRiskReviewRounds).limit(5) : rounds
  const openRound = usableRounds.find((round) => round.decision === null) ?? usableRounds[0]

  // ── Observaciones ─────────────────────────────────────────────────────────
  const observationCount = await countRows(sql, "prevention_risk_observations")
  if (observationCount < 4 && openRound) {
    const observations: (typeof schema.preventionRiskObservations.$inferInsert)[] = [
      { status: "open" as const, body: "Falta acreditar la participación de la jefatura de faena en la revisión." },
      { status: "open" as const, body: "La medida del riesgo crítico no declara un responsable verificable." },
      { status: "answered" as const, body: "El control asociado no tiene evidencia de implementación.", response: "Se adjuntó la evidencia y se actualizó el responsable." },
      { status: "resolved" as const, body: "Observación de demostración resuelta en la ronda anterior.", resolvedByUserId: actors.adminUserId },
    ].map((observation, index) => ({
      id: devId("miper-observation", index + 1),
      matrixId: openRound.matrixId,
      entryId: null,
      entryLabel: `Riesgo de demostración ${index + 1}`,
      roundId: openRound.id,
      stage: "technical",
      authorUserId: actors.adminUserId,
      body: observation.body,
      status: observation.status,
      response: "response" in observation ? observation.response : null,
      respondedByUserId: observation.status === "answered" ? actors.adminUserId : null,
      respondedAt: observation.status === "answered" ? iso(daysAgo(today, 3)) : null,
      resolvedByUserId: "resolvedByUserId" in observation ? observation.resolvedByUserId : null,
      resolvedAt: observation.status === "resolved" ? iso(daysAgo(today, 2)) : null,
      createdAt: iso(daysAgo(today, int(rng, 1, 10))),
    }))
    if (apply) {
      inserted += await insertBatch(observations, async (chunk) =>
        (await db.insert(schema.preventionRiskObservations).values(chunk).onConflictDoNothing().returning({ id: schema.preventionRiskObservations.id })).length,
      )
    } else {
      skipped += observations.length
    }
  } else {
    skipped += 4
  }

  // ── Programa de trabajo MIPER ─────────────────────────────────────────────
  const existingPrograms = await db.select().from(schema.preventionRiskPrograms).limit(10)
  const usedMatrixIds = new Set(existingPrograms.map((program) => program.matrixId))
  const freeMatrix = matrices.find((matrix) => !usedMatrixIds.has(matrix.id))
  if (existingPrograms.length < 2 && freeMatrix) {
    const programId = devId("miper-program", 1)
    const program: typeof schema.preventionRiskPrograms.$inferInsert = {
      id: programId,
      matrixId: freeMatrix.id,
      worksiteId: freeMatrix.worksiteId,
      period: today.getUTCFullYear(),
      companyName: "Chome",
      worksiteName: base.worksites.find((worksite) => worksite.id === freeMatrix.worksiteId)?.name ?? null,
      programManagerUserId: actors.adminUserId,
      elaboratedOn: dateOnly(daysAgo(today, 60)),
      version: 1,
      createdByUserId: actors.adminUserId,
      createdAt: iso(daysAgo(today, 60)),
      updatedAt: iso(daysAgo(today, 60)),
    }
    if (apply) {
      inserted += await insertBatch([program], async (chunk) =>
        (await db.insert(schema.preventionRiskPrograms).values(chunk).onConflictDoNothing().returning({ id: schema.preventionRiskPrograms.id })).length,
      )
    } else {
      skipped += 1
    }

    const actions: (typeof schema.preventionRiskProgramActions.$inferInsert)[] = [1, 2, 3].map((actionNumber) => ({
      id: devId("miper-action", actionNumber),
      programId,
      actionNumber,
      processId: null,
      description: `Actividad de demostración ${actionNumber}: control y seguimiento del riesgo.`,
      responsibleUserId: actors.adminUserId,
      responsibleSnapshot: "Administrador de demostración",
      locationLabel: "Faena de demostración",
      scheduleKind: "monthly",
      startsOn: dateOnly(daysAgo(today, 60)),
      status: "active",
      retiredAt: null,
      retiredReason: null,
      version: 1,
      createdByUserId: actors.adminUserId,
      createdAt: iso(daysAgo(today, 60)),
      updatedAt: iso(daysAgo(today, 60)),
    }))
    if (apply) {
      inserted += await insertBatch(actions, async (chunk) =>
        (await db.insert(schema.preventionRiskProgramActions).values(chunk).onConflictDoNothing().returning({ id: schema.preventionRiskProgramActions.id })).length,
      )
    } else {
      skipped += actions.length
    }

    const occurrences: (typeof schema.preventionRiskProgramOccurrences.$inferInsert)[] = actions.flatMap((action) =>
      [1, 2].map((monthOffset) => ({
        id: devId("miper-occurrence", Number(action.actionNumber) * 10 + monthOffset),
        actionId: action.id!,
        dueOn: dateOnly(daysAgo(today, monthOffset * 30)),
        outcome: monthOffset === 1 ? "pending" : "done",
        currentRecordId: null,
        createdAt: iso(daysAgo(today, 60)),
        updatedAt: iso(daysAgo(today, monthOffset * 30)),
      })),
    )
    if (apply) {
      inserted += await insertBatch(occurrences, async (chunk) =>
        (await db.insert(schema.preventionRiskProgramOccurrences).values(chunk).onConflictDoNothing().returning({ id: schema.preventionRiskProgramOccurrences.id })).length,
      )
      for (const occurrence of occurrences.filter((row) => row.outcome === "done")) {
        const recordId = devId("miper-record", Number(occurrence.id!.split("-").at(-1)))
        await db.insert(schema.preventionRiskProgramOccurrenceRecords).values({
          id: recordId,
          occurrenceId: occurrence.id!,
          outcome: "done",
          effectiveOn: occurrence.dueOn,
          late: false,
          reason: null,
          notes: "Ejecución de demostración.",
          recordedByUserId: actors.adminUserId,
          recordedAt: iso(daysAgo(today, 5)),
        }).onConflictDoNothing()
        await db.update(schema.preventionRiskProgramOccurrences)
          .set({ currentRecordId: recordId, updatedAt: iso(daysAgo(today, 5)) })
          .where(eq(schema.preventionRiskProgramOccurrences.id, occurrence.id!))
      }
    } else {
      skipped += occurrences.length
    }
  } else {
    skipped += 10
    notes.push("Ya existe un programa MIPER por cada matriz disponible; se omite crear otro.")
  }

  log(`  MIPER: ${inserted} filas insertadas, ${skipped} omitidas o planificadas`)
  return { domain: "miper", inserted, skipped, notes }
}
