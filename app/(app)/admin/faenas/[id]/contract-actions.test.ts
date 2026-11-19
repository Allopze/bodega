import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Alcance de las acciones de contratos de la faena: la faena del formulario la
 * controla quien envía, así que al editar se valida también la GUARDADA.
 */

const mocks = vi.hoisted(() => ({
  storedWorksiteId: "w-b" as string | null,
  storedExists: true,
  save: vi.fn(async () => ({ ok: true as const, id: "c-1", code: "CTR-2026-0001" })),
}))

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/routing/revalidate-vehicle-ficha", () => ({ revalidateVehicleFicha: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({
  guardPermission: vi.fn(async () => ({
    session: { user: { id: "u-1", email: "a@chome.test", isGlobal: false, worksiteIds: ["w-a"], roles: [], permissions: ["admin:worksites"] } },
    error: null,
  })),
}))
vi.mock("@/lib/auth/scope", () => ({
  canAccessWorksite: (session: { user: { worksiteIds: string[] } }, id: string) => session.user.worksiteIds.includes(id),
}))
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (mocks.storedExists ? [{ worksiteId: mocks.storedWorksiteId }] : []),
        }),
      }),
    }),
  },
}))
vi.mock("@/lib/services/contracts/contracts", () => ({
  saveOperationalContract: mocks.save,
  createMandante: vi.fn(),
}))
vi.mock("@/lib/services/contracts/assignments", () => ({ assignVehiclesToContract: vi.fn() }))

const { saveOperationalContractAction } = await import("./contract-actions")

const input = (overrides: Record<string, unknown> = {}) => ({
  worksiteId: "w-a", clientId: "cl-1", name: "Movimiento de residuos", status: "active", ...overrides,
})

afterEach(() => {
  mocks.storedWorksiteId = "w-b"
  mocks.storedExists = true
  vi.clearAllMocks()
})

describe("saveOperationalContractAction", () => {
  it("no deja editar un contrato de una faena fuera del alcance aunque el formulario diga otra", async () => {
    const result = await saveOperationalContractAction(input({ id: "c-de-b" }))
    expect(result).toEqual({ ok: false, message: "No tienes acceso a esta faena" })
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it("no deja editar un contrato transversal (sin faena) desde la faena", async () => {
    mocks.storedWorksiteId = null
    const result = await saveOperationalContractAction(input({ id: "c-transversal" }))
    expect(result.ok).toBe(false)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it("edita un contrato de una faena del alcance", async () => {
    mocks.storedWorksiteId = "w-a"
    const result = await saveOperationalContractAction(input({ id: "c-1" }))
    expect(result.ok).toBe(true)
    expect(mocks.save).toHaveBeenCalledTimes(1)
  })

  it("crea un contrato en una faena del alcance sin consultar uno guardado", async () => {
    mocks.storedExists = false
    const result = await saveOperationalContractAction(input())
    expect(result.ok).toBe(true)
  })

  it("rechaza crear en una faena fuera del alcance", async () => {
    const result = await saveOperationalContractAction(input({ worksiteId: "w-b" }))
    expect(result).toEqual({ ok: false, message: "No tienes acceso a esta faena" })
  })
})
