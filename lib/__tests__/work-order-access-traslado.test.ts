import { describe, expect, it } from "vitest"
import {
  allowedTransitions, canActOnWorkOrder, canSeeWorkOrder, currentWorksiteOf, workOrderVisibility, type AccessViewer, type WorkOrderAccessFacts,
} from "@/lib/services/mantencion/work-orders/access"

/**
 * La OT sigue al equipo: la visibilidad suma la faena de imputación y la actual del equipo, y la recepción
 * y la conformidad se juzgan con la faena ACTUAL (`vehicleWorksiteId`; sin dato, la de imputación).
 */

const ADMIN_PERMISSIONS = ["mant:ot:view_worksite", "mant:ot:receive", "mant:ot:conform", "mant:ot:create"]
const admin = (worksiteId: string): AccessViewer => ({ userId: `admin-${worksiteId}`, permissions: ADMIN_PERMISSIONS, worksiteIds: [worksiteId], isGlobal: false })

const facts = (patch: Partial<WorkOrderAccessFacts> = {}): WorkOrderAccessFacts => ({
  status: "trabajo_terminado", worksiteId: "A", requestedByUserId: "u-x", assignedToUserId: "u-y", ...patch,
})

describe("faena actual del equipo", () => {
  it("sin dato o sin traslado vale la de imputación", () => {
    expect(currentWorksiteOf(facts())).toBe("A")
    expect(currentWorksiteOf(facts({ vehicleWorksiteId: null }))).toBe("A")
    expect(currentWorksiteOf(facts({ vehicleWorksiteId: "B" }))).toBe("B")
  })
})

describe("canSeeWorkOrder", () => {
  it("ve la OT por la faena de imputación o por la actual del equipo; otra faena no", () => {
    const trasladada = facts({ vehicleWorksiteId: "B" })
    expect(canSeeWorkOrder(workOrderVisibility(admin("A")), trasladada)).toBe(true)
    expect(canSeeWorkOrder(workOrderVisibility(admin("B")), trasladada)).toBe(true)
    expect(canSeeWorkOrder(workOrderVisibility(admin("C")), trasladada)).toBe(false)
  })

  it("sin traslado todo como antes", () => {
    expect(canSeeWorkOrder(workOrderVisibility(admin("A")), facts())).toBe(true)
    expect(canSeeWorkOrder(workOrderVisibility(admin("A")), facts({ vehicleWorksiteId: "A" }))).toBe(true)
    expect(canSeeWorkOrder(workOrderVisibility(admin("B")), facts())).toBe(false)
  })
})

describe("recepción y conformidad: las da la faena actual del equipo", () => {
  const trasladada = (status: string) => facts({ status, vehicleWorksiteId: "B" })

  it("el destino las gana y el origen las pierde", () => {
    expect(canActOnWorkOrder(admin("B"), trasladada("trabajo_terminado"), "receive")).toEqual({ ok: true })
    expect(canActOnWorkOrder(admin("B"), trasladada("recepcionada"), "conform")).toEqual({ ok: true })
    expect(canActOnWorkOrder(admin("A"), trasladada("trabajo_terminado"), "receive")).toMatchObject({ ok: false, code: "forbidden" })
    expect(canActOnWorkOrder(admin("A"), trasladada("recepcionada"), "conform")).toMatchObject({ ok: false, code: "forbidden" })
    expect(allowedTransitions(admin("B"), trasladada("trabajo_terminado"))).toContain("receive")
    expect(allowedTransitions(admin("A"), trasladada("trabajo_terminado"))).not.toContain("receive")
  })

  it("sin traslado, o sin la faena actual, la faena de imputación decide como antes", () => {
    for (const vehicleWorksiteId of [undefined, null, "A"] as const) {
      const sin = facts({ status: "recepcionada", vehicleWorksiteId })
      expect(canActOnWorkOrder(admin("A"), sin, "conform")).toEqual({ ok: true })
      expect(canActOnWorkOrder(admin("B"), sin, "conform")).toMatchObject({ ok: false, code: "forbidden" })
    }
  })

  it("un rol global las da siempre", () => {
    const global: AccessViewer = { userId: "g", permissions: ADMIN_PERMISSIONS, worksiteIds: [], isGlobal: true }
    expect(canActOnWorkOrder(global, trasladada("recepcionada"), "conform")).toEqual({ ok: true })
  })
})
