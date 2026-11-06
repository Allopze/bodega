// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/trabajadores",
  useSearchParams: () => new URLSearchParams(nav.search),
}))
vi.mock("./actions", () => ({
  toggleWorkerActive: vi.fn(),
  bulkAssignWorkerPositionAction: vi.fn(),
}))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("./worker-form", () => ({ WorkerForm: () => null }))

import { WorkerList } from "./worker-list"
import type { AssignablePosition } from "./bulk-assign-dialog"

type Overrides = {
  position?: { name: string; needsReview: boolean }
  unclassified?: boolean
  hasDriverLicense?: boolean
}

function worker(id: string, firstName: string, isActive: boolean, overrides: Overrides = {}) {
  const { position, unclassified = false, hasDriverLicense = false } = overrides
  return {
    id, rut: null, firstName, lastName: "Prueba", sex: null,
    position: position?.name ?? null,
    positionId: position ? "pos-1" : null,
    positionNeedsReview: position?.needsReview ?? false,
    unclassified,
    hasDriverLicense,
    worksiteId: "ws-1", worksiteName: "Faena Uno", isActive,
    createdAt: "2026-08-18T00:00:00.000Z",
    sizeTop: null, sizeBottom: null, sizeShoe: null, sizeGloves: null, sizeHelmet: null,
  }
}

const CONDUCTOR: AssignablePosition = {
  id: "pos-conductor",
  name: "Conductor de camión",
  needsReview: false,
  aliases: ["Chofer"],
  capabilities: [{ id: "cap-drive", name: "Conduce vehículos" }],
  drives: true,
  requiredLicenseClasses: ["A4", "A5"],
}

const WORKERS = [worker("w-1", "Ana", true), worker("w-2", "Beto", false)]
const WORKSITES = [{ id: "ws-1", name: "Faena Uno" }]

function renderList(workers = WORKERS, search = "") {
  nav.search = search
  return render(
    <WorkerList
      sizeFamilies={[]}
      positions={[]}
      workers={workers}
      worksites={WORKSITES}
      assignablePositions={[CONDUCTOR]}
    />,
  )
}

/** jsdom no aplica media queries: las tarjetas móviles y la tabla se montan a la
 *  vez, así que todas las aserciones van dentro de la tabla. */
function table() {
  return within(screen.getByRole("table"))
}

/** Cuatro activos —tres sin cargo— y un inactivo sin cargo, que no cuenta. */
const SIN_CARGO_WORKERS = [
  worker("w-1", "Ana", true, { unclassified: true }),
  worker("w-2", "Beto", false, { unclassified: true }),
  worker("w-3", "Carla", true, { position: { name: "Supervisor", needsReview: false } }),
  worker("w-4", "Dani", true, { unclassified: true, hasDriverLicense: true }),
  worker("w-5", "Eli", true, { unclassified: true }),
]

afterEach(() => { cleanup(); vi.clearAllMocks(); nav.search = "" })

describe("WorkerList — vistas", () => {
  it("abre en «Activos» y separa a los desactivados en su propia vista", () => {
    renderList()
    expect(table().queryByText("Ana Prueba")).not.toBeNull()
    expect(table().queryByText("Beto Prueba")).toBeNull()

    cleanup()
    renderList(WORKERS, "vista=inactivos")
    expect(table().queryByText("Beto Prueba")).not.toBeNull()
    expect(table().queryByText("Ana Prueba")).toBeNull()
  })

  it("cambiar de pestaña escribe ?vista= con router.replace y sin saltar el scroll", () => {
    renderList()

    // Radix activa la pestaña en mousedown, no en click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Inactivos/ }))
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/trabajadores?vista=inactivos", { scroll: false })

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Sin cargo/ }))
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/trabajadores?vista=sin-cargo", { scroll: false })
  })

  it("volver a «Activos» limpia el parámetro en vez de escribir vista=activos", () => {
    renderList(WORKERS, "vista=inactivos")

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Activos/ }))

    expect(nav.replace).toHaveBeenLastCalledWith("/admin/trabajadores", { scroll: false })
  })

  it("conserva los demás parámetros de la URL al cambiar de vista", () => {
    renderList(WORKERS, "otro=1&vista=inactivos")

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Sin cargo/ }))

    expect(nav.replace).toHaveBeenLastCalledWith("/admin/trabajadores?otro=1&vista=sin-cargo", { scroll: false })
  })

  it("un ?vista= desconocido cae en «Activos»", () => {
    renderList(WORKERS, "vista=cualquiera")
    expect(table().queryByText("Ana Prueba")).not.toBeNull()
  })

  it("marca el cargo pendiente de revisión sin ocultar su nombre", () => {
    const workers = [
      worker("w-1", "Ana", true, { position: { name: "Operador", needsReview: true } }),
      worker("w-2", "Carla", true, { position: { name: "Supervisor", needsReview: false } }),
    ]
    renderList(workers)

    expect(table().queryByText("Operador")).not.toBeNull()
    expect(table().queryByText("Supervisor")).not.toBeNull()
    // Una sola fila trae el cargo sin revisar: el badge no debe propagarse.
    expect(table().queryAllByText("Por revisar")).toHaveLength(1)
  })
})

describe("WorkerList — «Sin cargo»", () => {
  it("cuenta sólo a los activos sin cargo, en la pestaña (una sola representación)", () => {
    renderList(SIN_CARGO_WORKERS)

    // Ana, Dani y Eli: Beto está inactivo y Carla ya tiene cargo.
    expect(screen.getByRole("tab", { name: /Sin cargo/ })).toHaveTextContent(/Sin cargo\s*3/)
    expect(screen.getByRole("tab", { name: /Activos/ })).toHaveTextContent(/Activos\s*4/)
  })

  it("lista a quienes no tienen cargo y nadie más", () => {
    renderList(SIN_CARGO_WORKERS, "vista=sin-cargo")

    expect(table().queryByText("Ana Prueba")).not.toBeNull()
    expect(table().queryByText("Dani Prueba")).not.toBeNull()
    expect(table().queryByText("Eli Prueba")).not.toBeNull()
    expect(table().queryByText("Beto Prueba")).toBeNull()
    expect(table().queryByText("Carla Prueba")).toBeNull()
  })

  it("sin nadie por clasificar dice que todos tienen cargo y ofrece volver a los activos", () => {
    renderList([worker("w-1", "Ana", true, { position: { name: "Supervisor", needsReview: false } })], "vista=sin-cargo")

    expect(screen.getByText("Todos los trabajadores tienen cargo")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Ver trabajadores activos" }))
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/trabajadores", { scroll: false })
  })

  it("no ofrece seleccionar en las otras vistas", () => {
    renderList(SIN_CARGO_WORKERS)
    expect(screen.queryByRole("checkbox", { name: /Seleccionar/ })).toBeNull()
  })

  it("la barra de acciones aparece con la selección y se va al limpiarla", () => {
    renderList(SIN_CARGO_WORKERS, "vista=sin-cargo")
    expect(screen.queryByRole("region", { name: "Acciones sobre la selección" })).toBeNull()

    fireEvent.click(table().getByRole("checkbox", { name: "Seleccionar a Ana Prueba" }))
    const bar = screen.getByRole("region", { name: "Acciones sobre la selección" })
    expect(bar).toHaveTextContent("1 seleccionado")
    expect(within(bar).getByRole("button", { name: "Asignar cargo" })).toBeTruthy()

    fireEvent.click(table().getByRole("checkbox", { name: "Seleccionar a Eli Prueba" }))
    expect(bar).toHaveTextContent("2 seleccionados")

    fireEvent.click(within(bar).getByRole("button", { name: "Limpiar selección" }))
    expect(screen.queryByRole("region", { name: "Acciones sobre la selección" })).toBeNull()
    expect(table().getByRole("checkbox", { name: "Seleccionar a Ana Prueba" })).not.toBeChecked()
  })

  it("«Seleccionar todos» marca cada fila visible y lo vuelve a quitar", () => {
    renderList(SIN_CARGO_WORKERS, "vista=sin-cargo")

    const all = screen.getByRole("checkbox", { name: "Seleccionar todos (3)" })
    fireEvent.click(all)
    expect(screen.getByRole("region", { name: "Acciones sobre la selección" })).toHaveTextContent("3 seleccionados")
    expect(table().getByRole("checkbox", { name: "Seleccionar a Dani Prueba" })).toBeChecked()

    fireEvent.click(all)
    expect(screen.queryByRole("region", { name: "Acciones sobre la selección" })).toBeNull()
  })

  it("«Asignar cargo» abre el diálogo con la cantidad seleccionada", () => {
    renderList(SIN_CARGO_WORKERS, "vista=sin-cargo")
    fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar todos (3)" }))

    fireEvent.click(within(screen.getByRole("region", { name: "Acciones sobre la selección" })).getByRole("button", { name: "Asignar cargo" }))

    const dialog = screen.getByRole("dialog", { name: "Asignar cargo" })
    expect(within(dialog).getByText(/Se aplicará a 3 trabajadores seleccionados/)).toBeTruthy()
    expect(within(dialog).getByRole("button", { name: "Asignar a 3" })).toBeDisabled()
  })
})
