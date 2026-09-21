// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { InspectionPageActions, InspectionRunList } from "./inspection-run-list"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/prevencion/inspecciones",
}))

afterEach(cleanup)

const TODAY = "2026-09-21"

const run = (over: Record<string, unknown> = {}) => ({
  id: "run-1",
  code: "INSP-2026-MEX_JILF",
  status: "planned",
  templateName: "Observación de Seguridad: Camión Ampliroll",
  templateKind: "inspection",
  origin: "prevencion",
  assigneeName: "Lorena Alvarado",
  subjectLabel: "KA122",
  worksiteId: "ws-1",
  worksiteName: "Teno - Arauco",
  executedAt: null,
  scheduledFor: "2026-08-25",
  compliancePercent: null,
  nonConformingCount: 0,
  openFindings: 0,
  criticalFindings: 0,
  ...over,
})

const summary = { total: 1, pendingReview: 0, withOpenFindings: 0, withCriticalFindings: 0, overdueRuns: 0 }

function renderList(over: Record<string, unknown> = {}, props: Record<string, unknown> = {}) {
  return render(
    <InspectionRunList
      runs={[run(over)] as never}
      summary={summary}
      page={1}
      pageSize={25}
      overdueProgramCount={0}
      today={TODAY}
      canExecute={false}
      templates={[]}
      worksites={[]}
      assignees={[]}
      subjectsByWorksite={{}}
      {...props}
    />,
  )
}

describe("bandeja de inspecciones — el rojo de 'Vencida'", () => {
  it("no marca vencida una inspección cancelada con fecha pasada", () => {
    // Las dos vistas viven a la vez en el DOM (tarjetas `md:hidden` + tabla
    // `hidden md:block`), así que buscar en todo el árbol prueba las dos: la
    // tabla comparaba sólo la fecha y pintaba "Vencida" en rojo sobre una
    // cancelada, mientras el KPI "Vencidas" la contaba en cero.
    renderList({ status: "cancelled" })
    // `/Vencida ·/` y no `/Vencida/`: el tile del KPI se llama "Vencidas".
    expect(screen.queryAllByText(/Vencida ·/)).toHaveLength(0)
    expect(screen.queryAllByText(/Programada · 25-08-2026/).length).toBeGreaterThan(0)
  })

  it("sí marca vencida una planificada con fecha pasada, en ambas vistas", () => {
    renderList({ status: "planned" })
    expect(screen.queryAllByText(/Vencida · 25-08-2026/)).toHaveLength(2)
  })
})

describe("bandeja de inspecciones — densidad de la fila de KPI (A1)", () => {
  it("expone cuatro tiles y ninguno navega fuera de la lista", () => {
    renderList()
    const tiles = screen.getAllByRole("button", { pressed: false })
      .filter((node) => node.className.includes("text-eyebrow") || node.querySelector(".text-eyebrow"))
    expect(tiles).toHaveLength(4)
    expect(screen.queryByText("Programaciones vencidas")).toBeNull()
  })

  it("un tile en cero no es pulsable y afirma el estado bueno", () => {
    renderList()
    const zero = screen.getByText("Con hallazgos abiertos").closest("button")
    expect(zero).toBeDisabled()
    expect(screen.getByText("Sin hallazgos abiertos")).toBeTruthy()
  })

  it("el aviso de programaciones vencidas aparece sólo cuando hay alguna", () => {
    const { unmount } = renderList()
    expect(screen.queryByRole("link", { name: "Ver y regularizar" })).toBeNull()
    unmount()
    renderList({}, { overdueProgramCount: 3 })
    expect(screen.getByText("3 programaciones vencidas")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ver y regularizar" })).toHaveAttribute(
      "href", "/prevencion/inspecciones/programacion?vista=vencidas",
    )
  })
})

describe("bandeja de inspecciones — cumplimiento no calculable (A6)", () => {
  it("usa la misma etiqueta en tarjeta y tabla, y explica el motivo", () => {
    renderList({ status: "cancelled" })
    // Antes la tarjeta decía "Aún no calculable" y la tabla "No calculable".
    expect(screen.queryAllByText("Aún no calculable")).toHaveLength(0)
    const celdas = screen.queryAllByText("No calculable")
    expect(celdas).toHaveLength(2)
    for (const celda of celdas) {
      expect(celda).toHaveAttribute("title", "No calculable: la inspección se canceló sin ejecutarse.")
    }
  })

  it("el motivo cambia con el estado de la ejecución", () => {
    renderList({ status: "planned" })
    expect(screen.queryAllByText("No calculable")[0]).toHaveAttribute(
      "title", "No calculable: la inspección aún no se ejecuta.",
    )
  })
})

describe("bandeja de inspecciones — la cabecera sólo lleva acciones", () => {
  it("ya no repite las rutas hermanas que el menú lateral lista", () => {
    render(
      <InspectionPageActions
        canCreate={false}
        canExport
        templates={[]}
        worksites={[]}
        assignees={[]}
        subjectsByWorksite={{}}
        exportQuery=""
      />,
    )
    // Queda la única acción de página que no es el verbo primario.
    expect(screen.getByRole("link", { name: "Exportar Excel" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Plantillas" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Programación" })).toBeNull()
    // El menú de overflow existía sólo para esas dos rutas en móvil.
    expect(screen.queryByRole("button", { name: "Más acciones de inspecciones" })).toBeNull()
  })
})
