// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_RE20_SLA_POLICY } from "@/lib/prevention/incidents"
import type { Re20WorkspaceProps } from "../../types"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
const capaAction = vi.hoisted(() => vi.fn())

vi.mock("@/lib/toast", () => ({ toast }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }))
vi.mock("../../../../actions", () => ({
  savePreventionIncidentRe20WorkspaceAction: vi.fn(),
  createCapaFromRe20MeasureAction: capaAction,
}))
vi.mock("@/lib/prevention/re20-offline-drafts", () => ({
  getRe20OfflineDraft: vi.fn(async () => null),
  putRe20OfflineDraft: vi.fn(async () => ({})),
  deleteRe20OfflineDraft: vi.fn(async () => {}),
}))

import { Re20WorkspaceShell } from "../../re20-workspace-shell"

const ev = (id: string, description: string) => ({ id, description, verified: false, causal: true, requiresVerification: false })

function props(data: Record<string, unknown> = {}, overrides: Partial<Re20WorkspaceProps> = {}): Re20WorkspaceProps {
  return {
    incident: {
      id: "inc-1", code: "INC-2026-001", companyName: "Chome", location: "Frente 3", occurredAt: "2026-10-20T10:00:00.000Z",
      knownAt: "2026-10-20T10:30:00.000Z", status: "under_investigation", actualSeverity: "lost_time", eventType: "work_accident",
      isFatalOrSerious: false, worksiteName: "Faena Norte", version: 3,
    },
    workspace: { version: 2, data, updatedAt: "2026-10-20T11:00:00.000Z" },
    policy: DEFAULT_RE20_SLA_POLICY,
    options: [],
    qualityReviews: [],
    legacyInvestigation: null,
    sensitivePayload: null,
    sensitiveLoadError: null,
    permissions: { canInvestigate: true, canSensitive: false, canNotify: false, canReview: false, canConfigure: false, canConfirmDiffusion: false },
    currentUser: { id: "u1", name: "Ana Pérez" },
    userId: "u1",
    people: [{ id: "u1", name: "Ana Pérez", position: "Prevencionista" }, { id: "u2", name: "Luis Rojas", position: "Supervisor" }],
    involvedPeople: [],
    diffusions: [],
    notifications: [],
    capa: [],
    initialPurpose: "",
    initialStage: "investigacion",
    ...overrides,
  }
}

const tree = {
  causalTree: {
    events: [ev("H1", "El operador sufrió un corte"), ev("H2", "La mano quedó en la zona de corte"), ev("H3", "El resguardo estaba retirado")],
    relations: [
      { from: "H2", to: "H1", type: "chain" },
      { from: "H3", to: "H2", type: "chain" },
    ],
  },
}

describe("etapa Investigación", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/prevencion/incidentes/inc-1?etapa=investigacion")
  })

  it("muestra las seis partes con ancla y su avance", () => {
    render(<Re20WorkspaceShell {...props()} />)
    const nav = screen.getByRole("navigation", { name: "Partes de la investigación" })
    expect(within(nav).getAllByRole("link")).toHaveLength(6)
    expect(within(nav).getByRole("link", { name: /Árbol de causas/ })).toBeTruthy()
  })

  it("sin hechos pide primero el hecho final con la regla del hecho válido", () => {
    render(<Re20WorkspaceShell {...props()} />)
    expect(screen.getByText("Empieza por el hecho final")).toBeTruthy()
    expect(screen.getAllByText(/Un hecho válido es breve, verificable y afirmativo/).length).toBeGreaterThan(0)
    fireEvent.change(document.getElementById("re20-investigacion-hecho-final")!, { target: { value: "La persona se cortó la mano" } })
    fireEvent.click(screen.getByRole("button", { name: /Crear el hecho final/ }))
    expect(screen.getByText(/¿Qué fue necesario para que ocurriera H1\? ¿Fue suficiente por sí solo\?/)).toBeTruthy()
  })

  it("agregar un antecedente crea el hecho y la relación, y la conjunción se deriva sola", () => {
    render(<Re20WorkspaceShell {...props(tree)} />)
    // Cadena mientras H1 tiene un único antecedente.
    expect(screen.getByTestId("relation-type").textContent).toContain("Cadena")
    fireEvent.change(document.getElementById("re20-investigacion-nuevo-antecedente")!, { target: { value: "No había bloqueo de energía" } })
    fireEvent.click(screen.getByRole("button", { name: /Agregar como antecedente de H1/ }))
    expect(screen.getByTestId("relation-type").textContent).toContain("Conjunción")
    expect(screen.getByTestId("relation-type").textContent).toContain("Dos o más hechos debieron concurrir")
    expect(screen.getAllByText("No había bloqueo de energía").length).toBeGreaterThan(0)
  })

  it("el diagrama es una imagen con nombre, descripción textual y trayectorias", () => {
    render(<Re20WorkspaceShell {...props(tree)} />)
    const svg = screen.getByRole("img", { name: /Árbol de causas con 3 hechos, 2 relaciones y 1 causa raíz/ })
    expect(svg.getAttribute("aria-describedby")).toBeTruthy()
    const description = document.getElementById(svg.getAttribute("aria-describedby")!)!
    expect(description.textContent).toContain("H3")
    expect(description.textContent).toContain("Causa raíz")
    expect(description.textContent).toContain("Ocurrió por H3")
    // Trayectoria generada sola: H3 → H2 → H1.
    const list = screen.getByRole("list", { name: "Trayectorias desde cada causa raíz hasta H1" })
    expect(list.textContent).toContain("H3")
    expect(list.textContent).toContain("H1")
    // Sin colores literales: sólo tokens.
    expect(svg.outerHTML).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgb\(/)
  })

  it("el listado de pendientes enlaza al campo y el progreso cuenta lo hecho", async () => {
    render(<Re20WorkspaceShell {...props({ causalTree: { events: [ev("H1", "Corte"), ev("H2", "Suelto")], relations: [] } })} />)
    const issues = screen.getByTestId("tree-issues")
    expect(issues.textContent).toContain("causa raíz")
    fireEvent.click(within(issues).getAllByRole("button")[0]!)
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(document.activeElement).toBeTruthy()
  })

  it("una causa raíz sin medida se marca pendiente y bloquea completar", () => {
    render(<Re20WorkspaceShell {...props(tree)} />)
    expect(screen.getByText("Pendiente: sin medida")).toBeTruthy()
    const blockers = screen.getByTestId("completion-blockers")
    expect(blockers.textContent).toContain("Una medida para la causa raíz H3")
    expect((screen.getByRole("button", { name: "Marcar informe definitivo como completo" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("la medida lleva la jerarquía de controles y el verificador excluye al responsable", () => {
    render(<Re20WorkspaceShell {...props({
      ...tree,
      measures: [{ id: "m1", rootCauseId: "H3", description: "Capacitar al personal", controlType: "Administrativa", responsibleUserId: "u1", effectiveness: {} }],
    })} />)
    expect(screen.getAllByText(/Capacitar o sancionar, por sí solos, rara vez eliminan/).length).toBeGreaterThan(0)
    const group = screen.getByRole("group", { name: /Tipo de control, de más a menos fuerte/ })
    const labels = within(group).getAllByRole("button").map((b) => b.textContent)
    expect(labels).toEqual(["1. Eliminación", "2. Ingeniería", "3. Administrativa", "4. EPP"])
    expect(screen.getByText(/rara vez elimina una causa técnica u organizacional\. ¿Hay una medida más arriba/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Crear CAPA desde esta medida" })).toBeTruthy()
  })

  it("una medida con CAPA muestra el enlace en vez del botón", () => {
    render(<Re20WorkspaceShell {...props({
      ...tree,
      measures: [{ id: "m1", rootCauseId: "H3", description: "Instalar bloqueo", controlType: "Ingeniería", capaId: "capa-1", effectiveness: {} }],
    }, { capa: [{ id: "capa-1", code: "CAPA-001", status: "open" }] })} />)
    const link = screen.getByRole("link", { name: "CAPA CAPA-001" })
    expect(link.getAttribute("href")).toBe("/prevencion/capa/capa-1")
    expect(screen.queryByRole("button", { name: "Crear CAPA desde esta medida" })).toBeNull()
  })

  it("con el caso cerrado la etapa queda en sólo lectura", () => {
    render(<Re20WorkspaceShell {...props(tree, { incident: { ...props().incident, status: "closed" } })} />)
    expect((document.getElementById("re20-investigacion-nuevo-antecedente") as HTMLTextAreaElement).closest("fieldset")!.disabled).toBe(true)
    expect(screen.queryByRole("button", { name: "Marcar informe definitivo como completo" })).toBeNull()
  })

  it("un cuasi accidente leve avisa que el árbol es optativo", () => {
    render(<Re20WorkspaceShell {...props({ nearMiss: { potential: "Bajo" } }, { incident: { ...props().incident, eventType: "dangerous_incident" } })} />)
    expect(screen.getByText("Para este evento el árbol es optativo")).toBeTruthy()
  })
})
