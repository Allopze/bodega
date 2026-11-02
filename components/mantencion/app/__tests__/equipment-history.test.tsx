// @vitest-environment jsdom
import "fake-indexeddb/auto"
import type { ReactNode } from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UUID, account, equipment, freshDb, storedCatalog, workOrder } from "@/lib/mantencion/client/__tests__/fixtures"
import { buildRows } from "@/lib/mantencion/client/fleet-view"
import { buildOtViews } from "@/lib/mantencion/client/ot-model"
import type { RecentRow } from "@/lib/mantencion/client/home-model"
import type { AppHistoryRecord } from "@/lib/mantencion/contracts"
import { AppActionsProvider, AppDataProvider, type AppData } from "../app-context"
import { EquipmentHistorySheet } from "../equipment-history-sheet"
import { HistorySearchSheet } from "../history-search-sheet"
import { RecentSection } from "../home-lists"
import { OtSheet } from "../ot-sheet"
import { RecordDetailSheet } from "../record-detail-sheet"
import { useFleetHistory, useHistoryPhoto, type FleetHistoryState, type PhotoState } from "../use-history"

vi.mock("../use-history", () => ({ useFleetHistory: vi.fn(), useHistoryPhoto: vi.fn() }))

const history = vi.mocked(useFleetHistory)
const photo = vi.mocked(useHistoryPhoto)

const PREVENTIVE: AppHistoryRecord = {
  id: "rec-p", folio: "MP-BIO-0031", kind: "P", vehicleId: "veh-1", worksiteName: "Biodiversa", workDate: "2026-09-12",
  reading: 20_150, unit: "km", executorKind: "otro_mecanico", executorName: "Luis Campos", workOrderFolio: "OT-BIO-0004",
  notes: "Se cambió el filtro de aire", schedule: { name: "Camiones y tractos", intervalValue: 20_000 },
  itemsDone: 14,
  itemsFlagged: [
    { group: "Motor", name: "Cambio aceite motor", value: "NR", reason: "Faltó el aceite en bodega" },
    { group: "Motor", name: "Inspección visual", value: "NA", reason: null },
    { group: "Frenos", name: "Cambio líquido", value: "NR", reason: "Sin repuesto" },
  ],
  corrective: null,
  photos: [{ id: "ph-1", kind: "filtros", width: 1600, height: 1200 }, { id: "ph-2", kind: "sticker", width: 1200, height: 1600 }],
}

const CORRECTIVE: AppHistoryRecord = {
  id: "rec-c", folio: "MC-BIO-0007", kind: "C", vehicleId: "veh-1", worksiteName: "Biodiversa", workDate: "2026-10-20",
  reading: 40_100, unit: "km", executorKind: "externo", executorName: "Maestranza Melo", workOrderFolio: null, notes: null,
  schedule: null, itemsDone: 0, itemsFlagged: [],
  corrective: {
    description: "Fuga de aceite en el cárter", hours: 3.5, workTypes: ["Mecánico"],
    jobs: [{ workTypeName: "Mecánico", hours: 3.5, parts: [{ quantity: 2, description: "Empaquetadura de cárter" }, { quantity: 1, description: "Tapón de drenaje" }] }],
    workshopEntryDate: "2026-10-18", workshopExitDate: null, stillInWorkshop: true,
  },
  photos: [],
}

const state = (overrides: Partial<FleetHistoryState> = {}): FleetHistoryState => ({
  byVehicle: { "veh-1": [CORRECTIVE, PREVENTIVE] }, updatedAt: "2026-10-28T15:00:00.000Z", refreshing: false, failed: false, ...overrides,
})

function data(online = true): AppData {
  const stored = storedCatalog("u-1", [equipment(), equipment({ id: "veh-2", code: "KA-141", plate: "TTTT-11" })])
  return { deviceId: UUID(900), appVersion: "test", account: account("u-1"), accounts: [account("u-1")], stored, rows: buildRows(stored, []), queue: [], online, now: Date.now() }
}

const actions = { syncNow: vi.fn(), refreshCatalog: vi.fn(async () => "unchanged" as const), toast: vi.fn() }
const wrap = (ui: ReactNode, online = true) => render(<AppDataProvider value={data(online)}><AppActionsProvider value={actions}>{ui}</AppActionsProvider></AppDataProvider>)

beforeEach(async () => {
  await freshDb()
  document.body.innerHTML = '<div id="mant-content"></div><div id="mant-modals"></div>'
  history.mockReturnValue(state())
  photo.mockReturnValue({ status: "loading" })
})
afterEach(cleanup)

describe("historial de un equipo", () => {
  it("muestra el equipo, sus trabajos y cuándo se actualizó; tocar uno abre el detalle y se vuelve a la lista", () => {
    wrap(<EquipmentHistorySheet vehicleId="veh-1" onClose={() => {}} />)
    const dialog = screen.getByRole("dialog", { name: "Historial del equipo" })
    expect(within(dialog).getByText("KA-140 · SGCP-84")).toBeTruthy()
    expect(within(dialog).getByText(/Biodiversa/)).toBeTruthy()
    expect(within(dialog).getByText(/Última lectura/).textContent).toContain("40.312 km")
    expect(within(dialog).getByText("Últimas 2 mantenciones")).toBeTruthy()
    const corrective = within(dialog).getByRole("button", { name: /MC-BIO-0007/ })
    expect(corrective.textContent).toContain("20-10-2026 · Correctiva")
    expect(corrective.textContent).toContain("Fuga de aceite en el cárter")
    expect(corrective.textContent).toContain("Maestranza Melo (taller externo)")
    const preventive = within(dialog).getByRole("button", { name: /MP-BIO-0031/ })
    expect(preventive.textContent).toContain("Preventiva 20.000 km")
    expect(preventive.textContent).toContain("Camiones y tractos")
    expect(within(dialog).getByText(/Historial actualizado el/)).toBeTruthy()
    expect(within(dialog).queryByText(/Sin señal: puede faltar/)).toBeNull()

    fireEvent.click(preventive)
    const detail = screen.getByRole("dialog", { name: "MP-BIO-0031" })
    expect(within(detail).getByText("14 ítems realizados")).toBeTruthy()
    fireEvent.click(within(detail).getByRole("button", { name: "Volver al historial" }))
    expect(screen.getByRole("dialog", { name: "Historial del equipo" })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /MP-BIO-0031/ }))
  })

  it("un equipo sin trabajos lo dice en lenguaje de usuario, sin botón que no lleva a ningún lado", () => {
    history.mockReturnValue(state({ byVehicle: {} }))
    wrap(<EquipmentHistorySheet vehicleId="veh-2" onClose={() => {}} />)
    const dialog = screen.getByRole("dialog", { name: "Historial del equipo" })
    expect(within(dialog).getByText(/no tiene mantenciones registradas todavía/)).toBeTruthy()
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["Cerrar"])
  })

  it("sin señal avisa que puede faltar lo más reciente", () => {
    history.mockReturnValue(state({ failed: true }))
    wrap(<EquipmentHistorySheet vehicleId="veh-1" onClose={() => {}} />, false)
    expect(screen.getByText("Sin señal: puede faltar lo más reciente.")).toBeTruthy()
    expect(screen.getByRole("button", { name: /MP-BIO-0031/ })).toBeTruthy()
  })

  it("mientras baja dice «Bajando…»; si nunca se bajó y no hay señal, pide conectarse una vez", () => {
    history.mockReturnValue(state({ byVehicle: null, updatedAt: null, refreshing: true }))
    const first = wrap(<EquipmentHistorySheet vehicleId="veh-1" onClose={() => {}} />)
    expect(screen.getByRole("status").textContent).toBe("Bajando el historial…")
    first.unmount()

    history.mockReturnValue(state({ byVehicle: null, updatedAt: null, failed: true }))
    wrap(<EquipmentHistorySheet vehicleId="veh-1" onClose={() => {}} />, false)
    expect(screen.getByText(/Todavía no bajamos el historial y no hay señal/)).toBeTruthy()
    expect(screen.queryByText(/Sin señal: puede faltar/)).toBeNull()
  })
})

describe("detalle de un registro", () => {
  it("una foto lista se ve con descripción; una sin señal dice que carga cuando haya señal", () => {
    photo.mockImplementation((id: string): PhotoState => id === "ph-1" ? { status: "ready", url: "blob:foto-1" } : { status: "offline" })
    wrap(<RecordDetailSheet record={PREVENTIVE} onClose={() => {}} />)
    const img = screen.getByRole("img", { name: /Filtros usados del registro MP-BIO-0031 de KA-140 · SGCP-84/ })
    expect(img.getAttribute("src")).toBe("blob:foto-1")
    expect(screen.getByText("La foto se carga cuando haya señal.")).toBeTruthy()
    expect(screen.getByText("Sticker de mantención")).toBeTruthy()
  })

  it("una foto que se está cargando o que falló no deja el hueco en blanco", () => {
    photo.mockImplementation((id: string): PhotoState => id === "ph-1" ? { status: "loading" } : { status: "error" })
    wrap(<RecordDetailSheet record={PREVENTIVE} onClose={() => {}} />)
    expect(screen.getByText("Cargando foto…")).toBeTruthy()
    expect(screen.getByText("No pudimos cargar esta foto.")).toBeTruthy()
  })

  it("preventiva: cuenta los ítems realizados y lista los que no, por sistema y con su motivo", () => {
    wrap(<RecordDetailSheet record={PREVENTIVE} onClose={() => {}} />)
    const dialog = screen.getByRole("dialog", { name: "MP-BIO-0031" })
    const text = dialog.textContent ?? ""
    expect(text).toContain("Preventiva 20.000 km")
    expect(text).toContain("12-09-2026")
    expect(text).toContain("20.150 km")
    expect(text).toContain("Luis Campos")
    expect(text).toContain("OT-BIO-0004")
    expect(within(dialog).getByText("14 ítems realizados")).toBeTruthy()
    expect(within(dialog).getByText("Motor")).toBeTruthy()
    expect(within(dialog).getByText("Frenos")).toBeTruthy()
    expect(text).toContain("Cambio aceite motor · No realizado")
    expect(text).toContain("Faltó el aceite en bodega")
    expect(text).toContain("Inspección visual · No aplica")
    expect(text).toContain("Se cambió el filtro de aire")
    // Nunca el código crudo de la pauta.
    expect(text).not.toMatch(/· NR|· NA/)
  })

  it("correctiva: descripción, trabajos con horas y repuestos, y «Sigue en taller»", () => {
    wrap(<RecordDetailSheet record={CORRECTIVE} onClose={() => {}} />)
    const dialog = screen.getByRole("dialog", { name: "MC-BIO-0007" })
    const text = dialog.textContent ?? ""
    expect(text).toContain("Correctiva")
    expect(text).toContain("Fuga de aceite en el cárter")
    expect(text).toContain("3,5 h")
    expect(text).toContain("2 × Empaquetadura de cárter")
    expect(text).toContain("1 × Tapón de drenaje")
    expect(text).toContain("Entró el 18-10-2026")
    expect(text).toContain("Sigue en taller.")
    expect(text).toContain("Maestranza Melo (taller externo)")
  })
})

describe("entradas al historial", () => {
  const recent: RecentRow = {
    id: "rec-p", kind: "P", equipmentCode: "KA-140", equipmentPlate: "SGCP-84", title: "Preventiva 20.000 km", when: "2026-09-12T15:00:00.000Z",
    folio: "MP-BIO-0031", state: "sent", voided: false, rejection: null,
  }

  it("una fila de «Mis últimos registros» que está en el historial bajado abre su detalle; las demás siguen sin ser botón", () => {
    const onOpen = vi.fn()
    const pending: RecentRow = { ...recent, id: "rec-x", folio: null, state: "pending" }
    render(<RecentSection rows={[recent, pending]} now={Date.parse("2026-10-28T18:00:00.000Z")} records={new Map([[PREVENTIVE.id, PREVENTIVE]])} onOpen={onOpen} />)
    const buttons = screen.getAllByRole("button")
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)
    expect(onOpen).toHaveBeenCalledWith(PREVENTIVE)
    expect(screen.getByText("Folio pendiente")).toBeTruthy()
  })

  it("el buscador usa el mismo filtro del paso «equipo» y al elegir entrega el equipo", () => {
    const onPick = vi.fn()
    wrap(<HistorySearchSheet onPick={onPick} onClose={() => {}} />)
    const dialog = screen.getByRole("dialog", { name: "Historial de un equipo" })
    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Patente o código" }), { target: { value: "ka141" } })
    expect(within(dialog).queryByRole("button", { name: /KA-140/ })).toBeNull()
    fireEvent.click(within(dialog).getByRole("button", { name: /KA-141/ }))
    expect(onPick).toHaveBeenCalledWith("veh-2")
  })

  it("la OT ofrece «Historial del equipo» con el equipo de la OT", () => {
    const stored = storedCatalog("u-1", [equipment()])
    const ot = workOrder()
    stored.catalog.workOrders = [ot]
    const view = buildOtViews(stored.catalog, [], { id: "u-1", name: "Javier Roa" }).mine[0]!
    const onHistory = vi.fn()
    wrap(<OtSheet view={view} onClose={() => {}} onRegister={() => {}} onHistory={onHistory} />)
    fireEvent.click(screen.getByRole("button", { name: "Historial del equipo" }))
    expect(onHistory).toHaveBeenCalledWith(ot.vehicleId)
  })
})
