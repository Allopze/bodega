import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { and, eq } from "drizzle-orm"
import { describe, expect, it, vi } from "vitest"
import * as schema from "@/db/schema"
import { migratePGlite } from "@/lib/testing/pglite-migrate"

const pg = new PGlite()
const inMemoryDb = drizzle(pg, { schema })
const testGlobal = globalThis as typeof globalThis & { __db?: typeof inMemoryDb }
// @ts-expect-error — PGlite es estructuralmente compatible en runtime.
testGlobal.__db = inMemoryDb

vi.mock("@/db", () => ({ get db() { return testGlobal.__db } }))

await migratePGlite(pg, path.resolve(process.cwd(), "db/migrations"))

const { closeCopecPeriodWithIssues, recordCopecPeriodCoverage } = await import("@/lib/combustibles/copec-coverage-store")
const { canCloseCopecPeriodWithIssues, isTerminalCopecCoverage } = await import("@/lib/combustibles/copec-coverage")
const { listOpenCopecRejections, resolveFuelProviderRejection } = await import("@/lib/combustibles/fuel-provider-ledger")
const { loadVehicleResolver } = await import("@/lib/combustibles/plate-resolver")

const ACTOR = "op-copec-ingesta"
const WORKSITE = "ws-copec-ingesta"
const VEHICLE = "veh-copec-ingesta"

await inMemoryDb.insert(schema.users).values({ id: ACTOR, name: "Operador Copec", email: "copec@chome.test", hashedPassword: "x" })
await inMemoryDb.insert(schema.worksites).values({ id: WORKSITE, name: "Faena Copec", code: "FC-COPEC", isActive: true })
await inMemoryDb.insert(schema.fuelEquipmentTypes).values({ id: "et-copec", slug: "camion-copec", name: "Camión" })
await inMemoryDb.insert(schema.fuelVehicles).values({
  id: VEHICLE, plate: "KA-1", type: "camion", equipmentTypeId: "et-copec", worksiteId: WORKSITE,
})
await inMemoryDb.insert(schema.fuelProviderSyncRuns).values({
  id: "run-copec-mejoras", provider: "copec", requestedFrom: "2026-05-01", requestedTo: "2026-05-31",
  correlationId: "corr-copec-mejoras", actorUserId: ACTOR,
})

describe("C1 · cerrar un mes Copec con observaciones", () => {
  it("guarda el estado terminal, el motivo y el operador, y no vuelve a cerrarse", async () => {
    await recordCopecPeriodCoverage({
      channel: "TCT", product: "diesel", month: "2026-05-01", status: "incomplete", sourceAvailability: "available",
      rowsReceived: 10, rowsAccepted: 9, rowsRejected: 1, rowsPending: 0,
    })

    expect(canCloseCopecPeriodWithIssues({
      status: "incomplete", sourceAvailability: "available", rowsReceived: 10, rowsPending: 0,
    })).toEqual({ ok: true })
    expect(canCloseCopecPeriodWithIssues({
      status: "incomplete", sourceAvailability: "available", rowsReceived: 10, rowsPending: 1,
    }).ok).toBe(false)

    const closed = await closeCopecPeriodWithIssues({
      channel: "TCT", product: "diesel", month: "2026-05-01",
      reason: "Copec corrigió una fila con patente vacía; el resto se verificó contra el portal.",
      actorUserId: ACTOR,
    })
    expect(closed.status).toBe("closed_with_issues")
    expect(isTerminalCopecCoverage(closed.status)).toBe(true)

    const [saved] = await inMemoryDb.select().from(schema.fuelProviderPeriodCoverage)
      .where(and(
        eq(schema.fuelProviderPeriodCoverage.sourceAccount, "tct:diesel"),
        eq(schema.fuelProviderPeriodCoverage.periodMonth, "2026-05-01"),
      ))
    expect(saved).toMatchObject({
      status: "closed_with_issues",
      evidenceActorUserId: ACTOR,
      rowsReceived: 10,
      rowsAccepted: 9,
      rowsRejected: 1,
    })
    expect(saved?.evidence).toContain("Copec corrigió una fila")

    await expect(closeCopecPeriodWithIssues({
      channel: "TCT", product: "diesel", month: "2026-05-01",
      reason: "Segundo cierre que no debe aplicarse",
      actorUserId: ACTOR,
    })).rejects.toThrow(/ya tiene la cobertura cerrada/)
  })
})

describe("C2 · resolver una observación del proveedor", () => {
  it("marca la revisión y la transacción original, y deja de listarla como abierta", async () => {
    await inMemoryDb.insert(schema.fuelProviderRejections).values({
      id: "rej-copec-1", syncRunId: "run-copec-mejoras", provider: "copec", sourceAccount: "tct:diesel",
      sourceRowKey: "row-1", code: "possible_provider_correction", message: "La guía cambió de volumen", status: "open",
    })
    await inMemoryDb.insert(schema.fuelProviderTransactions).values({
      id: "tx-copec-1", syncRunId: "run-copec-mejoras", provider: "copec", sourceAccount: "tct:diesel",
      identityKey: "row:copec:tct:diesel:row-1", sourceRowKey: "row-1", fingerprint: "fp-1",
      status: "pending", payloadHash: "hash-1",
    })

    expect(await listOpenCopecRejections()).toHaveLength(1)
    await resolveFuelProviderRejection({
      rejectionId: "rej-copec-1", status: "resolved",
      reason: "La corrección coincide con el vale de despacho firmado.",
      actorUserId: ACTOR,
    })

    const [rejection] = await inMemoryDb.select().from(schema.fuelProviderRejections)
      .where(eq(schema.fuelProviderRejections.id, "rej-copec-1"))
    const [transaction] = await inMemoryDb.select().from(schema.fuelProviderTransactions)
      .where(eq(schema.fuelProviderTransactions.id, "tx-copec-1"))
    expect(rejection).toMatchObject({ status: "resolved", resolvedBy: ACTOR })
    expect(transaction).toMatchObject({ status: "superseded", resolutionCode: "correction_approved" })
    expect(await listOpenCopecRejections()).toHaveLength(0)
  })

  it("una fila inválida no se aprueba como corrección: sólo se marca revisada", async () => {
    await inMemoryDb.insert(schema.fuelProviderRejections).values({
      id: "rej-copec-invalida", syncRunId: "run-copec-mejoras", provider: "copec", sourceAccount: "tct:diesel",
      sourceRowKey: "row-invalida", code: "invalid_quantity", message: "Volumen negativo", status: "open",
    })
    const [listed] = await listOpenCopecRejections()
    expect(listed).toMatchObject({ id: "rej-copec-invalida", isCorrection: false })

    await expect(resolveFuelProviderRejection({
      rejectionId: "rej-copec-invalida", status: "resolved",
      reason: "Intento de aprobar una fila que no es corrección.",
      actorUserId: ACTOR,
    })).rejects.toThrow(/Sólo una corrección del proveedor se puede aprobar/)

    await resolveFuelProviderRejection({
      rejectionId: "rej-copec-invalida", status: "dismissed",
      reason: "Revisada contra el portal: la fila no corresponde a un despacho.",
      actorUserId: ACTOR,
    })
    const [rejection] = await inMemoryDb.select().from(schema.fuelProviderRejections)
      .where(eq(schema.fuelProviderRejections.id, "rej-copec-invalida"))
    expect(rejection).toMatchObject({ status: "dismissed", resolvedBy: ACTOR })
  })
})

describe("C3 · la flota del proveedor no depende de la cuenta", () => {
  it("un vínculo hecho en Diésel cuenta como flota al sincronizar BlueMax, sin heredar la asignación", async () => {
    await inMemoryDb.insert(schema.fuelProviderMappings).values({
      id: "map-copec-1", provider: "copec", sourceAccount: "tct:diesel", externalKey: "KA-1",
      normalizedValue: "KA1", worksiteId: WORKSITE, vehicleId: VEHICLE, decidedBy: ACTOR,
      reason: "Vínculo manual del lote diésel", effectiveFrom: "2026-01-01",
    })

    const resolver = await loadVehicleResolver({ provider: "copec", sourceAccount: "tct:bluemax" })
    expect(resolver.inFleet("KA-1")).toBe(true)
    // La asignación temporal sí es de la cuenta: en un período histórico BlueMax
    // no hereda el vínculo de Diésel (el fallback por patrón sólo aplica al mes en curso).
    expect(resolver("KA-1", "2026-02-01", "2026-02-28")).toBeUndefined()
  })
})
