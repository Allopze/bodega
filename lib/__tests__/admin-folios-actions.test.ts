/**
 * Unit tests for folio / code_sequence admin actions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequirePermission = vi.hoisted(() => vi.fn())
const mockRecordAudit = vi.hoisted(() => vi.fn())
const mockSelectSeq = vi.hoisted(() => vi.fn())
const mockSetCodeSequenceNextValue = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({
  requirePermission: mockRequirePermission,
}))
vi.mock("@/lib/audit", () => ({
  recordAudit: mockRecordAudit,
}))
vi.mock("@/lib/code-sequences", () => ({
  setCodeSequenceNextValue: mockSetCodeSequenceNextValue,
}))
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: () => mockSelectSeq() })),
      })),
    })),
  },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { correctCodeSequenceAction } from "@/app/(app)/admin/folios/actions"
import type { ActionState } from "@/lib/validation/masters"

const prevState: ActionState = { ok: false, message: "" }

function makeSession() {
  return {
    expires: "2099-01-01",
    user: {
      id: "user-1",
      email: "admin@test.cl",
      name: "Admin",
      roles: ["administrador"],
      permissions: ["admin:folios"],
      worksiteIds: [],
      primaryWorksiteId: "",
      avatarColor: "#000",
      isActive: true,
    },
  }
}

function makeFormData(fields: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set("prefix", "OC")
  fd.set("year", "2026")
  fd.set("nextValue", "100")
  fd.set("confirmation", "OC-2026")
  for (const [k, v] of Object.entries(fields)) {
    if (v === "") fd.delete(k)
    else fd.set(k, v)
  }
  return fd
}

describe("correctCodeSequenceAction", () => {
  beforeEach(() => vi.resetAllMocks())

  it("requires admin:folios", async () => {
    mockRequirePermission.mockRejectedValueOnce(new Error("No permission"))
    const res = await correctCodeSequenceAction(prevState, makeFormData())
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Sin permisos")
  })

  it("rejects missing prefix", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const res = await correctCodeSequenceAction(prevState, makeFormData({ prefix: "" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("Prefijo")
  })

  it("rejects non-4-digit year", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const res = await correctCodeSequenceAction(prevState, makeFormData({ year: "26" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("4 dígitos")
  })

  it("rejects invalid nextValue", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const res = await correctCodeSequenceAction(prevState, makeFormData({ nextValue: "0" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("entero mayor o igual a 1")
  })

  it("rejects wrong confirmation", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    const res = await correctCodeSequenceAction(prevState, makeFormData({ confirmation: "wrong" }))
    expect(res.ok).toBe(false)
    expect(res.message).toContain("exactamente")
  })

  it("applies correction when confirmation matches, auditing before and after values", async () => {
    mockRequirePermission.mockResolvedValueOnce(makeSession())
    mockSelectSeq.mockResolvedValueOnce([{ prefix: "OC", year: 2026, nextValue: 7 }])
    mockSetCodeSequenceNextValue.mockResolvedValueOnce({ before: 7, after: 100 })

    const res = await correctCodeSequenceAction(prevState, makeFormData())

    expect(res.ok).toBe(true)
    expect(mockSetCodeSequenceNextValue).toHaveBeenCalledWith({ prefix: "OC", year: 2026, nextValue: 100 })
    expect(mockRecordAudit).toHaveBeenCalledWith(expect.objectContaining({
      entityType: "code_sequence",
      entityId: "OC-2026",
      oldState: { nextValue: 7 },
      newState: { nextValue: 100 },
    }))
  })
})
