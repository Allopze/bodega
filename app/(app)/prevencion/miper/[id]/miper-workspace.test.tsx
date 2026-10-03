// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ShellHeaderProvider } from "@/components/layout/header-context"
import { taskKeyOf } from "@/lib/prevention/miper/matrix-tree"
import type { MiperEntrySnapshot, MiperHeaderSnapshot, SnapshotDiff } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperWorkspace } from "@/lib/services/miper/queries"

const nav = vi.hoisted(() => ({ query: "" }))
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams(nav.query) }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
// Todas las acciones que importa el árbol del espacio de trabajo (grep de `../actions` y `../../actions` en `[id]/`).
vi.mock("../actions", () => ({
  addMiperObservationAction: vi.fn(), addOccurrenceEvidenceAction: vi.fn(), applyProgramGenerationAction: vi.fn(),
  approveMiperFinalAction: vi.fn(), approveMiperTechnicalAction: vi.fn(), deleteMiperControlAction: vi.fn(),
  deleteMiperEntryAction: vi.fn(), discardMiperDraftAction: vi.fn(), duplicateMiperEntryAction: vi.fn(),
  loadOccurrenceDetailAction: vi.fn(), loadProgramWorkspaceAction: vi.fn(), openMiperRoundAction: vi.fn(),
  proposeProgramActionsAction: vi.fn(), recordOccurrenceAction: vi.fn(), reopenMiperObservationAction: vi.fn(),
  requestMiperCorrectionsAction: vi.fn(), resolveMiperObservationAction: vi.fn(), respondMiperObservationAction: vi.fn(),
  retireProgramActionAction: vi.fn(), returnMiperAction: vi.fn(), saveMiperControlAction: vi.fn(),
  saveMiperEntryAction: vi.fn(), saveProgramActionAction: vi.fn(), saveProgramHeaderAction: vi.fn(),
  submitMiperAction: vi.fn(), updateMiperHeaderAction: vi.fn(), uploadProgramEvidenceAction: vi.fn(),
  voidOccurrenceRecordAction: vi.fn(), withdrawOccurrenceEvidenceAction: vi.fn(),
}))

import { MiperWorkspaceView } from "./miper-workspace"

const header: MiperHeaderSnapshot = {
  period: 2026, iperCode: "RE-04", elaboratedOn: "2026-10-01", updatedOn: null, companyName: "Chome", companyRut: "1-9", companyAddress: "Calle 1",
  companyCommune: "Panguipulli", economicActivity: "Servicios", adherentNumber: null, worksiteName: "Planta", siteRepresentativeUserId: null,
  siteRepresentativeName: "Ana", headcountTotal: 2, headcountMale: 1, headcountFemale: 1, headcountOther: 0, participationSummary: "Participación", consultationEvidenceReference: "Acta",
}
const entry = (overrides: Partial<MiperEntrySnapshot> = {}): MiperEntrySnapshot => ({
  id: "e1", rowNumber: 1, activity: "Transporte", task: "Carga", position: "Conductor", location: "Planta", exposedFemale: 0, exposedMale: 2, exposedOther: 0,
  riskFactorId: "f1", riskFactor: "Mecánico", isRoutine: true, hazard: "Peligro 1", risk: "Choque", probableDamage: "Fracturas",
  probability: 2, consequence: 4, magnitude: 8, classification: "important", controlledStatus: "no", controls: [], ...overrides,
})
const editMode: WorkspaceMode = { canEdit: true, canReviewTechnical: false, canApproveLegal: false, canObserve: false, canRespond: false, isSubmitter: false, canExecuteProgram: false, readOnlyReason: null }
/** Lo que `getMiperWorkspace` entrega para un borrador nunca aprobado: todo «agregado» contra nada. */
const allAdded: SnapshotDiff = { headerFields: [], entries: [{ kind: "added", entryId: "e1", rowNumber: 1, fields: [] }], hasChanges: true }
const NO_PROGRAM = { done: 0, late: 0, pending: 0, overdue: 0, failed: 0, planned: 0, ratio: null }

function workspaceOf(overrides: Partial<MiperWorkspace> = {}): MiperWorkspace {
  return {
    matrix: { id: "m1", version: 1, status: "draft", reviewState: "none", isLegacy: false, worksiteId: "ws1", worksiteName: "Planta", period: 2026 },
    label: "Borrador", snapshot: { header, entries: [entry()] }, entryVersions: { e1: 1 }, controlVersions: {}, versions: [],
    lastVersionSnapshot: null, openRound: null, reviewDiff: null, reviewBaselineSnapshot: null, pendingDiff: allAdded,
    observations: [], completeness: [],
    prefill: { companyName: "Chome", companyRut: "1-9", companyAddress: "Calle 1", economicActivity: "Servicios", adherentNumber: "", companyCommune: "Panguipulli", worksiteName: "Planta", siteRepresentativeUserId: null, siteRepresentativeName: "Ana", headcount: { total: 2, male: 1, female: 1, other: 0, unrecorded: 0 } },
    riskFactors: [{ id: "f1", name: "Mecánico", isActive: true }],
    dictionaries: { activities: [], tasks: [], positions: [], locations: [], hazards: [], risks: [], damages: [], measures: [] },
    responsibleOptions: [], siblingMatrices: [], program: null, controlActionLinks: [],
    ...overrides,
  } as unknown as MiperWorkspace
}

function show(query: string, workspace = workspaceOf(), mode = editMode) {
  nav.query = query
  return render(<ShellHeaderProvider><MiperWorkspaceView workspace={workspace} history={[]} mode={mode} userId="u1" programProgress={NO_PROGRAM} /></ShellHeaderProvider>)
}

const TASK = `tarea=${taskKeyOf({ activity: "Transporte", task: "Carga" })}`

afterEach(() => {
  nav.query = ""
  sessionStorage.clear()
})

describe("MiperWorkspaceView — marcas de cambio (A2, fila 3)", () => {
  it("sin línea base (borrador nunca aprobado) la estructura no dice «modificado»", () => {
    show("")
    expect(screen.queryByText(/modificado/)).toBeNull()
  })
  it("sin línea base la tarea no marca «Nueva»", () => {
    show(TASK)
    expect(screen.queryByText("Nueva", { exact: true })).toBeNull()
  })
  it("con una versión aprobada como línea base, las marcas vuelven", () => {
    show(TASK, workspaceOf({ lastVersionSnapshot: { header, entries: [] } }))
    expect(screen.getByText("Nueva", { exact: true })).toBeTruthy()
  })
})

describe("MiperWorkspaceView — render completo (A2, fila 16)", () => {
  it("en la raíz: título, tarjeta «Siguiente paso», pestañas, buscador y estructura", () => {
    show("")
    expect(screen.getByRole("heading", { level: 1, name: "MIPER Planta 2026" })).toBeTruthy()
    expect(screen.getByText("Faltan datos en 1 riesgo")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Siguiente pendiente" }).getAttribute("href")).toBe("/prevencion/miper/m1?fila=e1")
    expect(screen.getByRole("tab", { name: "Matriz (1)", selected: true })).toBeTruthy()
    expect(screen.getByLabelText("Buscar en la matriz")).toBeTruthy()
    expect(screen.getByRole("heading", { level: 2, name: /Transporte/ })).toBeTruthy()
  })

  it("con ?tarea= muestra la tarea y la tarjeta no (va sólo en la raíz)", () => {
    show(TASK)
    expect(screen.getByRole("heading", { level: 2, name: "Carga" })).toBeTruthy()
    expect(screen.getByRole("heading", { level: 3, name: "Peligros identificados (1)" })).toBeTruthy()
    expect(screen.queryByText("Faltan datos en 1 riesgo")).toBeNull()
  })

  it("con ?fila=&paso= abre el editor del riesgo en ese paso", () => {
    show("fila=e1&paso=evaluacion")
    expect(screen.getByRole("heading", { level: 2, name: "Peligro 1" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: /Evaluación/, selected: true })).toBeTruthy()
  })

  it("una tarea que ya no existe lo dice y ofrece volver a la matriz", () => {
    show("tarea=zzz")
    expect(screen.getByText("Esta tarea ya no existe")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Volver a la matriz" }).getAttribute("href")).toBe("/prevencion/miper/m1")
  })

  it("con ?ficha=1 abre la «Ficha del documento»", () => {
    show("ficha=1")
    expect(screen.getByRole("dialog", { name: "Ficha del documento" })).toBeTruthy()
  })

  it("el motivo de solo lectura acompaña también al editor (alcance «everywhere»)", () => {
    const reason = "Esta MIPER fue reemplazada por la de otro período: se conserva como historia."
    show("fila=e1", workspaceOf(), { ...editMode, canEdit: false, readOnlyReason: reason })
    expect(screen.getByText(reason)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Más acciones/ })).toBeNull()
  })
})

describe("MiperWorkspaceView — marcas del revisor y de lo publicado (A2, Task 3)", () => {
  const reviewerMode: WorkspaceMode = { ...editMode, canEdit: false, canReviewTechnical: true }
  const round = { id: "r1", stage: "technical", roundNumber: 1, openedAt: null, submittedByUserId: "u2", submittedAt: "2026-10-01T10:00:00Z", snapshot: { header, entries: [entry()] } }
  const changed = entry({ hazard: "Peligro cambiado" })
  const modifiedDiff: SnapshotDiff = { headerFields: [], entries: [{ kind: "modified", entryId: "e1", rowNumber: 1, fields: [] }], hasChanges: true }
  const reviewing = (overrides: Partial<MiperWorkspace> = {}) => workspaceOf({
    matrix: { id: "m1", version: 2, status: "in_review", reviewState: "technical", isLegacy: false, worksiteId: "ws1", worksiteName: "Planta", period: 2026 },
    snapshot: { header, entries: [changed] }, openRound: round, reviewDiff: modifiedDiff, ...overrides,
  } as unknown as Partial<MiperWorkspace>)

  it("el revisor, con la foto de la ronda anterior como línea base, ve «Modificada» en el riesgo cambiado", () => {
    show(TASK, reviewing({ reviewBaselineSnapshot: { header, entries: [entry()] } }), reviewerMode)
    expect(screen.getByText("Modificada", { exact: true })).toBeTruthy()
  })

  it("el revisor sin línea base no ve «Nueva» ni «Modificada»", () => {
    show(TASK, reviewing({ reviewBaselineSnapshot: null }), reviewerMode)
    expect(screen.queryByText("Nueva", { exact: true })).toBeNull()
    expect(screen.queryByText("Modificada", { exact: true })).toBeNull()
  })

  it("una MIPER publicada con versión sellada y cambios pendientes marca «Modificada»", () => {
    show(TASK, workspaceOf({
      matrix: { id: "m1", version: 3, status: "published", reviewState: "none", isLegacy: false, worksiteId: "ws1", worksiteName: "Planta", period: 2026 },
      snapshot: { header, entries: [changed] }, lastVersionSnapshot: { header, entries: [entry()] }, pendingDiff: modifiedDiff,
    } as unknown as Partial<MiperWorkspace>))
    expect(screen.getByText("Modificada", { exact: true })).toBeTruthy()
  })
})

describe("MiperWorkspaceView — plurales del aviso Intolerable", () => {
  const intolerable = (id: string, n: number) => entry({ id, rowNumber: n, classification: "intolerable" })
  it("uno: singular", () => {
    show("", workspaceOf({ snapshot: { header, entries: [intolerable("e1", 1)] } } as unknown as Partial<MiperWorkspace>))
    // Título exacto: `toContain("1 riesgo Intolerable")` también aceptaría «1 riesgo Intolerables».
    expect(within(screen.getByRole("alert")).getByText("1 riesgo Intolerable", { exact: true })).toBeTruthy()
    expect(screen.getByRole("alert").textContent).not.toContain("(s)")
  })
  it("varios: plural", () => {
    show("", workspaceOf({ snapshot: { header, entries: [intolerable("e1", 1), intolerable("e2", 2)] } } as unknown as Partial<MiperWorkspace>))
    expect(within(screen.getByRole("alert")).getByText("2 riesgos Intolerables", { exact: true })).toBeTruthy()
  })
})

describe("MiperWorkspaceView — plural de observaciones por responder", () => {
  const obs = (id: string) => ({ id, entryId: null, status: "open", body: "Revisar", authorName: "Rev", responderName: null, createdAt: "2026-10-01T10:00:00Z", respondedAt: null, response: null }) as unknown as MiperWorkspace["observations"][number]
  const responder: WorkspaceMode = { ...editMode, canRespond: true }
  it.each([[1, "Tienes 1 observación por responder"], [2, "Tienes 2 observaciones por responder"]])("%i abiertas", (n, text) => {
    show("tab=revision", workspaceOf({ observations: Array.from({ length: n }, (_, i) => obs(`o${i}`)) }), responder)
    expect(screen.getByText(text)).toBeTruthy()
  })
})

describe("MiperWorkspaceView — pestaña Resumen (Fase B)", () => {
  it("la matriz sigue siendo la pestaña por defecto; Resumen va primero en la tira", () => {
    show("")
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Resumen", "Matriz (1)", "Programa", "Revisión", "Historial"])
    expect(screen.getByRole("tab", { name: "Resumen", selected: false })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Matriz (1)", selected: true })).toBeTruthy()
  })

  it("con ?tab=resumen muestra las cuatro cifras y la completitud por actividad", () => {
    show("tab=resumen")
    expect(screen.getByRole("tab", { name: "Resumen", selected: true })).toBeTruthy()
    expect(screen.getByRole("link", { name: /^Riesgos completos/ })).toBeTruthy()
    expect(screen.getByRole("progressbar", { name: /^Transporte: / })).toBeTruthy()
  })
})
