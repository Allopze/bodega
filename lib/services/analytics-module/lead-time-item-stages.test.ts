import { describe, expect, it } from "vitest"
import {
  buildItemLeadTimeView,
  itemOutcome,
  itemStageHeadline,
  type ItemMilestones,
} from "./lead-time-item-stages"

/** Día `d` desde 1970. */
const D = 20_000
const days = (value: number) => `${value} d`

const milestones = (over: Partial<ItemMilestones> = {}): ItemMilestones => ({
  submittedDay: D, approvedDay: D + 1, issuedDay: D + 3, arrivedDay: D + 9, deliveredDay: D + 10, closedDay: D + 10,
  ...over,
})
const states = (view: ReturnType<typeof buildItemLeadTimeView>) => view.stages.map((stage) => [stage.key, stage.state, stage.days])

describe("itemOutcome", () => {
  it("cerrado es lo mismo que cuenta Analítica; rechazado se detuvo; el resto sigue abierto", () => {
    expect(itemOutcome("received")).toBe("closed")
    expect(itemOutcome("delivered")).toBe("closed")
    expect(itemOutcome("rejected")).toBe("stopped")
    // Entrega parcial: Analítica no lo cierra (no distingue si llegó completo), así que acá tampoco.
    expect(itemOutcome("partially_delivered")).toBe("open")
    expect(itemOutcome("in_purchase_order")).toBe("open")
  })
})

describe("buildItemLeadTimeView · ítem cerrado", () => {
  it("mide cada tramo entre sus dos hitos, igual que el cálculo agregado, y el total hasta el cierre", () => {
    const view = buildItemLeadTimeView(milestones(), "delivered", D + 100)

    expect(states(view)).toEqual([
      ["approval", "done", 1], ["purchase", "done", 2], ["arrival", "done", 6], ["delivery", "done", 1],
    ])
    expect(view.outcome).toBe("closed")
    expect(view.totalDays).toBe(10)
  })

  it("un cierre sin entrega (servicios, stock) deja el último tramo como «no ocurrió», no como atraso", () => {
    const view = buildItemLeadTimeView(milestones({ deliveredDay: null, closedDay: D + 9 }), "received", D + 100)

    expect(states(view).at(-1)).toEqual(["delivery", "skipped", null])
    expect(view.totalDays).toBe(9)
  })

  it("fechas al revés: el tramo lo dice y no inventa una duración negativa", () => {
    const view = buildItemLeadTimeView(milestones({ approvedDay: D + 5, issuedDay: D + 3 }), "delivered", D + 100)

    expect(states(view)[1]).toEqual(["purchase", "out_of_order", null])
    expect(states(view)[0]).toEqual(["approval", "done", 5])
  })

  it("un hito intermedio sin fecha deja el tramo «sin fecha» pero conserva los medibles", () => {
    const view = buildItemLeadTimeView(milestones({ issuedDay: null }), "delivered", D + 100)

    expect(states(view)).toEqual([
      ["approval", "done", 1], ["purchase", "no_date", null], ["arrival", "no_date", null], ["delivery", "done", 1],
    ])
  })
})

describe("buildItemLeadTimeView · ítem abierto", () => {
  it("el tramo en curso cuenta los días hasta hoy y los siguientes aún no llegan", () => {
    // Aprobado y con OC emitida, pero la mercadería no llegó: el tiempo corre en «Llegada».
    const view = buildItemLeadTimeView(milestones({ arrivedDay: null, deliveredDay: null, closedDay: null }), "purchased", D + 14)

    expect(states(view)).toEqual([
      ["approval", "done", 1], ["purchase", "done", 2], ["arrival", "current", 11], ["delivery", "pending", null],
    ])
    expect(view.totalDays).toBe(14)
  })

  it("recién enviado: el primer tramo está en curso desde el envío", () => {
    const view = buildItemLeadTimeView(milestones({ approvedDay: null, issuedDay: null, arrivedDay: null, deliveredDay: null, closedDay: null }), "requested", D + 3)

    expect(states(view)).toEqual([
      ["approval", "current", 3], ["purchase", "pending", null], ["arrival", "pending", null], ["delivery", "pending", null],
    ])
  })

  it("sin ninguna fecha todo queda pendiente y no hay total", () => {
    const view = buildItemLeadTimeView({ submittedDay: null, approvedDay: null, issuedDay: null, arrivedDay: null, deliveredDay: null, closedDay: null }, "draft", D)

    expect(view.stages.every((stage) => stage.state === "pending")).toBe(true)
    expect(view.totalDays).toBeNull()
  })

  it("una fecha futura (reloj o dato mal cargado) no da días negativos", () => {
    const view = buildItemLeadTimeView(milestones({ approvedDay: null, issuedDay: null, arrivedDay: null, deliveredDay: null, closedDay: null }), "requested", D - 2)

    expect(view.stages[0]).toMatchObject({ state: "current", days: 0 })
    expect(view.totalDays).toBe(0)
  })
})

describe("buildItemLeadTimeView · ítem rechazado", () => {
  it("no corre ningún reloj: lo que no ocurrió es «no ocurrió», sin días ni total", () => {
    const view = buildItemLeadTimeView(milestones({ approvedDay: null, issuedDay: null, arrivedDay: null, deliveredDay: null, closedDay: null }), "rejected", D + 40)

    expect(view.stages.every((stage) => stage.state === "skipped" && stage.days === null)).toBe(true)
    expect(view.totalDays).toBeNull()
  })
})

describe("itemStageHeadline", () => {
  const headline = (m: ItemMilestones, status: string, today = D + 100) => itemStageHeadline(buildItemLeadTimeView(m, status, today), days)

  it("cerrado: dice cuánto tardó y cuál tramo fue el más lento", () => {
    expect(headline(milestones(), "delivered")).toBe("Se cerró 10 d después de la solicitud. El tramo más lento fue «Llegada» (6 d).")
  })

  it("un empate se dice como empate, no se elige uno al azar", () => {
    const tied = milestones({ approvedDay: D + 4, issuedDay: D + 8, arrivedDay: D + 12, deliveredDay: D + 13, closedDay: D + 13 })

    expect(headline(tied, "delivered")).toBe("Se cerró 13 d después de la solicitud. Los tramos más lentos fueron «Aprobación», «Emisión de OC» y «Llegada» (4 d cada uno).")
  })

  it("si todos los tramos medidos duran lo mismo no hay «más lento»", () => {
    const even = milestones({ approvedDay: D + 2, issuedDay: D + 4, arrivedDay: D + 6, deliveredDay: D + 8, closedDay: D + 8 })

    expect(headline(even, "delivered")).toBe("Se cerró 8 d después de la solicitud. Los tramos medidos duraron lo mismo (2 d cada uno).")
  })

  it("abierto: dice dónde está hoy y desde hace cuánto; el «más lento» sólo compite entre tramos ya terminados", () => {
    const open = milestones({ arrivedDay: null, deliveredDay: null, closedDay: null })

    expect(headline(open, "purchased", D + 14)).toBe(
      "Lleva 14 d desde la solicitud y está en el tramo «Llegada» desde hace 11 d. El tramo más lento fue «Emisión de OC» (2 d).",
    )
  })

  it("abierto con un solo tramo ya medido: lo nombra como medido, no como «el más lento»", () => {
    const open = milestones({ issuedDay: null, arrivedDay: null, deliveredDay: null, closedDay: null })

    expect(headline(open, "approved", D + 6)).toBe("Lleva 6 d desde la solicitud y está en el tramo «Emisión de OC» desde hace 5 d. Tramo ya medido: «Aprobación» (1 d).")
  })

  it("el tramo que empezó hoy no dice «desde hace 0 días»", () => {
    const open = milestones({ approvedDay: null, issuedDay: null, arrivedDay: null, deliveredDay: null, closedDay: null })

    expect(headline(open, "requested", D)).toBe("Lleva 0 d desde la solicitud y entró hoy al tramo «Aprobación».")
  })

  it("rechazado no «lleva» días", () => {
    expect(headline(milestones({ approvedDay: null, issuedDay: null, arrivedDay: null, deliveredDay: null, closedDay: null }), "rejected"))
      .toBe("El ítem se rechazó: no hay plazos que medir después de la solicitud.")
  })

  it("cerrado el mismo día de la solicitud", () => {
    const sameDay = milestones({ approvedDay: D, issuedDay: D, arrivedDay: D, deliveredDay: D, closedDay: D })

    expect(headline(sameDay, "delivered")).toBe("Se cerró el mismo día de la solicitud. Los tramos medidos duraron lo mismo (0 d cada uno).")
  })

  it("sin fechas suficientes lo dice en vez de inventar una frase", () => {
    const none: ItemMilestones = { submittedDay: null, approvedDay: null, issuedDay: null, arrivedDay: null, deliveredDay: null, closedDay: null }

    expect(headline(none, "draft")).toBe("Todavía no hay fechas suficientes para medir los tramos de este ítem.")
    expect(headline(none, "delivered")).toBe("El ítem se cerró, pero sus fechas no alcanzan para medir los tramos.")
  })
})
