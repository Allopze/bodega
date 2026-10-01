import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { eq } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const db = drizzle(pg, { schema })

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await db.insert(schema.worksites).values({ id: "ws-p", name: "Faena P", code: "P-1" })
  await db.insert(schema.users).values({ id: "u-p", name: "Autora", email: "p@p.cl", hashedPassword: "x", isActive: true })
  await db.insert(schema.preventionRiskMethodologies).values({ id: "m-p", code: "RE-04-CHOME", name: "RE-04", versionLabel: "REV-2026", kind: "primary", authoritySource: "RE-04", createdByUserId: "u-p" })
  await db.insert(schema.preventionRiskMatrices).values({ id: "mx-p", worksiteId: "ws-p", matrixVersion: 1, title: "MIPER P 2026", period: 2026, methodologyId: "m-p", methodologySnapshot: {}, revisionReason: "Elaboración inicial.", participationSummary: "", consultationEvidenceReference: "", createdByUserId: "u-p" })
  await db.insert(schema.preventionRiskPrograms).values({ id: "prog-p", matrixId: "mx-p", worksiteId: "ws-p", period: 2026, createdByUserId: "u-p" })
}, 60_000)

describe("restricciones del Programa de Trabajo (F2)", () => {
  it("un programa por MIPER", async () => {
    await expect(db.insert(schema.preventionRiskPrograms).values({ id: "prog-dup", matrixId: "mx-p", worksiteId: "ws-p", period: 2026, createdByUserId: "u-p" })).rejects.toThrow()
  })

  it("una ocurrencia por actividad y fecha", async () => {
    await db.insert(schema.preventionRiskProgramActions).values({ id: "act-1", programId: "prog-p", actionNumber: 1, description: "Inspeccionar extintores", scheduleKind: "monthly", startsOn: "2026-03-01", status: "active", createdByUserId: "u-p" })
    await db.insert(schema.preventionRiskProgramOccurrences).values({ id: "occ-1", actionId: "act-1", dueOn: "2026-03-31", outcome: "pending" })
    await expect(db.insert(schema.preventionRiskProgramOccurrences).values({ id: "occ-dup", actionId: "act-1", dueOn: "2026-03-31", outcome: "pending" })).rejects.toThrow()
  })

  it("'Se hizo' exige fecha efectiva; 'No se hizo' exige motivo de al menos 10; anular exige motivo", async () => {
    await expect(db.insert(schema.preventionRiskProgramOccurrenceRecords).values({ id: "r-bad", occurrenceId: "occ-1", outcome: "done", recordedByUserId: "u-p" })).rejects.toThrow()
    await expect(db.insert(schema.preventionRiskProgramOccurrenceRecords).values({ id: "r-bad2", occurrenceId: "occ-1", outcome: "not_done", reason: "corto", recordedByUserId: "u-p" })).rejects.toThrow()
    await db.insert(schema.preventionRiskProgramOccurrenceRecords).values({ id: "r-ok", occurrenceId: "occ-1", outcome: "done", effectiveOn: "2026-03-28", recordedByUserId: "u-p" })
    await expect(db.update(schema.preventionRiskProgramOccurrenceRecords).set({ voidedAt: "2026-04-01T10:00:00.000Z", voidedByUserId: "u-p" }).where(eq(schema.preventionRiskProgramOccurrenceRecords.id, "r-ok"))).rejects.toThrow()
  })

  it("el vínculo actividad ↔ medida es único por par", async () => {
    await db.insert(schema.preventionRiskEntries).values({ id: "e-1", matrixId: "mx-p", rowNumber: 1, hazardCode: "R-1", probability: 2, consequence: 4 })
    await db.insert(schema.preventionRiskControls).values({ id: "c-1", riskEntryId: "e-1", description: "Topes", hierarchy: "engineering", status: "proposed" })
    await db.insert(schema.preventionRiskProgramActionControls).values({ id: "l-1", actionId: "act-1", controlId: "c-1", linkedByUserId: "u-p" })
    await expect(db.insert(schema.preventionRiskProgramActionControls).values({ id: "l-dup", actionId: "act-1", controlId: "c-1", linkedByUserId: "u-p" })).rejects.toThrow()
  })
})
