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
    notes: "Sin novedad", corrective: null, photos: [], observations: [], voided: null, stampGap: null, history: [], pdfStorageKey: null,
    groups: [
      { name: "Motor", items: [{ key: "k1", name: "Revisión aceite motor", value: "R", reason: null, manufacturerWarning: false }] },
      { name: "Frenos", items: [{ key: "k4", name: "Revisión pastillas", value: "NR", reason: "Falta repuesto", manufacturerWarning: true }] },
    ],
    ...overrides,
  }
}

const sortHref = (key: string) => `/mantencion/registros?orden=${key}`

/** La tabla y las tarjetas conviven en el DOM (una se oculta por CSS): cada prueba mira la que le toca. */
const table = () => within(screen.getByRole("region", { name: "Registros de mantención" }))
const cards = () => within(screen.getByRole("list", { name: "Registros de mantención como tarjetas" }))

describe("lista de registros", () => {
  afterEach(cleanup)

  it("cada folio lleva al detalle con la lista de la que se viene, y los encabezados ordenables son enlaces con aria-sort", () => {
    render(<RecordsTable rows={[row()]} sort="fecha" dir="desc" sortHref={sortHref} listQuery="revision=pendiente" />)
    expect(table().getByRole("link", { name: "Ver el registro MP-BIO-0001" }).getAttribute("href")).toBe("/mantencion/registros/rec-1?lista=revision%3Dpendiente")
    expect(screen.getByRole("columnheader", { name: /^Fecha/ }).getAttribute("aria-sort")).toBe("descending")
    expect(screen.getByRole("columnheader", { name: /^Folio/ }).getAttribute("aria-sort")).toBe("none")
    expect(screen.getByRole("link", { name: /^Folio/ }).getAttribute("href")).toBe("/mantencion/registros?orden=folio")
  })

  it("la lista sin filtros también viaja: el detalle sabe que se llegó desde ella", () => {
    render(<RecordsTable rows={[row()]} sort="fecha" dir="desc" sortHref={sortHref} listQuery="" />)
    expect(table().getByRole("link", { name: "Ver el registro MP-BIO-0001" }).getAttribute("href")).toBe("/mantencion/registros/rec-1?lista=")
  })

  it("el estado es una línea principal y, como mucho, una secundaria: ítems no realizados, taller, anulado", () => {
    render(<RecordsTable
      sort="fecha" dir="desc" sortHref={sortHref} listQuery=""
      rows={[
        row({ id: "a", folio: "MP-A", notDoneCount: 2 }),
        row({ id: "b", folio: "MC-B", kind: "C", intervalValue: null, workshop: { daysStopped: 4, stale: true } }),
        row({ id: "c", folio: "MP-C", status: "anulado" }),
        row({ id: "d", folio: "MP-D", review: "revisado" }),
      ]}
    />)
    const t = table()
    expect(t.getByText("2 ítems no realizados")).toBeTruthy()
    // Taller: lo principal es «En taller · 4 días»; «Sin actualizar» va aparte, en la secundaria.
    expect(t.getByText("En taller · 4 días")).toBeTruthy()
    expect(t.getByText("Sin actualizar")).toBeTruthy()
    expect(t.getByText("No cuenta en los cálculos")).toBeTruthy()
    expect(t.getByText("Anulado")).toBeTruthy()
    // «Completa» + «Revisado»: el resultado y la revisión no se mezclan en una misma línea.
    expect(t.getByText("Revisado").textContent).toBe("Revisado")
  })

  it("«Sin actualizar» y «Observado» van en tono de señal, nunca en rojo", () => {
    render(<RecordsTable
      sort="fecha" dir="desc" sortHref={sortHref} listQuery=""
      rows={[row({ id: "b", folio: "MC-B", kind: "C", intervalValue: null, review: "observado", workshop: { daysStopped: 3, stale: true } })]}
    />)
    const t = table()
    for (const label of ["Sin actualizar", "Observado", "En taller · 3 días"]) {
      expect(t.getByText(label).className).toContain("--color-signal-ink")
      expect(t.getByText(label).className).not.toContain("--color-danger")
    }
  })

  it("la revisión pendiente no se pinta: es lo normal y las pestañas ya cuentan lo que falta", () => {
    render(<RecordsTable rows={[row({ review: "pendiente" })]} sort="fecha" dir="desc" sortHref={sortHref} listQuery="" />)
    expect(table().queryByText("Pendiente")).toBeNull()
  })

  it("registrado por otro mecánico dice «en nombre de» y las alertas van en una línea de texto, no en chips", () => {
    render(<RecordsTable
      sort="fecha" dir="desc" sortHref={sortHref} listQuery=""
      rows={[row({
        executorKind: "otro_mecanico", executorName: "Javier Roa", registeredByName: "Deivis González",
        alerts: { jump: true, outOfWorksite: true, manualSchedule: true, duplicate: true },
      })]}
    />)
    const t = table()
    expect(t.getByText("Registrado por Deivis González en nombre de Javier Roa")).toBeTruthy()
    expect(t.getByText("Alertas: salto de lectura, fuera de faena, pauta a mano y duplicado")).toBeTruthy()
  })

  it("un equipo sin patente muestra sólo el código", () => {
    render(<RecordsTable rows={[row({ equipment: { ...equipment, plate: "MQ-01", code: "MQ-01", noPlate: true } })]} sort="fecha" dir="desc" sortHref={sortHref} listQuery="" />)
    expect(table().getByText("MQ-01").textContent).toBe("MQ-01")
    expect(table().queryByText(/·\s*MQ-01/)).toBeNull()
  })

  it("bajo md la misma lista son tarjetas, con una acción «Ver el registro» y el estado dicho igual", () => {
    render(<RecordsTable
      sort="fecha" dir="desc" sortHref={sortHref} listQuery="revision=pendiente"
      rows={[row({ id: "a", folio: "MP-A", notDoneCount: 2 }), row({ id: "b", folio: "MC-B", kind: "C", intervalValue: null, workshop: { daysStopped: 4, stale: true } })]}
    />)
    const c = cards()
    expect(c.getAllByRole("listitem")).toHaveLength(2)
    expect(c.getByRole("link", { name: "Ver el registro MP-A" }).getAttribute("href")).toBe("/mantencion/registros/a?lista=revision%3Dpendiente")
    expect(c.getByRole("link", { name: "Ver el registro MP-A" }).textContent).toBe("Ver el registro")
    expect(c.getByText("2 ítems no realizados")).toBeTruthy()
    expect(c.getByText("En taller · 4 días")).toBeTruthy()
    expect(c.getByText("Sin actualizar")).toBeTruthy()
  })
})

describe("detalle de un registro", () => {
  afterEach(cleanup)

  it("datos del registro: lectura anterior y pauta usada, que dice si se eligió a mano (el motivo lo da la alerta)", () => {
    render(<RecordDataSection detail={detail({
      schedule: { name: "Camiones y tractos", version: 2, intervalValue: 20_000, suggestedIntervalValue: 40_000, manualReason: "Pedido de la jefatura" },
      executorKind: "otro_mecanico", registeredByName: "Deivis González",
    })} />)
    expect(screen.getByText("Lectura anterior").nextSibling?.textContent).toContain("20.100 km")
    expect(screen.getByText(/elegida a mano \(la sugerida era la de 40\.000 km\)/)).toBeTruthy()
    // El motivo vive en la alerta, no en dos lugares (regla A5).
    expect(screen.queryByText(/Motivo:/)).toBeNull()
    expect(screen.getByText("Registrado por Deivis González en nombre de Javier Roa")).toBeTruthy()
  })

  it("resultado por sistema: cuenta, no realizado con motivo y aviso del fabricante", () => {
    render(<PreventiveSection detail={detail()} />)
    expect(screen.getByText(/1 realizados · 1 no realizados · 0 no aplica/)).toBeTruthy()
    expect(screen.getByText(/Revisión pastillas — Falta repuesto/)).toBeTruthy()
    expect(screen.getByText(/Confirmar con la pauta del fabricante: Revisión pastillas/)).toBeTruthy()
  })

  it("las alertas son una lista con nombre: dicen qué pasó, qué hacer y enlazan al duplicado y a la foto", () => {
    render(<RecordAlerts detail={detail({
      readingJumpAlert: true, duplicateOf: { id: "rec-0", folio: "MP-BIO-0000" },
      photos: [{ id: "ph-9", kind: "sticker", stampedAt: "2026-07-22T11:38:00.000Z", receivedAt: "2026-10-27T15:01:00.000Z", width: 800, height: 600 }],
      stampGap: { hours: 2400, subject: "foto", photoId: "ph-9", at: "2026-07-22T11:38:00.000Z" },
    })} />)
    const list = screen.getByRole("list", { name: "Alertas del registro" })
    expect(within(list).getByText("Salto de lectura")).toBeTruthy()
    expect(within(list).getByRole("link", { name: "Ver MP-BIO-0000" }).getAttribute("href")).toBe("/mantencion/registros/rec-0")
    // La explicación y la acción están a la vista, no en un `title`.
    expect(within(list).getByText(/«Sticker de mantención» es del 22-07-2026/)).toBeTruthy()
    expect(within(list).getByText("Pide una foto nueva o confirma con el mecánico.")).toBeTruthy()
    expect(within(list).getByRole("link", { name: "Ver la foto" }).getAttribute("href")).toBe("#foto-ph-9")
    expect(list.querySelector("[title]")).toBeNull()
  })

  it("el aviso cuenta las alertas y no usa mayúsculas sostenidas (cabe en 390 px)", () => {
    render(<RecordAlerts detail={detail({ readingJumpAlert: true, outOfWorksite: true })} />)
    expect(screen.getByText("Este registro tiene 2 alertas")).toBeTruthy()
    expect(screen.getByRole("list", { name: "Alertas del registro" }).innerHTML).not.toContain("uppercase")
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
        workOrder: null, workshopReason: "Espera repuesto importado",
        jobs: [
          { id: "j1", workTypeName: "Mecánico", hours: 2, noParts: false, parts: [{ quantity: 2, description: "Manguera 1/2" }] },
          { id: "j2", workTypeName: "Soldadura", hours: 1.5, noParts: true, parts: [] },
        ],
        drivers: ["AEDO POLANCO JOSE A."],
        workshop: { inWorkshop: true, stale: true, lastActivityDate: "2026-10-24", exitDate: null, daysStopped: 4 },
        updates: [{ id: "u1", kind: "sigue", note: "Esperando repuesto", exitDate: null, userName: "Pedro", createdAt: "2026-10-25T12:00:00.000Z" }],
      },
    })} />)
    expect(screen.getByText("Mecánico")).toBeTruthy()
    expect(screen.getByText("Soldadura")).toBeTruthy()
    expect(screen.getByText("2 h")).toBeTruthy()
    expect(screen.getByText("1,5 h")).toBeTruthy()
    expect(screen.getByText("No se usaron repuestos.")).toBeTruthy()
    expect(screen.getByText("Espera repuesto importado")).toBeTruthy()
    expect(screen.getByText("No se cambió aceite")).toBeTruthy()
    expect(screen.getByText("3,5 h")).toBeTruthy()
    expect(screen.getByText("Manguera 1/2")).toBeTruthy()
    // Etiqueta y valor calzan: «Salida de taller» → «Aún en taller».
    expect(screen.getByText("Salida de taller")).toBeTruthy()
    expect(screen.getByText("Aún en taller")).toBeTruthy()
    expect(screen.getByText("Sin actualizar hace más de 2 días.")).toBeTruthy()
    expect(screen.getByText(/Esperando repuesto/)).toBeTruthy()
    expect(screen.getByText("AEDO POLANCO JOSE A.")).toBeTruthy()
  })

  it("el snapshot del equipo no cambia aunque la ficha cambie: lo muestra tal cual se firmó", () => {
    render(<EquipmentSection detail={detail()} />)
    expect(screen.getByText("Scania R450")).toBeTruthy()
    expect(screen.getByText(/editar la ficha después no cambia este registro/)).toBeTruthy()
  })

  it("la sección de texto libre del mecánico se llama «Notas del mecánico»", () => {
    render(<PreventiveSection detail={detail()} />)
    expect(screen.getByRole("heading", { name: "Notas del mecánico" })).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Observaciones del mecánico" })).toBeNull()
  })

  it("columna lateral: firma del mecánico sin texto de hoja de ruta, observaciones con respuesta e historial", () => {
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
    expect(screen.getByRole("heading", { name: "Firma del mecánico" })).toBeTruthy()
    expect(screen.queryByText(/segunda etapa/)).toBeNull()
    expect(screen.getByText("Ya la subí")).toBeTruthy()
    expect(screen.getByText("Aún sin respuesta del mecánico.")).toBeTruthy()
    expect(screen.getByRole("link", { name: /Preventiva 20\.000 km/ }).getAttribute("href")).toBe("/mantencion/registros/rec-0")
  })
})
