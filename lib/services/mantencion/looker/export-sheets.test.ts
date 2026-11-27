import { describe, expect, it } from "vitest"
import { EXCEL_DATE_FORMAT } from "@/lib/reports/excel-dates"
import { filtersSheet } from "./export-filters"
import { planningNotes, planningSheet } from "./export-planning"
import {
  checklistMatrixSheet, complianceByMonthSheet, complianceByPlateSheet, complianceByWorksiteMechanicSheet, matrixChecksSheet,
  preventiveNotes,
} from "./export-preventive"
import type {
  ChecklistMatrix, ComplianceBucket, ComplianceByPlate, LookerContext,
  LookerFilters, LookerOptions, MatrixCheck, PlanningRow, ResolvedCrossFilters,
} from "./types"

/** Fechas de calendario como las escribe el libro: medianoche UTC del día, sin desfase de zona. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

function planRow(over: Partial<PlanningRow> = {}): PlanningRow {
  return {
    vehicleId: "v-1", code: "KA-143", plate: "SJFC-66", label: "KA-143 · SJFC-66", typeName: "Camión", worksiteId: "ws-1",
    worksiteName: "Teno", unit: "km", scheduleName: "Camiones", intervals: [10_000, 40_000], frequency: 40_000,
    lastDate: "2026-10-15", programmed: 340_000, real: 339_990, current: 345_000, next: 350_000, delta: 10, remaining: 5_000,
    base: 10_000, state: "al_dia", declared: false, evidence: null, manual: false, manualReason: null, outOfRange: false,
    dailyUsage: 240, estimatedDate: "2026-12-17", estimateNote: null,
    ...over,
  }
}

describe("hoja de Planificación", () => {
  it("km: una fila por equipo con tocaba, se hizo, ¿a tiempo?, lectura, próxima y faltan como números, y las fechas como fecha de Excel", () => {
    const sheet = planningSheet([planRow()], "km")
    expect(sheet.worksheetName).toBe("Consolidado por kilómetros")
    expect(sheet.headers).toEqual([
      "Patente", "Código", "Tipo de equipo", "Faena", "Pauta", "Frecuencia (km)", "Última mantención",
      "Tocaba a los (km)", "Se hizo a los (km)", "¿A tiempo?", "Lectura actual (km)", "Próxima a los (km)", "Faltan (km)",
      "Fecha estimada", "Uso diario (km/día)", "Estado", "Observación",
    ])
    expect(sheet.rows).toEqual([[
      "SJFC-66", "KA-143", "Camión", "Teno", "Camiones", 40_000, day("2026-10-15"),
      340_000, 339_990, "A tiempo", 345_000, 350_000, 5_000, day("2026-12-17"), 240, "Al día", null,
    ]])
    expect(sheet.columnFormats?.[6]).toBe(EXCEL_DATE_FORMAT)
    expect(sheet.columnFormats?.[13]).toBe(EXCEL_DATE_FORMAT)
  })

  it("¿A tiempo? dice cuánto tarde o antes con el mismo texto de la pantalla", () => {
    const timing = (over: Partial<PlanningRow>) => planningSheet([planRow(over)], "km").rows[0]![9]
    expect(timing({ delta: -14_394 })).toBe("14.394 km tarde")
    expect(timing({ delta: 360 })).toBe("360 km antes")
  })

  it("horas: los rótulos hablan de horas, y lo que el equipo no tiene queda vacío, nunca en cero", () => {
    const sheet = planningSheet([
      planRow({
        unit: "h", plate: "TO-37", code: "TO-37", scheduleName: null, frequency: null, lastDate: null, programmed: null, real: null,
        current: null, next: null, delta: null, remaining: null, base: null, dailyUsage: null, estimatedDate: null, estimateNote: null,
      }),
    ], "h")
    expect(sheet.worksheetName).toBe("Consolidado por horas")
    expect(sheet.headers).toContain("Tocaba a los (h)")
    expect(sheet.headers).toContain("Frecuencia (h)")
    expect(sheet.headers).toContain("Uso diario (h/día)")
    expect(sheet.rows[0]).toEqual(["TO-37", "TO-37", "Camión", "Teno", null, null, null, null, null, null, null, null, null, null, null, "Sin dato", null])
  })

  it("el estado sigue el semáforo de la pantalla: vencida, próxima o al día", () => {
    const state = (over: Partial<PlanningRow>) => planningSheet([planRow(over)], "km").rows[0]![15]
    expect(state({ remaining: 0 })).toBe("Vencida")
    expect(state({ remaining: -1_200 })).toBe("Vencida")
    expect(state({ remaining: 1_000, base: 10_000 })).toBe("Próxima")
    expect(state({ remaining: 5_000, base: 10_000 })).toBe("Al día")
  })

  it("la observación dice lo que la pantalla marca con un lápiz, «Declarada» o un tooltip, y por qué no hay fecha estimada", () => {
    const observation = (over: Partial<PlanningRow>) => planningSheet([planRow(over)], "km").rows[0]![16]
    expect(observation({ manual: true, manualReason: "Terreno difícil" })).toBe("Intervalo ajustado a mano: Terreno difícil")
    expect(observation({ manual: true, manualReason: null })).toBe("Intervalo ajustado a mano")
    expect(observation({ declared: true, evidence: "Planilla 2026" })).toBe("Preventiva declarada (respaldo: Planilla 2026)")
    expect(observation({ declared: true, evidence: null })).toBe("Preventiva declarada")
    expect(observation({ outOfRange: true })).toBe("La última mantención queda fuera del período elegido")
    expect(observation({ manual: true, manualReason: "x", outOfRange: true })).toBe("Intervalo ajustado a mano: x; La última mantención queda fuera del período elegido")
    expect(observation({ estimatedDate: null, estimateNote: "El equipo no registra uso en los últimos 30 días" })).toBe("Sin fecha estimada: El equipo no registra uso en los últimos 30 días")
  })

  it("las notas explican tocaba/se hizo, faltan, la fecha estimada y la regla de «próxima»; con un equipo elegido avisan que la hoja queda completa", () => {
    const base = planningNotes({}, "km").join("\n")
    expect(base).toMatch(/Próxima = punto de la última mantención \+ intervalo base/)
    expect(base).toMatch(/«Tocaba a los» es el punto de la pauta/)
    expect(base).toMatch(/«Faltan» = próxima − lectura actual/)
    expect(base).toMatch(/uso diario de los últimos 30 días/)
    expect(base).toMatch(/dato que no existe, no un cero/)
    expect(base).not.toMatch(/equipo elegido/i)
    const cross: ResolvedCrossFilters = { equipment: { id: "v-1", code: "KA-143", plate: "SJFC-66", label: "KA-143 · SJFC-66", worksiteId: "ws-1", worksiteName: "Teno", unit: "km", intervals: [], frequency: null } }
    expect(planningNotes(cross, "km").join("\n")).toMatch(/el equipo elegido con un clic no recorta la hoja/i)
    expect(planningNotes({}, "h").join("\n")).toMatch(/diferencia en horas/)
  })
})

describe("hojas de cumplimiento", () => {
  it("por mes: un mes sin pautas queda con el % vacío y 0 pautas, no con 0 %", () => {
    const buckets: ComplianceBucket[] = [
      { key: "2026-09", label: "sept 2026", percent: null, checks: 0 },
      { key: "2026-10", label: "oct 2026", percent: 97.5, checks: 2 },
    ]
    const sheet = complianceByMonthSheet(buckets)
    expect(sheet.worksheetName).toBe("Cumplimiento por mes")
    expect(sheet.headers).toEqual(["Mes", "Cumplimiento (%)", "Pautas"])
    expect(sheet.rows).toEqual([["sept 2026", null, 0], ["oct 2026", 97.5, 2]])
  })

  it("por faena y mecánico: dos columnas, con «Sin mecánico» como en la pantalla", () => {
    const buckets: ComplianceBucket[] = [
      { key: "ws-1|javier roa", label: "Teno · Javier Roa", percent: 97.5, checks: 2, worksiteId: "ws-1", worksiteName: "Teno", mechanicKey: "javier roa", mechanicLabel: "Javier Roa" },
      { key: "ws-1|none", label: "Teno · Sin mecánico", percent: null, checks: 1, worksiteId: "ws-1", worksiteName: "Teno", mechanicKey: null, mechanicLabel: null },
    ]
    const sheet = complianceByWorksiteMechanicSheet(buckets)
    expect(sheet.worksheetName).toBe("Cumplimiento faena y mecánico")
    expect(sheet.headers).toEqual(["Faena", "Mecánico", "Cumplimiento (%)", "Pautas"])
    expect(sheet.rows).toEqual([["Teno", "Javier Roa", 97.5, 2], ["Teno", "Sin mecánico", null, 1]])
  })

  it("por equipo: los niveles van en una celda y trae lo sin hacer, la última pauta y las fotos", () => {
    const rows: ComplianceByPlate[] = [
      {
        vehicleId: "v-1", code: "KA-143", plate: "SJFC-66", worksiteId: "ws-1", worksiteName: "Teno", percent: 90, checks: 2,
        levels: ["40.000 KM", "10.000 KM"], notDone: 3, lastDate: "2026-10-15", lastMechanic: "Javier Roa", withoutPhotos: 1,
      },
      {
        vehicleId: null, code: "KA-X", plate: "", worksiteId: null, worksiteName: null, percent: null, checks: 1, levels: [],
        notDone: 0, lastDate: "2026-10-02", lastMechanic: null, withoutPhotos: 0,
      },
    ]
    const sheet = complianceByPlateSheet(rows)
    expect(sheet.worksheetName).toBe("Cumplimiento por equipo")
    expect(sheet.headers).toEqual([
      "Patente", "Código", "Faena", "Niveles de pauta", "Cumplimiento (%)", "Pautas", "Sin hacer", "Última pauta",
      "Mecánico de la última pauta", "Fotos completas",
    ])
    expect(sheet.rows).toEqual([
      ["SJFC-66", "KA-143", "Teno", "40.000 KM · 10.000 KM", 90, 2, 3, day("2026-10-15"), "Javier Roa", "1 sin fotos"],
      [null, "KA-X", "Sin faena", null, null, 1, 0, day("2026-10-02"), "Sin mecánico", "Todas"],
    ])
    expect(sheet.columnFormats?.[7]).toBe(EXCEL_DATE_FORMAT)
  })
})

function check(over: Partial<MatrixCheck> = {}): MatrixCheck {
  return {
    id: "h:p1", source: "historial", vehicleId: "v-1", date: "2026-10-15", label: "KA-143 · 40.000 KM", code: "KA-143", plate: "SJFC-66", worksiteName: "Teno",
    level: "40.000 KM", mechanic: "Javier Roa", photoIds: [], photoUrls: [], observations: "Cambio de refrigerante pendiente",
    items: { "Cambio aceite": "realizado", "Revisión frenos": "no_realizado" }, itemOrder: { "Cambio aceite": 0, "Revisión frenos": 1 },
    itemGroups: { "Cambio aceite": null, "Revisión frenos": null },
    ...over,
  }
}

describe("matriz de checklist", () => {
  const matrix: ChecklistMatrix = {
    checks: [
      check(),
      check({
        id: "r:r1", source: "registro", date: "2026-12-10", code: "KA-R", plate: "REC-01", level: "40.000 km", mechanic: null, observations: null,
        photoIds: [{ id: "ph-1", caption: "Sticker", stampedAt: "x", receivedAt: "y" }, { id: "ph-2", caption: "Filtros usados", stampedAt: "x", receivedAt: "y" }],
        items: { "Cambio aceite": "no_aplica", "Filtro aire": "realizado" }, itemOrder: { "Cambio aceite": 0, "Filtro aire": 1 },
        itemGroups: { "Cambio aceite": "Motor", "Filtro aire": "Motor" },
      }),
    ],
    items: [
      { name: "Cambio aceite", group: "Motor", sortOrder: 0 },
      { name: "Revisión frenos", group: null, sortOrder: 1 },
      { name: "Filtro aire", group: "Motor", sortOrder: 1 },
    ],
    withoutDetail: 2,
  }

  it("ítems en filas y una columna por pauta; un ítem que la pauta no trae queda vacío", () => {
    const sheet = checklistMatrixSheet(matrix)
    expect(sheet.worksheetName).toBe("Matriz de checklist")
    expect(sheet.headers).toEqual(["Ítem", "Sistema", "KA-143 · 15-10-2026 · 40.000 KM", "KA-R · 10-12-2026 · 40.000 km"])
    expect(sheet.rows).toEqual([
      ["Cambio aceite", "Motor", "Realizado", "No aplica"],
      ["Revisión frenos", null, "No realizado", null],
      ["Filtro aire", "Motor", null, "Realizado"],
    ])
  })

  it("una hoja aparte por pauta lleva mecánico, observaciones, fotos de la plataforma y enlaces de respaldo", () => {
    const withLinks: ChecklistMatrix = {
      ...matrix,
      checks: [check({ photoUrls: [{ label: "Sticker", url: "https://drive.google.com/file/d/1" }] }), matrix.checks[1]!],
    }
    const sheet = matrixChecksSheet(withLinks)
    expect(sheet.worksheetName).toBe("Pautas de la matriz")
    expect(sheet.headers).toEqual([
      "Pauta (columna de la matriz)", "Código", "Patente", "Fecha", "Nivel de pauta", "Mecánico", "Faena", "Fuente", "Observaciones",
      "Fotos en la plataforma", "Enlaces de respaldo",
    ])
    expect(sheet.rows).toEqual([
      ["KA-143 · 15-10-2026 · 40.000 KM", "KA-143", "SJFC-66", day("2026-10-15"), "40.000 KM", "Javier Roa", "Teno", "Historial de formularios",
        "Cambio de refrigerante pendiente", 0, "Sticker: https://drive.google.com/file/d/1"],
      ["KA-R · 10-12-2026 · 40.000 km", "KA-R", "REC-01", day("2026-12-10"), "40.000 km", "Sin mecánico", "Teno", "Registro de la plataforma", null, 2, null],
    ])
    expect(sheet.columnFormats?.[3]).toBe(EXCEL_DATE_FORMAT)
  })

  it("el encabezado de una columna que parte con =, +, - o @ (código o patente del histórico, texto libre) se neutraliza como el resto de las celdas", () => {
    const hostile: ChecklistMatrix = {
      ...matrix,
      checks: ["=1+1", "+1", "-1", "@SUM(1)"].map((code, index) => check({ id: `h:x${index}`, code, plate: "" })),
    }
    const headers = checklistMatrixSheet(hostile).headers.slice(2)
    expect(headers).toHaveLength(4)
    for (const header of headers) expect(header).toMatch(/^'[=+\-@]/)
    // Y es el mismo texto que la columna «Pauta (columna de la matriz)», que el libro sanea al escribirla.
    expect(headers).toEqual(matrixChecksSheet(hostile).rows.map((row) => `'${row[0]}`))
  })

  it("sin pautas con detalle, la matriz es una hoja con sus dos encabezados y sin filas", () => {
    const empty: ChecklistMatrix = { checks: [], items: [], withoutDetail: 3 }
    expect(checklistMatrixSheet(empty).headers).toEqual(["Ítem", "Sistema"])
    expect(checklistMatrixSheet(empty).rows).toEqual([])
    expect(matrixChecksSheet(empty).rows).toEqual([])
  })

  it("las notas de lectura de Preventivo dicen el corte, la regla del %, el orden por equipo, los topes de la matriz y lo que quedó fuera", () => {
    const notes = preventiveNotes("km", matrix, 60).join("\n")
    expect(notes).toMatch(/hasta el 30-11-2026/)
    expect(notes).toMatch(/desde el 01-12-2026/)
    expect(notes).toMatch(/equipos por kilómetros/)
    expect(notes).toMatch(/promedio de los % de cada pauta/)
    expect(notes).toMatch(/más ítems dejaron sin hacer primero/)
    expect(notes).toMatch(/dato que no existe, no un cero/)
    expect(notes).toMatch(/hasta 60 pautas/)
    expect(notes).toMatch(/últimas 8/)
    expect(notes).toMatch(/2 de las últimas pautas no traen detalle/)
    expect(notes).not.toMatch(/prorrateadas/)
    expect(preventiveNotes("h", { ...matrix, withoutDetail: 0 }, 60).join("\n")).toMatch(/equipos por horas/)
    expect(preventiveNotes("h", { ...matrix, withoutDetail: 0 }, 60).join("\n")).not.toMatch(/no traen detalle/)
  })
})

const options: LookerOptions = {
  worksites: [{ id: "ws-1", name: "Teno" }, { id: "ws-2", name: "Arauco" }],
  equipment: [
    { id: "v-1", code: "KA-143", plate: "SJFC-66", label: "KA-143 · SJFC-66", worksiteId: "ws-1", worksiteName: "Teno", typeName: "Camión", unit: "km", scheduleId: "s-1", scheduleName: "Camiones", intervals: [10_000, 40_000], frequency: 40_000 },
  ],
  frequencies: [{ value: 10_000, unit: "km", label: "10.000 km" }, { value: 40_000, unit: "km", label: "40.000 km" }],
}

function context(over: { filters?: Partial<LookerFilters>; cross?: ResolvedCrossFilters } = {}): LookerContext {
  return {
    filters: {
      tab: "correctivo", unit: "km", from: "2026-10-01", to: "2026-10-31", requestedFrom: "2026-10-01", requestedTo: "2026-10-31", invalidPeriod: false,
      worksiteIds: [], equipmentIds: [], frequencies: [], page: 1, cross: {},
      planningState: null, dateField: "proxima", dateFrom: null, dateTo: null, invalidDateRange: false, sheetVehicleId: null, sheetCheckId: null,
      ...over.filters,
    },
    options,
    cross: over.cross ?? {},
  }
}

const detail = (sheet: ReturnType<typeof filtersSheet>, concept: string) => sheet.rows.filter((row) => row[0] === concept).map((row) => row[1])

describe("hoja «Filtros»", () => {
  it("sin filtros dice todo lo que se ve: pestaña, unidad, período, todas las faenas, todos los equipos, todas las frecuencias y ningún filtro cruzado", () => {
    const sheet = filtersSheet({ tab: "correctivo", context: context(), notes: [] })
    expect(sheet.worksheetName).toBe("Filtros")
    expect(sheet.headers).toEqual(["Concepto", "Detalle"])
    expect(detail(sheet, "Pestaña")).toEqual(["Correctivo"])
    expect(detail(sheet, "Unidad de control")).toEqual(["Por kilómetros"])
    expect(detail(sheet, "Período")).toEqual(["01-10-2026 al 31-10-2026"])
    expect(detail(sheet, "Faenas")).toEqual(["Todas las faenas de tu alcance"])
    expect(detail(sheet, "Equipos")).toEqual(["Todos"])
    expect(detail(sheet, "Frecuencia")).toEqual(["Todas"])
    expect(detail(sheet, "Filtros cruzados")).toEqual(["Ninguno"])
  })

  it("con filtros nombra las faenas, los códigos y las frecuencias, y lista cada filtro cruzado activo", () => {
    const cross: ResolvedCrossFilters = {
      conductor: { key: "juan perez", label: "JUAN PEREZ" },
      month: { key: "2026-10", label: "oct 2026" },
      mechanic: { key: "javier roa", label: "Javier Roa" },
      worksite: { id: "ws-1", name: "Teno" },
      equipment: { id: "v-1", code: "KA-143", plate: "SJFC-66", label: "KA-143 · SJFC-66", worksiteId: "ws-1", worksiteName: "Teno", unit: "km", intervals: [], frequency: null },
      work: { id: "ot:1", label: "OT-0001", equipmentId: "v-1", worksiteId: "ws-1" },
    }
    const sheet = filtersSheet({
      tab: "correctivo",
      context: context({ filters: { worksiteIds: ["ws-1", "ws-2"], equipmentIds: ["v-1"], frequencies: [40_000] }, cross }),
      notes: [],
    })
    expect(detail(sheet, "Faenas")).toEqual(["Teno, Arauco"])
    expect(detail(sheet, "Equipos")).toEqual(["KA-143 · SJFC-66"])
    expect(detail(sheet, "Frecuencia")).toEqual(["40.000 km"])
    expect(detail(sheet, "Filtros cruzados")).toEqual([])
    expect(detail(sheet, "Filtro cruzado: Equipo")).toEqual(["KA-143 · SJFC-66"])
    expect(detail(sheet, "Filtro cruzado: OT")).toEqual(["OT-0001"])
    expect(detail(sheet, "Filtro cruzado: Conductor")).toEqual(["JUAN PEREZ"])
    expect(detail(sheet, "Filtro cruzado: Mes")).toEqual(["oct 2026"])
    expect(detail(sheet, "Filtro cruzado: Faena")).toEqual(["Teno"])
    expect(detail(sheet, "Filtro cruzado: Mecánico")).toEqual(["Javier Roa"])
  })

  it("un equipo que sólo viene derivado de una OT o de una pauta no se lista como filtro cruzado propio", () => {
    const cross: ResolvedCrossFilters = {
      equipment: { id: "v-1", code: "KA-143", plate: "SJFC-66", label: "KA-143 · SJFC-66", worksiteId: "ws-1", worksiteName: "Teno", unit: "km", intervals: [], frequency: null, derivedFrom: "work" },
    }
    const sheet = filtersSheet({ tab: "correctivo", context: context({ cross }), notes: [] })
    expect(detail(sheet, "Filtro cruzado: Equipo")).toEqual([])
  })

  it("una faena sin nombre disponible no se nombra y el texto no afirma lo que no se sabe (ajena o inactiva); el período se corta en hoy", () => {
    const sheet = filtersSheet({
      tab: "preventivo",
      context: context({ filters: { tab: "preventivo", unit: "h", worksiteIds: ["ws-ajena"], requestedTo: "2026-11-30", to: "2026-11-24", from: "2026-11-01", requestedFrom: "2026-11-01" } }),
      notes: [],
    })
    expect(detail(sheet, "Pestaña")).toEqual(["Preventivo"])
    expect(detail(sheet, "Unidad de control")).toEqual(["Por horas"])
    // Las opciones traen sólo faenas ACTIVAS del alcance: una faena que no está ahí puede ser ajena o estar cerrada, y el
    // libro puede traer filas de ella. Por eso no dice «sin datos» ni «fuera de tu alcance» a secas.
    expect(detail(sheet, "Faenas")).toEqual(["1 faena sin nombre disponible (fuera de tu alcance o inactiva)"])
    expect(JSON.stringify(sheet.rows)).not.toContain("ws-ajena")
    expect(JSON.stringify(sheet.rows)).not.toMatch(/sin datos/)
    expect(detail(sheet, "Período")).toEqual(["01-11-2026 al 24-11-2026 (se mide hasta hoy; se pidió hasta el 30-11-2026)"])
  })

  it("faenas activas del alcance se nombran y las que no, se cuentan, en plural y mezcladas", () => {
    const faenas = (...ids: string[]) => detail(filtersSheet({ tab: "correctivo", context: context({ filters: { worksiteIds: ids } }), notes: [] }), "Faenas")
    expect(faenas("ws-1")).toEqual(["Teno"])
    expect(faenas("ws-x", "ws-y")).toEqual(["2 faenas sin nombre disponible (fuera de tu alcance o inactiva)"])
    expect(faenas("ws-1", "ws-x", "ws-y")).toEqual(["Teno; 2 faenas sin nombre disponible (fuera de tu alcance o inactiva)"])
  })

  it("lo mismo con los códigos: un equipo que no está entre las opciones (ajeno o inactivo) no se nombra ni se declara «sin datos»", () => {
    const codigos = (...ids: string[]) => detail(filtersSheet({ tab: "correctivo", context: context({ filters: { equipmentIds: ids } }), notes: [] }), "Equipos")
    expect(codigos("v-1")).toEqual(["KA-143 · SJFC-66"])
    expect(codigos("v-x")).toEqual(["1 código sin nombre disponible (fuera de tu alcance o inactivo)"])
    expect(codigos("v-x", "v-y")).toEqual(["2 códigos sin nombre disponible (fuera de tu alcance o inactivo)"])
    expect(codigos("v-1", "v-x")).toEqual(["KA-143 · SJFC-66; 1 código sin nombre disponible (fuera de tu alcance o inactivo)"])
    expect(JSON.stringify(codigos("v-x"))).not.toMatch(/sin datos/)
  })

  it("un rango inválido de la dirección avisa que se usó el período por defecto; las notas van al final, una por fila", () => {
    const sheet = filtersSheet({ tab: "correctivo", context: context({ filters: { invalidPeriod: true } }), notes: ["Primera.", "Segunda."] })
    expect(detail(sheet, "Período")[0]).toMatch(/El rango de la dirección no era válido: se usó el período por defecto/)
    expect(sheet.rows.slice(-2)).toEqual([["Nota", "Primera."], ["Nota", "Segunda."]])
  })

  it("Planificación no tiene período (PAN4-6): lleva el estado y el rango de fechas que filtran la tabla", () => {
    const plain = filtersSheet({ tab: "planificacion", context: context({ filters: { tab: "planificacion" } }), notes: [] })
    expect(detail(plain, "Pestaña")).toEqual(["Planificación"])
    expect(detail(plain, "Período")).toEqual([])
    expect(detail(plain, "Estado")).toEqual([])
    const sheet = filtersSheet({
      tab: "planificacion",
      context: context({ filters: { tab: "planificacion", unit: "h", planningState: "vencida", dateField: "ultima", dateFrom: "2026-06-01", dateTo: "2026-09-30" } }),
      notes: [],
    })
    expect(detail(sheet, "Unidad de control")).toEqual(["Por horas"])
    expect(detail(sheet, "Estado")).toEqual(["Vencidas"])
    expect(detail(sheet, "Última mantención")).toEqual(["01-06-2026 al 30-09-2026"])
    const shortcut = filtersSheet({ tab: "planificacion", context: context({ filters: { tab: "planificacion", dateTo: "2026-12-27" } }), notes: [] })
    expect(detail(shortcut, "Próxima mantención (estimada)")).toEqual(["hasta 27-12-2026"])
    const invalid = filtersSheet({ tab: "planificacion", context: context({ filters: { tab: "planificacion", invalidDateRange: true } }), notes: [] })
    expect(detail(invalid, "Fechas")[0]).toMatch(/no eran válidas/)
  })
})
