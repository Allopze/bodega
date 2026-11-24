import { describe, expect, it } from "vitest"
import { EXCEL_DATE_FORMAT } from "@/lib/reports/excel-dates"
import { filtersSheet } from "./export-filters"
import { planningNotes, planningSheet } from "./export-planning"
import {
  checklistMatrixSheet, complianceByMonthSheet, complianceByPlateSheet, complianceByWorksiteMechanicSheet,
  correctiveSheet, driversSheet, equipmentSeriesSheet, matrixChecksSheet, workNotes,
} from "./export-work"
import type {
  ChecklistMatrix, ComplianceBucket, ComplianceByPlate, CorrectiveWorkRow, DriverRow, EquipmentSeriesRow, LookerContext,
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
    ...over,
  }
}

describe("hoja de Planificación", () => {
  it("km: una fila por equipo con A, B, actual, próxima, delta y faltantes como números, y la fecha como fecha de Excel", () => {
    const sheet = planningSheet([planRow()], "km")
    expect(sheet.worksheetName).toBe("Consolidado por kilómetros")
    expect(sheet.headers).toEqual([
      "Patente", "Código", "Tipo de equipo", "Faena", "Pauta", "Frecuencia (km)", "Última mantención",
      "Km programados (A)", "Km reales (B)", "Km actuales", "Próxima mantención (km)", "Delta A − B (km)", "Faltantes (km)",
      "Situación", "Observación",
    ])
    expect(sheet.rows).toEqual([[
      "SJFC-66", "KA-143", "Camión", "Teno", "Camiones", 40_000, day("2026-10-15"),
      340_000, 339_990, 345_000, 350_000, 10, 5_000, "Al día", null,
    ]])
    expect(sheet.columnFormats?.[6]).toBe(EXCEL_DATE_FORMAT)
  })

  it("horas: los rótulos hablan de horas, y lo que el equipo no tiene queda vacío, nunca en cero", () => {
    const sheet = planningSheet([
      planRow({
        unit: "h", plate: "TO-37", code: "TO-37", scheduleName: null, frequency: null, lastDate: null, programmed: null, real: null,
        current: null, next: null, delta: null, remaining: null, base: null,
      }),
    ], "h")
    expect(sheet.worksheetName).toBe("Consolidado por horas")
    expect(sheet.headers).toContain("Horas programadas (A)")
    expect(sheet.headers).toContain("Frecuencia (h)")
    expect(sheet.rows[0]).toEqual(["TO-37", "TO-37", "Camión", "Teno", null, null, null, null, null, null, null, null, null, "Sin dato", null])
  })

  it("la situación sigue el semáforo de la pantalla: vencida, por vencer o al día", () => {
    const situation = (over: Partial<PlanningRow>) => planningSheet([planRow(over)], "km").rows[0]![13]
    expect(situation({ remaining: 0 })).toBe("Vencida")
    expect(situation({ remaining: -1_200 })).toBe("Vencida")
    expect(situation({ remaining: 1_000, base: 10_000 })).toBe("Por vencer")
    expect(situation({ remaining: 5_000, base: 10_000 })).toBe("Al día")
  })

  it("la observación dice lo que la pantalla marca con un lápiz, «Declarada» o un tooltip", () => {
    const observation = (over: Partial<PlanningRow>) => planningSheet([planRow(over)], "km").rows[0]![14]
    expect(observation({ manual: true, manualReason: "Terreno difícil" })).toBe("Intervalo ajustado a mano: Terreno difícil")
    expect(observation({ manual: true, manualReason: null })).toBe("Intervalo ajustado a mano")
    expect(observation({ declared: true, evidence: "Planilla 2026" })).toBe("Preventiva declarada (respaldo: Planilla 2026)")
    expect(observation({ declared: true, evidence: null })).toBe("Preventiva declarada")
    expect(observation({ outOfRange: true })).toBe("La última mantención queda fuera del período elegido")
    expect(observation({ manual: true, manualReason: "x", outOfRange: true })).toBe("Intervalo ajustado a mano: x; La última mantención queda fuera del período elegido")
  })

  it("las notas explican A, B, delta, faltantes y la regla de «próxima»; con un equipo elegido avisan qué tabla lo aplica", () => {
    const base = planningNotes({}).join("\n")
    expect(base).toMatch(/Próxima mantención = punto de la última mantención \+ intervalo base/)
    expect(base).toMatch(/Delta = A − B/)
    expect(base).toMatch(/Faltantes = próxima − actual/)
    expect(base).toMatch(/dato que no existe, no un cero/)
    expect(base).not.toMatch(/equipo elegido/i)
    const cross: ResolvedCrossFilters = { equipment: { id: "v-1", code: "KA-143", plate: "SJFC-66", label: "KA-143 · SJFC-66", worksiteId: "ws-1", worksiteName: "Teno", unit: "km", intervals: [], frequency: null } }
    expect(planningNotes(cross).join("\n")).toMatch(/la tabla de kilómetros no se filtra por el equipo elegido/i)
    // El equipo es de kilómetros: la tabla de horas queda vacía, y la nota dice por qué como la pantalla.
    expect(planningNotes(cross)).toContain("KA-143 se controla por km; no tiene registros por horas.")
  })
})

function work(over: Partial<CorrectiveWorkRow> = {}): CorrectiveWorkRow {
  return {
    id: "ot:1", source: "ot", date: "2026-10-20", vehicleId: "v-1", recordId: null, code: "KA-143", plate: "SJFC-66", typeName: "Camión",
    unit: "km", reading: 345_000, readingText: null, reference: "OT-0001", workPerformed: "Reparación de frenos",
    worksiteId: "ws-1", worksiteName: "Teno", hours: 4, photoId: "p-1", photoUrl: null, ...over,
  }
}

describe("hoja «Correctivos»", () => {
  it("una fila por trabajo con la fecha de Excel, la lectura numérica y las horas como número; la foto no viaja", () => {
    const sheet = correctiveSheet([work()], "km")
    expect(sheet.worksheetName).toBe("Correctivos")
    expect(sheet.headers).toEqual([
      "Fecha", "Fuente", "Referencia", "Código", "Patente", "Tipo de equipo", "Faena", "Odómetro (km)", "Lectura del formulario",
      "Horas hombre", "Trabajo realizado",
    ])
    expect(sheet.rows[0]).toEqual([
      day("2026-10-20"), "Orden de trabajo", "OT-0001", "KA-143", "SJFC-66", "Camión", "Teno", 345_000, null, 4, "Reparación de frenos",
    ])
    expect(sheet.columnFormats?.[0]).toBe(EXCEL_DATE_FORMAT)
    expect(JSON.stringify(sheet.rows)).not.toContain("p-1")
  })

  it("el formulario histórico trae la lectura como texto y puede no tener faena, folio ni horas", () => {
    const row = work({ id: "h:1", source: "historial", reading: null, readingText: "145.000", reference: "", worksiteName: null, hours: null, workPerformed: "" })
    expect(correctiveSheet([row], "h").rows[0]).toEqual([
      day("2026-10-20"), "Historial de formularios", null, "KA-143", "SJFC-66", "Camión", "Sin faena", null, "145.000", null, null,
    ])
    expect(correctiveSheet([row], "h").headers[7]).toBe("Horómetro (h)")
    expect(correctiveSheet([work({ source: "registro" })], "km").rows[0]![1]).toBe("Registro de la plataforma")
  })
})

describe("hojas de conductores y de horas por equipo", () => {
  it("«Conductores»: horas prorrateadas y registros", () => {
    const drivers: DriverRow[] = [{ key: "juan perez", label: "JUAN PEREZ", records: 2, hours: 1.5, workIds: ["h:1"] }]
    const sheet = driversSheet(drivers)
    expect(sheet.worksheetName).toBe("Conductores")
    expect(sheet.headers).toEqual(["Conductor", "Horas (prorrateadas)", "Registros"])
    expect(sheet.rows).toEqual([["JUAN PEREZ", 1.5, 2]])
  })

  it("«Horas y registros»: la serie del gráfico combinado, con todos los equipos que tuvieron trabajos", () => {
    const series: EquipmentSeriesRow[] = [{ vehicleId: "v-1", label: "KA-143 · SJFC-66", records: 3, hours: 7.5 }]
    const sheet = equipmentSeriesSheet(series)
    expect(sheet.worksheetName).toBe("Horas y registros")
    expect(sheet.headers).toEqual(["Equipo", "Horas trabajadas", "Registros"])
    expect(sheet.rows).toEqual([["KA-143 · SJFC-66", 7.5, 3]])
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

  it("por patente: los niveles de pauta van en una celda", () => {
    const rows: ComplianceByPlate[] = [
      { vehicleId: "v-1", code: "KA-143", plate: "SJFC-66", worksiteId: "ws-1", worksiteName: "Teno", percent: 90, checks: 2, levels: ["40.000 KM", "10.000 KM"] },
      { vehicleId: null, code: "KA-X", plate: "", worksiteId: null, worksiteName: null, percent: null, checks: 1, levels: [] },
    ]
    const sheet = complianceByPlateSheet(rows)
    expect(sheet.worksheetName).toBe("Cumplimiento por patente")
    expect(sheet.headers).toEqual(["Patente", "Código", "Faena", "Niveles de pauta", "Cumplimiento (%)", "Pautas"])
    expect(sheet.rows).toEqual([
      ["SJFC-66", "KA-143", "Teno", "40.000 KM · 10.000 KM", 90, 2],
      [null, "KA-X", "Sin faena", null, null, 1],
    ])
  })
})

function check(over: Partial<MatrixCheck> = {}): MatrixCheck {
  return {
    id: "h:p1", source: "historial", date: "2026-10-15", label: "KA-143 · 40.000 KM", code: "KA-143", plate: "SJFC-66", worksiteName: "Teno",
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

  it("sin pautas con detalle, la matriz es una hoja con sus dos encabezados y sin filas", () => {
    const empty: ChecklistMatrix = { checks: [], items: [], withoutDetail: 3 }
    expect(checklistMatrixSheet(empty).headers).toEqual(["Ítem", "Sistema"])
    expect(checklistMatrixSheet(empty).rows).toEqual([])
    expect(matrixChecksSheet(empty).rows).toEqual([])
  })

  it("las notas de lectura traen el corte de fuentes, el prorrateo de conductores, la regla del % y los topes de la matriz", () => {
    const notes = workNotes("km", matrix, 60).join("\n")
    expect(notes).toMatch(/hasta el 30-11-2026/)
    expect(notes).toMatch(/desde el 01-12-2026/)
    expect(notes).toMatch(/equipos por kilómetros/)
    expect(notes).toMatch(/prorrateadas/)
    expect(notes).toMatch(/promedio de los % de cada pauta/)
    expect(notes).toMatch(/dato que no existe, no un cero/)
    expect(notes).toMatch(/hasta 60 pautas/)
    expect(notes).toMatch(/últimas 8/)
    expect(notes).toMatch(/2 de las últimas pautas no traen detalle/)
    expect(workNotes("h", { ...matrix, withoutDetail: 0 }, 60).join("\n")).toMatch(/máquinas por horas/)
    expect(workNotes("h", { ...matrix, withoutDetail: 0 }, 60).join("\n")).not.toMatch(/no traen detalle/)
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
      tab: "camiones", from: "2026-10-01", to: "2026-10-31", requestedFrom: "2026-10-01", requestedTo: "2026-10-31", invalidPeriod: false,
      worksiteIds: [], equipmentIds: [], frequencies: [], page: 1, cross: {}, ...over.filters,
    },
    options,
    cross: over.cross ?? {},
  }
}

const detail = (sheet: ReturnType<typeof filtersSheet>, concept: string) => sheet.rows.filter((row) => row[0] === concept).map((row) => row[1])

describe("hoja «Filtros»", () => {
  it("sin filtros dice todo lo que se ve: pestaña, período, todas las faenas, todos los códigos, todas las frecuencias y ningún filtro cruzado", () => {
    const sheet = filtersSheet({ tab: "camiones", context: context(), notes: [] })
    expect(sheet.worksheetName).toBe("Filtros")
    expect(sheet.headers).toEqual(["Concepto", "Detalle"])
    expect(detail(sheet, "Pestaña")).toEqual(["Camiones (equipos por kilómetros)"])
    expect(detail(sheet, "Período")).toEqual(["01-10-2026 al 31-10-2026"])
    expect(detail(sheet, "Faenas")).toEqual(["Todas las faenas de tu alcance"])
    expect(detail(sheet, "Códigos (equipos)")).toEqual(["Todos"])
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
      tab: "camiones",
      context: context({ filters: { worksiteIds: ["ws-1", "ws-2"], equipmentIds: ["v-1"], frequencies: [40_000] }, cross }),
      notes: [],
    })
    expect(detail(sheet, "Faenas")).toEqual(["Teno, Arauco"])
    expect(detail(sheet, "Códigos (equipos)")).toEqual(["KA-143 · SJFC-66"])
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
    const sheet = filtersSheet({ tab: "camiones", context: context({ cross }), notes: [] })
    expect(detail(sheet, "Filtro cruzado: Equipo")).toEqual([])
  })

  it("una faena que no está en el alcance no se nombra: se dice que no hay datos; el período se corta en hoy", () => {
    const sheet = filtersSheet({
      tab: "maquinas",
      context: context({ filters: { tab: "maquinas", worksiteIds: ["ws-ajena"], requestedTo: "2026-11-30", to: "2026-11-24", from: "2026-11-01", requestedFrom: "2026-11-01" } }),
      notes: [],
    })
    expect(detail(sheet, "Pestaña")).toEqual(["Máquinas (equipos por horas)"])
    expect(detail(sheet, "Faenas")).toEqual(["1 faena fuera de tu alcance: sin datos"])
    expect(JSON.stringify(sheet.rows)).not.toContain("ws-ajena")
    expect(detail(sheet, "Período")).toEqual(["01-11-2026 al 24-11-2026 (se mide hasta hoy; se pidió hasta el 30-11-2026)"])
  })

  it("un rango inválido de la dirección avisa que se usó el período por defecto; las notas van al final, una por fila", () => {
    const sheet = filtersSheet({ tab: "planificacion", context: context({ filters: { tab: "planificacion", invalidPeriod: true } }), notes: ["Primera.", "Segunda."] })
    expect(detail(sheet, "Pestaña")).toEqual(["Planificación"])
    expect(detail(sheet, "Período")[0]).toMatch(/El rango de la dirección no era válido: se usó el período por defecto/)
    expect(sheet.rows.slice(-2)).toEqual([["Nota", "Primera."], ["Nota", "Segunda."]])
  })
})
