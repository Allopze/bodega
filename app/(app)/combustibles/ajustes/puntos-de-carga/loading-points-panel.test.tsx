// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const createLink = vi.hoisted(() => vi.fn())
const revokeLink = vi.hoisted(() => vi.fn())
const setStorage = vi.hoisted(() => vi.fn())
vi.mock("../../tae/actions", () => ({
  createTaePublicLinkAction: createLink,
  revokeTaePublicLinkAction: revokeLink,
  setTaeLoadingPointStorageAction: setStorage,
  createTaeLoadingPointAction: vi.fn(),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

const { LoadingPointsPanel } = await import("./loading-points-panel")

const point = { id: "p1", worksiteId: "w1", worksiteName: "Biodiversa", name: "Surtidor principal", type: "fixed_dispenser", isActive: true, storageLocationId: null, activeLinks: 1 }
const link = { id: "l1", label: "Turno noche", worksiteName: "Biodiversa", loadingPointName: "Surtidor principal", createdAt: "2026-10-20T14:00:00.000Z", lastUsedAt: null, revokedAt: null }
const revoked = { ...link, id: "l0", label: "QR viejo", revokedAt: "2026-10-25T14:00:00.000Z" }

const renderPanel = (overrides: Partial<Parameters<typeof LoadingPointsPanel>[0]> = {}) =>
  render(<LoadingPointsPanel points={[point]} links={[link, revoked]} storageLocations={[{ id: "s1", worksiteId: "w1", name: "Estanque base" }]} {...overrides} />)

describe("puntos de carga y QR", () => {
  beforeEach(() => vi.clearAllMocks())

  it("lista los puntos con su faena, tipo y enlaces activos, y separa los enlaces revocados", () => {
    renderPanel()
    const table = screen.getByRole("region", { name: "Puntos de carga" })
    expect(within(table).getByText("Surtidor principal")).toBeInTheDocument()
    expect(within(table).getByText("Biodiversa")).toBeInTheDocument()
    expect(within(table).getByText("Surtidor fijo")).toBeInTheDocument()
    expect(within(screen.getByRole("region", { name: "Enlaces vigentes" })).getByText("Turno noche")).toBeInTheDocument()
    expect(screen.getByText("Enlaces revocados (1)")).toBeInTheDocument()
  })

  it("revocar pide confirmación y no revoca hasta confirmar", async () => {
    revokeLink.mockResolvedValue({ ok: true, message: "Enlace revocado" })
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Revocar el enlace Turno noche" }))

    const dialog = await screen.findByRole("dialog", { name: "Revocar enlace" })
    expect(dialog).toHaveTextContent("dejará de funcionar al instante")
    expect(revokeLink).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole("button", { name: "Revocar enlace" }))
    await waitFor(() => expect(revokeLink).toHaveBeenCalledWith("l1"))
  })

  it("cancelar la confirmación deja el enlace como estaba", async () => {
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Revocar el enlace Turno noche" }))
    const dialog = await screen.findByRole("dialog", { name: "Revocar enlace" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Revocar enlace" })).toBeNull())
    expect(revokeLink).not.toHaveBeenCalled()
  })

  it("si revocar falla, el motivo queda dentro del diálogo, que sigue abierto", async () => {
    revokeLink.mockResolvedValue({ ok: false, message: "Enlace no encontrado" })
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: "Revocar el enlace Turno noche" }))
    const dialog = await screen.findByRole("dialog", { name: "Revocar enlace" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Revocar enlace" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Enlace no encontrado")
  })

  it("generar un QR usa el nombre del punto como etiqueta por omisión y avisa que se muestra una sola vez", async () => {
    createLink.mockResolvedValue({ ok: true, data: { id: "l9", accessToken: "tok-123" } })
    renderPanel({ links: [] })
    fireEvent.click(screen.getByRole("button", { name: "Generar QR de Surtidor principal" }))
    const dialog = await screen.findByRole("dialog", { name: "Generar QR" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Generar QR" }))

    await waitFor(() => expect(createLink).toHaveBeenCalledWith({ worksiteId: "w1", loadingPointId: "p1", label: "Surtidor principal" }))
    expect(await screen.findByText("QR listo para «Surtidor principal»")).toBeInTheDocument()
    expect(screen.getByText(/Se muestra una sola vez/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Ver QR y enlace/ })).toBeInTheDocument()
  })

  it("un punto inactivo no genera QR", () => {
    renderPanel({ points: [{ ...point, isActive: false }] })
    expect(screen.getByRole("button", { name: "Generar QR de Surtidor principal" })).toBeDisabled()
    expect(screen.getByText("Inactivo")).toBeInTheDocument()
  })

  it("sin puntos explica qué es un punto de carga y ofrece crear el primero", () => {
    renderPanel({ points: [], links: [], emptyAction: <button type="button">Crear el primer punto de carga</button> })
    expect(screen.getByRole("heading", { name: "Aún no hay puntos de carga" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Crear el primer punto de carga" })).toBeInTheDocument()
    expect(screen.getByText(/No hay enlaces vigentes/)).toBeInTheDocument()
  })
})
