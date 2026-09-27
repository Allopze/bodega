import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGuardPermission = vi.hoisted(() => vi.fn())
const mockFindFirst = vi.hoisted(() => vi.fn())

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock("@/lib/auth/can", () => ({ guardPermission: mockGuardPermission }))
vi.mock("@/db", () => ({
  db: { query: { billingProposals: { findFirst: mockFindFirst } } },
}))

const { transitionProposalAction } = await import("./actions")

describe("transitionProposalAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGuardPermission.mockResolvedValue({ session: null, error: { ok: false, message: "Sin permisos" } })
  })

  it("exige sesión con permiso antes de validar la entrada", async () => {
    // Una server action es un POST público: quien no tiene sesión no debe
    // poder sondear qué forma de entrada acepta (el mensaje de zod) ni llegar
    // a ningún trabajo del servidor.
    const result = await transitionProposalAction({ transition: "no-existe" })

    expect(mockGuardPermission).toHaveBeenCalledWith("billing:view")
    expect(result).toEqual({ ok: false, message: "Sin permisos" })
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it("con permiso, la entrada inválida sigue rechazándose sin tocar la base", async () => {
    mockGuardPermission.mockResolvedValue({ session: { user: { id: "u1" } }, error: null })

    const result = await transitionProposalAction({ transition: "no-existe" })

    expect(result.ok).toBe(false)
    expect(result.message).not.toBe("Sin permisos")
    expect(mockFindFirst).not.toHaveBeenCalled()
  })
})
