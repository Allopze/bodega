import { describe, expect, it } from "vitest"
import type { OperationalWorkItem } from "@/lib/services/operational-work-queue"
import { describeDue, pendientesHref, pendientesLinkLabel, pickTodayItems, TODAY_ITEM_LIMIT } from "./dashboard-today"
import type { DashboardScope } from "./dashboard-scope"

const TODAY = "2026-10-05"

function item(id: string, over: Partial<OperationalWorkItem> = {}): OperationalWorkItem {
  return {
    id,
    sourceType: "purchase_order",
    sourceId: id,
    actionKey: "receive",
    module: "recepciones",
    title: `Recibir ${id}`,
    subtitle: "",
    worksiteId: "ws-1",
    worksiteName: "Faena Norte",
    status: "sent",
    statusLabel: "Enviada",
    priority: "normal",
    blocked: false,
    createdAt: "2026-09-01T10:00:00.000Z",
    sourceDueAt: null,
    assignee: null,
    href: `/compras/${id}`,
    ctaLabel: "Recibir",
    ...over,
  }
}

describe("describeDue — vencimiento en palabras", () => {
  it.each([
    ["2026-07-23", "Vencida hace 74 días", "overdue"],
    ["2026-10-04", "Vencida hace 1 día", "overdue"],
    ["2026-10-05", "Vence hoy", "today"],
    ["2026-10-06", "Vence mañana", "upcoming"],
    ["2026-10-09", "Vence en 4 días", "upcoming"],
    [null, "Sin fecha de vencimiento", "none"],
  ] as const)("%s → %s", (due, label, kind) => {
    expect(describeDue(due, TODAY)).toEqual({ label, due: kind })
  })

  it("una fecha lejana se dice con el formato de la app, no como \"en 90 días\"", () => {
    const { label, due } = describeDue("2026-12-31", TODAY)
    expect(due).toBe("upcoming")
    expect(label).toMatch(/^Vence el .*2026/)
  })

  it("acepta una marca de tiempo completa y cuenta por día civil", () => {
    expect(describeDue("2026-10-05T23:30:00.000Z", TODAY).label).toBe("Vence hoy")
  })
})

describe("pickTodayItems — qué entra en Hoy", () => {
  it("las vencidas van primero, la más atrasada arriba", () => {
    const picked = pickTodayItems([
      item("futura", { sourceDueAt: "2026-10-10" }),
      item("vencida-reciente", { sourceDueAt: "2026-10-03" }),
      item("vencida-vieja", { sourceDueAt: "2026-07-23" }),
    ], TODAY)

    expect(picked.map((entry) => entry.id)).toEqual(["vencida-vieja", "vencida-reciente", "futura"])
  })

  it("tras las vencidas, las críticas; después, el vencimiento más cercano", () => {
    const picked = pickTodayItems([
      item("normal-pronto", { sourceDueAt: "2026-10-06" }),
      item("critica-sin-fecha", { priority: "critical" }),
      item("normal-tarde", { sourceDueAt: "2026-11-30" }),
      item("vencida", { sourceDueAt: "2026-10-01" }),
      item("critica-con-fecha", { priority: "critical", sourceDueAt: "2026-10-20" }),
    ], TODAY)

    expect(picked.map((entry) => entry.id)).toEqual([
      "vencida", "critica-con-fecha", "critica-sin-fecha", "normal-pronto", "normal-tarde",
    ])
  })

  it(`nunca pasa de ${TODAY_ITEM_LIMIT} y deduplica la unión de las dos páginas`, () => {
    const many = Array.from({ length: 9 }, (_, i) => item(`oc-${i}`, { sourceDueAt: `2026-09-0${i + 1}` }))
    const picked = pickTodayItems([...many, ...many], TODAY)

    expect(picked).toHaveLength(TODAY_ITEM_LIMIT)
    expect(new Set(picked.map((entry) => entry.id)).size).toBe(TODAY_ITEM_LIMIT)
  })

  it("cada fila dice qué es, en qué faena y cuándo vence", () => {
    const [entry] = pickTodayItems([item("OC-1", { sourceDueAt: "2026-07-23", priority: "critical" })], TODAY)

    expect(entry).toMatchObject({
      title: "Recibir OC-1",
      context: "Recepciones · Faena Norte",
      dueLabel: "Vencida hace 74 días",
      due: "overdue",
      critical: true,
      href: "/compras/OC-1",
      ctaLabel: "Recibir",
    })
  })

  it("una fila bloqueada lo dice en texto", () => {
    const [entry] = pickTodayItems([item("OC-2", { blocked: true, sourceDueAt: "2026-10-05" })], TODAY)

    expect(entry?.dueLabel).toBe("Bloqueada · Vence hoy")
  })

  it("sin filas devuelve una lista vacía", () => {
    expect(pickTodayItems([], TODAY)).toEqual([])
  })
})

describe("enlace único a Mis pendientes", () => {
  const scope = (worksiteId: string): DashboardScope => ({ worksiteId, worksiteName: null, period: "mes", view: "resumen" })

  it("lleva el conteo de la población completa", () => {
    expect(pendientesLinkLabel(215)).toBe("Ver todos mis pendientes (215)")
  })

  it("con cero no pone un \"(0)\" pelado", () => {
    expect(pendientesLinkLabel(0)).toBe("Ver mis pendientes")
  })

  it("conserva la faena del alcance", () => {
    expect(pendientesHref(scope("all"))).toBe("/pendientes")
    expect(pendientesHref(scope("ws-sur"))).toBe("/pendientes?worksiteId=ws-sur")
    expect(pendientesHref(scope("ws-sur"), { quick: "overdue" })).toBe("/pendientes?quick=overdue&worksiteId=ws-sur")
  })
})
