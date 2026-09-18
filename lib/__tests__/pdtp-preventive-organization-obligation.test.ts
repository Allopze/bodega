/**
 * lib/__tests__/pdtp-preventive-organization-obligation.test.ts
 *
 * N°11: la faena que alcanza la dotación exigida y no tiene el órgano
 * preventivo que corresponde abre un compromiso con plazo.
 *
 * Lo que estos casos protegen no es el barrido sino la **frontera legal**: más
 * de 25 trabajadores exige Comité Paritario; entre 10 y 25 basta el Delegado.
 * Por eso el cierre re-evalúa antes de reportar — designar un delegado en una
 * faena grande no satisface la norma y no puede cerrar el caso.
 */

import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"
import { migratePGlite } from "@/lib/testing/pglite-migrate"
import * as schema from "@/db/schema"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error PGlite is compatible at runtime
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({
  get db() {
    return testGlobal.__db
  },
}))
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { chileDateParts } = await import("@/lib/utils")
const {
  sweepPreventiveOrganizationObligations,
  evaluateWorksitePreventiveOrganization,
  onPreventiveOrganizationSatisfied,
} = await import("@/lib/services/pdtp-adapters/preventive-organization-connector")

afterAll(async () => {
  delete testGlobal.__db
  await pg.close()
})

const PROGRAM_YEAR = chileDateParts().year
const PROGRAM_ID = "pdtp-org-v1"
const USER_ID = "user-org-1"
const WS_ID = "ws-org-1"
const ACTIVITY_ID = `${PROGRAM_ID}-a-011`

async function seedWorkers(count: number, worksiteId = WS_ID) {
  if (count === 0) return
  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.workers).values(
    Array.from({ length: count }, (_, i) => ({
      id: `wk-org-${worksiteId}-${i}`,
      firstName: "Trabajador", lastName: `N°${i}`,
      worksiteId, isActive: true, createdAt: now,
    })),
  )
}

async function obligations() {
  return inMemoryDb.select().from(schema.pdtpObligations)
}

beforeEach(async () => {
  await inMemoryDb.delete(schema.pdtpExecutions)
  await inMemoryDb.delete(schema.pdtpObligations)
  await inMemoryDb.delete(schema.pdtpActivities)
  await inMemoryDb.delete(schema.pdtpPrograms)
  await inMemoryDb.delete(schema.preventionWorksiteDelegates)
  await inMemoryDb.delete(schema.preventionCommittees)
  await inMemoryDb.delete(schema.workers)
  await inMemoryDb.delete(schema.worksites)
  await inMemoryDb.delete(schema.users)

  const now = new Date().toISOString()
  await inMemoryDb.insert(schema.users).values({
    id: USER_ID, name: "Prevencionista", email: "prev-org@example.test", hashedPassword: "x",
  })
  await inMemoryDb.insert(schema.worksites).values({ id: WS_ID, name: "Faena Organización", code: "FO", isActive: true })
  await inMemoryDb.insert(schema.pdtpPrograms).values({
    id: PROGRAM_ID, version: 1, year: PROGRAM_YEAR, title: `PDTP ${PROGRAM_YEAR} organización`,
    status: "active", appliesToAllWorksites: true, elaboratedByName: "Prevencionista", elaboratedByTitle: "Experto en Prevención",
    creationMode: "blank", complianceTarget: 0.9, pesoEjecucion: 0.5, pesoVerificacion: 0.3, pesoCierre: 0.2,
    activatedByUserId: USER_ID, createdAt: now, updatedAt: now,
  })
  await inMemoryDb.insert(schema.pdtpActivities).values({
    id: ACTIVITY_ID, programId: PROGRAM_ID, n: 11,
    activity: "Constituir el o los Comités Paritarios cuando proceda",
    program: "Organización preventiva",
    responsibleSlugs: ["prevencionista_faena"], responsibleDisplay: "PRF",
    scheduleMode: "on_demand", scheduleClassificationStatus: "confirmed",
    dueDays: 30,
    evidenceRequirement: "Acta de constitución del comité o el registro del delegado SST.",
    indicatorMode: "closed_on_time",
    sourceSheetRow: 11, createdAt: now, updatedAt: now,
  })
})

describe("sweepPreventiveOrganizationObligations", () => {
  it("26 trabajadores sin comité abren una obligación con 30 días de plazo", async () => {
    await seedWorkers(26)

    const result = await sweepPreventiveOrganizationObligations()

    expect(result.opened).toBe(1)
    const [row] = await obligations()
    expect(row).toBeDefined()
    expect(row!.worksiteId).toBe(WS_ID)
    expect(row!.sourceType).toBe("organizacion_preventiva")
    expect((row!.sourceMetadataJson as Record<string, unknown>).required).toBe("cphs")
    expect((row!.sourceMetadataJson as Record<string, unknown>).headcount).toBe(26)
    const dias = (new Date(row!.dueAt!).getTime() - new Date(row!.sourceOccurredAt!).getTime()) / 86_400_000
    expect(Math.round(dias)).toBe(30)
  })

  it("25 justos abren igual, pero lo exigible es el delegado", async () => {
    // La frontera de la norma es *más* de 25. Con 25 exactos corresponde
    // delegado, no comité; la brecha existe igual si no hay ninguno de los dos.
    await seedWorkers(25)

    await sweepPreventiveOrganizationObligations()

    const [row] = await obligations()
    expect((row!.sourceMetadataJson as Record<string, unknown>).required).toBe("delegate")
  })

  it("una faena chica no abre nada", async () => {
    await seedWorkers(9)
    const result = await sweepPreventiveOrganizationObligations()
    expect(result.opened).toBe(0)
    expect(await obligations()).toHaveLength(0)
  })

  it("dos barridos seguidos dejan un solo caso vivo", async () => {
    await seedWorkers(30)
    await sweepPreventiveOrganizationObligations()
    const second = await sweepPreventiveOrganizationObligations()

    expect(second.opened).toBe(0)
    expect(second.alreadyOpen).toBe(1)
    expect(await obligations()).toHaveLength(1)
  })

  it("el barrido por faena ve lo mismo que el completo", async () => {
    await seedWorkers(30)
    const result = await evaluateWorksitePreventiveOrganization([WS_ID])
    expect(result.opened).toBe(1)
  })

  it("sin programa activo no abre nada y no falla", async () => {
    await seedWorkers(30)
    await inMemoryDb.update(schema.pdtpPrograms).set({ status: "draft" })
      .where(eq(schema.pdtpPrograms.id, PROGRAM_ID))

    const result = await sweepPreventiveOrganizationObligations()

    expect(result.opened).toBe(0)
    expect(result.errors).toBe(0)
    expect(await obligations()).toHaveLength(0)
  })
})

describe("onPreventiveOrganizationSatisfied", () => {
  async function constituteCommitteeRow() {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionCommittees).values({
      id: "cphs-org-1", worksiteId: WS_ID, name: "CPHS Faena Organización",
      constitutedOn: `${PROGRAM_YEAR}-05-02`, mandateEndsOn: `${PROGRAM_YEAR + 2}-05-02`,
      status: "active", createdByUserId: USER_ID, createdAt: now, updatedAt: now,
    })
  }

  async function designateDelegateRow() {
    const now = new Date().toISOString()
    await inMemoryDb.insert(schema.preventionWorksiteDelegates).values({
      id: "cphsdel-org-1", worksiteId: WS_ID, workerId: `wk-org-${WS_ID}-0`,
      designatedOn: `${PROGRAM_YEAR}-05-02`, termEndsOn: null,
      status: "active", createdByUserId: USER_ID, createdAt: now, updatedAt: now,
    })
  }

  it("constituir el comité cierra el caso", async () => {
    await seedWorkers(30)
    await sweepPreventiveOrganizationObligations()
    await constituteCommitteeRow()

    await onPreventiveOrganizationSatisfied({
      worksiteId: WS_ID, kind: "committee", entityId: "cphs-org-1",
      occurredAt: `${PROGRAM_YEAR}-05-02`, userId: USER_ID,
    })

    const [row] = await obligations()
    expect(row!.status).toBe("reported")
    const [execution] = await inMemoryDb.select().from(schema.pdtpExecutions)
    expect(execution!.obligationId).toBe(row!.id)
  })

  it("designar un delegado NO cierra la N°11 en una faena que exige comité", async () => {
    await seedWorkers(41)
    await sweepPreventiveOrganizationObligations()
    await designateDelegateRow()

    await onPreventiveOrganizationSatisfied({
      worksiteId: WS_ID, kind: "delegate", entityId: "cphsdel-org-1",
      occurredAt: `${PROGRAM_YEAR}-05-02`, userId: USER_ID,
    })

    const [row] = await obligations()
    expect(row!.status).toBe("pending")
    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)
  })

  it("designar un delegado sí cierra la N°11 en la banda del delegado", async () => {
    await seedWorkers(15)
    await sweepPreventiveOrganizationObligations()
    await designateDelegateRow()

    await onPreventiveOrganizationSatisfied({
      worksiteId: WS_ID, kind: "delegate", entityId: "cphsdel-org-1",
      occurredAt: `${PROGRAM_YEAR}-05-02`, userId: USER_ID,
    })

    const [row] = await obligations()
    expect(row!.status).toBe("reported")
  })

  it("sin brecha previa no falla ni inventa una ejecución", async () => {
    await seedWorkers(30)
    await constituteCommitteeRow()

    await expect(onPreventiveOrganizationSatisfied({
      worksiteId: WS_ID, kind: "committee", entityId: "cphs-org-1",
      occurredAt: `${PROGRAM_YEAR}-05-02`, userId: USER_ID,
    })).resolves.toBeUndefined()

    expect(await inMemoryDb.select().from(schema.pdtpExecutions)).toHaveLength(0)
  })
})
