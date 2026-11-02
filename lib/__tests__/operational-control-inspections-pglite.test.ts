import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import type { Session } from "next-auth"
import { beforeAll, describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import type { DB } from "@/db"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import { IDS, seedControlFixtures } from "@/lib/combustibles/control/queries/test-fixtures"

/**
 * El Panel cruza las inspecciones con sus hallazgos y con las CAPA vencidas.
 * La prueba fija tres invariantes: las runs canceladas no cuentan, los
 * hallazgos abiertos son trabajo vigente (no del período) y CAPA sólo se
 * consulta con `prevention:capa:view`.
 */

const pg = new PGlite()
const testDb = drizzle(pg, { schema }) as unknown as DB
const g = globalThis as typeof globalThis & { __db?: DB }
g.__db = testDb
vi.mock("@/db", () => ({ get db() { return g.__db } }))
vi.mock("server-only", () => ({}))

const { getOperationalControlHub } = await import("@/lib/services/operational-control")

function session(
  permissions: string[],
  options: { global?: boolean; worksiteIds?: string[] } = {},
): Session {
  return {
    user: {
      id: IDS.user,
      isGlobal: options.global ?? true,
      roles: [],
      worksiteIds: options.worksiteIds ?? [],
      permissions,
    },
    expires: "2099-01-01",
  } as unknown as Session
}

const MARCH = { from: "2026-03-01", to: "2026-03-31" }

beforeAll(async () => {
  await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))
  await seedControlFixtures(testDb)

  await testDb.insert(schema.preventionInspectionTemplates).values({
    id: "ocf-template",
    code: "OCF-TPL",
    versionLabel: "1",
    name: "Plantilla OCF",
    kind: "inspection",
    definitionSnapshot: {},
    contentHash: "a".repeat(64),
    status: "draft",
    authorUserId: IDS.user,
  })

  await testDb.insert(schema.preventionInspectionRuns).values([
    {
      id: "ocf-run-a",
      code: "OCF-A",
      templateId: "ocf-template",
      worksiteId: IDS.wsA,
      subjectVehicleId: IDS.vA,
      subjectLabel: "KA-1",
      scheduledFor: "2026-03-10",
      status: "completed",
      compliancePercent: 80,
      nonConformingCount: 2,
      partialCount: 1,
      createdByUserId: IDS.user,
    },
    {
      id: "ocf-run-b",
      code: "OCF-B",
      templateId: "ocf-template",
      worksiteId: IDS.wsB,
      subjectVehicleId: IDS.vB,
      subjectLabel: "KB-2",
      scheduledFor: "2026-03-11",
      status: "completed",
      compliancePercent: 50,
      nonConformingCount: 0,
      partialCount: 0,
      createdByUserId: IDS.user,
    },
    // Cancelada: no debe sumar conteo, no conformes, cumplimiento ni hallazgos.
    {
      id: "ocf-run-cancelled",
      code: "OCF-C",
      templateId: "ocf-template",
      worksiteId: IDS.wsA,
      subjectVehicleId: IDS.vA,
      subjectLabel: "KA-1",
      scheduledFor: "2026-03-12",
      status: "cancelled",
      compliancePercent: 0,
      nonConformingCount: 5,
      partialCount: 0,
      createdByUserId: IDS.user,
    },
  ])

  await testDb.insert(schema.preventionCapaActions).values([
    {
      id: "ocf-capa-overdue",
      code: "OCF-CAPA-1",
      sourceType: "inspection",
      sourceId: "ocf-finding-critical",
      worksiteId: IDS.wsA,
      finding: "Hallazgo crítico",
      actionDescription: "Corregir",
      targetDate: "2020-01-01",
      status: "pending",
      createdByUserId: IDS.user,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    },
    {
      id: "ocf-capa-future",
      code: "OCF-CAPA-2",
      sourceType: "inspection",
      sourceId: "ocf-finding-b",
      worksiteId: IDS.wsB,
      finding: "Hallazgo de B",
      actionDescription: "Corregir",
      targetDate: "2099-01-01",
      status: "pending",
      createdByUserId: IDS.user,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    },
  ])

  await testDb.insert(schema.preventionInspectionFindings).values([
    { id: "ocf-finding-critical", runId: "ocf-run-a", description: "Crítico", criticality: "critical", status: "capa_linked", capaActionId: "ocf-capa-overdue" },
    // Segundo hallazgo que referencia la MISMA CAPA: la CAPA debe contarse una vez.
    { id: "ocf-finding-critical-2", runId: "ocf-run-a", description: "Otro hallazgo de la misma CAPA", criticality: "high", status: "capa_linked", capaActionId: "ocf-capa-overdue" },
    { id: "ocf-finding-open", runId: "ocf-run-a", description: "Abierto", criticality: "high", status: "open" },
    { id: "ocf-finding-closed", runId: "ocf-run-a", description: "Cerrado", criticality: "critical", status: "closed" },
    { id: "ocf-finding-b", runId: "ocf-run-b", description: "De B", criticality: "low", status: "open", capaActionId: "ocf-capa-future" },
    { id: "ocf-finding-cancelled", runId: "ocf-run-cancelled", description: "De run cancelada", criticality: "critical", status: "open" },
  ])
}, 120_000)

describe("Panel operacional: inspecciones, hallazgos y CAPA", () => {
  it("cruza cumplimiento, hallazgos abiertos y CAPA vencidas por vehículo", async () => {
    const hub = await getOperationalControlHub(
      session(["prevention:inspections:view", "prevention:capa:view"]),
      MARCH,
    )
    const a = hub.assets.find((asset) => asset.id === IDS.vA)!
    const b = hub.assets.find((asset) => asset.id === IDS.vB)!

    expect(a).toMatchObject({
      // La run cancelada no suma: queda 1 inspección, 2 no conformes y 80 %.
      inspectionCount: 1,
      inspectionCompliancePercent: 80,
      inspectionNonConforming: 2,
      inspectionPartial: 1,
      // Abierto + dos capa_linked; el cerrado y el de la run cancelada no cuentan.
      openFindings: 3,
      criticalOpenFindings: 1,
      // Dos hallazgos referencian la misma CAPA: se cuenta una sola vez.
      overdueCapa: 1,
    })
    expect(b).toMatchObject({
      inspectionCount: 1,
      inspectionCompliancePercent: 50,
      openFindings: 1,
      criticalOpenFindings: 0,
      // La CAPA de B vence en 2099: no está vencida.
      overdueCapa: 0,
    })
  })

  it("sin prevention:capa:view no devuelve CAPA, pero conserva los hallazgos", async () => {
    const hub = await getOperationalControlHub(session(["prevention:inspections:view"]), MARCH)
    const a = hub.assets.find((asset) => asset.id === IDS.vA)!

    expect(a.overdueCapa).toBeNull()
    expect(a.openFindings).toBe(3)
    expect(a.criticalOpenFindings).toBe(1)
  })

  it("sin prevention:inspections:view no consulta ni devuelve inspecciones, hallazgos ni CAPA, aunque tenga CAPA", async () => {
    const hub = await getOperationalControlHub(session(["mantenciones:view", "prevention:capa:view"]), MARCH)
    const a = hub.assets.find((asset) => asset.id === IDS.vA)!

    expect(a.inspectionCompliancePercent).toBeNull()
    expect(a.inspectionNonConforming).toBeNull()
    expect(a.inspectionPartial).toBeNull()
    expect(a.openFindings).toBeNull()
    expect(a.criticalOpenFindings).toBeNull()
    expect(a.overdueCapa).toBeNull()
  })

  it("el alcance por faena deja fuera los hallazgos y CAPA del equipo ajeno", async () => {
    const hub = await getOperationalControlHub(
      session(
        ["prevention:inspections:view", "prevention:capa:view"],
        { global: false, worksiteIds: [IDS.wsA] },
      ),
      MARCH,
    )

    expect(hub.assets.map((asset) => asset.id)).toEqual([IDS.vA])
    expect(hub.assets[0]).toMatchObject({ openFindings: 3, criticalOpenFindings: 1, overdueCapa: 1 })
  })
})
