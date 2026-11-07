// @vitest-environment jsdom
/**
 * UX-01: la lista de capacitación ya no filtra ni cuenta nada en el cliente. El
 * servidor entrega la página, los contadores y la paginación; aquí se afirma lo
 * que la pantalla hace con eso: pestañas con sus cifras, un solo diálogo para
 * toda la lista, una acción principal por tarjeta y vacíos que llevan a algún lado.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  TrainingOccurrenceListItem,
  TrainingOccurrenceStatus,
  TrainingOccurrenceStatusCounts,
} from "@/lib/services/prevention-training-occurrences"

let search = "year=2026&faena=ws-1&page=3"
const replace = vi.fn()
const refresh = vi.fn()
const recordAction = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock("next/navigation", () => ({
  usePathname: () => "/prevencion/capacitacion",
  useSearchParams: () => new URLSearchParams(search),
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
}))
vi.mock("./actions", () => ({
  recordTrainingOccurrenceStatusAction: (...args: unknown[]) => recordAction(...args),
}))
vi.mock("@/lib/toast", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), warning: vi.fn() } }))

const { TrainingOccurrenceList } = await import("./training-occurrence-list")

const COUNTS: TrainingOccurrenceStatusCounts = { all: 90, pending: 12, completed: 60, not_completed: 15, not_applicable: 3 }

function makeRow(status: TrainingOccurrenceStatus, overrides: Partial<TrainingOccurrenceListItem> = {}): TrainingOccurrenceListItem {
  return {
    id: `occ-${status}`,
    version: 4,
    code: `CAP-${status.toUpperCase()}`,
    title: `Curso de ${status}`,
    itemType: "course",
    audience: "Todo el personal",
    catalogVersion: "programa-capacitacion-2026-v1",
    pdtpActivityNumbers: [],
    worksiteId: "ws-1",
    worksiteName: "Faena Uno",
    worksiteActive: true,
    year: 2026,
    slotKey: "m03-w2",
    scheduledMonth: 3,
    scheduledWeek: 2,
    status,
    completedAt: status === "completed" ? "2026-03-10T12:00:00.000Z" : null,
    completedByUserId: status === "completed" ? "u-1" : null,
    completedByName: status === "completed" ? "Ana Prevención" : null,
    observation: status === "not_completed" ? "Se reprograma" : null,
    notApplicableReason: status === "not_applicable" ? "La faena no opera equipos de izaje" : null,
    evidence: [],
    ...overrides,
  }
}

type ListProps = React.ComponentProps<typeof TrainingOccurrenceList>

function renderList(overrides: Partial<ListProps> = {}) {
  const props: ListProps = {
    rows: [makeRow("pending"), makeRow("completed"), makeRow("not_completed"), makeRow("not_applicable")],
    counts: COUNTS,
    status: "pending",
    search: "",
    worksites: [
      { id: "ws-1", name: "Faena Uno", isActive: true },
      { id: "ws-2", name: "Faena Dos", isActive: true },
    ],
    selectedYear: 2026,
    selectedWorksiteId: "",
    selectedMonth: null,
    programLabel: "Programa anual 2026 · versión 1",
    hasProgram: true,
    canRecord: true,
    activationByWorksite: {},
    clearFiltersHref: "/prevencion/capacitacion?faena=ws-1&year=2026",
    showAllHref: "/prevencion/capacitacion?faena=ws-1&year=2026&estado=todas",
    pagination: <nav aria-label="Paginación">1 - 25 de 90</nav>,
    ...overrides,
  }
  return render(<TrainingOccurrenceList {...props} />)
}

/** La tarjeta de la fila de ese estado (cada fila de prueba se titula «Curso de <estado>»). */
const card = (status: TrainingOccurrenceStatus) => screen.getByRole("heading", { level: 2, name: `Curso de ${status}` }).closest("article")!

describe("TrainingOccurrenceList (página del servidor)", () => {
  beforeEach(() => {
    search = "year=2026&faena=ws-1&page=3"
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("las pestañas llevan los contadores del servidor y conservan el resto de la URL salvo la página", () => {
    renderList()
    const tabs = screen.getByRole("navigation", { name: "Filtrar por estado" })
    expect(within(tabs).getByRole("link", { name: /^Pendientes\s*12$/ }).getAttribute("aria-current")).toBe("page")
    expect(within(tabs).getByRole("link", { name: /^Hechas\s*60$/ }).getAttribute("href"))
      .toBe("/prevencion/capacitacion?year=2026&faena=ws-1&estado=hecha")
    expect(within(tabs).getByRole("link", { name: /^No hechas\s*15$/ })).toBeTruthy()
    expect(within(tabs).getByRole("link", { name: /^No aplican\s*3$/ })).toBeTruthy()
    expect(within(tabs).getByRole("link", { name: /^Todas\s*90$/ }).getAttribute("href"))
      .toBe("/prevencion/capacitacion?year=2026&faena=ws-1&estado=todas")
    // «Pendientes» es la vista por omisión: su enlace quita `estado` en vez de escribirlo.
    expect(within(tabs).getByRole("link", { name: /^Pendientes\s*12$/ }).getAttribute("href"))
      .toBe("/prevencion/capacitacion?year=2026&faena=ws-1")
  })

  it("la pestaña activa sale de la URL: `estado=hecha` marca «Hechas»", () => {
    search = "estado=hecha"
    renderList({ status: "completed" })
    const tabs = screen.getByRole("navigation", { name: "Filtrar por estado" })
    expect(within(tabs).getByRole("link", { name: /^Hechas/ }).getAttribute("aria-current")).toBe("page")
    expect(within(tabs).getByRole("link", { name: /^Pendientes/ }).getAttribute("aria-current")).toBeNull()
  })

  it("pinta las filas tal como llegan y rotula cada una en singular, distinto de la pestaña", () => {
    renderList()
    expect(screen.getAllByRole("article")).toHaveLength(4)
    expect(within(card("pending")).getByText("Pendiente")).toBeTruthy()
    expect(within(card("completed")).getByText("Hecha")).toBeTruthy()
    expect(within(card("not_completed")).getByText("No hecha")).toBeTruthy()
    expect(within(card("not_applicable")).getByText("No aplica")).toBeTruthy()
    // El plural es de la pestaña, no del badge de una actividad.
    expect(within(card("completed")).queryByText("Hechas")).toBeNull()
    // Cada tarjeta dice su faena: sin faena elegida, las de distintas faenas se intercalan.
    expect(within(card("pending")).getByText("Faena Uno")).toBeTruthy()
  })

  it("renderiza el nodo de paginación que arma el servidor", () => {
    renderList()
    expect(screen.getByRole("navigation", { name: "Paginación" }).textContent).toBe("1 - 25 de 90")
  })

  it("el rótulo del programa es legible, no el slug del catálogo", () => {
    renderList()
    expect(screen.getByText("Programa anual 2026 · versión 1")).toBeTruthy()
    expect(screen.queryByText(/programa-capacitacion-2026-v1/)).toBeNull()
  })

  it("el selector de faena muestra su valor desde el primer pintado", () => {
    const { unmount } = renderList()
    expect(screen.getByRole("combobox", { name: "Filtrar por faena" }).textContent).toContain("Todas las faenas")
    unmount()
    renderList({ selectedWorksiteId: "ws-2" })
    expect(screen.getByRole("combobox", { name: "Filtrar por faena" }).textContent).toContain("Faena Dos")
  })

  it("el buscador está rotulado y el chip de mes se quita sin perder estado, texto ni faena", () => {
    search = "year=2026&faena=ws-1&estado=todas&q=casco&mes=4&page=2"
    renderList({ selectedMonth: 4, status: "all", search: "casco" })
    expect(screen.getByRole("searchbox", { name: "Buscar actividad o faena" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro Mes" }))
    expect(replace).toHaveBeenCalledTimes(1)
    const [href, options] = replace.mock.calls[0]!
    const params = new URL(href as string, "http://x").searchParams
    expect(params.get("mes")).toBeNull()
    expect(params.get("page")).toBeNull()
    expect(params.get("estado")).toBe("todas")
    expect(params.get("q")).toBe("casco")
    expect(params.get("faena")).toBe("ws-1")
    expect(options).toEqual({ scroll: false })
  })

  describe("acciones", () => {
    it("cada tarjeta ofrece UNA acción principal según su estado, y el resto en «Más acciones»", () => {
      renderList()
      const primary = (status: TrainingOccurrenceStatus) => within(card(status)).getAllByRole("button").map((button) => button.textContent?.trim())
      expect(primary("pending")).toContain("Marcar hecha")
      expect(primary("completed")).toContain("Corregir a no hecha")
      expect(primary("not_completed")).toContain("Marcar hecha")
      expect(primary("not_applicable")).toContain("Marcar hecha")
      // Nunca tres botones: la principal y el menú.
      expect(within(card("pending")).getAllByRole("button")).toHaveLength(2)
    })

    it("«Más acciones» ofrece los demás destinos, nunca el estado actual", async () => {
      renderList()
      fireEvent.keyDown(within(card("pending")).getByRole("button", { name: /Más acciones/ }), { key: "Enter" })
      expect(await screen.findByRole("menuitem", { name: "Marcar no hecha" })).toBeTruthy()
      expect(screen.getByRole("menuitem", { name: "No aplica" })).toBeTruthy()
      expect(screen.queryByRole("menuitem", { name: "Marcar hecha" })).toBeNull()
    })

    it("una hecha ofrece corregir a no hecha como principal y «No aplica» en el menú", async () => {
      renderList()
      fireEvent.keyDown(within(card("completed")).getByRole("button", { name: /Más acciones/ }), { key: "Enter" })
      expect(await screen.findByRole("menuitem", { name: "No aplica" })).toBeTruthy()
      expect(screen.queryByRole("menuitem", { name: /no hecha/i })).toBeNull()
    })

    it("sin permiso de registrar, o en una faena inactiva, no hay acciones", () => {
      renderList({ canRecord: false })
      expect(screen.queryByRole("button", { name: /Marcar|Corregir|Más acciones/ })).toBeNull()
      cleanup()
      renderList({ rows: [makeRow("pending", { worksiteActive: false })] })
      expect(screen.queryByRole("button", { name: /Marcar|Más acciones/ })).toBeNull()
      expect(screen.getByText(/Historial de una faena inactiva/)).toBeTruthy()
    })

    it("hay un solo diálogo para toda la lista: no existe hasta que se toca una acción, y abre con el destino correcto", async () => {
      renderList()
      expect(screen.queryByRole("dialog")).toBeNull()

      fireEvent.click(within(card("pending")).getByRole("button", { name: "Marcar hecha" }))
      let dialog = await screen.findByRole("dialog")
      expect(screen.getAllByRole("dialog")).toHaveLength(1)
      expect(within(dialog).getByText("Marcar capacitación como hecha")).toBeTruthy()
      expect(within(dialog).getByText(/CAP-PENDING · Curso de pending · Faena Uno/)).toBeTruthy()
      expect(within(dialog).getByText("Evidencia")).toBeTruthy()

      fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

      // Otra tarjeta, otro destino, el mismo diálogo.
      fireEvent.keyDown(within(card("completed")).getByRole("button", { name: /Más acciones/ }), { key: "Enter" })
      fireEvent.click(await screen.findByRole("menuitem", { name: "No aplica" }))
      dialog = await screen.findByRole("dialog")
      expect(within(dialog).getByText("Declarar que la capacitación no aplica")).toBeTruthy()
      expect(within(dialog).getByText(/CAP-COMPLETED · Curso de completed/)).toBeTruthy()
      expect(within(dialog).getByLabelText(/Motivo/)).toBeTruthy()
    })

    it("reabrir parte de un formulario limpio", async () => {
      renderList()
      const open = () => fireEvent.click(within(card("completed")).getByRole("button", { name: "Corregir a no hecha" }))
      open()
      let dialog = await screen.findByRole("dialog")
      fireEvent.change(within(dialog).getByLabelText(/Observación/), { target: { value: "texto a medias" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

      open()
      dialog = await screen.findByRole("dialog")
      expect((within(dialog).getByLabelText(/Observación/) as HTMLTextAreaElement).value).toBe("")
    })

    it("«no aplica» pide el motivo antes de llamar al servidor", async () => {
      renderList()
      fireEvent.keyDown(within(card("pending")).getByRole("button", { name: /Más acciones/ }), { key: "Enter" })
      fireEvent.click(await screen.findByRole("menuitem", { name: "No aplica" }))
      const dialog = await screen.findByRole("dialog")
      fireEvent.change(within(dialog).getByLabelText(/Motivo/), { target: { value: "corto" } })
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar no aplica" }))
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining("al menos 10 caracteres"))
      expect(recordAction).not.toHaveBeenCalled()
    })

    it("guardar envía la versión de la fila, cierra el diálogo y NO pide un segundo refresh", async () => {
      recordAction.mockResolvedValue({ ok: true, message: "Capacitación marcada como no hecha." })
      renderList()
      fireEvent.keyDown(within(card("pending")).getByRole("button", { name: /Más acciones/ }), { key: "Enter" })
      fireEvent.click(await screen.findByRole("menuitem", { name: "Marcar no hecha" }))
      const dialog = await screen.findByRole("dialog")
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar no hecha" }))

      await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Capacitación marcada como no hecha."))
      expect(recordAction).toHaveBeenCalledWith({
        occurrenceId: "occ-pending",
        expectedVersion: 4,
        status: "not_completed",
        observation: null,
        notApplicableReason: null,
      })
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
      // La acción ya revalida la ruta; otro `router.refresh()` encima es una recarga completa en Next 16.
      expect(refresh).not.toHaveBeenCalled()
    })

    it("si el servidor rechaza, el diálogo sigue abierto y el aviso nombra el motivo", async () => {
      recordAction.mockResolvedValue({ ok: false, message: "La capacitación cambió mientras la editabas. Recarga y reintenta." })
      renderList()
      fireEvent.keyDown(within(card("pending")).getByRole("button", { name: /Más acciones/ }), { key: "Enter" })
      fireEvent.click(await screen.findByRole("menuitem", { name: "Marcar no hecha" }))
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirmar no hecha" }))

      await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining("cambió mientras la editabas")))
      expect(screen.getByRole("dialog")).toBeTruthy()
      expect(refresh).not.toHaveBeenCalled()
    })
  })

  describe("vacíos", () => {
    it("sin casillas en TODO el alcance, el programa no está cargado y el CTA lleva a las faenas", () => {
      renderList({ rows: [], hasProgram: false, counts: { all: 0, pending: 0, completed: 0, not_completed: 0, not_applicable: 0 } })
      expect(screen.getByText("El programa 2026 aún no tiene actividades")).toBeTruthy()
      expect(screen.getByRole("link", { name: "Revisar faenas" }).getAttribute("href")).toBe("/prevencion/faenas")
    })

    it("una página vacía con programa NO dice que falte el programa", () => {
      renderList({ rows: [], hasProgram: true, status: "completed" })
      expect(screen.queryByText(/aún no tiene actividades/)).toBeNull()
      expect(screen.getByText("Sin coincidencias")).toBeTruthy()
      expect(screen.getByRole("link", { name: "Limpiar filtros" }).getAttribute("href"))
        .toBe("/prevencion/capacitacion?faena=ws-1&year=2026")
    })

    it("«Pendientes» vacío es la buena noticia, con salida a todas", () => {
      renderList({ rows: [], status: "pending", counts: { ...COUNTS, pending: 0 } })
      expect(screen.getByText("No hay actividades pendientes")).toBeTruthy()
      expect(screen.getByRole("link", { name: "Ver todas" }).getAttribute("href"))
        .toBe("/prevencion/capacitacion?faena=ws-1&year=2026&estado=todas")
    })

    it("«Pendientes» vacío con una búsqueda activa sí es una búsqueda sin resultados", () => {
      renderList({ rows: [], status: "pending", search: "zzz" })
      expect(screen.getByText("Sin coincidencias")).toBeTruthy()
      expect(screen.getByRole("link", { name: "Limpiar filtros" })).toBeTruthy()
    })
  })
})
