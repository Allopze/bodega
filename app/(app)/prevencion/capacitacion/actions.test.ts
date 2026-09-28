import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

const guardPermission = vi.hoisted(() => vi.fn())
const resolveWorksiteScope = vi.hoisted(() => vi.fn())
const recordTrainingOccurrenceStatus = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/can", () => ({ guardPermission }))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/services/prevention-training-occurrences", () => ({ recordTrainingOccurrenceStatus }))

import { recordTrainingOccurrenceStatusAction } from "./actions"

const session = { user: { id: "u1", permissions: ["prevention:training:record"] } }

describe("recordTrainingOccurrenceStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    guardPermission.mockResolvedValue({ session, error: null })
    resolveWorksiteScope.mockReturnValue({ mode: "all" })
  })

  it.each([
    ["completed", "Capacitación marcada como hecha."],
    ["not_completed", "Capacitación marcada como no hecha."],
    // El ternario binario anterior decía «no hecha» también aquí: el aviso
    // contradecía lo que la persona acababa de declarar.
    ["not_applicable", "Capacitación declarada como no aplicable."],
  ])("con estado %s avisa «%s»", async (status, message) => {
    recordTrainingOccurrenceStatus.mockResolvedValue({ status })
    await expect(recordTrainingOccurrenceStatusAction({})).resolves.toEqual({ ok: true, message })
  })

  it("un motivo corto llega al usuario en vez del mensaje genérico", async () => {
    const schema = z.object({ reason: z.string().min(10, "El motivo debe tener al menos 10 caracteres.") })
    const parsed = schema.safeParse({ reason: "corto" })
    recordTrainingOccurrenceStatus.mockRejectedValue(parsed.error)
    const result = await recordTrainingOccurrenceStatusAction({})
    expect(result.ok).toBe(false)
    expect(result.message).toContain("El motivo debe tener al menos 10 caracteres.")
  })
})
