// @vitest-environment jsdom
import * as React from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DevicePersonGroup, DeviceView } from "@/lib/services/mantencion/device-groups"

const revokeDeviceAction = vi.hoisted(() => vi.fn(async () => ({ ok: true, message: "Dispositivo desconectado." })))
vi.mock("@/app/(app)/mantencion/dispositivos/actions", () => ({ revokeDeviceAction }))
vi.mock("@/lib/toast", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }))
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,qr") } }))

const { DevicesList } = await import("./devices-list")
const { ShellHeaderProvider, useSafeShellHeader } = await import("@/components/layout/header-context")

function device(overrides: Partial<DeviceView> = {}): DeviceView {
  return {
    id: "c1", name: "Chrome en Android", status: "vigente", lastUse: "hoy, 12:53", connected: "28-10-2026", endDate: "27-11-2026", code: "1fbe6a56",
    searchText: "Chrome en Android Android · Chrome 1fbe6a56-0000", ...overrides,
  }
}

const ANA: DevicePersonGroup = {
  userId: "u1", userName: "Ana Pérez", userEmail: "ana@chome.cl",
  active: [device(), device({ id: "c2", name: "Safari en iPhone", lastUse: "ayer, 19:10", code: "bbbbbbbb", searchText: "Safari en iPhone iPhone · Safari bbbbbbbb-1" })],
  past: [device({ id: "c3", name: "Edge en Windows", status: "revocada", lastUse: "hace 5 días (25-10-2026)", connected: "20-10-2026", endDate: "29-10-2026", code: "cccccccc", searchText: "Edge en Windows cccccccc-2" })],
}
const BETO: DevicePersonGroup = { userId: "u2", userName: "Beto Soto", userEmail: "beto@chome.cl", active: [], past: [device({ id: "c4", status: "vencida", endDate: "01-10-2026", code: "dddddddd", searchText: "dddddddd-3" })] }

function Search({ query }: { query: string }) {
  const { setSearchQuery } = useSafeShellHeader()
  React.useEffect(() => setSearchQuery(query), [query, setSearchQuery])
  return null
}
const renderList = (groups: DevicePersonGroup[], query = "") => render(
  <ShellHeaderProvider><Search query={query} /><DevicesList groups={groups} canRevoke /></ShellHeaderProvider>,
)

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

describe("DevicesList", () => {
  it("agrupa por persona: lo conectado a la vista, con rótulo legible y el código como dato secundario", () => {
    renderList([ANA, BETO])
    const ana = screen.getByRole("group", { name: "Ana Pérez" })
    expect(within(ana).getByText("2 dispositivos conectados")).toBeDefined()
    expect(within(ana).getByText("Chrome en Android")).toBeDefined()
    expect(within(ana).getByText("Último uso: hoy, 12:53")).toBeDefined()
    expect(within(ana).getAllByText("Conectado el 28-10-2026")[0]!.className).toContain("whitespace-nowrap")
    expect(within(ana).getByText("1fbe6a56").className).toContain("font-mono")
    // Lo vigente no repite «Vigente» en cada renglón: ya está bajo «conectados».
    expect(within(ana).queryByText("Vigente")).toBeNull()
    expect(screen.getByRole("group", { name: "Beto Soto" })).toBeDefined()
    expect(within(screen.getByRole("group", { name: "Beto Soto" })).getByText("Sin dispositivos conectados")).toBeDefined()
  })

  it("lo vencido y lo revocado queda plegado, con su etiqueta y sin botón de revocar", () => {
    renderList([ANA])
    const ana = screen.getByRole("group", { name: "Ana Pérez" })
    const summary = within(ana).getByText("Ver 1 anterior").closest("summary")!
    expect(summary.closest("details")!.hasAttribute("open")).toBe(false)
    const past = within(summary.closest("details")!)
    expect(past.getByText("Revocada")).toBeDefined()
    expect(past.getByText("revocada el 29-10-2026")).toBeDefined()
    expect(past.queryByRole("button", { name: /Revocar/ })).toBeNull()
    // Los dos conectados sí se pueden revocar, cada uno con su nombre accesible.
    expect(within(ana).getAllByRole("button", { name: /^Revocar el acceso de Ana Pérez en / })).toHaveLength(2)
  })

  it("revocar pide confirmación con la persona y el dispositivo, y llama a la acción con su id", async () => {
    renderList([ANA])
    fireEvent.click(screen.getByRole("button", { name: "Revocar el acceso de Ana Pérez en Safari en iPhone" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Revocar el acceso de Ana Pérez")).toBeDefined()
    expect(within(dialog).getByText(/«Safari en iPhone» dejará de sincronizar/)).toBeDefined()
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Revocar acceso" })) })
    expect(revokeDeviceAction).toHaveBeenCalledWith({ credentialId: "c2" })
  })

  it("la búsqueda de la barra superior encuentra a la persona (todos sus teléfonos) o un teléfono por su código", async () => {
    const { unmount } = renderList([ANA, BETO], "ana pérez")
    await waitFor(() => expect(screen.queryByRole("group", { name: "Beto Soto" })).toBeNull())
    expect(within(screen.getByRole("group", { name: "Ana Pérez" })).getAllByRole("button", { name: /Revocar/ })).toHaveLength(2)
    unmount()

    renderList([ANA, BETO], "bbbbbbbb")
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Ana Pérez" })).getAllByRole("button", { name: /Revocar/ })).toHaveLength(1))
    expect(screen.queryByRole("group", { name: "Beto Soto" })).toBeNull()
  })

  it("una búsqueda sin coincidencias lo dice", async () => {
    renderList([ANA], "zzz")
    expect(await screen.findByText("Ningún dispositivo coincide con «zzz».")).toBeDefined()
  })

  it("sin dispositivos explica qué los hace aparecer y ofrece instalar la app", () => {
    renderList([])
    expect(screen.getByText("Todavía no hay dispositivos conectados")).toBeDefined()
    expect(screen.getByRole("button", { name: "Instalar app del mecánico" })).toBeDefined()
  })
})
