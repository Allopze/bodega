import { describe, expect, it } from "vitest"
import { canRegisterReceiptForOrder } from "./recepcion-table.helpers"

describe("canRegisterReceiptForOrder", () => {
  it("does not offer direct-to-worksite receipt to an office-only actor", () => {
    expect(canRegisterReceiptForOrder("directo_faena", "sent", true, false)).toBe(false)
  })

  it("allows the direct route only to an actor who can receive at the worksite", () => {
    expect(canRegisterReceiptForOrder("directo_faena", "sent", false, true)).toBe(true)
  })

  it("offers each office-route stage only to its valid receiver", () => {
    expect(canRegisterReceiptForOrder("via_oficina", "sent", true, false)).toBe(true)
    expect(canRegisterReceiptForOrder("via_oficina", "sent", false, true)).toBe(false)
    expect(canRegisterReceiptForOrder("via_oficina", "office_received", true, false)).toBe(false)
    expect(canRegisterReceiptForOrder("via_oficina", "office_received", false, true)).toBe(true)
    expect(canRegisterReceiptForOrder("via_oficina", "partially_office_received", false, true)).toBe(true)
  })
})
