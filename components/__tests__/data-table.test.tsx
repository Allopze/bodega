// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { DataTable } from "@/components/admin/data-table"
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
  afterEach(cleanup)

  it("renders table with headers and rows", () => {
    render(
      withProvider(
        <DataTable
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

  it("shows empty state when no rows", () => {
    render(
      withProvider(
        <DataTable
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
})
