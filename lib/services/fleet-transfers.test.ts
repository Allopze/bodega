import { DrizzleQueryError } from "drizzle-orm"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * El trigger diferido `FLEET_STAY_INVARIANT` salta al CONFIRMAR la transacción
 * (otra sesión cambió la faena del equipo entre medio). Drizzle lo envuelve en
 * un `DrizzleQueryError` con el error de Postgres en `cause`: la persona tiene
 * que ver «recarga e inténtalo de nuevo», no el SQL.
 */

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  recheck: vi.fn(async () => ({ requested: true })),
}))
vi.mock("@/db", () => ({ db: { transaction: mocks.transaction } }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/combustibles/copec-sync", () => ({ requestCopecRecheckFrom: mocks.recheck }))

const { transferVehicles, voidTransfer } = await import("./fleet-transfers")

const STALE = "El equipo cambió de faena en otra sesión. Recarga e inténtalo de nuevo."
const actor = { userId: "u-1", email: "ana@example.com", scope: "all" as const }
const transferInput = {
  toWorksiteId: "ws-b", effectiveDate: "2026-11-15", reason: "Refuerzo de la faena Mininco", authorizedBy: "Gerencia", vehicleIds: ["v-1"],
}

function invariantAtCommit(): DrizzleQueryError {
  const pgError = new Error("FLEET_STAY_INVARIANT: el equipo v-1 quedó en ws-b y su estadía abierta es de ws-a")
  return new DrizzleQueryError("commit", [], pgError)
}

beforeEach(() => {
  mocks.transaction.mockReset()
  mocks.recheck.mockClear()
})

describe("FLEET_STAY_INVARIANT al confirmar", () => {
  it("el traslado lo traduce a «cambió de faena en otra sesión» y no pide revisar Copec", async () => {
    mocks.transaction.mockRejectedValue(invariantAtCommit())
    expect(await transferVehicles(actor, transferInput, "2026-11-18")).toEqual({ ok: false, message: STALE })
    expect(mocks.recheck).not.toHaveBeenCalled()
  })

  it("la anulación lo traduce igual", async () => {
    mocks.transaction.mockRejectedValue(invariantAtCommit())
    expect(await voidTransfer(actor, { transferId: "t-1", reason: "Se registró por error" }, "2026-11-18"))
      .toEqual({ ok: false, message: STALE })
  })

  it("cualquier otro error de la base sigue su curso", async () => {
    const other = new DrizzleQueryError("insert", [], new Error("connection terminated"))
    mocks.transaction.mockRejectedValue(other)
    await expect(transferVehicles(actor, transferInput, "2026-11-18")).rejects.toBe(other)
    await expect(voidTransfer(actor, { transferId: "t-1", reason: "Se registró por error" }, "2026-11-18")).rejects.toBe(other)
  })
})
