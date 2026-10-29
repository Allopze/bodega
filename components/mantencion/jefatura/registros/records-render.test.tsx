// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { RecordDetail } from "@/lib/services/mantencion/records-detail"
import type { RecordListRow } from "@/lib/services/mantencion/records-query"
import { RecordAside } from "./record-aside"
import { CorrectiveSections, EquipmentSection, PreventiveSection, RecordAlerts, RecordDataSection } from "./record-sections"
import { RecordsTable } from "./records-table"

const equipment = { code: "KA-135", plate: "RBYD-98", noPlate: false, type: "Camión", brand: "Scania", model: "R450", year: 2021, worksite: "Biodiversa", unit: "km" as const }

function row(overrides: Partial<RecordListRow> = {}): RecordListRow {
  return {
    id: "rec-1", folio: "MP-BIO-0001", kind: "P", vehicleId: "veh-1", equipment, worksiteName: "Biodiversa", reading: 40_312, unit: "km",
    workDate: "2026-10-27", signedAt: "2026-10-27T15:00:00.000Z", receivedAt: "2026-10-27T15:01:00.000Z", status: "vigente", review: "pendiente",
    intervalValue: 40_000, executorKind: "yo", executorName: "Javier Roa", registeredById: "u-1", registeredByName: "Javier Roa", notDoneCount: 0,
    alerts: { jump: false, outOfWorksite: false, manualSchedule: false, duplicate: false }, workshop: null, ...overrides,
  }
}

function detail(overrides: Partial<RecordDetail> = {}): RecordDetail {
  return {
    id: "rec-1", folio: "MP-BIO-0001", kind: "P", status: "vigente", review: "pendiente", equipment, vehicleId: "veh-1", worksiteId: "ws-1", worksiteName: "Biodiversa",
    outOfWorksite: false, reading: 40_312, unit: "km", workDate: "2026-10-27", previousReading: { value: 20_100, date: "2026-09-12", source: "MP-BIO-0000" },
    signedAt: "2026-10-27T15:00:00.000Z", receivedAt: "2026-10-27T15:01:00.000Z", offlineSince: null, registeredById: "u-1", registeredByName: "Javier Roa",
    executorKind: "yo", executorName: "Javier Roa", readingJumpAlert: false, readingJumpConfirmed: false, duplicateConfirmed: false, duplicateOf: null,
    correctsRecord: null, correctedBy: null,
    schedule: { name: "Camiones y tractos", version: 2, intervalValue: 40_000, suggestedIntervalValue: 40_000, manualReason: null },
    notes: "Sin novedad", corrective: null, photos: [], observations: [], voided: null, stampGapHours: null, history: [], pdfStorageKey: null,
    groups: [
      { name: "Motor", items: [{ key: "k1", name: "Revisión aceite motor", value: "R", reason: null, manufacturerWarning: false }] },
      { name: "Frenos", items: [{ key: "k4", name: "Revisión pastillas", value: "NR", reason: "Falta repuesto", manufacturerWarning: true }] },
    ],
    ...overrides,
  }
}

const sortHref = (key: string) => `/mantencion/registros?orden=${key}`

describe("tabla de registros", () => {
  afterEach(cleanup)

  it("cada folio lleva al detalle y los encabezados ordenables son enlaces con aria-sort", () => {
    render(<RecordsTable rows={[row()]} sort="fecha" dir="desc" sortHref={sortHref} />)
    expect(screen.getByRole("link", { name: "Ver el registro MP-BIO-0001" }).getAttribute("href")).toBe("/mantencion/registros/rec-1")
    expect(screen.getByRole("columnheader", { name: /^Fecha/ }).getAttribute("aria-sort")).toBe("descending")
    expect(screen.getByRole("columnheader", { name: /^Folio/ }).getAttribute("aria-sort")).toBe("none")
    expect(screen.getByRole("link", { name: /^Folio/ }).getAttribute("href")).toBe("/mantencion/registros?orden=folio")
  })

  it("el estado dice qué pasó con palabras: ítems no realizados, taller, anulado", () => {
    render(<RecordsTable
      sort="fecha" dir="desc" sortHref={sortHref}
      rows={[
        row({ id: "a", folio: "MP-A", notDoneCount: 2 }),
        row({ id: "b", folio: "MC-B", kind: "C", intervalValue: null, workshop: { daysStopped: 4, stale: true } }),
        row({ id: "c", folio: "MP-C", status: "anulado" }),
      ]}
    />)
    expect(screen.getByText("2 ítems no realizados")).toBeTruthy()
    expect(screen.getByText(/En taller · 4 días · sin actualizar/)).toBeTruthy()
    expect(screen.getByText("No cuenta en los cálculos")).toBeTruthy()
    expect(screen.getByText("Anulado")).toBeTruthy()
  })

  it("registrado por otro mecánico dice «en nombre de» y las alertas van como etiquetas", () => {
    render(<RecordsTable
      sort="fecha" dir="desc" sortHref={sortHref}
      rows={[row({
        executorKind: "otro_mecanico", executorName: "Javier Roa", registeredByName: "Deivis González",
        alerts: { jump: true, outOfWorksite: true, manualSchedule: true, duplicate: true },
      })]}
    />)
    expect(screen.getByText("Registrado por Deivis González en nombre de Javier Roa")).toBeTruthy()
    for (const label of ["Salto de lectura", "Fuera de faena", "Pauta a mano", "Duplicado"]) expect(screen.getByText(label)).toBeTruthy()
  })

  it("un equipo sin patente muestra sólo el código", () => {
    render(<RecordsTable rows={[row({ equipment: { ...equipment, plate: "MQ-01", code: "MQ-01", noPlate: true } })]} sort="fecha" dir="desc" sortHref={sortHref} />)
    expect(screen.getByText("MQ-01").textContent).toBe("MQ-01")
    expect(screen.queryByText(/·\s*MQ-01/)).toBeNull()
  })
})

describe("detalle de un registro", () => {
  afterEach(cleanup)

  it("datos del registro: lectura anterior, pauta usada y «elegida a mano» con su motivo", () => {
    render(<RecordDataSection detail={detail({
      schedule: { name: "Camiones y tractos", version: 2, intervalValue: 20_000, suggestedIntervalValue: 40_000, manualReason: "Pedido de la jefatura" },
      executorKind: "otro_mecanico", registeredByName: "Deivis González",
    })} />)
    expect(screen.getByText("Lectura anterior").nextSibling?.textContent).toContain("20.100 km")
    expect(screen.getByText("Elegida a mano")).toBeTruthy()
    expect(screen.getByText(/Motivo: Pedido de la jefatura/)).toBeTruthy()
    expect(screen.getByText("Registrado por Deivis González en nombre de Javier Roa")).toBeTruthy()
  })

  it("resultado por sistema: cuenta, no realizado con motivo y aviso del fabricante", () => {
    render(<PreventiveSection detail={detail()} />)
    expect(screen.getByText(/1 realizados · 1 no realizados · 0 no aplica/)).toBeTruthy()
    expect(screen.getByText(/Revisión pastillas — Falta repuesto/)).toBeTruthy()
    expect(screen.getByText(/Confirmar con la pauta del fabricante: Revisión pastillas/)).toBeTruthy()
  })

  it("las alertas son una lista con nombre, con el enlace al duplicado", () => {
    render(<RecordAlerts detail={detail({ readingJumpAlert: true, duplicateOf: { id: "rec-0", folio: "MP-BIO-0000" }, stampGapHours: 120 })} />)
    const list = screen.getByRole("list", { name: "Alertas del registro" })
    expect(within(list).getByText("Salto de lectura")).toBeTruthy()
    expect(within(list).getByRole("link", { name: /ver MP-BIO-0000/ }).getAttribute("href")).toBe("/mantencion/registros/rec-0")
    expect(within(list).getByText(/difieren más de 72 h/)).toBeTruthy()
  })

  it("sin alertas no dibuja la lista", () => {
    render(<RecordAlerts detail={detail()} />)
    expect(screen.queryByRole("list", { name: "Alertas del registro" })).toBeNull()
  })

  it("correctiva: trabajo, aceite, repuestos, taller con su novedad y conductores", () => {
    render(<CorrectiveSections detail={detail({
      kind: "C", schedule: null, groups: [],
      corrective: {
        workTypes: ["Mecánico", "Soldadura"], oils: [], description: "Cambio de manguera", hours: 3.5, inWorkshop: true, workshopEntryDate: "2026-10-24",
        workOrder: null, noParts: false, parts: [{ quantity: 2, description: "Manguera 1/2" }], drivers: ["AEDO POLANCO JOSE A."],
        workshop: { inWorkshop: true, stale: true, lastActivityDate: "2026-10-24", exitDate: null, daysStopped: 4 },
        updates: [{ id: "u1", kind: "sigue", note: "Esperando repuesto", exitDate: null, userName: "Pedro", createdAt: "2026-10-25T12:00:00.000Z" }],
      },
    })} />)
    expect(screen.getByText("Mecánico, Soldadura")).toBeTruthy()
    expect(screen.getByText("No se cambió aceite")).toBeTruthy()
    expect(screen.getByText("3,5 h")).toBeTruthy()
    expect(screen.getByText("Manguera 1/2")).toBeTruthy()
    expect(screen.getByText("Sigue en taller")).toBeTruthy()
    expect(screen.getByText("Sin actualizar hace más de 2 días.")).toBeTruthy()
    expect(screen.getByText(/Esperando repuesto/)).toBeTruthy()
    expect(screen.getByText("AEDO POLANCO JOSE A.")).toBeTruthy()
  })

  it("el snapshot del equipo no cambia aunque la ficha cambie: lo muestra tal cual se firmó", () => {
    render(<EquipmentSection detail={detail()} />)
    expect(screen.getByText("Scania R450")).toBeTruthy()
    expect(screen.getByText(/editar la ficha después no cambia este registro/)).toBeTruthy()
  })

  it("columna lateral: firma de jefatura en segunda etapa, observaciones con respuesta e historial", () => {
    render(<RecordAside
      photos={<p>Galería</p>}
      detail={detail({
        observations: [
          { id: "o1", text: "Falta foto", userName: "Alexis Morales", createdAt: "2026-10-27T16:00:00.000Z", response: "Ya la subí", respondedByName: "Javier Roa", respondedAt: "2026-10-27T17:00:00.000Z" },
          { id: "o2", text: "Revisar lectura", userName: "Alexis Morales", createdAt: "2026-10-27T18:00:00.000Z", response: null, respondedByName: null, respondedAt: null },
        ],
        history: [{ id: "rec-0", folio: "MP-BIO-0000", kind: "P", workDate: "2026-09-12", reading: 20_100, unit: "km", intervalValue: 20_000 }],
      })}
    />)
    expect(screen.getByText("Jefatura · segunda etapa")).toBeTruthy()
    expect(screen.getByText("Ya la subí")).toBeTruthy()
    expect(screen.getByText("Aún sin respuesta del mecánico.")).toBeTruthy()
    expect(screen.getByRole("link", { name: /Preventiva 20\.000 km/ }).getAttribute("href")).toBe("/mantencion/registros/rec-0")
  })
})
