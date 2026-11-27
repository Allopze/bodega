// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  refresh: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock("@/app/(app)/mantencion/notas-pedido/bulk-actions", () => ({ decideLinesInBulkAction: mocks.decide }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: mocks.refresh }) }))
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }))

const { BulkLinesBar } = await import("./bulk-lines-bar")

const done = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  message: "2 líneas enviadas a compra (SOL-0007).",
  result: { ok: 2, failed: [], requests: [{ code: "SOL-0007", id: "req-7", approved: true }] },
  ...overrides,
})

beforeEach(() => { mocks.decide.mockResolvedValue(done()) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

function mount(props: Partial<React.ComponentProps<typeof BulkLinesBar>> = {}) {
  const onClear = vi.fn()
  const view = render(<BulkLinesBar lineIds={["l1", "l2", "l3"]} noteCount={2} onClear={onClear} {...props} />)
  return { onClear, ...view }
}
const region = () => screen.getByRole("region", { name: "Acciones sobre las líneas elegidas" })
const status = () => screen.getByRole("status")

describe("BulkLinesBar", () => {
  it("sin selección ni resultado no pinta la barra, pero deja montada la región en vivo vacía", () => {
    mount({ lineIds: [], noteCount: 0 })
    expect(screen.queryByRole("region")).toBeNull()
    expect(status().textContent).toBe("")
  })

  it("dice «N líneas de M notas», lo anuncia y ofrece las tres decisiones y quitar la selección", () => {
    const { onClear } = mount()
    expect(region().textContent).toContain("3 líneas de 2 notas")
    expect(status().textContent).toBe("3 líneas elegidas de 2 notas")
    for (const name of ["Enviar a compra", "Sacar de bodega", "Rechazar", "Quitar selección"]) expect(within(region()).getByRole("button", { name })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Quitar selección" }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("singular: «1 línea de 1 nota»", () => {
    mount({ lineIds: ["l1"], noteCount: 1 })
    expect(region().textContent).toContain("1 línea de 1 nota")
  })

  it("«Enviar a compra» decide de una vez, sin diálogo, y deja el resultado con el enlace a la solicitud y la selección limpia", async () => {
    const { onClear } = mount()
    fireEvent.click(screen.getByRole("button", { name: "Enviar a compra" }))
    expect(screen.queryByRole("dialog")).toBeNull()
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1))
    expect(mocks.decide).toHaveBeenCalledWith({ lineIds: ["l1", "l2", "l3"], decision: "comprar" })
    // El resultado vive en la región en vivo (anuncio) y a la vista, con el enlace a la solicitud creada.
    await waitFor(() => expect(status().textContent).toContain("2 líneas enviadas a compra."))
    expect(within(region()).getByText("2 líneas enviadas a compra.")).toBeTruthy()
    expect(within(region()).getByRole("link", { name: "SOL-0007" }).getAttribute("href")).toBe("/solicitudes/req-7")
    expect(region().textContent).toContain("(aprobada)")
  })

  it("una solicitud que quedó esperando su aprobación lo dice junto a su enlace", async () => {
    mocks.decide.mockResolvedValue(done({ result: { ok: 1, failed: [], requests: [{ code: "SOL-0008", id: "req-8", approved: false }] } }))
    mount({ lineIds: ["l1"], noteCount: 1 })
    fireEvent.click(screen.getByRole("button", { name: "Enviar a compra" }))
    await waitFor(() => expect(within(region()).getByRole("link", { name: "SOL-0008" })).toBeTruthy())
    expect(region().textContent).toContain("1 línea enviada a compra.")
    expect(region().textContent).toContain("espera su aprobación")
  })

  it("«Sacar de bodega» manda la decisión «bodega» sin confirmar", async () => {
    mocks.decide.mockResolvedValue(done({ result: { ok: 3, failed: [], requests: [] } }))
    const { onClear } = mount()
    fireEvent.click(screen.getByRole("button", { name: "Sacar de bodega" }))
    await waitFor(() => expect(onClear).toHaveBeenCalled())
    expect(mocks.decide).toHaveBeenCalledWith({ lineIds: ["l1", "l2", "l3"], decision: "bodega" })
    expect(within(region()).getByText("3 líneas sacadas de bodega.")).toBeTruthy()
    expect(within(region()).queryByRole("link")).toBeNull()
  })

  it("un lote mixto dice cuántas salieron y por qué falló cada nota, y aun así limpia la selección", async () => {
    mocks.decide.mockResolvedValue(done({
      result: { ok: 1, failed: [{ noteCode: "NP-2026-0002", message: "La nota está en espera: acéptala primero." }], requests: [{ code: "SOL-0009", id: "req-9", approved: true }] },
    }))
    const { onClear } = mount()
    fireEvent.click(screen.getByRole("button", { name: "Enviar a compra" }))
    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1))
    const failures = within(region()).getByRole("list", { name: "Notas que no se pudieron procesar" })
    expect(within(failures).getByText("NP-2026-0002")).toBeTruthy()
    expect(failures.textContent).toContain("La nota está en espera: acéptala primero.")
    expect(status().textContent).toContain("1 línea enviada a compra.")
    expect(status().textContent).toContain("NP-2026-0002: La nota está en espera: acéptala primero.")
  })

  it("si no salió ninguna línea, conserva la selección para reintentar y muestra los motivos", async () => {
    mocks.decide.mockResolvedValue({
      ok: false,
      message: "No se decidió ninguna línea.",
      result: { ok: 0, failed: [{ noteCode: "NP-2026-0001", message: "Una nota sin OT no aparta stock." }], requests: [] },
    })
    const { onClear } = mount()
    fireEvent.click(screen.getByRole("button", { name: "Sacar de bodega" }))
    await waitFor(() => expect(within(region()).getByText("No se decidió ninguna línea.")).toBeTruthy())
    expect(onClear).not.toHaveBeenCalled()
    expect(region().textContent).toContain("Una nota sin OT no aparta stock.")
    // La selección sigue ahí: la barra conserva el conteo y los botones.
    expect(region().textContent).toContain("3 líneas de 2 notas")
  })

  it("si el servidor rechaza la petición (permiso, validación) muestra su mensaje y conserva la selección", async () => {
    mocks.decide.mockResolvedValue({ ok: false, message: "No tienes permiso para esta acción." })
    const { onClear } = mount()
    fireEvent.click(screen.getByRole("button", { name: "Enviar a compra" }))
    await waitFor(() => expect(within(region()).getByText("No tienes permiso para esta acción.")).toBeTruthy())
    expect(onClear).not.toHaveBeenCalled()
  })

  it("sin conexión (la acción lanza) avisa y conserva la selección", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false })
    try {
      mocks.decide.mockRejectedValue(new TypeError("Failed to fetch"))
      const { onClear } = mount()
      fireEvent.click(screen.getByRole("button", { name: "Enviar a compra" }))
      await waitFor(() => expect(within(region()).getByText(/Sin conexión/)).toBeTruthy())
      expect(onClear).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true })
    }
  })

  it("el resultado se puede cerrar", async () => {
    const { rerender } = mount()
    fireEvent.click(screen.getByRole("button", { name: "Enviar a compra" }))
    await waitFor(() => expect(within(region()).getByText("2 líneas enviadas a compra.")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Cerrar el resultado" }))
    rerender(<BulkLinesBar lineIds={[]} noteCount={0} onClear={vi.fn()} />)
    expect(screen.queryByRole("region")).toBeNull()
    expect(status().textContent).toBe("")
  })

  it("elegir otras líneas después de un resultado descarta el resultado anterior", async () => {
    const onClear = vi.fn()
    const { rerender } = render(<BulkLinesBar lineIds={["l1"]} noteCount={1} onClear={onClear} />)
    fireEvent.click(screen.getByRole("button", { name: "Enviar a compra" }))
    await waitFor(() => expect(onClear).toHaveBeenCalled())
    rerender(<BulkLinesBar lineIds={[]} noteCount={0} onClear={onClear} />)
    expect(within(region()).getByText("2 líneas enviadas a compra.")).toBeTruthy()
    rerender(<BulkLinesBar lineIds={["l5"]} noteCount={1} onClear={onClear} />)
    expect(screen.queryByText("2 líneas enviadas a compra.")).toBeNull()
    expect(region().textContent).toContain("1 línea de 1 nota")
  })

  it("«Sacar de bodega» queda deshabilitado, con el motivo, cuando ninguna nota elegida tiene OT", () => {
    mount({ canTakeFromStock: false })
    const button = screen.getByRole("button", { name: "Sacar de bodega" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toMatch(/sin OT no aparta stock/)
    expect((screen.getByRole("button", { name: "Enviar a compra" }) as HTMLButtonElement).disabled).toBe(false)
  })

  describe("Rechazar", () => {
    const openDialog = () => {
      fireEvent.click(screen.getByRole("button", { name: "Rechazar" }))
      return screen.getByRole("dialog")
    }

    it("abre un diálogo que pide el motivo (mínimo 5 letras) y no decide hasta confirmarlo", () => {
      mount()
      const dialog = within(openDialog())
      expect(dialog.getByText("Rechazar las líneas")).toBeTruthy()
      expect(dialog.getByText(/3 líneas de 2 notas no se compran ni se sacan de la bodega/)).toBeTruthy()
      const submit = dialog.getByRole("button", { name: "Rechazar" }) as HTMLButtonElement
      expect(submit.disabled).toBe(true)
      fireEvent.change(dialog.getByLabelText(/Motivo/), { target: { value: "ya  " } })
      expect(submit.disabled).toBe(true)
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it("con el motivo escrito rechaza las líneas con él (recortado), cierra el diálogo y deja el resultado en la barra", async () => {
      mocks.decide.mockResolvedValue(done({ message: "3 líneas rechazadas.", result: { ok: 3, failed: [], requests: [] } }))
      const { onClear } = mount()
      const dialog = within(openDialog())
      fireEvent.change(dialog.getByLabelText(/Motivo/), { target: { value: "  Ya hay en la faena  " } })
      fireEvent.click(dialog.getByRole("button", { name: "Rechazar" }))
      await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith({ lineIds: ["l1", "l2", "l3"], decision: "rechazar", reason: "Ya hay en la faena" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
      expect(onClear).toHaveBeenCalledTimes(1)
      expect(within(region()).getByText("3 líneas rechazadas.")).toBeTruthy()
      expect(mocks.toast.success).toHaveBeenCalled()
    })

    it("si no se rechazó ninguna, el error queda dentro del diálogo con lo escrito y la selección sigue", async () => {
      mocks.decide.mockResolvedValue({
        ok: false, message: "No se decidió ninguna línea.", result: { ok: 0, failed: [{ noteCode: "NP-2026-0001", message: "La línea ya la resolvió otra persona." }], requests: [] },
      })
      const { onClear } = mount()
      const dialog = within(openDialog())
      fireEvent.change(dialog.getByLabelText(/Motivo/), { target: { value: "Ya hay en la faena" } })
      fireEvent.click(dialog.getByRole("button", { name: "Rechazar" }))
      await waitFor(() => expect(dialog.getByRole("alert").textContent).toContain("No se decidió ninguna línea."))
      expect(screen.getByRole("dialog")).toBeTruthy()
      expect((dialog.getByLabelText(/Motivo/) as HTMLTextAreaElement).value).toBe("Ya hay en la faena")
      expect(onClear).not.toHaveBeenCalled()
    })

    it("«Cancelar» cierra el diálogo sin decidir", () => {
      mount()
      fireEvent.click(within(openDialog()).getByRole("button", { name: "Cancelar" }))
      expect(screen.queryByRole("dialog")).toBeNull()
      expect(mocks.decide).not.toHaveBeenCalled()
    })
  })
})
