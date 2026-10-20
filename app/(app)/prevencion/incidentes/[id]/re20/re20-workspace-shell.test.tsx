// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_RE20_SLA_POLICY } from "@/lib/prevention/incidents"
import type { Re20WorkspaceProps } from "./types"

const saveAction = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))

vi.mock("@/lib/toast", () => ({ toast }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }))
vi.mock("../../actions", () => ({ savePreventionIncidentRe20WorkspaceAction: saveAction }))
vi.mock("@/lib/prevention/re20-offline-vault", () => ({
  getRe20VaultState: vi.fn(async () => ({ configured: false, unlocked: false, draftCount: 0 })),
  listRe20OfflineDraftHeaders: vi.fn(async () => []),
  getRe20OfflineDraft: vi.fn(async () => null),
  putRe20OfflineDraft: vi.fn(async () => ({})),
  deleteRe20OfflineDraft: vi.fn(async () => {}),
  lockRe20Vault: vi.fn(),
  touchRe20Vault: vi.fn(),
  unlockRe20Vault: vi.fn(async () => ({ configured: true, deviceId: "d" })),
}))

import { Re20WorkspaceShell } from "./re20-workspace-shell"

function props(overrides: Partial<Re20WorkspaceProps> = {}): Re20WorkspaceProps {
  return {
    incident: {
      id: "inc-1", code: "INC-2026-001", companyName: "Chome", location: "Frente 3", occurredAt: "2026-10-20T10:00:00.000Z",
      knownAt: "2026-10-20T10:30:00.000Z", status: "under_investigation", actualSeverity: "lost_time", eventType: "work_accident",
      isFatalOrSerious: false, worksiteName: "Faena Norte", version: 3,
    },
    workspace: { version: 2, data: {}, updatedAt: "2026-10-20T11:00:00.000Z" },
    policy: DEFAULT_RE20_SLA_POLICY,
    options: [{ category: "weather", code: "r1", name: "Lluvia", isActive: true }],
    qualityReviews: [],
    legacyInvestigation: null,
    sensitivePayload: null,
    sensitiveLoadError: null,
    permissions: { canInvestigate: true, canSensitive: false, canNotify: false, canReview: false, canConfigure: false, canConfirmDiffusion: false },
    currentUser: { id: "u1", name: "Ana Pérez" },
    userId: "u1",
    people: [{ id: "u1", name: "Ana Pérez", position: "Prevencionista" }],
    involvedPeople: [],
    diffusions: [],
    notifications: [],
    capa: [],
    initialPurpose: "",
    initialStage: "preliminar",
    ...overrides,
  }
}

describe("Re20WorkspaceShell", () => {
  beforeEach(() => {
    saveAction.mockReset()
    window.history.replaceState(null, "", "/prevencion/incidentes/inc-1")
  })

  it("muestra el siguiente paso con quién actúa y cuándo vence", () => {
    render(<Re20WorkspaceShell {...props()} />)
    const card = screen.getByRole("heading", { name: "Siguiente paso: 1. Aviso y preliminar" }).closest("section")!
    expect(card.textContent).toContain("Jefatura de terreno")
    expect(card.textContent).toContain("Vence:")
  })

  it("lista lo que falta y cada enlace lleva el foco al campo", async () => {
    render(<Re20WorkspaceShell {...props()} />)
    fireEvent.click(screen.getByRole("button", { name: "Jefatura a cargo" }))
    await waitFor(() => expect(document.activeElement?.id).toBe("re20-preliminar-managerName"))
  })

  it("en un accidente de trayecto ofrece sólo los pasos 1 a 3 y dice por qué", () => {
    render(<Re20WorkspaceShell {...props({ incident: { ...props().incident, eventType: "commute_accident" } })} />)
    const nav = screen.getByRole("navigation", { name: "Etapas del protocolo" })
    expect(nav.querySelectorAll("button")).toHaveLength(3)
    expect(screen.getByText(/Accidente de trayecto: el protocolo pide solo los pasos 1 a 3/)).toBeTruthy()
  })

  it("cambia de etapa en la URL sin ir al servidor", () => {
    render(<Re20WorkspaceShell {...props()} />)
    fireEvent.click(screen.getByRole("button", { name: /^3\. DIAT/ }))
    expect(window.location.search).toContain("etapa=diat")
  })

  it("con el caso cerrado deja todo en sólo lectura", () => {
    render(<Re20WorkspaceShell {...props({ incident: { ...props().incident, status: "closed" } })} />)
    expect(screen.getByText("Caso cerrado")).toBeTruthy()
    expect((document.getElementById("re20-preliminar-managerName") as HTMLInputElement).closest("fieldset")!.disabled).toBe(true)
    expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull()
  })

  it("guarda con la versión esperada y un id de mutación", async () => {
    saveAction.mockResolvedValue({ ok: true, message: "Expediente RE-20 guardado", version: 3 })
    render(<Re20WorkspaceShell {...props()} />)
    fireEvent.change(document.getElementById("re20-preliminar-managerName")!, { target: { value: "Juan Soto" } })
    expect(screen.getAllByText("Cambios sin guardar").length).toBeGreaterThan(0)
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Guardar" })[0]!) })
    expect(saveAction).toHaveBeenCalledWith(expect.objectContaining({
      incidentId: "inc-1",
      expectedVersion: 2,
      mutationId: expect.stringMatching(/^re20-save-/),
      data: expect.objectContaining({ preliminary: expect.objectContaining({ managerName: "Juan Soto" }) }),
    }))
    await waitFor(() => expect(screen.getAllByText(/^Guardado /).length).toBeGreaterThan(0))
  })
})
