import { describe, expect, it } from "vitest"
import { ITEM_STATE_META, OC_STATE_META, REQUEST_STATE_META } from "@/components/states/state-badge"
import {
  STATUS_LIFECYCLE,
  UNKNOWN_WORKSITE_LABEL,
  backlogSummary,
  buildWorksiteBacklog,
  statusItems,
  statusRows,
  statusSummary,
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

describe("worksiteLabels · faenas legibles (Fase 0 · 0.3c)", () => {
  it("marca las inactivas y deja intactas las activas", () => {
    expect(worksiteLabels([
      { id: "ws-1", name: "Faena Norte", isActive: true },
      { id: "ws-2", name: "Faena Cerrada", isActive: false },
    ])).toEqual({ "ws-1": "Faena Norte", "ws-2": "Faena Cerrada (inactiva)" })
  })
})

describe("buildWorksiteBacklog · una fila por faena con sus dos cifras (CHART-032)", () => {
  const labels = worksiteLabels([
    { id: "ws-1", name: "Faena Norte", isActive: true },
    { id: "ws-2", name: "Faena Cerrada", isActive: false },
    { id: "ws-3", name: "Faena Sur", isActive: true },
  ])

  it("junta ítems sin OC y OC por recibir de la misma faena en una sola fila", () => {
    const rows = buildWorksiteBacklog(
      [{ worksiteId: "ws-1", total: 12 }, { worksiteId: "ws-3", total: 2 }],
      [{ worksiteId: "ws-1", total: 4 }, { worksiteId: "ws-2", total: 3 }],
      labels,
    )

    expect(rows).toEqual([
      { key: "ws-1", label: "Faena Norte", withoutOrder: 12, pendingReceipt: 4 },
      { key: "ws-2", label: "Faena Cerrada (inactiva)", withoutOrder: 0, pendingReceipt: 3 },
      { key: "ws-3", label: "Faena Sur", withoutOrder: 2, pendingReceipt: 0 },
    ])
  })

  it("las más cargadas primero y, a igual carga, por nombre", () => {
    const rows = buildWorksiteBacklog([{ worksiteId: "ws-3", total: 5 }, { worksiteId: "ws-1", total: 5 }], [], labels)

    expect(rows.map((row) => row.label)).toEqual(["Faena Norte", "Faena Sur"])
  })

  it("un id sin faena en el catálogo (o nulo) cae en un rótulo y todas las desconocidas son una sola fila", () => {
    const rows = buildWorksiteBacklog(
      [{ worksiteId: "3f2a9c1e-77b0-4d52-9a40-0a1b2c3d4e5f", total: 2 }, { worksiteId: null, total: 1 }],
      [{ worksiteId: "otro-id-sin-catalogo", total: 4 }],
      labels,
    )

    expect(rows).toEqual([{ key: UNKNOWN_WORKSITE_LABEL, label: UNKNOWN_WORKSITE_LABEL, withoutOrder: 3, pendingReceipt: 4 }])
    expect(JSON.stringify(rows)).not.toContain("3f2a9c1e")
  })

  it("convierte el conteo a número (las agregaciones de la base pueden llegar como texto) y omite lo que está en cero", () => {
    const rows = buildWorksiteBacklog([{ worksiteId: "ws-1", total: "6" as unknown as number }, { worksiteId: "ws-3", total: 0 }], [], labels)

    expect(rows).toEqual([{ key: "ws-1", label: "Faena Norte", withoutOrder: 6, pendingReceipt: 0 }])
  })
})

describe("backlogSummary", () => {
  it("dice los dos totales y dónde está la mayor carga, de las filas que se dibujan", () => {
    const rows = buildWorksiteBacklog([{ worksiteId: "ws-1", total: 12 }], [{ worksiteId: "ws-1", total: 4 }, { worksiteId: "ws-2", total: 3 }], worksiteLabels([
      { id: "ws-1", name: "Faena Norte", isActive: true }, { id: "ws-2", name: "Faena Sur", isActive: true },
    ]))

    expect(backlogSummary(rows)).toBe("12 ítems esperan una OC y 7 OC esperan recepción. La mayor carga está en Faena Norte (16).")
  })

  it("concuerda singular y plural y, con una sola faena, no compara", () => {
    const rows = buildWorksiteBacklog([{ worksiteId: "ws-1", total: 1 }], [{ worksiteId: "ws-1", total: 1 }], worksiteLabels([{ id: "ws-1", name: "Faena Norte", isActive: true }]))

    expect(backlogSummary(rows)).toBe("1 ítem espera una OC y 1 OC espera recepción; todo está en Faena Norte.")
  })

  it("sin filas no afirma nada", () => {
    expect(backlogSummary([])).toBe("")
  })
})

describe("statusItems / statusSummary", () => {
  const rows = statusRows([{ status: "closed", total: 9 }, { status: "submitted", total: 5 }, { status: "draft", total: 1 }, { status: "cancelled", total: 0 }], "request")

  it("mantiene el orden de ciclo de vida, rotula en español y omite los estados sin ítems", () => {
    const items = statusItems(rows, "request")

    expect(items.map((item) => [item.label, item.value])).toEqual([["Borrador", 1], ["Enviada", 5], ["Cerrada", 9]])
  })

  it("cada estado puede llevar a su lista", () => {
    const items = statusItems(rows, "request", (status) => `/solicitudes?estado=${status}`)

    expect(items.find((item) => item.key === "submitted")?.href).toBe("/solicitudes?estado=submitted")
  })

  it("la frase nombra el estado más frecuente y su peso, calculado de las mismas filas", () => {
    expect(statusSummary(statusItems(rows, "request"), { singular: "solicitud", plural: "solicitudes" })).toBe("Lo más frecuente: Cerrada (9 de 15 solicitudes, 60%).")
  })

  it("con un solo elemento va en singular y sin filas no afirma nada", () => {
    expect(statusSummary(statusItems([["draft", 1]], "request"), { singular: "solicitud", plural: "solicitudes" })).toBe("Lo más frecuente: Borrador (1 de 1 solicitud, 100%).")
    expect(statusSummary([], { singular: "solicitud", plural: "solicitudes" })).toBe("")
  })
})
