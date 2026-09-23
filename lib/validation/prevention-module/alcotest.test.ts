import { describe, expect, it } from "vitest"
import { alcoholTestDispatchSchema, alcoholTestRegisterSchema } from "./alcotest"

const BASE_REGISTER = {
  worksiteId: "ws-1",
  shift: "dia",
  performedAt: "2026-03-05T14:00:00.000Z",
  result: "negativo" as const,
  testedWorkerId: "worker-1",
}

const BASE_DISPATCH = {
  worksiteId: "ws-1",
  year: 2026,
  month: 3,
  recipient: "mutual@example.test",
}

/**
 * `slotId` conecta el control/envío con la casilla del programa que cumple
 * (`fulfillAlcotestSlotTx`, prevention-alcotest-slots.ts). Antes de este
 * cambio el schema no lo declaraba, así que Zod lo descartaba en silencio —
 * `.parse()` no lanza por una clave extra, simplemente no la devuelve— y
 * ninguna casilla de alcotest podía marcarse "hecha" desde la aplicación
 * aunque el servicio ya sabía qué hacer con él.
 */
describe("alcoholTestRegisterSchema — slotId", () => {
  it("conserva el slotId cuando viene la casilla elegida", () => {
    const parsed = alcoholTestRegisterSchema.parse({ ...BASE_REGISTER, slotId: "slot-123" })
    expect(parsed.slotId).toBe("slot-123")
  })

  it("acepta null explícito (control extraordinario, sin casilla)", () => {
    const parsed = alcoholTestRegisterSchema.parse({ ...BASE_REGISTER, slotId: null })
    expect(parsed.slotId).toBeNull()
  })

  it("sigue siendo opcional: se puede omitir por completo", () => {
    const parsed = alcoholTestRegisterSchema.parse(BASE_REGISTER)
    expect(parsed.slotId).toBeUndefined()
  })

  it("rechaza un slotId vacío en vez de tratarlo como \"ninguna casilla\"", () => {
    const result = alcoholTestRegisterSchema.safeParse({ ...BASE_REGISTER, slotId: "" })
    expect(result.success).toBe(false)
  })
})

describe("alcoholTestDispatchSchema — slotId", () => {
  it("conserva el slotId cuando viene la casilla elegida", () => {
    const parsed = alcoholTestDispatchSchema.parse({ ...BASE_DISPATCH, slotId: "slot-envio-1" })
    expect(parsed.slotId).toBe("slot-envio-1")
  })

  it("acepta null explícito (envío extraordinario, sin casilla)", () => {
    const parsed = alcoholTestDispatchSchema.parse({ ...BASE_DISPATCH, slotId: null })
    expect(parsed.slotId).toBeNull()
  })

  it("sigue siendo opcional: se puede omitir por completo", () => {
    const parsed = alcoholTestDispatchSchema.parse(BASE_DISPATCH)
    expect(parsed.slotId).toBeUndefined()
  })
})
