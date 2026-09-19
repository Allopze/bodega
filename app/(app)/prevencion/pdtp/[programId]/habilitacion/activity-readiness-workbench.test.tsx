// @vitest-environment jsdom
/**
 * El defecto que originó el rediseño, convertido en test: el panel anterior
 * mostraba veinte actividades, repetía la misma frase en las catorce filas de
 * un grupo y no ofrecía ninguna acción. En prueba de usabilidad el
 * prevencionista no pudo resolver ninguna.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"

const mockReplace = vi.fn()
let mockSearchParams = new URLSearchParams()
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  usePathname: () => "/prevencion/pdtp/p-1/habilitacion",
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock("@/app/(app)/prevencion/inspecciones/actions", () => ({ remindTemplateApprovalAction: vi.fn() }))
vi.mock("@/app/(app)/prevencion/capacitacion/actions", () => ({ remindTrainingCourseVersionApprovalAction: vi.fn() }))
vi.mock("@/app/(app)/prevencion/emergencias/actions", () => ({ remindEmergencyPlanApprovalAction: vi.fn() }))

import { ActivityReadinessWorkbench, type ReadinessRow } from "./activity-readiness-workbench"
import { READINESS_FORBIDDEN_JARGON } from "./readiness-copy"

function row(over: Partial<ReadinessRow> = {}): ReadinessRow {
  return {
    activityId: `act-${over.n ?? 1}`,
    n: 1,
    activity: "Actividad",
    status: "instrument_required",
    blocks: false,
    reason: "motivo",
    instrumentKind: "Plantilla",
    instrumentCode: "INS-014",
    instrumentState: "En borrador",
    worksiteNames: null,
    resolution: { kind: "open", href: "/prevencion/inspecciones/plantillas?estado=draft&q=INS-014", label: "Abrir la plantilla" },
    ...over,
  }
}

/** Las dos filas gemelas del informe real: N°37 y N°38 con texto idéntico. */
const GEMELAS: ReadinessRow[] = [
  row({ n: 37, activity: "Realizar Charlas de Seguridad para reforzar las conductas seguras", instrumentKind: "Curso", instrumentCode: "CAP-37", reason: "Curso CAP-37 sin ninguna versión" }),
  row({ n: 38, activity: "Realizar Charlas de Seguridad para reforzar las conductas seguras", instrumentKind: "Curso", instrumentCode: "CAP-38", reason: "Curso CAP-38 v02 sin publicar" }),
]

afterEach(() => { cleanup(); mockSearchParams = new URLSearchParams(); mockReplace.mockClear() })

/* La bandeja renderiza la tabla y las tarjetas a la vez y deja que el CSS
 * esconda una (mismo patrón que `/pendientes`). En un navegador `display:none`
 * las saca del árbol de accesibilidad; en jsdom no hay CSS, así que las
 * consultas se acotan a la vista que se está afirmando. */
const table = () => within(screen.getByRole("table"))

describe("ActivityReadinessWorkbench", () => {
  it("dos filas del mismo grupo con instrumentos distintos muestran motivos distintos", () => {
    render(<ActivityReadinessWorkbench rows={GEMELAS} total={81} ready={67} />)
    expect(table().getByText("Curso CAP-37 sin ninguna versión")).toBeDefined()
    expect(table().getByText("Curso CAP-38 v02 sin publicar")).toBeDefined()
  })

  it("la explicación del grupo se muestra una sola vez para N filas", () => {
    render(<ActivityReadinessWorkbench rows={GEMELAS} total={81} ready={67} />)
    const blurb = screen.getAllByText(/La plantilla, el curso o el plan que las respalda existe/)
    expect(blurb).toHaveLength(1)
  })

  it("cada fila tiene una acción y un nombre accesible único", () => {
    render(<ActivityReadinessWorkbench rows={GEMELAS} total={81} ready={67} />)
    // El verbo visible se repite; el nombre accesible no. Con veinte filas, el
    // mismo `aria-label` en todas deja veinte enlaces indistinguibles.
    const labels = table().getAllByRole("link").map((link) => link.getAttribute("aria-label"))
    expect(labels).toHaveLength(2)
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels[0]).toContain("N°37")
  })

  it("los chips cuentan por vista y escriben la vista en la URL", () => {
    const rows = [
      row({ n: 1, blocks: true, status: "code_gap" }),
      row({ n: 2 }),
      row({ n: 3, status: "segregated_valid", blocks: false }),
    ]
    render(<ActivityReadinessWorkbench rows={rows} total={81} ready={78} />)

    const frenan = screen.getByRole("button", { name: /Frenan la firma/ })
    expect(within(frenan).getByText("1")).toBeDefined()
    expect(frenan.getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(frenan)
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining("vista=blocking"),
      expect.anything(),
    )
  })

  it("un chip en cero sigue siendo pulsable y explica el cero", () => {
    render(<ActivityReadinessWorkbench rows={[row({ n: 2 })]} total={81} ready={80} />)
    const frenan = screen.getByRole("button", { name: /Frenan la firma/ })
    expect(frenan.hasAttribute("disabled")).toBe(false)
    expect(frenan.getAttribute("title")).toMatch(/Sin actividades en esta vista/)
  })

  it("nombre largo se recorta a dos líneas pero conserva el texto completo", () => {
    const largo = "Realizar Charlas de Seguridad para reforzar las conductas seguras. Estas charlas tienen como objetivo generar un espacio de diálogo entre la jefatura y el personal."
    render(<ActivityReadinessWorkbench rows={[row({ n: 37, activity: largo })]} total={81} ready={80} />)
    const cell = table().getByTitle(largo)
    expect(cell.className).toContain("line-clamp-2")
  })

  it("las faenas van al árbol de accesibilidad, no sólo al tooltip", () => {
    render(<ActivityReadinessWorkbench rows={[row({
      n: 84, instrumentKind: "Plan de emergencia",
      worksiteNames: ["Faena Norte", "Faena Sur", "Faena Centro"],
    })]} total={81} ready={80} />)
    expect(table().getByText("3 faenas")).toBeDefined()
    expect(table().getByText("Faena Norte, Faena Sur, Faena Centro")).toBeDefined()
  })

  it("ofrece pedir la aprobación a quien no puede firmar", () => {
    render(<ActivityReadinessWorkbench rows={[row({
      n: 24,
      resolution: { kind: "request", target: { kind: "template", templateId: "tpl-1" }, label: "Solicitar aprobación" },
    })]} total={81} ready={80} />)
    expect(table().getByRole("button", { name: "Solicitar aprobación" })).toBeDefined()
  })

  it("a quien no puede hacer nada le dice a quién pedírselo, sin un botón muerto", () => {
    render(<ActivityReadinessWorkbench rows={[row({
      n: 24,
      resolution: { kind: "blocked", askRoles: ["Jefatura de Prevención"], permissionLabel: "registrar inspecciones" },
    })]} total={81} ready={80} />)
    expect(table().getByText("Pídeselo a Jefatura de Prevención")).toBeDefined()
    // Un botón gris en una lista de triage se lee como "roto" y no dice qué hacer.
    expect(screen.queryByRole("button", { name: /Aprobar/ })).toBeNull()
  })

  it("anuncia el conteo visible para quien navega con lector de pantalla", () => {
    render(<ActivityReadinessWorkbench rows={GEMELAS} total={81} ready={67} />)
    expect(screen.getByRole("status").textContent).toBe("Mostrando 2 de 2 actividades.")
  })

  it("con filtros que no dejan nada, ofrece limpiarlos en vez de una lista vacía muda", () => {
    mockSearchParams = new URLSearchParams("faena=Faena%20Inexistente")
    render(<ActivityReadinessWorkbench rows={GEMELAS} total={81} ready={67} />)
    expect(screen.getByText("No hay actividades con estos filtros")).toBeDefined()
    // Hay dos salidas a propósito: la de la barra de filtros y la del propio
    // estado vacío, que es donde el usuario está mirando cuando se queda sin
    // resultados.
    expect(screen.getAllByRole("button", { name: /Limpiar filtros/ }).length).toBeGreaterThanOrEqual(1)
  })

  it("sin filas muestra el estado de éxito, no una tabla vacía", () => {
    render(<ActivityReadinessWorkbench rows={[]} total={81} ready={81} />)
    expect(screen.getByText("Todo listo")).toBeDefined()
  })

  it("no muestra jerga interna en ninguna parte", () => {
    const { container } = render(<ActivityReadinessWorkbench
      rows={[row({ n: 1, blocks: true, status: "code_gap" }), row({ n: 2 }), row({ n: 3, status: "segregated_valid" })]}
      total={81} ready={78}
    />)
    const text = (container.textContent ?? "").toLocaleLowerCase("es-CL")
    for (const term of READINESS_FORBIDDEN_JARGON) {
      expect(text, term).not.toContain(term)
    }
  })

  it("la tabla declara en su caption el orden que realmente aplica", () => {
    render(<ActivityReadinessWorkbench rows={GEMELAS} total={81} ready={67} />)
    expect(screen.getByText(/ordenadas por gravedad y número/i)).toBeDefined()
  })
})
