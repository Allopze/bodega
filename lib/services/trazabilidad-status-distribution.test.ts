import { describe, expect, it } from "vitest"
import {
  COMPUTED_STATUS_METAS,
  TRACEABILITY_STATUS_LIFECYCLE,
  computeStatusDistribution,
  countRequestsByStatus,
  mergeStatusCounts,
  orderStatusDistribution,
  summarizeStatusDistribution,
  type ComputedStatus,
} from "./trazabilidad-consolidated"

const requests = (...statuses: ComputedStatus[]) => statuses.map((status) => ({ status }))

describe("TRACEABILITY_STATUS_LIFECYCLE", () => {
  it("cubre cada estado exactamente una vez: un estado nuevo no puede quedar fuera de la barra", () => {
    expect([...TRACEABILITY_STATUS_LIFECYCLE].sort()).toEqual(Object.keys(COMPUTED_STATUS_METAS).sort())
  })

  it("va de Borrador a Entregado y deja al final los desenlaces fuera del camino", () => {
    expect(TRACEABILITY_STATUS_LIFECYCLE[0]).toBe("borrador")
    expect(TRACEABILITY_STATUS_LIFECYCLE.indexOf("entregado")).toBe(TRACEABILITY_STATUS_LIFECYCLE.length - 3)
    expect(TRACEABILITY_STATUS_LIFECYCLE.slice(-2)).toEqual(["rechazado", "cancelado"])
  })

  it("recorre las etapas físicas en su orden: proveedor, oficina, tránsito, faena, entrega", () => {
    const at = (status: ComputedStatus) => TRACEABILITY_STATUS_LIFECYCLE.indexOf(status)
    const physical: ComputedStatus[] = [
      "solicitado", "aprobado", "pedido_proveedor", "parcialmente_recibido_oficina", "en_oficina",
      "parcialmente_enviado_faena", "enviado_faena", "parcialmente_recibido_faena", "en_faena",
      "parcialmente_entregado", "entregado",
    ]
    expect(physical.map(at)).toEqual([...physical.map(at)].sort((left, right) => left - right))
  })
})

describe("countRequestsByStatus", () => {
  it("cuenta una vez cada solicitud, por su estado agregado", () => {
    expect(countRequestsByStatus(requests("en_faena", "entregado", "en_faena", "borrador"))).toEqual({
      en_faena: 2,
      entregado: 1,
      borrador: 1,
    })
  })

  it("sin solicitudes no hay estados", () => {
    expect(countRequestsByStatus([])).toEqual({})
  })
})

describe("mergeStatusCounts", () => {
  it("suma las cuentas de cada faena", () => {
    expect(mergeStatusCounts({ en_faena: 2, entregado: 1 }, { en_faena: 1, rechazado: 4 })).toEqual({
      en_faena: 3,
      entregado: 1,
      rechazado: 4,
    })
  })

  it("no muta ninguno de los dos lados", () => {
    const left = { solicitado: 1 }
    const right = { solicitado: 2 }
    mergeStatusCounts(left, right)
    expect(left).toEqual({ solicitado: 1 })
    expect(right).toEqual({ solicitado: 2 })
  })
})

describe("orderStatusDistribution", () => {
  it("ordena por ciclo de vida y no por tamaño, con su rótulo y su tono", () => {
    const entries = orderStatusDistribution({ entregado: 30, solicitado: 2, en_faena: 9, rechazado: 1, borrador: 4 })
    expect(entries.map((entry) => entry.status)).toEqual(["borrador", "solicitado", "en_faena", "entregado", "rechazado"])
    expect(entries.map((entry) => entry.count)).toEqual([4, 2, 9, 30, 1])
    expect(entries[2]).toEqual({ status: "en_faena", label: "En faena", color: "info", count: 9 })
  })

  it("omite los estados sin solicitudes y los conteos no positivos", () => {
    const entries = orderStatusDistribution({ solicitado: 0, aprobado: 3, entregado: -1 })
    expect(entries.map((entry) => entry.status)).toEqual(["aprobado"])
  })
})

describe("computeStatusDistribution", () => {
  it("cuenta y ordena en un paso", () => {
    const entries = computeStatusDistribution(requests("entregado", "aprobado", "entregado", "cancelado", "aprobado", "aprobado"))
    expect(entries.map((entry) => [entry.status, entry.count])).toEqual([
      ["aprobado", 3],
      ["entregado", 2],
      ["cancelado", 1],
    ])
  })

  it("las cuentas son excluyentes: suman exactamente el total de solicitudes", () => {
    const all = requests("borrador", "solicitado", "en_oficina", "en_oficina", "parcialmente_entregado", "entregado", "rechazado")
    const total = computeStatusDistribution(all).reduce((sum, entry) => sum + entry.count, 0)
    expect(total).toBe(all.length)
  })
})

describe("summarizeStatusDistribution", () => {
  it("separa las solicitudes en curso de las cerradas (entregadas, rechazadas o canceladas)", () => {
    const entries = computeStatusDistribution(requests("solicitado", "en_faena", "en_faena", "entregado", "rechazado", "cancelado"))
    expect(summarizeStatusDistribution(entries)).toEqual({ total: 6, open: 3, closed: 3 })
  })

  it("sin solicitudes todo es cero", () => {
    expect(summarizeStatusDistribution([])).toEqual({ total: 0, open: 0, closed: 0 })
  })
})
