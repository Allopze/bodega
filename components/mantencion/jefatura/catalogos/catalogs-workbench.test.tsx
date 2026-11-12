// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CatalogAdminRow } from "@/lib/services/mantencion/catalog-admin"

const actions = vi.hoisted(() => ({
  createCatalogEntryAction: vi.fn(),
  renameCatalogEntryAction: vi.fn(),
  setCatalogEntryActiveAction: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/mantencion/catalogos",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
// La cabecera vive en el contexto del shell; aquí sólo importa su título y sus acciones.
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, actions: headerActions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{headerActions}</header>,
}))
vi.mock("@/app/(app)/mantencion/catalogos/actions", () => actions)

import { CatalogsWorkbench, type CatalogCounts } from "./catalogs-workbench"

const COUNTS: CatalogCounts = { brands: 3, workshops: 0, drivers: 0, workTypes: 0, oils: 0 }
const ROWS: CatalogAdminRow[] = [
  { id: "b1", name: "Scania", isActive: true, usage: 12, usageText: "12 equipos · 2 reglas de pauta" },
  { id: "b2", name: "Kia", isActive: true, usage: 0, usageText: "" },
  { id: "b3", name: "Antigua", isActive: false, usage: 0, usageText: "" },
]

/** Cada fila se dibuja dos veces (tarjetas móviles y tabla): se trabaja con la tabla, que es la visible en escritorio. */
function tableRow(name: string) {
  const row = screen.getAllByText(name).map((node) => node.closest("tr")).find((tr) => tr !== null)
  if (!row) throw new Error(`Sin fila para ${name}`)
  return within(row)
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe("CatalogsWorkbench", () => {
  it("muestra las pestañas con su contador, el estado y los usos de cada fila", () => {
    render(<CatalogsWorkbench catalog="brands" rows={ROWS} counts={COUNTS} />)
    expect(screen.getByRole("heading", { name: "Catálogos de mantención" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Nueva marca" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Marcas · 3" }).getAttribute("aria-current")).toBe("page")
    expect(screen.getByRole("link", { name: "Aceites · 0" })).toBeTruthy()
    expect(tableRow("Scania").getByText("Activa")).toBeTruthy()
    expect(tableRow("Scania").getByText("12 equipos · 2 reglas de pauta")).toBeTruthy()
    expect(tableRow("Kia").getByText("Sin uso")).toBeTruthy()
    expect(tableRow("Antigua").getByText("Inactiva")).toBeTruthy()
    expect(tableRow("Antigua").getByRole("button", { name: "Activar «Antigua»" })).toBeTruthy()
  })

  it("el catálogo de aceites no muestra la columna de usos", () => {
    render(<CatalogsWorkbench catalog="oils" rows={[{ id: "o1", name: "15W-40", isActive: true, usage: null, usageText: "" }]} counts={COUNTS} />)
    expect(screen.queryByRole("columnheader", { name: /Usos/ })).toBeNull()
    expect(screen.getByRole("button", { name: "Nuevo aceite" })).toBeTruthy()
  })

  it("un catálogo vacío ofrece crear la primera entrada, sin repetir el botón de la cabecera", () => {
    render(<CatalogsWorkbench catalog="workshops" rows={[]} counts={COUNTS} />)
    expect(screen.getByText("Todavía no hay talleres")).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Nuevo taller" })).toHaveLength(1)
  })

  it("«Nueva marca» abre el diálogo y envía el nombre; un duplicado se muestra bajo el campo y no cierra", async () => {
    actions.createCatalogEntryAction.mockResolvedValue({ ok: false, field: "name", message: "Ya existe una marca llamada «Kia»." })
    render(<CatalogsWorkbench catalog="brands" rows={ROWS} counts={COUNTS} />)
    fireEvent.click(screen.getByRole("button", { name: "Nueva marca" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText(/Nombre de la marca/), { target: { value: "kia" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Agregar" }))
    await waitFor(() => expect(actions.createCatalogEntryAction).toHaveBeenCalledWith({ catalog: "brands", name: "kia" }))
    expect(await within(dialog).findByText("Ya existe una marca llamada «Kia».")).toBeTruthy()
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("renombrar parte del nombre actual y manda el id", async () => {
    actions.renameCatalogEntryAction.mockResolvedValue({ ok: true, message: "Renombrada a «Scania AB».", data: { id: "b1", name: "Scania AB" } })
    render(<CatalogsWorkbench catalog="brands" rows={ROWS} counts={COUNTS} />)
    fireEvent.click(tableRow("Scania").getByRole("button", { name: "Renombrar «Scania»" }))
    const dialog = await screen.findByRole("dialog")
    const input = within(dialog).getByLabelText(/Nombre de la marca/) as HTMLInputElement
    expect(input.value).toBe("Scania")
    fireEvent.change(input, { target: { value: "Scania AB" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar nombre" }))
    await waitFor(() => expect(actions.renameCatalogEntryAction).toHaveBeenCalledWith({ catalog: "brands", id: "b1", name: "Scania AB" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("desactivar pide confirmación y explica que lo que ya la usa la conserva", async () => {
    actions.setCatalogEntryActiveAction.mockResolvedValue({ ok: true, data: { id: "b1", isActive: false } })
    render(<CatalogsWorkbench catalog="brands" rows={ROWS} counts={COUNTS} />)
    fireEvent.click(tableRow("Scania").getByRole("button", { name: "Desactivar «Scania»" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/Los equipos y las reglas de pauta que ya la usan la conservan/)).toBeTruthy()
    expect(actions.setCatalogEntryActiveAction).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Desactivar" }))
    await waitFor(() => expect(actions.setCatalogEntryActiveAction).toHaveBeenCalledWith({ catalog: "brands", id: "b1", active: false }))
  })

  it("activar una inactiva no pregunta", async () => {
    actions.setCatalogEntryActiveAction.mockResolvedValue({ ok: true, data: { id: "b3", isActive: true } })
    render(<CatalogsWorkbench catalog="brands" rows={ROWS} counts={COUNTS} />)
    fireEvent.click(tableRow("Antigua").getByRole("button", { name: "Activar «Antigua»" }))
    await waitFor(() => expect(actions.setCatalogEntryActiveAction).toHaveBeenCalledWith({ catalog: "brands", id: "b3", active: true }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
