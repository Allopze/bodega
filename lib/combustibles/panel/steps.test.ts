import { describe, expect, it, vi } from "vitest"
import type { MandanteReconciliationSummary } from "@/lib/combustibles/control/queries/reconciliation-summary"
import type { FuelInboxSummary } from "@/lib/combustibles/inbox/types"
import type { PayablesSummary } from "@/lib/combustibles/payables-summary"
import type { FuelSourceStatus } from "@/lib/combustibles/sources-status"
import { buildPanelSteps, type PanelStep, type PanelStepsInput } from "./steps"

vi.mock("server-only", () => ({}))
const { applyPeriodCoverage, summarizeFuelSources } = await import("@/lib/combustibles/sources-status")

const TODAY = "2026-10-31"

const open = { status: "en_curso", inLabel: "octubre", isWholeMonths: true } as const
const closed = { status: "cerrado", inLabel: "septiembre", isWholeMonths: true } as const
const week = { status: "en_curso", inLabel: "la semana del 26 de octubre", isWholeMonths: false } as const

function source(partial: Partial<FuelSourceStatus> = {}): FuelSourceStatus {
  return {
    key: "copec",
    name: "Copec",
    description: "Tarjetas",
    status: "ok",
    statusLabel: "Al día",
    lastUpdateAt: null,
    facts: [],
    feeds: [],
    problem: null,
    technical: [],
    ...partial,
  }
}

const sourcesOf = (...statuses: FuelSourceStatus[]) => ({ statuses, summary: summarizeFuelSources(statuses) })

function inbox(total: number | null, byKind: Partial<FuelInboxSummary["byKind"]> = {}, oldestWaitingSince: string | null = null): FuelInboxSummary {
  return { total, byKind: { carga: null, caso: null, patente: null, pedido: null, ...byKind }, oldestWaitingSince }
}

function mandante(partial: Partial<MandanteReconciliationSummary> = {}): MandanteReconciliationSummary {
  return {
    mandanteId: "m1", name: "CMPC Santa Fe", worksiteNames: ["Santa Fe"], tolerancePct: 2,
    inLiters: 42_100, directLiters: 29_300, viaTankLiters: 11_480, differenceLiters: 1_320, differencePct: 3.1, overTolerance: true,
    ...partial,
  }
}

const noPayables: PayablesSummary = { pendingAmount: 0, overdueAmount: 0, dueStatements: [], monthsWithoutStatement: [] }

/** Todo llegó y está en orden: la base sobre la que cada prueba rompe una cosa. */
function allGood(overrides: Partial<PanelStepsInput> = {}): PanelStepsInput {
  return {
    period: open,
    today: TODAY,
    visible: { fuentes: true, cuadratura: true, pagos: true },
    sources: sourcesOf(source(), source({ key: "telemetria", name: "Telemetría" })),
    inbox: inbox(0),
    reconciliation: { rows: [mandante({ overTolerance: false, differenceLiters: 80, differencePct: 0.4 })], monthKeys: ["2026-10"] },
    worse: { count: 0, examples: [] },
    hasPerformanceData: true,
    payables: { summary: noPayables, activity: { statements: 2, invoicedLoads: 10 } },
    ...overrides,
  }
}

const stepOf = (input: PanelStepsInput, key: PanelStep["key"]): PanelStep => {
  const found = buildPanelSteps(input).steps.find((step) => step.key === key)
  if (!found) throw new Error(`falta el paso ${key}`)
  return found
}

describe("tira de cinco pasos del Panel", () => {
  it("con todo en orden los cinco pasos están listos y llevan su enlace", () => {
    const { steps, readyCount, total } = buildPanelSteps(allGood())
    expect(steps.map((step) => [step.number, step.key, step.status])).toEqual([
      [1, "fuentes", "ok"], [2, "revisar", "ok"], [3, "cuadratura", "ok"], [4, "equipos", "ok"], [5, "pagos", "ok"],
    ])
    expect(readyCount).toBe(5)
    expect(total).toBe(5)
    expect(steps.map((step) => step.href)).toEqual([
      "/combustibles/fuentes",
      "/combustibles/revisar?vista=decididas",
      "/combustibles/cuadratura",
      "/combustibles/consumo",
      "/combustibles/pagos",
    ])
  })

  it("agrega el período a cada enlace", () => {
    const { steps } = buildPanelSteps(allGood({ link: (href) => `${href}${href.includes("?") ? "&" : "?"}periodo=2026-10` }))
    expect(steps.map((step) => step.href)).toEqual([
      "/combustibles/fuentes?periodo=2026-10",
      "/combustibles/revisar?vista=decididas&periodo=2026-10",
      "/combustibles/cuadratura?periodo=2026-10",
      "/combustibles/consumo?periodo=2026-10",
      "/combustibles/pagos?periodo=2026-10",
    ])
  })

  it("los pasos que la persona no ve no se dibujan y los demás se renumeran: «N de 3»", () => {
    const result = buildPanelSteps(allGood({ visible: { fuentes: false, cuadratura: false, pagos: true } }))
    expect(result.steps.map((step) => [step.number, step.key])).toEqual([[1, "revisar"], [2, "equipos"], [3, "pagos"]])
    expect(result.total).toBe(3)
    const sinMontos = buildPanelSteps(allGood({ visible: { fuentes: true, cuadratura: true, pagos: false } }))
    expect(sinMontos.steps.map((step) => step.key)).toEqual(["fuentes", "revisar", "cuadratura", "equipos"])
    expect(sinMontos.total).toBe(4)
    expect(sinMontos.readyCount).toBe(4)
  })

  describe("un dato que no llegó nunca es «listo»", () => {
    it("sin ninguna respuesta, los cinco pasos dicen «sin datos» y ninguno cuenta como listo", () => {
      const result = buildPanelSteps(allGood({ sources: null, inbox: null, reconciliation: null, worse: null, hasPerformanceData: null, payables: null }))
      expect(result.steps.map((step) => step.status)).toEqual(["sin_datos", "sin_datos", "sin_datos", "sin_datos", "sin_datos"])
      expect(result.steps.map((step) => step.figure)).toEqual(Array(5).fill("Sin datos"))
      expect(result.readyCount).toBe(0)
    })

    it("los cuerpos provisionales de las otras líneas (listas vacías, total nulo) tampoco son «listo»", () => {
      const result = buildPanelSteps(allGood({
        sources: sourcesOf(),
        inbox: inbox(null),
        reconciliation: { rows: [], monthKeys: ["2026-10"] },
        // `countEquipmentWorseThanModel` provisional devuelve 0: se desmiente con las cargas medibles del período.
        worse: { count: 0, examples: [] },
        hasPerformanceData: false,
        payables: { summary: noPayables, activity: { statements: 0, invoicedLoads: 0 } },
      }))
      expect(result.steps.map((step) => step.status)).toEqual(["sin_datos", "sin_datos", "sin_datos", "sin_datos", "sin_datos"])
      expect(result.readyCount).toBe(0)
    })

    it("fuentes: si ninguna trajo datos no hay nada que dar por al día", () => {
      const step = stepOf(allGood({ sources: sourcesOf(source({ status: "sin_datos", statusLabel: "Sin credenciales" })) }), "fuentes")
      expect(step.status).toBe("sin_datos")
    })

    it("pagos: un resumen vacío sin facturas ni estados no es «al día»", () => {
      const step = stepOf(allGood({ payables: { summary: noPayables, activity: { statements: 0, invoicedLoads: 0 } } }), "pagos")
      expect(step.status).toBe("sin_datos")
      expect(step.phrase).toBe("Todavía no hay facturas ni estados de cuenta en octubre.")
    })

    it("pagos: un resumen vacío cuya actividad no se pudo leer tampoco se da por pagado", () => {
      expect(stepOf(allGood({ payables: { summary: noPayables, activity: null } }), "pagos").status).toBe("sin_datos")
    })

    it("equipos: sin saber si hubo cargas medibles, el cero cuenta como listo sólo si se pudo medir", () => {
      expect(stepOf(allGood({ hasPerformanceData: false }), "equipos").status).toBe("sin_datos")
      expect(stepOf(allGood({ hasPerformanceData: true }), "equipos").status).toBe("ok")
    })
  })

  describe("fuentes de datos", () => {
    it("lista: «Al día» en un período en curso y «Listos» en uno cerrado", () => {
      expect(stepOf(allGood(), "fuentes")).toMatchObject({ status: "ok", figure: "Al día", phrase: "2 fuentes al día." })
      expect(stepOf(allGood({ period: closed }), "fuentes")).toMatchObject({ status: "ok", figure: "Listos", phrase: "En septiembre todas las fuentes con datos llegaron completas." })
    })

    it("pendiente: nombra la fuente y lo que falta, y cuenta el resto", () => {
      const step = stepOf(allGood({
        sources: sourcesOf(
          source({ status: "pendiente", statusLabel: "Con pendientes", problem: "1 patente sin vincular" }),
          source({ key: "planilla", name: "Planilla de cargas", status: "pendiente", statusLabel: "Con pendientes", problem: "12 filas rechazadas" }),
          source({ key: "telemetria", name: "Telemetría" }),
        ),
      }), "fuentes")
      expect(step).toMatchObject({ status: "pendiente", figure: "2", figureNote: "fuentes por revisar" })
      expect(step.phrase).toBe("Copec: 1 patente sin vincular. Y 1 fuente más por revisar.")
    })

    it("una corrida que falló se nombra primero y sigue siendo pendiente (el rojo es sólo para tolerancia y vencido)", () => {
      const step = stepOf(allGood({
        sources: sourcesOf(
          source({ status: "pendiente", problem: "1 patente sin vincular" }),
          source({ key: "telemetria", name: "Telemetría", status: "falla", statusLabel: "Falló hoy a las 05:30" }),
        ),
      }), "fuentes")
      expect(step.status).toBe("pendiente")
      expect(step.phrase.startsWith("Telemetría: Falló hoy a las 05:30.")).toBe(true)
    })

    it("en un período cerrado dice qué quedó pendiente de ese período", () => {
      const step = stepOf(allGood({ period: closed, sources: sourcesOf(source({ status: "pendiente", problem: "falta el archivo de septiembre" })) }), "fuentes")
      expect(step.phrase).toBe("En septiembre quedó pendiente. Copec: falta el archivo de septiembre.")
    })

    describe("una fuente activa sin datos del período", () => {
      const periodOf = (status: "en_curso" | "cerrado" | "futuro", inLabel: string) => ({ from: "2026-09-01", status, inLabel })
      // La planilla trajo datos por última vez en agosto; Copec cubre el período.
      const statuses = () => [
        source({ completeUntil: "2026-09-30" }),
        source({ key: "planilla", name: "Planilla de cargas", statusLabel: "Importada el 28 ago", completeUntil: "2026-08-28" }),
        source({ key: "telemetria", name: "Telemetría de equipos", status: "sin_datos", statusLabel: "Sin datos" }),
      ]

      it("en un período cerrado deja el paso pendiente y nombra la fuente que no llegó", () => {
        const covered = applyPeriodCoverage(statuses(), periodOf("cerrado", "septiembre"))
        expect(covered[1]).toMatchObject({ status: "pendiente", statusLabel: "Sin datos en septiembre", problem: "No trajo datos en septiembre." })
        const step = stepOf(allGood({ period: closed, sources: sourcesOf(...covered) }), "fuentes")
        expect(step).toMatchObject({ status: "pendiente", figure: "1", figureNote: "fuente por revisar" })
        expect(step.phrase).toBe("En septiembre quedó pendiente. Planilla de cargas: No trajo datos en septiembre.")
      })

      it("en el período en curso sólo lo avisa, y las fuentes que nunca se usaron no cuentan como faltantes", () => {
        const covered = applyPeriodCoverage(statuses(), periodOf("en_curso", "septiembre"))
        expect(covered[1]).toMatchObject({ status: "ok", statusLabel: "Todavía sin datos en septiembre", missingInPeriod: true })
        const step = stepOf(allGood({ sources: sourcesOf(...covered) }), "fuentes")
        expect(step).toMatchObject({ status: "ok", figure: "Al día" })
        expect(step.phrase).toBe("2 fuentes al día. Planilla de cargas todavía no trae datos en octubre. 1 fuente todavía no se usa.")
      })

      it("terreno y facturas cuentan lo del período; el histórico de sellos no es periódico; un período futuro no exige nada", () => {
        const sinCargas = source({ key: "terreno", name: "Formulario en terreno", statusLabel: "Sin cargas en septiembre", completeUntil: "2026-09-30", dataInPeriod: false })
        const historico = source({ key: "historico-sellos", name: "Histórico de sellos", dataInPeriod: null })
        const [terreno, sellos] = applyPeriodCoverage([sinCargas, historico], periodOf("cerrado", "septiembre"))
        expect(terreno).toMatchObject({ status: "pendiente", statusLabel: "Sin datos en septiembre" })
        expect(sellos).toEqual(historico)
        const [enCurso] = applyPeriodCoverage([sinCargas], periodOf("en_curso", "septiembre"))
        expect(enCurso).toMatchObject({ status: "ok", statusLabel: "Sin cargas en septiembre", missingInPeriod: true })
        expect(applyPeriodCoverage(statuses(), periodOf("futuro", "noviembre"))).toEqual(statuses())
      })
    })
  })

  describe("por revisar", () => {
    it("nada pendiente: «Nada» y el enlace va a lo decidido", () => {
      expect(stepOf(allGood(), "revisar")).toMatchObject({ status: "ok", figure: "Nada", cta: "Ver lo decidido", phrase: "No queda nada esperando a una persona." })
      expect(stepOf(allGood({ period: closed }), "revisar").phrase).toBe("En septiembre todo quedó decidido.")
    })

    it("pendiente: compone la frase con lo que hay de cada tipo y dice cuánto lleva esperando lo más antiguo", () => {
      const step = stepOf(allGood({ inbox: inbox(7, { carga: 3, patente: 2, caso: 1, pedido: 1 }, "2026-10-25T14:00:00.000Z") }), "revisar")
      expect(step).toMatchObject({ status: "pendiente", figure: "7", figureNote: "por decidir", cta: "Revisar", href: "/combustibles/revisar" })
      expect(step.phrase).toBe("3 cargas por decidir, 2 patentes sin vincular, 1 caso, 1 pedido de revisión. Lo más antiguo: espera hace 6 días.")
    })

    it("en singular, y sin «lo más antiguo» si llegó hoy", () => {
      const step = stepOf(allGood({ inbox: inbox(1, { carga: 1 }, "2026-10-31T13:00:00.000Z") }), "revisar")
      expect(step.phrase).toBe("1 carga por decidir.")
    })

    it("en un período cerrado dice lo que quedó sin decidir", () => {
      const step = stepOf(allGood({ period: closed, inbox: inbox(2, { carga: 2 }) }), "revisar")
      expect(step.phrase).toBe("Quedaron sin decidir: 2 cargas por decidir.")
    })
  })

  describe("cuadratura", () => {
    it("fuera de tolerancia es el único «mal» de la tira junto con lo vencido: nombra al peor mandante", () => {
      const step = stepOf(allGood({
        reconciliation: {
          rows: [mandante({ overTolerance: false, name: "CMPC Pacífico", differenceLiters: 230, differencePct: 0.8 }), mandante(), mandante({ mandanteId: "m3", name: "Forestal Biodiversa", differenceLiters: -400, differencePct: -2.5 })],
          monthKeys: ["2026-10"],
        },
      }), "cuadratura")
      expect(step).toMatchObject({ status: "mal", statusLabel: "No cuadra", figure: "2 fuera" })
      expect(step.phrase).toBe("CMPC Santa Fe: diferencia de 1.320 L (3,1 %), sobre su tolerancia de 2 %. Y 1 mandante más.")
    })

    it("todos dentro de su tolerancia: cuadra (en pasado si el período cerró)", () => {
      const rows = [mandante({ overTolerance: false }), mandante({ mandanteId: "m2", overTolerance: false })]
      const reconciliation = { rows, monthKeys: ["2026-09"] }
      expect(stepOf(allGood({ reconciliation }), "cuadratura")).toMatchObject({ status: "ok", figure: "Cuadra", phrase: "Los 2 mandantes cuadran dentro de su tolerancia." })
      expect(stepOf(allGood({ period: closed, reconciliation }), "cuadratura").phrase).toBe("Los 2 mandantes cuadraron dentro de su tolerancia.")
    })

    it("un mandante sin entradas no se cuenta como cuadrado ni como fuera", () => {
      const reconciliation = { rows: [mandante({ overTolerance: false }), mandante({ mandanteId: "m2", overTolerance: null, differencePct: null })], monthKeys: ["2026-10"] }
      const step = stepOf(allGood({ reconciliation }), "cuadratura")
      expect(step.status).toBe("ok")
      expect(step.phrase).toBe("El mandante cuadra dentro de su tolerancia. 1 mandante sin entradas en el período.")
      const none = { rows: [mandante({ overTolerance: null, differencePct: null })], monthKeys: ["2026-10"] }
      expect(stepOf(allGood({ reconciliation: none }), "cuadratura").status).toBe("sin_datos")
    })

    it("una semana o un rango no son meses completos: «Por mes», informativo, sin ok ni mal", () => {
      const withOver = { rows: [mandante()], monthKeys: ["2026-10", "2026-11"] }
      const step = stepOf(allGood({ period: week, reconciliation: withOver }), "cuadratura")
      expect(step).toMatchObject({ status: "info", figure: "Por mes" })
      expect(step.phrase).toBe("La cuadratura se mide por mes completo. Octubre, hasta hoy: CMPC Santa Fe está fuera de tolerancia.")
      const fine = { rows: [mandante({ overTolerance: false })], monthKeys: ["2026-09", "2026-10"] }
      expect(stepOf(allGood({ period: week, reconciliation: fine }), "cuadratura").phrase).toBe("La cuadratura se mide por mes completo. Septiembre y octubre, hasta hoy: el mandante cuadra.")
      // Una semana ya cerrada habla de su mes sin «hasta hoy», y un mes que todavía no empieza no se nombra.
      const old = { rows: [mandante({ overTolerance: false })], monthKeys: ["2026-09", "2026-10"] }
      expect(stepOf(allGood({ period: week, today: "2026-11-20", reconciliation: old }), "cuadratura").phrase).toBe("La cuadratura se mide por mes completo. Septiembre y octubre: el mandante cuadra.")
      // Sin medida del mes, queda la frase base y el paso sigue siendo informativo.
      const sinMedida = stepOf(allGood({ period: week, reconciliation: null }), "cuadratura")
      expect(sinMedida).toMatchObject({ status: "info", phrase: "La cuadratura se mide por mes completo." })
      // `Por mes` no cuenta como listo.
      expect(buildPanelSteps(allGood({ period: week })).steps.find((s) => s.key === "cuadratura")?.status).not.toBe("ok")
    })
  })

  describe("equipos que rinden peor", () => {
    it("lista los equipos y cuenta los que no caben; es informativo, no un pendiente", () => {
      const step = stepOf(allGood({
        worse: { count: 5, examples: [
          { vehicleId: "1", code: "CA-14", familyLabel: "Camiones", deltaPct: -22 },
          { vehicleId: "2", code: "CA-22", familyLabel: "Camiones", deltaPct: -15 },
          { vehicleId: "3", code: "EX-03", familyLabel: "Maquinaria", deltaPct: 19 },
        ] },
      }), "equipos")
      expect(step).toMatchObject({ status: "info", statusLabel: "Para mirar", figure: "5", figureNote: "equipos" })
      expect(step.phrase).toBe("CA-14, CA-22, EX-03 y 2 más rinden más de 10 % peor que su modelo.")
    })

    it("un equipo, en singular y en pasado si el período cerró", () => {
      const worse = { count: 1, examples: [{ vehicleId: "1", code: "EX-03", familyLabel: "Maquinaria", deltaPct: 19 }] }
      expect(stepOf(allGood({ worse }), "equipos").phrase).toBe("EX-03 rinde más de 10 % peor que su modelo.")
      expect(stepOf(allGood({ period: closed, worse }), "equipos").phrase).toBe("EX-03 rindió más de 10 % peor que su modelo.")
    })

    it("sin ejemplos igual dice cuántos son", () => {
      expect(stepOf(allGood({ worse: { count: 3, examples: [] } }), "equipos").phrase).toBe("3 equipos rinden más de 10 % peor que su modelo.")
    })

    it("ninguno: listo", () => {
      expect(stepOf(allGood(), "equipos")).toMatchObject({ status: "ok", figure: "Ninguno" })
    })
  })

  describe("pagos", () => {
    const statement = { statementId: "s1", supplierName: "Aramco", month: "2026-09", pendingAmount: 8_400_000, dueDate: "2026-11-05", overdue: false }

    it("saldo por pagar: pendiente, con el vencimiento y lo que falta crear", () => {
      const step = stepOf(allGood({
        payables: {
          summary: {
            pendingAmount: 8_400_000, overdueAmount: 0, dueStatements: [statement],
            monthsWithoutStatement: [{ supplierId: "p1", supplierName: "Copec", month: "2026-10", loads: 40, totalAmount: 1_000_000 }],
          },
          activity: { statements: 2, invoicedLoads: 40 },
        },
      }), "pagos")
      expect(step).toMatchObject({ status: "pendiente", figure: "$8,4M", figureNote: "por pagar", href: "/combustibles/pagos/estados" })
      expect(step.phrase).toBe("Aramco septiembre vence el 5 nov: quedan $8,4M. Copec octubre todavía no tiene estado de cuenta.")
    })

    it("lo vencido es rojo y se dice vencido", () => {
      const step = stepOf(allGood({
        payables: {
          summary: { pendingAmount: 9_000_000, overdueAmount: 5_000_000, dueStatements: [{ ...statement, overdue: true, dueDate: "2026-10-05" }], monthsWithoutStatement: [] },
          activity: { statements: 1, invoicedLoads: 5 },
        },
      }), "pagos")
      expect(step).toMatchObject({ status: "mal", statusLabel: "Vencido", figure: "$5M", figureNote: "vencido" })
      expect(step.phrase.startsWith("Aramco septiembre venció el 5 oct:")).toBe(true)
    })

    it("sin saldo pero con un mes sin estado de cuenta, lo pendiente es crearlo", () => {
      const step = stepOf(allGood({
        payables: {
          summary: { ...noPayables, monthsWithoutStatement: [{ supplierId: "p1", supplierName: "Copec", month: "2026-10", loads: 12, totalAmount: 500_000 }] },
          activity: { statements: 0, invoicedLoads: 12 },
        },
      }), "pagos")
      expect(step).toMatchObject({ status: "pendiente", figure: "1", figureNote: "estado de cuenta por crear" })
    })

    it("un mes que todavía no termina no es algo pendiente de crear: sólo se avisa que llegará", () => {
      const waiting = { supplierId: "p1", supplierName: "Copec", month: "2026-10", loads: 40, totalAmount: 1_000_000, monthClosed: false }
      // Sólo eso: nada por pagar ni por crear ahora, el paso está listo y lo dice.
      const alone = stepOf(allGood({ payables: { summary: { ...noPayables, monthsWithoutStatement: [waiting] }, activity: { statements: 1, invoicedLoads: 40 } } }), "pagos")
      expect(alone).toMatchObject({ status: "ok", figure: "Al día" })
      expect(alone.phrase).toBe("No hay saldos por pagar. Copec octubre todavía no tiene estado de cuenta: se crea al cerrar el mes.")
      // Junto a un saldo por pagar, se agrega a la frase sin cambiar el estado ni la cifra.
      const withDebt = stepOf(allGood({ payables: { summary: { ...noPayables, pendingAmount: 8_400_000, dueStatements: [statement], monthsWithoutStatement: [waiting] }, activity: { statements: 2, invoicedLoads: 40 } } }), "pagos")
      expect(withDebt).toMatchObject({ status: "pendiente", figure: "$8,4M" })
      expect(withDebt.phrase).toBe("Aramco septiembre vence el 5 nov: quedan $8,4M. Copec octubre todavía no tiene estado de cuenta: se crea al cerrar el mes.")
      // Un mes ya cerrado sin estado de cuenta sí es algo por hacer.
      const closedMonth = stepOf(allGood({ payables: { summary: { ...noPayables, monthsWithoutStatement: [{ ...waiting, month: "2026-09", monthClosed: true }] }, activity: { statements: 0, invoicedLoads: 40 } } }), "pagos")
      expect(closedMonth).toMatchObject({ status: "pendiente", figure: "1", figureNote: "estado de cuenta por crear" })
    })

    it("todo pagado: «Al día»", () => {
      expect(stepOf(allGood(), "pagos")).toMatchObject({ status: "ok", figure: "Al día", phrase: "No hay saldos por pagar ni estados de cuenta por crear." })
      expect(stepOf(allGood({ period: closed }), "pagos").phrase).toBe("En septiembre todo está pagado.")
    })
  })

  it("cuenta como listos sólo los pasos en «ok»", () => {
    const result = buildPanelSteps(allGood({
      inbox: inbox(2, { carga: 2 }),
      worse: { count: 1, examples: [{ vehicleId: "1", code: "CA-14", familyLabel: "Camiones", deltaPct: -12 }] },
    }))
    expect(result.steps.map((step) => step.status)).toEqual(["ok", "pendiente", "ok", "info", "ok"])
    expect(result.readyCount).toBe(3)
  })
})
