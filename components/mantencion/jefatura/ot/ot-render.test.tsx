// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { WorkOrderTab } from "@/lib/services/mantencion/work-orders/query"
import { otDetail, otRow } from "./ot-fixtures"
import { OT_FILTER_PARAMS, buildOtTabs, hasWorkOrderFilters, parseWorkOrderQuery } from "./ot-filters"
import { OtAside } from "./ot-aside"
import {
  OtEntrySection, OtExitSection, OtFaenaReceptionSection, OtHeaderSection, OtItemsSection, OtReceptionSection, OtRejectionNotice, OtRepairSection,
  OtVoidedNotice,
} from "./ot-sections"
import { OtTable } from "./ot-table"
import { OT_STATUSES, OT_STATUS_LABELS } from "@/lib/mantencion/work-order-states"
import { OT_STATE_META } from "./ot-labels"

afterEach(cleanup)

const cards = () => within(screen.getByRole("list", { name: "Órdenes de trabajo como tarjetas" }))
const table = () => within(screen.getByRole("region", { name: "Órdenes de trabajo" }))

describe("filtros y pestañas de la lista", () => {
  it("sin parámetros rige «Abiertas», página 1 y sin filtros", () => {
    const filters = parseWorkOrderQuery({})
    expect(filters).toMatchObject({ tab: "abiertas", page: 1, pageSize: 25 })
    expect(hasWorkOrderFilters(filters)).toBe(false)
  })

  it("lee estado, faena, equipo, mecánico, período, búsqueda y página de la URL", () => {
    const filters = parseWorkOrderQuery({ estado: "en_ejecucion", faena: "ws-1", equipo: "veh-1", mecanico: "u-1", desde: "2026-10-01", hasta: "2026-10-31", q: " KA-135 ", pagina: "3" })
    expect(filters).toMatchObject({ tab: "en_ejecucion", worksiteId: "ws-1", vehicleId: "veh-1", assignedToUserId: "u-1", from: "2026-10-01", to: "2026-10-31", q: "KA-135", page: 3 })
    expect(hasWorkOrderFilters(filters)).toBe(true)
  })

  it("ignora un estado desconocido, fechas mal formadas y páginas inválidas", () => {
    const filters = parseWorkOrderQuery({ estado: "SUBMITTED", desde: "ayer", hasta: "2026-13", pagina: "-2" })
    expect(filters).toMatchObject({ tab: "abiertas", page: 1 })
    expect(filters.from).toBeUndefined()
    expect(filters.to).toBeUndefined()
  })

  it("el estado no es un filtro: limpiar filtros no cambia de pestaña (A5)", () => {
    expect(OT_FILTER_PARAMS).not.toContain("estado")
    expect(hasWorkOrderFilters(parseWorkOrderQuery({ estado: "cerrada" }))).toBe(false)
  })

  it("ocho pestañas con su contador; «Abiertas» es la predeterminada y no lleva parámetro", () => {
    const counts: Record<WorkOrderTab, number> = { abiertas: 9, solicitada: 2, asignada: 1, en_ejecucion: 4, trabajo_terminado: 1, recepcionada: 1, cerrada: 30, anulada: 0 }
    const tabs = buildOtTabs(counts)
    expect(tabs.map((tab) => tab.label)).toEqual(["Abiertas", "Por asignar", "Asignadas", "En taller", "Por recibir", "Por conformidad", "Cerradas", "Anuladas"])
    expect(tabs.map((tab) => tab.count)).toEqual([9, 2, 1, 4, 1, 1, 30, 0])
    expect(tabs[0]!.value).toBe("")
    expect(tabs[3]!.value).toBe("en_ejecucion")
  })

  it("las etiquetas de estado salen de la máquina de estados: ninguno se muestra crudo", () => {
    for (const status of OT_STATUSES) expect(OT_STATE_META[status].label).toBe(OT_STATUS_LABELS[status])
  })
})

describe("tabla de la lista", () => {
  it("el folio lleva al detalle y el estado es un badge con etiqueta en español", () => {
    render(<OtTable rows={[otRow()]} />)
    expect(table().getByRole("link", { name: "Ver la OT OT-BIO-0001" }).getAttribute("href")).toBe("/mantencion/ot/ot-1")
    expect(table().getByText("En taller")).toBeTruthy()
    expect(screen.queryByText("en_ejecucion")).toBeNull()
  })

  it("muestra tipo, mecánico y días en taller; sin mecánico dice «Sin asignar»", () => {
    render(<OtTable rows={[otRow(), otRow({ id: "ot-2", folio: "OT-BIO-0002", status: "solicitada", assignedToName: null, assignedToUserId: null, repair: false, maintenance: true, workshopEntryAt: null, daysInWorkshop: null, estimatedDeliveryDate: null })]} />)
    const t = table()
    expect(t.getByText("Reparación")).toBeTruthy()
    expect(t.getByText("Mantención")).toBeTruthy()
    expect(t.getByText("Javier Roa")).toBeTruthy()
    expect(t.getByText("Sin asignar")).toBeTruthy()
    expect(t.getByText("2 días")).toBeTruthy()
  })

  it("una entrega estimada vencida se marca con texto «Vencida», no sólo con color", () => {
    render(<OtTable rows={[otRow({ estimateOverdue: true, estimatedDeliveryDate: "2026-10-28" }), otRow({ id: "ot-2", folio: "OT-BIO-0002" })]} />)
    const overdue = table().getAllByText("Vencida")
    expect(overdue).toHaveLength(1)
    expect(overdue[0]!.closest("[data-overdue]")?.textContent).toContain("28-10-2026")
    expect(table().getByText("05-11-2026").closest("[data-overdue]")).toBeNull()
  })

  it("una OT devuelta lo dice en la celda de estado", () => {
    render(<OtTable rows={[otRow({ rejectionCount: 2 })]} />)
    expect(table().getByText("Devuelta 2 veces")).toBeTruthy()
  })

  it("también hay tarjetas para móvil con una acción de 44 px", () => {
    render(<OtTable rows={[otRow()]} />)
    expect(cards().getByRole("link", { name: "Ver la OT OT-BIO-0001" }).getAttribute("href")).toBe("/mantencion/ot/ot-1")
  })
})

describe("secciones del detalle, en el orden del talonario", () => {
  it("cabecera: folio, equipo, REPARACIÓN / MANTENCIÓN marcadas, fecha, solicitante y mecánico", () => {
    render(<OtHeaderSection detail={otDetail({ repair: true, maintenance: false })} />)
    const group = screen.getByRole("group", { name: "Tipo de trabajo" })
    expect(group.textContent).toContain("Reparación: marcada")
    expect(group.textContent).toContain("Mantención: sin marcar")
    expect(screen.getByText("OT-BIO-0001")).toBeTruthy()
    expect(screen.getByText("KA-135 · RBYD-98")).toBeTruthy()
    expect(screen.getByText("30-10-2026")).toBeTruthy()
    expect(screen.getAllByText("Ana Pérez", { selector: "dd" })).toHaveLength(2) // solicitante y creada por
    expect(screen.getByText(/Javier Roa · desde/)).toBeTruthy()
  })

  it("la descripción de la reparación sólo aparece si se marcó REPARACIÓN", () => {
    const { rerender } = render(<OtRepairSection detail={otDetail()} />)
    expect(screen.getByText(/Pierde aceite/)).toBeTruthy()
    rerender(<OtRepairSection detail={otDetail({ repair: false, maintenance: true })} />)
    expect(screen.queryByText(/Pierde aceite/)).toBeNull()
  })

  it("trabajos anexos y mantenciones: líneas numeradas con SÍ / NO / Pendiente, nota y origen en taller", () => {
    render(
      <>
        <OtItemsSection detail={otDetail()} kind="anexo" />
        <OtItemsSection detail={otDetail()} kind="mantencion" />
      </>,
    )
    const anexos = within(screen.getByRole("region", { name: "Trabajos anexos (reparación)" }))
    expect(anexos.getByText("SÍ")).toBeTruthy()
    expect(anexos.getByText("Pendiente")).toBeTruthy()
    expect(anexos.getByText("Agregado en el taller")).toBeTruthy()
    const mantenciones = within(screen.getByRole("region", { name: "Mantenciones solicitadas o asignadas en taller" }))
    expect(mantenciones.getByText("NO")).toBeTruthy()
    expect(mantenciones.getByText("Falta el filtro")).toBeTruthy()
  })

  it("los pasos que aún no ocurren se dicen en texto, no con un hueco", () => {
    render(
      <>
        <OtEntrySection detail={otDetail({ entry: null })} />
        <OtExitSection detail={otDetail()} />
        <OtReceptionSection detail={otDetail()} />
        <OtFaenaReceptionSection detail={otDetail()} />
      </>,
    )
    expect(screen.getByText(/aún no ingresa al taller/)).toBeTruthy()
    expect(screen.getByText("El equipo aún no sale del taller.")).toBeTruthy()
    expect(screen.getByText("Aún no se registra la recepción.")).toBeTruthy()
    expect(screen.getByText("Aún sin conformidad en faena.")).toBeTruthy()
  })

  it("ingreso, salida, recepción y recepción en faena muestran fecha, hora y «Sr.»", () => {
    const detail = otDetail({
      exit: { exitAt: "2026-11-03T14:30:00.000Z", finishedByName: "Javier Roa" },
      reception: { receivedAt: "2026-11-03T18:00:00.000Z", receiverName: "Marco Vera", recordedByName: "Alexis Soto", recordedAt: "2026-11-03T18:05:00.000Z" },
      faenaReception: { receivedAt: "2026-11-04T13:00:00.000Z", receiverName: "Ana Pérez", recordedByName: "Ana Pérez", closedAt: "2026-11-04T13:01:00.000Z" },
    })
    render(
      <>
        <OtEntrySection detail={detail} />
        <OtExitSection detail={detail} />
        <OtReceptionSection detail={detail} />
        <OtFaenaReceptionSection detail={detail} />
      </>,
    )
    expect(screen.getByText("Luis Mena")).toBeTruthy()
    expect(screen.getByText(/Taller Los Aromos \(externo\)/)).toBeTruthy()
    expect(screen.getByText("120.500")).toBeTruthy()
    expect(screen.getByText("Marco Vera")).toBeTruthy()
    expect(screen.getAllByText("Ana Pérez").length).toBeGreaterThan(0)
  })

  it("una OT anulada se marca con su motivo; una devuelta muestra el último motivo de rechazo", () => {
    const { rerender } = render(<OtVoidedNotice detail={otDetail({ status: "anulada", voided: { at: "2026-11-02T10:00:00.000Z", byName: "Alexis Soto", reason: "Equipo equivocado" } })} />)
    expect(screen.getByText("Esta orden está anulada")).toBeTruthy()
    expect(screen.getByText("Motivo: Equipo equivocado")).toBeTruthy()
    rerender(<OtRejectionNotice detail={otDetail({ rejectionCount: 1 })} />)
    expect(screen.getByText("Esta orden fue devuelta una vez")).toBeTruthy()
    expect(screen.getByText("Motivo: Sigue la fuga de aceite")).toBeTruthy()
    rerender(<OtRejectionNotice detail={otDetail({ rejectionCount: 1, status: "cerrada" })} />)
    expect(screen.queryByText(/devuelta/)).toBeNull()
  })
})

describe("columna lateral", () => {
  it("el historial va de lo más reciente a lo más antiguo y deja ver el motivo de un rechazo", () => {
    render(<OtAside detail={otDetail()} />)
    const history = within(screen.getByRole("list", { name: "Historial de la orden de trabajo" }))
    const items = history.getAllByRole("listitem").map((item) => item.textContent ?? "")
    expect(items[0]).toContain("Rechazada")
    expect(items[0]).toContain("Sigue la fuga de aceite")
    expect(items.at(-1)).toContain("OT solicitada")
    // El cambio de fecha dice de qué a qué.
    expect(history.getByText("03-11-2026 → 05-11-2026")).toBeTruthy()
  })

  it("enlaza el registro sólo cuando se puede abrir", () => {
    render(<OtAside detail={otDetail()} />)
    expect(screen.getByRole("link", { name: "MC-BIO-0007" }).getAttribute("href")).toBe("/mantencion/registros/rec-1")
    expect(screen.queryByRole("link", { name: "MC-SAN-0002" })).toBeNull()
    expect(screen.getByText(/sin acceso para abrirlo/)).toBeTruthy()
  })

  it("un hallazgo de inspección enlaza a la inspección y a la CAPA", () => {
    render(<OtAside detail={otDetail({ inspectionFinding: { id: "f1", runId: "run-9", capaActionId: "capa-3" } })} />)
    expect(screen.getByRole("link", { name: "Ver la inspección de origen" }).getAttribute("href")).toBe("/prevencion/inspecciones/run-9")
    expect(screen.getByRole("link", { name: "Ver la acción correctiva (CAPA)" }).getAttribute("href")).toBe("/prevencion/capa/capa-3")
  })
})
