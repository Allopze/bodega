import { describe, expect, it } from "vitest"
import { canRegisterReceiptForOrder, quietOrderStatusesForTab } from "./recepcion-table.helpers"

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

describe("quietOrderStatusesForTab", () => {
  it("«Por atender» (sin estado) da por sabida la OC pendiente de recepción", () => {
    expect(quietOrderStatusesForTab(null)).toEqual(["sent"])
    expect(quietOrderStatusesForTab("")).toEqual(["sent"])
  })

  it("una pestaña de un solo estado lo da por sabido", () => {
    expect(quietOrderStatusesForTab("sent")).toEqual(["sent"])
    expect(quietOrderStatusesForTab("partially_received")).toEqual(["partially_received"])
  })

  it("una pestaña con varios estados no silencia ninguno", () => {
    expect(quietOrderStatusesForTab("partially_office_received,office_received")).toEqual([])
    expect(quietOrderStatusesForTab("sent,office_received,received,closed")).toEqual([])
  })
})
