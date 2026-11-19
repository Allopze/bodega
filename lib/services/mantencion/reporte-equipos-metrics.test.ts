import { describe, expect, it } from "vitest"
import { REPORTE_EQUIPOS_FILAS } from "@/lib/sst/definitions/reporte-equipos-sections"
import {
  ageBucketOf,
  buildOpenFailures,
  countFailuresBySystem,
  DEFAULT_SIGNATURE_ROLES,
  daysBetween,
  detectionDate,
  failureSystemOf,
  hasAllSignatures,
  normalizeSignatureRoles,
  operatedHours,
  OTHER_SYSTEM,
  parseMeterReading,
  readingKey,
  summarizeCoverage,
  type ItemReading,
  type OpenFindingRow,
} from "./reporte-equipos-metrics"

describe("parseMeterReading", () => {
  it.each([
    ["134122", 134122],
    ["5400,5", 5400.5],
    ["5400.5", 5400.5],
    ["134.122,5", 134122.5],
    ["134,122.5", 134122.5],
    ["1.234.567", 1234567],
    // Un solo punto con tres dígitos detrás es el separador de miles (convención es-CL).
    ["134.122", 134122],
    ["  1 250,25 ", 1250.25],
    ["0", 0],
  ])("%s se lee como %s", (raw, expected) => {
    expect(parseMeterReading(raw)).toBe(expected)
  })

  it.each([[""], ["   "], ["abc"], ["-5"], ["12a"], ["1,234.567,8"], [null], [undefined]])("%s no es una lectura", (raw) => {
    expect(parseMeterReading(raw as string | null | undefined)).toBeNull()
  })
})

describe("operatedHours", () => {
  it("resta término menos inicio, con coma decimal", () => {
    expect(operatedHours("1000,5", "1008,25")).toBe(7.75)
    expect(operatedHours("134.122,0", "134.130,5")).toBe(8.5)
  })

  it("acepta 0 y 24 horas, los dos extremos del turno", () => {
    expect(operatedHours("100", "100")).toBe(0)
    expect(operatedHours("100", "124")).toBe(24)
  })

  it("descarta lo absurdo: más de 24 h, negativo o una lectura que falta", () => {
    expect(operatedHours("134122", "135120")).toBeNull()
    expect(operatedHours("100", "124,1")).toBeNull()
    expect(operatedHours("100", "99")).toBeNull()
    expect(operatedHours("100", null)).toBeNull()
    expect(operatedHours(undefined, "100")).toBeNull()
    expect(operatedHours("cien", "101")).toBeNull()
  })
})

describe("firmas", () => {
  const signed = (role: string, name = "Ana Pérez") => ({ role, name, userId: null, verified: false, capturedByUserId: "u1", signedAt: "2026-11-02T10:00:00Z" })

  it("exige cada rol del snapshot con un nombre", () => {
    const all = DEFAULT_SIGNATURE_ROLES.map((role) => signed(role))
    expect(hasAllSignatures(all, DEFAULT_SIGNATURE_ROLES)).toBe(true)
    expect(hasAllSignatures(all.slice(0, 2), DEFAULT_SIGNATURE_ROLES)).toBe(false)
  })

  it("una firma con el nombre en blanco no cuenta", () => {
    const sheet = [signed("operador_entrante"), signed("operador_saliente", "  "), signed("supervisor_turno")]
    expect(hasAllSignatures(sheet, DEFAULT_SIGNATURE_ROLES)).toBe(false)
  })

  it("sin acta, o con algo que no es una lista, no hay firmas", () => {
    expect(hasAllSignatures(null, DEFAULT_SIGNATURE_ROLES)).toBe(false)
    expect(hasAllSignatures({ role: "operador_entrante" }, DEFAULT_SIGNATURE_ROLES)).toBe(false)
    expect(hasAllSignatures([null, 3, "x"], DEFAULT_SIGNATURE_ROLES)).toBe(false)
  })

  it("los roles salen del snapshot de la plantilla; sin ellos, los tres del papel", () => {
    expect(normalizeSignatureRoles(["a", "b"])).toEqual(["a", "b"])
    expect(normalizeSignatureRoles(undefined)).toEqual([...DEFAULT_SIGNATURE_ROLES])
    expect(normalizeSignatureRoles([])).toEqual([...DEFAULT_SIGNATURE_ROLES])
    expect(normalizeSignatureRoles([1, null])).toEqual([...DEFAULT_SIGNATURE_ROLES])
    // Una plantilla que sólo exige dos roles no se mide contra tres.
    expect(hasAllSignatures([signed("a"), signed("b")], normalizeSignatureRoles(["a", "b"]))).toBe(true)
  })
})

describe("summarizeCoverage: esperados y recibidos", () => {
  const query = { from: "2026-11-01", to: "2026-11-30", granularity: "day" as const, today: "2026-11-05" }
  const run = (date: string | null, status: string) => ({ date, status })

  it("espera los no cancelados con fecha del período y hasta hoy; recibe los completados o revisados", () => {
    const result = summarizeCoverage([
      run("2026-11-01", "completed"),
      run("2026-11-01", "reviewed"),
      run("2026-11-02", "planned"),
      run("2026-11-03", "in_progress"),
      run("2026-11-04", "cancelled"),
      // Futuro: todavía no se espera.
      run("2026-11-06", "planned"),
      run("2026-11-20", "completed"),
      // Fuera del período.
      run("2026-10-31", "completed"),
      // Sin fecha que ubicar en el calendario.
      run(null, "completed"),
    ], query)
    expect(result.expected).toBe(4)
    expect(result.received).toBe(2)
    expect(result.percent).toBe(50)
  })

  it("arma un punto por día hasta hoy, con los vacíos en cero, y marca el de hoy como parcial", () => {
    const result = summarizeCoverage([run("2026-11-01", "completed"), run("2026-11-05", "planned")], query)
    expect(result.points.map((point) => point.key)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"])
    expect(result.points[0]).toMatchObject({ expected: 1, received: 1, partial: false })
    expect(result.points[1]).toMatchObject({ expected: 0, received: 0 })
    expect(result.points[4]).toMatchObject({ expected: 1, received: 0, partial: true })
  })

  it("sin esperados no hay porcentaje", () => {
    expect(summarizeCoverage([run("2026-11-04", "cancelled")], query).percent).toBeNull()
    expect(summarizeCoverage([], query)).toMatchObject({ expected: 0, received: 0, percent: null })
  })

  it("por mes junta los días del mes", () => {
    const result = summarizeCoverage(
      [run("2026-10-10", "completed"), run("2026-10-11", "planned"), run("2026-11-02", "completed")],
      { from: "2026-10-01", to: "2026-11-30", granularity: "month", today: "2026-11-05" },
    )
    expect(result.points).toEqual([
      { key: "2026-10", expected: 2, received: 1, partial: false },
      { key: "2026-11", expected: 1, received: 1, partial: true },
    ])
  })

  it("un período que termina antes de hoy no tiene baldes parciales", () => {
    const result = summarizeCoverage([run("2026-09-01", "completed")], { from: "2026-09-01", to: "2026-09-03", granularity: "day", today: "2026-11-05" })
    expect(result.points.every((point) => !point.partial)).toBe(true)
    expect(result.points).toHaveLength(3)
  })
})

describe("sistemas de las fallas", () => {
  it("agrupa los ítems del papel en su sistema", () => {
    expect(failureSystemOf("luces").label).toBe("Eléctrico")
    expect(failureSystemOf("freno_servicio").label).toBe("Frenos y dirección")
    expect(failureSystemOf("direccion").label).toBe("Frenos y dirección")
    expect(failureSystemOf("neumaticos_llantas").label).toBe("Neumáticos y rodado")
    expect(failureSystemOf("fuga_aceite_frenos").label).toBe("Fluidos y fugas")
    expect(failureSystemOf("espejos").label).toBe("Carrocería y cabina")
    expect(failureSystemOf("extintor").label).toBe("Seguridad")
    expect(failureSystemOf("estado_garra").label).toBe("Implemento")
    expect(failureSystemOf("estado_ampliroll").label).toBe("Implemento")
  })

  it("los ítems del acoplado cuentan en el sistema de su espejo", () => {
    expect(failureSystemOf("acoplado_luces").label).toBe("Eléctrico")
    expect(failureSystemOf("acoplado_freno_servicio").label).toBe("Frenos y dirección")
    expect(failureSystemOf("acoplado_estado_balde").label).toBe("Implemento")
  })

  it("un ítem desconocido va a «Otros», no se pierde", () => {
    expect(failureSystemOf("algo_nuevo")).toEqual(OTHER_SYSTEM)
  })

  it("cada una de las 25 filas del papel (y su espejo del acoplado) tiene sistema: una fila nueva no cae en «Otros» en silencio", () => {
    for (const fila of REPORTE_EQUIPOS_FILAS) {
      expect(failureSystemOf(fila.id).id, fila.id).not.toBe(OTHER_SYSTEM.id)
      expect(failureSystemOf(`acoplado_${fila.id}`).id, `acoplado_${fila.id}`).not.toBe(OTHER_SYSTEM.id)
    }
  })

  it("cuenta ocurrencias de mayor a menor y deja fuera los sistemas sin fallas", () => {
    const counts = countFailuresBySystem(["luces", "luces", "bocina", "freno_servicio", "acoplado_luces", "extintor", "nuevo"])
    expect(counts.map((row) => [row.label, row.count])).toEqual([
      ["Eléctrico", 4],
      ["Frenos y dirección", 1],
      ["Seguridad", 1],
      ["Otros", 1],
    ])
    expect(countFailuresBySystem([])).toEqual([])
  })
})

describe("detectionDate: el primer reporte de la racha actual", () => {
  const reading = (date: string, result: string): ItemReading => ({ date, result })

  it("una racha sin cortes arranca en su primer día con falla", () => {
    expect(detectionDate([reading("2026-11-01", "non_conforming"), reading("2026-11-02", "non_conforming"), reading("2026-11-03", "non_conforming")])).toBe("2026-11-01")
  })

  it("un reporte intermedio conforme corta la racha: cuenta desde la falla posterior", () => {
    expect(detectionDate([
      reading("2026-11-01", "non_conforming"),
      reading("2026-11-02", "conforming"),
      reading("2026-11-03", "non_conforming"),
      reading("2026-11-04", "non_conforming"),
    ])).toBe("2026-11-03")
  })

  it("un «no aplica» o un ítem sin responder no arregla la falla", () => {
    expect(detectionDate([
      reading("2026-11-01", "non_conforming"),
      reading("2026-11-02", "not_applicable"),
      reading("2026-11-03", "recorded"),
      reading("2026-11-04", "non_conforming"),
    ])).toBe("2026-11-01")
  })

  it("no importa el orden en que llegan las lecturas", () => {
    expect(detectionDate([
      reading("2026-11-04", "non_conforming"),
      reading("2026-11-01", "non_conforming"),
      reading("2026-11-02", "conforming"),
      reading("2026-11-03", "non_conforming"),
    ])).toBe("2026-11-03")
  })

  it("dos reportes el mismo día: si uno marca falla, el día cuenta como falla", () => {
    expect(detectionDate([
      reading("2026-11-01", "non_conforming"),
      reading("2026-11-02", "conforming"),
      reading("2026-11-02", "non_conforming"),
      reading("2026-11-03", "non_conforming"),
    ])).toBe("2026-11-01")
    // Y un conforme el mismo día que un «no aplica» sigue cortando.
    expect(detectionDate([
      reading("2026-11-01", "non_conforming"),
      reading("2026-11-02", "not_applicable"),
      reading("2026-11-02", "conforming"),
      reading("2026-11-03", "non_conforming"),
    ])).toBe("2026-11-03")
  })

  it("si el último reporte ya sale conforme, la racha que cuenta es la última que hubo", () => {
    expect(detectionDate([
      reading("2026-10-20", "non_conforming"),
      reading("2026-10-21", "conforming"),
      reading("2026-11-01", "non_conforming"),
      reading("2026-11-02", "non_conforming"),
      reading("2026-11-03", "conforming"),
    ])).toBe("2026-11-01")
  })

  it("sin ninguna falla en las lecturas no hay detección", () => {
    expect(detectionDate([])).toBeNull()
    expect(detectionDate([reading("2026-11-01", "conforming")])).toBeNull()
  })
})

describe("antigüedad", () => {
  it("cuenta días civiles y nunca sale negativa", () => {
    expect(daysBetween("2026-11-01", "2026-11-04")).toBe(3)
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1)
    expect(daysBetween("2026-11-04", "2026-11-01")).toBe(0)
    expect(daysBetween("no", "2026-11-01")).toBe(0)
  })

  it("los tramos son 0–3, 4–7 y más de 7 días", () => {
    expect([0, 3, 4, 7, 8, 40].map(ageBucketOf)).toEqual(["fresh", "fresh", "week", "week", "old", "old"])
  })
})

describe("buildOpenFailures", () => {
  const today = "2026-11-10"
  const finding = (over: Partial<OpenFindingRow> & { id: string }): OpenFindingRow => ({
    vehicleId: "v1", itemId: "freno_servicio", criticality: "critical", createdDate: "2026-11-09", ...over,
  })
  const readings = (entries: Array<[string, string, ItemReading[]]>) => new Map(entries.map(([vehicle, item, list]) => [readingKey(vehicle, item), list]))

  it("un freno que falla cinco días seguidos es una sola falla, con la antigüedad de su primer día", () => {
    const failures = buildOpenFailures(
      ["1", "2", "3", "4", "5"].map((id, index) => finding({ id, createdDate: `2026-11-0${index + 5}` })),
      readings([["v1", "freno_servicio", ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"].map((date) => ({ date, result: "non_conforming" }))]]),
      today,
    )
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ detectedOn: "2026-11-01", ageDays: 9, bucket: "old", safety: true })
  })

  it("equipos o ítems distintos son fallas distintas", () => {
    const failures = buildOpenFailures(
      [finding({ id: "1" }), finding({ id: "2", vehicleId: "v2" }), finding({ id: "3", itemId: "luces", criticality: "medium" })],
      new Map(),
      today,
    )
    expect(failures).toHaveLength(3)
  })

  it("la falla es de seguridad si algún hallazgo suyo es alto o crítico", () => {
    const failures = buildOpenFailures(
      [finding({ id: "1", itemId: "luces", criticality: "low" }), finding({ id: "2", itemId: "luces", criticality: "high" }), finding({ id: "3", itemId: "bocina", criticality: "medium" })],
      new Map(),
      today,
    )
    expect(failures.find((failure) => failure.itemId === "luces")?.safety).toBe(true)
    expect(failures.find((failure) => failure.itemId === "bocina")?.safety).toBe(false)
  })

  it("sin lecturas cuenta desde el primer hallazgo", () => {
    const [failure] = buildOpenFailures([finding({ id: "1", createdDate: "2026-11-08" }), finding({ id: "2", createdDate: "2026-11-06" })], new Map(), today)
    expect(failure).toMatchObject({ detectedOn: "2026-11-06", ageDays: 4, bucket: "week" })
  })

  it("un reporte conforme entre medio reinicia la antigüedad", () => {
    const [failure] = buildOpenFailures(
      [finding({ id: "1", createdDate: "2026-11-09" })],
      readings([["v1", "freno_servicio", [
        { date: "2026-10-01", result: "non_conforming" },
        { date: "2026-10-02", result: "conforming" },
        { date: "2026-11-08", result: "non_conforming" },
        { date: "2026-11-09", result: "non_conforming" },
      ]]]),
      today,
    )
    expect(failure).toMatchObject({ detectedOn: "2026-11-08", ageDays: 2, bucket: "fresh" })
  })

  it("una desviación sin ítem o un hallazgo sin equipo no se junta con nada", () => {
    const failures = buildOpenFailures(
      [finding({ id: "1", itemId: null }), finding({ id: "2", itemId: null }), finding({ id: "3", vehicleId: null })],
      new Map(),
      today,
    )
    expect(failures).toHaveLength(3)
  })
})
