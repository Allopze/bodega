// @vitest-environment jsdom
import * as React from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FieldLoadConfig, FieldLoadSubmitter } from "./types"

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("@/lib/pwa/tae-offline-queue", () => ({
  getTaeDraft: vi.fn().mockResolvedValue(null),
  saveTaeDraft: vi.fn().mockResolvedValue(undefined),
  clearTaeDraft: vi.fn().mockResolvedValue(undefined),
  getTaeDraftPhotos: vi.fn().mockResolvedValue({}),
  saveTaeDraftPhotos: vi.fn().mockResolvedValue(undefined),
  getTaeIdentity: vi.fn().mockResolvedValue(null),
  saveTaeIdentity: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/pwa/image-compress", () => ({ compressPhoto: vi.fn(async (file: File) => file) }))

const { FieldLoadWizard } = await import("./field-load-wizard")

/**
 * El formulario por pasos lo usan el QR público y el registro autenticado. Estas
 * pruebas fijan que, sin las propiedades opcionales del registro autenticado,
 * se comporta exactamente como antes: seis pasos, fotos exigidas, nada de fecha
 * propia en el envío y la pantalla final de siempre.
 */
const CONFIG: FieldLoadConfig = {
  worksite: { id: "ws-1", name: "Biodiversa" },
  loadingPoint: { id: "lp-1", name: "Surtidor principal", type: "tae" },
  vehicles: [{ id: "veh-1", code: "CA-14", plate: "KPRT14", type: "camion", meterType: "odometer", tankCapacityLiters: 400, products: [{ id: "prod-1", name: "Diésel", unit: "liter" }] }],
  supplyMedia: [{ id: "medium-1", name: "TAE" }],
}

const next = () => screen.getByRole("button", { name: "Siguiente" })
const byId = (id: string) => document.getElementById(id)!
const photo = () => new File([new Uint8Array([1, 2, 3])], "foto.jpg", { type: "image/jpeg" })

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

function renderWizard(submit: FieldLoadSubmitter = vi.fn(async () => ({ kind: "sent" as const }))) {
  render(<FieldLoadWizard config={CONFIG} scopeKey="public:ws-1:lp-1" submit={submit} identityTransport={null} />)
  return submit
}

describe("FieldLoadWizard sin las propiedades del registro autenticado", () => {
  it("son seis pasos, el primero es el equipo y no hay «Atrás» ni paso previo", () => {
    renderWizard()
    expect(screen.getByText("Paso 1 de 6")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Equipo" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Atrás" })).toBeNull()
    expect(screen.getByRole("textbox", { name: "Buscar equipo por código o patente" })).toBeInTheDocument()
  })

  it("la foto del tablero se exige y no se ofrece como opcional", () => {
    renderWizard()
    fireEvent.click(screen.getByRole("option", { name: /CA-14/ }))
    fireEvent.click(next())
    expect(screen.getByText("Paso 2 de 6")).toBeInTheDocument()
    expect(screen.queryByText(/\(opcional\)/)).toBeNull()
    fireEvent.change(byId("tae-meter-reading"), { target: { value: "182310" } })
    fireEvent.click(next())
    expect(screen.getByText("Falta la foto del tablero con la lectura.")).toBeInTheDocument()
    expect(screen.getByText("Paso 2 de 6")).toBeInTheDocument()
  })

  it("el envío no lleva fecha propia ni confirmación de duplicada, y la pantalla final es la de siempre", async () => {
    const submit = renderWizard()
    fireEvent.click(screen.getByRole("option", { name: /CA-14/ }))
    fireEvent.click(next())
    fireEvent.change(byId("tae-meter-reading"), { target: { value: "182310" } })
    fireEvent.change(byId("tae-evidence-odometer"), { target: { files: [photo()] } })
    await screen.findByText("Repetir foto")
    fireEvent.click(next())
    fireEvent.change(byId("tae-liters"), { target: { value: "185" } })
    fireEvent.change(byId("tae-evidence-liter_meter"), { target: { files: [photo()] } })
    await screen.findByText("Repetir foto")
    fireEvent.click(next())
    fireEvent.change(byId("tae-removed"), { target: { value: "S-1" } })
    fireEvent.change(byId("tae-evidence-removed_seal"), { target: { files: [photo()] } })
    fireEvent.change(byId("tae-installed"), { target: { value: "S-2" } })
    fireEvent.change(byId("tae-evidence-installed_seal"), { target: { files: [photo()] } })
    await screen.findAllByText("Repetir foto")
    fireEvent.click(next())
    fireEvent.change(byId("tae-driver"), { target: { value: "Juan Pérez" } })
    fireEvent.change(byId("tae-supervisor"), { target: { value: "Rodrigo Pino" } })
    fireEvent.click(next())
    expect(screen.getByText("Paso 6 de 6")).toBeInTheDocument()
    expect(screen.getByText("Al enviar, la plataforma registra la fecha y la hora. Sin conexión se usa la hora del teléfono.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Enviar carga" }))
    expect(await screen.findByRole("heading", { name: "Carga registrada" })).toBeInTheDocument()
    expect(screen.getByText("Quedó guardada con la fecha y hora de la plataforma.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Registrar otra carga" })).toBeInTheDocument()

    const [payload, evidence] = vi.mocked(submit).mock.calls[0]!
    expect(Object.keys(payload)).not.toContain("pastLoad")
    expect(Object.keys(payload)).not.toContain("acknowledgeDuplicate")
    expect(payload).toMatchObject({ vehicleId: "veh-1", liters: 185, meterReading: 182310, worksiteId: "ws-1", loadingPointId: "lp-1" })
    expect(evidence.map((item) => item.kind).sort()).toEqual(["installed_seal", "liter_meter", "odometer", "removed_seal"])
  })

  it("litros sobre la capacidad del estanque se rechazan en el propio paso, sin enviar ni pedir confirmar nada", async () => {
    const submit = renderWizard()
    fireEvent.click(screen.getByRole("option", { name: /CA-14/ }))
    fireEvent.click(next())
    fireEvent.change(byId("tae-meter-reading"), { target: { value: "182310" } })
    fireEvent.change(byId("tae-evidence-odometer"), { target: { files: [photo()] } })
    await screen.findByText("Repetir foto")
    fireEvent.click(next())
    fireEvent.change(byId("tae-liters"), { target: { value: "500" } })
    fireEvent.change(byId("tae-evidence-liter_meter"), { target: { files: [photo()] } })
    await screen.findByText("Repetir foto")
    fireEvent.click(next())
    expect(screen.getByText(/superan la capacidad del estanque/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Registrar de todos modos" })).toBeNull()
    expect(submit).not.toHaveBeenCalled()
  })
})
