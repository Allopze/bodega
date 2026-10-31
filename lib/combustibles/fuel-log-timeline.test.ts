import { describe, expect, it } from "vitest"
import { auditDiffRows, buildLoadTimeline, type LoadTimelineInput } from "./fuel-log-timeline"

const base: LoadTimelineInput = {
  origen: "terreno",
  canViewCosts: false,
  createdAt: "2026-10-30T08:12:00.000Z",
  registeredByName: "Marcelo Rojas",
  terrenoSource: "internal_app",
  audit: [],
  statuses: [],
  marks: [],
  cases: [],
}

describe("línea de tiempo de una carga, en palabras", () => {
  it("empieza por cómo llegó la carga", () => {
    expect(buildLoadTimeline(base)[0]).toMatchObject({ actor: "Marcelo Rojas", text: "Marcelo Rojas registró la carga desde la app" })
    expect(buildLoadTimeline({ ...base, terrenoSource: "public_pwa", registeredByName: null })[0]?.text).toBe("Se registró desde el formulario en terreno (QR)")
    expect(buildLoadTimeline({ ...base, terrenoSource: "legacy_xlsx", registeredByName: null })[0]?.text).toBe("Entró desde el histórico de sellos")
    expect(buildLoadTimeline({ ...base, origen: "planilla", terrenoSource: null, batch: { fileName: "consolidado.xlsx", importedByName: "Ana" } })[0]?.text).toContain("consolidado.xlsx")
  })

  it("una carga con fecha pasada dice el motivo", () => {
    const [first] = buildLoadTimeline({ ...base, backdateReason: "Se olvidó registrarla el día 12" })
    expect(first?.text).toBe("Marcelo Rojas registró la carga con fecha pasada")
    expect(first?.note).toBe("Se olvidó registrarla el día 12")
  })

  it("cuenta los estados con la frase de la acción, no con el valor crudo", () => {
    const events = buildLoadTimeline({
      ...base,
      statuses: [
        { id: "s1", fromStatus: "submitted", toStatus: "observed", changedAt: "2026-10-30T09:00:00.000Z", actor: "Ana", reason: "Falta la foto del sello" },
        { id: "s2", fromStatus: "observed", toStatus: "validated", changedAt: "2026-10-30T10:00:00.000Z", actor: "Ana", reason: null },
        { id: "s3", fromStatus: "validated", toStatus: "voided", changedAt: "2026-10-30T11:00:00.000Z", actor: "Luis", reason: "Cargada por error" },
      ],
    })
    expect(events.map((event) => event.text)).toEqual([
      "Marcelo Rojas registró la carga desde la app",
      "Ana dejó la carga con observación",
      "Ana validó la carga",
      "Luis anuló la carga",
    ])
    expect(events[1]?.note).toBe("Falta la foto del sello")
    expect(JSON.stringify(events)).not.toMatch(/validated|observed|voided/)
  })

  it("el estado inicial del registro no se repite como un hecho aparte", () => {
    const events = buildLoadTimeline({ ...base, statuses: [{ id: "s0", fromStatus: null, toStatus: "submitted", changedAt: "2026-10-30T08:12:00.000Z", actor: null, reason: null }] })
    expect(events).toHaveLength(1)
  })

  it("el cambio de estado de terreno sale una sola vez aunque esté en la auditoría y en el historial de estados", () => {
    const events = buildLoadTimeline({
      ...base,
      statuses: [{ id: "s1", fromStatus: "submitted", toStatus: "validated", changedAt: "2026-10-30T10:00:00.000Z", actor: "Ana", reason: null }],
      audit: [{ id: "a1", action: "status_change", createdAt: "2026-10-30T10:00:00.000Z", actor: "Ana", entityType: "fuel_tae_submission", oldState: '{"status":"submitted"}', newState: '{"status":"validated"}', reason: null }],
    })
    expect(events.filter((event) => event.text.includes("validó"))).toHaveLength(1)
  })

  it("cuenta la decisión de la plataforma y su deshacer", () => {
    const events = buildLoadTimeline({
      ...base,
      flagged: { at: "2026-10-30T08:12:01.000Z", reasons: ["meter_regression"] },
      audit: [
        { id: "a1", action: "status_change", createdAt: "2026-10-30T11:00:00.000Z", actor: "Jefa", entityType: "fuel_equipment_load", oldState: '{"reviewStatus":"flagged"}', newState: '{"reviewStatus":"approved"}', reason: "Se cambió el tablero" },
        { id: "a2", action: "status_change", createdAt: "2026-10-30T12:00:00.000Z", actor: "Jefa", entityType: "fuel_equipment_load", oldState: '{"reviewStatus":"approved"}', newState: '{"reviewStatus":"ok"}', reason: "Me equivoqué" },
      ],
    })
    const texts = events.map((event) => event.text)
    expect(texts).toContain("La plataforma la dejó por decidir: lectura de medidor menor a la anterior")
    expect(texts).toContain("Jefa decidió que la carga cuenta")
    expect(texts).toContain("Jefa deshizo la decisión: la carga vuelve a estar por decidir")
    expect(events.find((event) => event.text.includes("cuenta"))?.note).toBe("Se cambió el tablero")
  })

  it("los pedidos de revisión salen de su tabla (pedido, retiro y resolución) y no de la auditoría", () => {
    const events = buildLoadTimeline({
      ...base,
      marks: [
        { id: "m1", status: "withdrawn", notes: "Los litros parecen altos", createdAt: "2026-10-30T09:00:00.000Z", markedByName: "Pedro", resolvedAt: "2026-10-30T09:30:00.000Z", resolvedByName: "Pedro", resolutionNote: null },
        { id: "m2", status: "resolved", notes: "Confirmar con el supervisor", createdAt: "2026-10-30T10:00:00.000Z", markedByName: "Pedro", resolvedAt: "2026-10-30T11:00:00.000Z", resolvedByName: "Jefa", resolutionNote: "Confirmado" },
      ],
      audit: [{ id: "a1", action: "update", createdAt: "2026-10-30T09:00:00.000Z", actor: "Pedro", entityType: "fuel_tae_submission", oldState: '{"reviewRequest":null}', newState: '{"reviewRequest":"open","markId":"m1"}', reason: "Los litros parecen altos" }],
    })
    expect(events.map((event) => event.text).filter((text) => /revis/i.test(text))).toEqual([
      "Pedro pidió que la revisen",
      "Pedro retiró el pedido de revisión",
      "Pedro pidió que la revisen",
      "Jefa resolvió el pedido de revisión",
    ])
  })

  it("cuenta los casos que se abrieron y cómo se cerraron", () => {
    const events = buildLoadTimeline({
      ...base,
      cases: [{ id: "c1", ruleName: "Kilometraje inferior al anterior", severity: "high", status: "resolved", detectedAt: "2026-10-30T09:40:00.000Z", resolvedAt: "2026-10-31T09:00:00.000Z", resolvedByName: "Jefa", resolution: "Era un error de lectura" }],
    })
    expect(events.map((event) => event.text)).toContain("Se abrió el caso «Kilometraje inferior al anterior» (gravedad alta)")
    expect(events.map((event) => event.text)).toContain("Jefa resolvió el caso «Kilometraje inferior al anterior»")
  })

  it("una corrección de lectura dice de cuánto a cuánto y si el medidor se reinició", () => {
    const [, event] = buildLoadTimeline({
      ...base,
      audit: [{ id: "a1", action: "update", createdAt: "2026-10-30T09:00:00.000Z", actor: "Ana", entityType: "fuel_tae_submission", oldState: '{"meterReading":1000}', newState: '{"meterReading":10,"meterReset":true}', reason: "Cambio de tablero" }],
    })
    expect(event?.text).toBe("Ana corrigió la lectura del medidor de 1.000 a 10 e indicó que el medidor se reinició: parte una serie nueva")
    expect(event?.note).toBe("Cambio de tablero")
  })

  it("sin permiso de costos, las modificaciones de una factura no mencionan montos", () => {
    const audit = [{ id: "a1", action: "update", createdAt: "2026-10-30T09:00:00.000Z", actor: "Ana", entityType: "fuel_load", oldState: '{"liters":100,"totalAmount":119000}', newState: '{"liters":120,"totalAmount":142800}', reason: null }]
    const hidden = buildLoadTimeline({ ...base, origen: "factura", terrenoSource: null, canViewCosts: false, audit })[1]
    const visible = buildLoadTimeline({ ...base, origen: "factura", terrenoSource: null, canViewCosts: true, audit })[1]
    expect(hidden?.text).toBe("Ana modificó los litros (de 100 a 120)")
    expect(visible?.text).toBe("Ana modificó los litros (de 100 a 120) y los montos")
  })

  it("ordena por instante real aunque las tablas devuelvan formatos distintos", () => {
    const events = buildLoadTimeline({
      ...base,
      statuses: [{ id: "s1", fromStatus: "submitted", toStatus: "validated", changedAt: "2026-10-30 10:00:00+00", actor: "Ana", reason: null }],
      marks: [{ id: "m1", status: "open", notes: "Revisar", createdAt: "2026-10-30T09:00:00.000Z", markedByName: "Pedro", resolvedAt: null, resolvedByName: null, resolutionNote: null }],
    })
    expect(events.map((event) => event.key)).toEqual(["registered", "mark:m1", "status:s1"])
  })
})

describe("cambios campo a campo", () => {
  it("rotula cada campo y escribe sus valores en palabras", () => {
    const rows = auditDiffRows('{"status":"submitted","liters":40,"flagReasons":["duplicate"]}', '{"status":"validated","liters":45,"flagReasons":[]}')
    expect(rows).toEqual([
      { key: "status", field: "Estado", before: "Por validar", after: "Validada" },
      { key: "liters", field: "Litros", before: "40", after: "45" },
      { key: "flagReasons", field: "Motivos de la revisión", before: "Posible carga duplicada", after: "ninguno" },
    ])
  })

  it("tolera un JSON roto o vacío", () => {
    expect(auditDiffRows(null, null)).toEqual([])
    expect(auditDiffRows("{roto", null)).toEqual([])
  })
})
