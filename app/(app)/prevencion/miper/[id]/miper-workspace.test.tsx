// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
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
  return render(<ShellHeaderProvider><MiperWorkspaceView workspace={workspace} history={[]} mode={mode} userId="u1" /></ShellHeaderProvider>)
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
