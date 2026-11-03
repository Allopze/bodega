import { describe, expect, it } from "vitest"
import { ITEM_STATE_META, OC_STATE_META, REQUEST_STATE_META } from "@/components/states/state-badge"
import {
  STATUS_LIFECYCLE,
  statusRows,
  toBreakdownRows,
  UNKNOWN_WORKSITE_LABEL,
  worksiteLabels,
} from "./reportes-page.helpers"

describe("statusRows · orden de ciclo de vida (Fase 0 · 0.3d)", () => {
  it("ordena por ciclo de vida y no por cantidad", () => {
    const rows = statusRows(
      [{ status: "closed", total: 40 }, { status: "draft", total: 1 }, { status: "in_purchasing", total: 12 }, { status: "submitted", total: 3 }],
      "request",
    )
    expect(rows.map(([status]) => status)).toEqual(["draft", "submitted", "in_purchasing", "closed"])
    expect(rows.map(([, count]) => count)).toEqual([1, 3, 12, 40])
  })

  it("los desenlaces que salen del flujo van al final", () => {
    const rows = statusRows(
      [{ status: "cancelled", total: 9 }, { status: "closed", total: 1 }, { status: "rejected", total: 5 }, { status: "approved", total: 2 }],
      "request",
    )
    expect(rows.map(([status]) => status)).toEqual(["approved", "closed", "rejected", "cancelled"])
  })

  it("un estado desconocido no se pierde: va después de los conocidos, en orden estable", () => {
    const rows = statusRows(
      [{ status: "zeta", total: 1 }, { status: "delivered", total: 1 }, { status: "alfa", total: 1 }],
      "item",
    )
    expect(rows.map(([status]) => status)).toEqual(["delivered", "alfa", "zeta"])
  })

  it("convierte el conteo a número (las agregaciones de la base pueden llegar como texto)", () => {
    const rows = statusRows([{ status: "draft", total: "4" as unknown as number }], "oc")
    expect(rows).toEqual([["draft", 4]])
  })

  it.each([
    ["request", REQUEST_STATE_META],
    ["item", ITEM_STATE_META],
    ["oc", OC_STATE_META],
  ] as const)("todo estado de %s con rótulo figura en el orden, sin repetirse", (entity, meta) => {
    const order = STATUS_LIFECYCLE[entity]
    expect(new Set(order).size).toBe(order.length)
    expect([...order].sort()).toEqual(Object.keys(meta).sort())
  })
})

describe("worksiteLabels / toBreakdownRows · faenas legibles (Fase 0 · 0.3c)", () => {
  const labels = worksiteLabels([
    { id: "ws-1", name: "Faena Norte", isActive: true },
    { id: "ws-2", name: "Faena Cerrada", isActive: false },
  ])

  it("marca las inactivas y deja intactas las activas", () => {
    expect(labels).toEqual({ "ws-1": "Faena Norte", "ws-2": "Faena Cerrada (inactiva)" })
  })

  it("resuelve el nombre, ordena de mayor a menor y desempata por nombre", () => {
    const rows = toBreakdownRows(
      [{ worksiteId: "ws-2", total: 3 }, { worksiteId: "ws-1", total: 3 }, { worksiteId: "ws-1", total: 9 }],
      labels,
    )
    expect(rows).toEqual([
      { label: "Faena Norte", value: 9 },
      { label: "Faena Cerrada (inactiva)", value: 3 },
      { label: "Faena Norte", value: 3 },
    ])
  })

  it("un id sin faena en el catálogo (o nulo) cae en un rótulo, nunca en el id", () => {
    const rows = toBreakdownRows(
      [{ worksiteId: "3f2a9c1e-77b0-4d52-9a40-0a1b2c3d4e5f", total: 2 }, { worksiteId: null, total: 1 }],
      labels,
    )
    expect(rows.map((row) => row.label)).toEqual([UNKNOWN_WORKSITE_LABEL, UNKNOWN_WORKSITE_LABEL])
    expect(JSON.stringify(rows)).not.toContain("3f2a9c1e")
  })
})
