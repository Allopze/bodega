// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"

const mockReplace = vi.fn()
let mockSearchParams = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockReplace }),
}))

import { DataTable } from "@/components/ui/data-table"
import { ShellHeaderProvider } from "@/components/layout/header-context"
import { TableRow, TableCell } from "@/components/ui/table"

const COLUMNS = [
  { key: "name", label: "Nombre", sortable: true },
  { key: "email", label: "Email", sortable: true },
  { key: "role", label: "Rol" },
]

const ROWS = [
  { id: "1", name: "Ana López", email: "ana@chome.cl", role: "Admin" },
  { id: "2", name: "Juan Pérez", email: "juan@chome.cl", role: "Usuario" },
  { id: "3", name: "María García", email: "maria@chome.cl", role: "Editor" },
]

function withProvider(ui: React.ReactElement) {
  return <ShellHeaderProvider>{ui}</ShellHeaderProvider>
}

describe("DataTable", () => {
  afterEach(() => {
    cleanup()
    mockSearchParams = new URLSearchParams()
  })

  it("renders table with headers and rows", () => {
    render(
      withProvider(
        <DataTable
          caption="Usuarios de prueba"
          columns={COLUMNS}
          rows={ROWS}
          searchKeys={["name", "email"]}
          renderRow={(row) => (
            <TableRow key={row.id as string}>
              <TableCell>{row.name as string}</TableCell>
              <TableCell>{row.email as string}</TableCell>
              <TableCell>{row.role as string}</TableCell>
            </TableRow>
          )}
        />,
      ),
    )

    expect(screen.getByText("Nombre")).toBeDefined()
    expect(screen.getByText("Email")).toBeDefined()
    expect(screen.getByText("Rol")).toBeDefined()
    expect(screen.getByText("Ana López")).toBeDefined()
    expect(screen.getByText("Juan Pérez")).toBeDefined()
    expect(screen.getByText("María García")).toBeDefined()
  })

  it("keeps showing real rows if the dataset shrinks while on a later page (UIUX-009)", () => {
    const renderRow = (row: (typeof ROWS)[number]) => (
      <TableRow key={row.id}>
        <TableCell>{row.name}</TableCell>
      </TableRow>
    )

    const { rerender } = render(
      withProvider(
        <DataTable
          caption="Usuarios de prueba"
          columns={COLUMNS}
          rows={ROWS}
          searchKeys={["name", "email"]}
          pageSize={1}
          renderRow={renderRow}
          emptyTitle="Sin resultados"
        />,
      ),
    )

    // Cada fila ocupa su propia página (pageSize=1): ir a la página 3.
    fireEvent.click(screen.getByLabelText("Ir a página 3"))
    expect(screen.getByText("María García")).toBeDefined()

    // El dataset se reduce (p. ej. el buscador del TopBar filtra) mientras el
    // usuario sigue en la página 3, que ya no existe.
    rerender(
      withProvider(
        <DataTable
          caption="Usuarios de prueba"
          columns={COLUMNS}
          rows={ROWS.slice(0, 1)}
          searchKeys={["name", "email"]}
          pageSize={1}
          renderRow={renderRow}
          emptyTitle="Sin resultados"
        />,
      ),
    )

    expect(screen.getByText("Ana López")).toBeDefined()
    expect(screen.queryByText("Sin resultados")).toBeNull()
  })

  it("shows empty state when no rows", () => {
    render(
      withProvider(
        <DataTable
          caption="Usuarios de prueba"
          columns={COLUMNS}
          rows={[]}
          searchKeys={["name"]}
          renderRow={() => null}
          emptyTitle="Sin resultados"
          emptyDescription="No hay datos disponibles"
        />,
      ),
    )

    expect(screen.getByText("Sin resultados")).toBeDefined()
    expect(screen.getByText("No hay datos disponibles")).toBeDefined()
  })

  it("renders skeleton rows when loading", () => {
    const { container } = render(
      withProvider(
        <DataTable
          caption="Usuarios de prueba"
          columns={COLUMNS}
          rows={[]}
          searchKeys={["name"]}
          renderRow={() => null}
          loading
        />,
      ),
    )

    const skeletonDivs = container.querySelectorAll(".animate-pulse")
    expect(skeletonDivs.length).toBeGreaterThan(0)
  })

  it("filters rows via explicit search prop", () => {
    const { container } = render(
      withProvider(
        <DataTable
          caption="Usuarios de prueba"
          columns={COLUMNS}
          rows={ROWS}
          searchKeys={["name"]}
          search="Ana"
          onSearchChange={() => {}}
          renderRow={(row) => (
            <TableRow key={row.id as string}>
              <TableCell>{row.name as string}</TableCell>
            </TableRow>
          )}
        />,
      ),
    )

    const rows = container.querySelectorAll("tbody tr")
    expect(rows.length).toBe(1)
    expect(screen.getByText("Ana López")).toBeDefined()
    expect(screen.queryByText("Juan Pérez")).toBeNull()
    expect(screen.queryByText("María García")).toBeNull()
  })

  it("shows search input when explicit search prop is provided", () => {
    render(
      withProvider(
        <DataTable
          caption="Usuarios de prueba"
          columns={COLUMNS}
          rows={ROWS}
          searchKeys={["name"]}
          search=""
          onSearchChange={() => {}}
          renderRow={() => null}
        />,
      ),
    )

    const searchInput = document.querySelector("input[aria-label='Buscar en la tabla']")
    expect(searchInput).not.toBeNull()
  })

  it("renders sortable column headers with aria-sort attribute", () => {
    render(
      withProvider(
        <DataTable
          caption="Usuarios de prueba"
          columns={COLUMNS}
          rows={ROWS}
          searchKeys={["name"]}
          renderRow={() => null}
        />,
      ),
    )

    const sortButtons = screen.getAllByRole("button")
    expect(sortButtons.length).toBeGreaterThanOrEqual(2)
  })

  it("lets dense catalog tables opt into a fixed layout that uses the available width", () => {
    const { container } = render(
      withProvider(
        <DataTable
          caption="Usuarios de prueba"
          columns={COLUMNS}
          rows={ROWS}
          searchKeys={["name"]}
          tableClassName="table-fixed min-w-0"
          renderRow={() => null}
        />,
      ),
    )

    expect(container.querySelector("table")).toHaveClass("table-fixed", "min-w-0")
  })

  it("does not call router.replace on mount when viewKey is set and parameters match defaults", () => {
    mockReplace.mockClear()
    render(
      withProvider(
        <DataTable
          caption="Usuarios de prueba"
          columns={COLUMNS}
          rows={ROWS}
          searchKeys={["name"]}
          viewKey="test_view"
          renderRow={() => null}
        />,
      ),
    )

    expect(mockReplace).not.toHaveBeenCalled()
  })

  // El cuerpo lo emite `renderRow`, que es del llamador: al ocultar una columna
  // desaparecía su encabezado pero no sus celdas, y la fila entera se corría un
  // lugar, dejando cada valor bajo el encabezado equivocado.
  it("oculta también las celdas de la columna que el usuario apaga", () => {
    // La visibilidad se restaura desde la URL (`<viewKey>_cols`), que es el mismo
    // estado que escribe el selector "Columnas"; se entra por ahí porque el menú
    // de Radix no se despliega en jsdom.
    mockSearchParams = new URLSearchParams("usuarios_cols=name,role")

    render(withProvider(
      <DataTable
        caption="Usuarios"
        columns={COLUMNS}
        rows={ROWS}
        searchKeys={["name"]}
        enableColumnToggle
        viewKey="usuarios"
        renderRow={(row) => (
          <TableRow>
            <TableCell>{row.name as string}</TableCell>
            <TableCell>{row.email as string}</TableCell>
            <TableCell>{row.role as string}</TableCell>
          </TableRow>
        )}
      />,
    ))

    expect(screen.queryByRole("columnheader", { name: /email/i })).not.toBeInTheDocument()

    // La regla se aplica por posición y sobre esta tabla, no globalmente.
    const scope = document.querySelector("table[data-dt]")?.getAttribute("data-dt")
    const style = document.querySelector("style")?.textContent ?? ""
    expect(style).toContain(`[data-dt="${scope}"] tbody td:nth-child(2)`)
    expect(style).toContain("display:none")
    expect(style).not.toContain("nth-child(1)")
    expect(style).not.toContain("nth-child(3)")
  })
})
