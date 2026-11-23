// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { useReducer } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UUID, account, equipment, freshDb, photo, storedCatalog } from "@/lib/mantencion/client/__tests__/fixtures"
import { buildRows } from "@/lib/mantencion/client/fleet-view"
import { flowReducer } from "@/lib/mantencion/client/flow"
import { newDraft, type FlowDraft } from "@/lib/mantencion/client/flow-types"
import { getPhoto, putPhoto } from "@/lib/mantencion/client/photo-store"
import type { StoredCatalog } from "@/lib/mantencion/client/types"
import { AppActionsProvider, AppDataProvider, type AppActions, type AppData } from "../app-context"
import { StepEquipo } from "../step-equipo"
import { StepTrabajo } from "../step-trabajo"

const actions = (): AppActions => ({ syncNow: vi.fn(), refreshCatalog: vi.fn(async () => "unchanged" as const), toast: vi.fn() })

function stored(): StoredCatalog {
  const two = [equipment(), equipment({ id: "veh-2", code: "KA-141", plate: "SRCJ-47" })]
  return storedCatalog("u-1", two)
}

function dataFor(catalogStored: StoredCatalog): AppData {
  return { deviceId: UUID(900), appVersion: "test", account: account("u-1"), accounts: [account("u-1")], stored: catalogStored, rows: buildRows(catalogStored, []), queue: [], online: true, now: Date.now() }
}

function Harness({ initial, data, step }: { initial: FlowDraft; data: AppData; step: "equipo" | "trabajo" }) {
  const [draft, dispatch] = useReducer(flowReducer, initial)
  const row = data.rows[0]!
  return (
    <AppDataProvider value={data}>
      <AppActionsProvider value={actions()}>
        {step === "equipo" ? <StepEquipo draft={draft} dispatch={dispatch} /> : <StepTrabajo draft={draft} dispatch={dispatch} row={row} />}
        <output data-testid="state">{JSON.stringify({ vehicleId: draft.vehicleId, photos: draft.photos, drivers: draft.driverIds, oils: draft.oilIds })}</output>
      </AppActionsProvider>
    </AppDataProvider>
  )
}

const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "{}") as { vehicleId: string; photos: { filtros: string | null; correctiva: string[] }; drivers: string[]; oils: string[] }

beforeEach(async () => {
  await freshDb()
  document.body.innerHTML = '<div id="mant-content"></div><div id="mant-modals"></div>'
})
afterEach(cleanup)

describe("APP-2: cambiar de equipo con fotos", () => {
  const withPhotos = () => ({ ...newDraft({ userId: "u-1", kind: "P", vehicleId: "veh-1" }), photos: { filtros: UUID(11), sticker: UUID(12), correctiva: [] } })

  it("pide confirmar y dice cuántas fotos y con qué sello; al confirmar las suelta del borrador y de IndexedDB", async () => {
    await putPhoto(photo(UUID(11)))
    await putPhoto(photo(UUID(12)))
    render(<Harness initial={withPhotos()} data={dataFor(stored())} step="equipo" />)
    fireEvent.click(screen.getByRole("button", { name: /KA-141/ }))
    const dialog = screen.getByRole("alertdialog")
    expect(dialog.textContent).toContain("Cambiar de equipo descarta las 2 fotos")
    expect(dialog.textContent).toContain("sello de KA-140")
    expect(state().vehicleId).toBe("veh-1")

    fireEvent.click(screen.getByRole("button", { name: "Cambiar y descartar" }))
    expect(state().vehicleId).toBe("veh-2")
    expect(state().photos.filtros).toBeNull()
    expect(screen.queryByRole("alertdialog")).toBeNull()
    await waitFor(async () => { expect(await getPhoto(UUID(11))).toBeNull(); expect(await getPhoto(UUID(12))).toBeNull() })
  })

  it("cancelar deja el equipo y las fotos como estaban", async () => {
    await putPhoto(photo(UUID(11)))
    render(<Harness initial={withPhotos()} data={dataFor(stored())} step="equipo" />)
    fireEvent.click(screen.getByRole("button", { name: /KA-141/ }))
    fireEvent.click(screen.getByRole("button", { name: "Dejar el equipo" }))
    expect(state().vehicleId).toBe("veh-1")
    expect(state().photos.filtros).toBe(UUID(11))
    expect(await getPhoto(UUID(11))).not.toBeNull()
  })

  it("sin fotos el cambio es directo, sin diálogo", () => {
    render(<Harness initial={newDraft({ userId: "u-1", kind: "P", vehicleId: "veh-1" })} data={dataFor(stored())} step="equipo" />)
    fireEvent.click(screen.getByRole("button", { name: /KA-141/ }))
    expect(screen.queryByRole("alertdialog")).toBeNull()
    expect(state().vehicleId).toBe("veh-2")
  })
})

describe("APP-3: lo elegido que ya no está disponible", () => {
  const corrective = (patch: Partial<FlowDraft>): FlowDraft => ({
    ...newDraft({ userId: "u-1", kind: "C", vehicleId: "veh-1" }),
    jobs: [{ workTypeId: "t-1", hours: 1, noParts: true, parts: [] }], noOilChange: false, ...patch,
  })

  it("el conductor desactivado se dibuja como «Ya no disponible · quitar» y se puede quitar", () => {
    render(<Harness initial={corrective({ driverIds: ["d-9"], idNames: { "d-9": "PEREZ" } })} data={dataFor(stored())} step="trabajo" />)
    const chip = screen.getByRole("button", { name: "Quitar “PEREZ”: ya no está disponible" })
    expect(chip.textContent).toContain("Ya no disponible · quitar")
    fireEvent.click(chip)
    expect(state().drivers).toEqual([])
    expect(screen.queryByRole("button", { name: /ya no está disponible/ })).toBeNull()
  })

  it("el aceite desactivado también sale con su chip, sin nombre guardado dice «un aceite»", () => {
    render(<Harness initial={corrective({ oilIds: ["o-9"] })} data={dataFor(stored())} step="trabajo" />)
    fireEvent.click(screen.getByRole("button", { name: "Quitar un aceite: ya no está disponible" }))
    expect(state().oils).toEqual([])
  })

  it("el ejecutor desactivado vuelve a pedir elegir, con el aviso a la vista", () => {
    render(<Harness initial={corrective({ executorKind: "otro_mecanico", executorUserId: "u-9", idNames: { "u-9": "Pedro Soto" } })} data={dataFor(stored())} step="trabajo" />)
    const select = screen.getByLabelText("Mecánico") as HTMLSelectElement
    expect(select.value).toBe("")
    expect(screen.getByText("Elige otro mecánico: “Pedro Soto” ya no está disponible.")).toBeTruthy()
  })

  it("sin catálogo bajado no se marca nada como «ya no disponible»", () => {
    const data = { ...dataFor(stored()), stored: null }
    render(<Harness initial={corrective({ driverIds: ["d-9"] })} data={data} step="trabajo" />)
    expect(screen.queryByRole("button", { name: /ya no está disponible/ })).toBeNull()
  })
})

