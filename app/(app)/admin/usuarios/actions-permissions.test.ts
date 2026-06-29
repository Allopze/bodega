import { beforeEach, describe, expect, it, vi } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: (...args: unknown[]) => mockRequirePermission(...args),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }))
vi.mock("@/lib/auth/rbac", () => ({ clearUserRbacCache: vi.fn() }))
vi.mock("@/lib/email/smtp", () => ({
  getAppBaseUrl: () => "http://localhost:3000",
  sendInvitationEmail: vi.fn(),
}))

describe("admin usuarios Server Actions permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("inviteUser denies direct action calls without admin:users", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("Forbidden"))
    const { inviteUser } = await import("./actions")

    const result = await inviteUser({ ok: false }, new FormData())

    expect(result.ok).toBe(false)
    expect(result.message).toContain("Sin permisos")
  })

  it("createUser denies direct action calls without admin:users", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("Forbidden"))
    const { createUser } = await import("./actions")

    const result = await createUser({ ok: false }, new FormData())

    expect(result.ok).toBe(false)
    expect(result.message).toContain("Sin permisos")
  })
})
