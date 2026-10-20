// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DEFAULT_RE20_SLA_POLICY } from "@/lib/prevention/incidents"
import { emptyRe20Sensitive } from "../workspace-data"
import type { Re20WorkspaceProps, Re20Sensitive } from "../types"
import type { Re20WorkspaceApi } from "../use-re20-workspace"

vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }))
vi.mock("../../../actions", () => ({ savePreventionIncidentRe20WorkspaceAction: vi.fn(), recordPreventionIncidentNotificationAction: vi.fn() }))
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

import { Re20WorkspaceShell } from "../re20-workspace-shell"
import { declaracionesStage } from "./declaraciones"
import { diatStage } from "./diat"

function fakeWs(sensitive: Re20Sensitive, extra: Partial<Re20WorkspaceApi> = {}) {
  return {
    sensitiveAvailable: true,
    sensitive,
    incident: { eventType: "work_accident" },
    notifications: [],
    ...extra,
  } as unknown as Re20WorkspaceApi
}

describe("etapa Declaraciones: avance", () => {
  it("sin declaraciones pide la primera y el cuestionario completo", () => {
    const progress = declaracionesStage.progress(fakeWs(emptyRe20Sensitive()))
    expect(progress.missing[0]).toEqual({ label: "Al menos una declaración", fieldId: "re20-declaraciones-list" })
    expect(progress.missing.some((item) => item.fieldId === "re20-declaraciones-entrevista-workerName")).toBe(true)
    expect(progress.done).toBe(0)
  })

  it("cada falta de una declaración apunta al campo con el id de esa declaración", () => {
    const sensitive = { ...emptyRe20Sensitive(), declarations: [{ id: "d1", kind: "witness" as const, name: "Luis Soto", statement: "", answers: {}, reserveIdentity: false, attachmentReferences: [] }] }
    const ids = declaracionesStage.progress(fakeWs(sensitive, { incident: { eventType: "commute_accident" } } as never)).missing.map((item) => item.fieldId)
    expect(ids).toEqual(["re20-declaraciones-d1-statement", "re20-declaraciones-d1-clause", "re20-declaraciones-d1-signedAt"])
  })

  it("una declaración completa suma sus cuatro datos", () => {
    const sensitive = { ...emptyRe20Sensitive(), declarations: [{ id: "d1", kind: "witness" as const, name: "Luis Soto", statement: "Vi la caída", clauseAccepted: true, signedAt: "2026-10-20T12:00:00.000Z", answers: {}, reserveIdentity: false, attachmentReferences: [] }] }
    const progress = declaracionesStage.progress(fakeWs(sensitive, { incident: { eventType: "commute_accident" } } as never))
    expect(progress).toEqual({ done: 4, total: 4, missing: [] })
  })

  it("sin acceso a datos reservados no inventa avance", () => {
    expect(declaracionesStage.progress(fakeWs(emptyRe20Sensitive(), { sensitiveAvailable: false }))).toEqual({ done: 0, total: 0, missing: [] })
    expect(diatStage.progress(fakeWs(emptyRe20Sensitive(), { sensitiveAvailable: false }))).toEqual({ done: 0, total: 0, missing: [] })
  })
})

describe("etapa DIAT: avance", () => {
  it("pide clasificación, trabajo y presentación, y el tipo de trayecto sólo si aplica", () => {
    const base = emptyRe20Sensitive()
    const ids = diatStage.progress(fakeWs(base)).missing.map((item) => item.fieldId)
    expect(ids).toEqual(["re20-diat-severity", "re20-diat-scope", "re20-diat-proofMedium", "re20-diat-activity", "re20-diat-usualWork", "re20-diat-block-presentation"])
    const commute = { ...base, diat: { ...base.diat, scope: "commute" as const } }
    expect(diatStage.progress(fakeWs(commute)).missing.map((item) => item.fieldId)).toContain("re20-diat-commuteType")
  })

  it("queda completa con todo anotado y la presentación enviada", () => {
    const base = emptyRe20Sensitive()
    const sensitive: Re20Sensitive = { ...base, diat: { ...base.diat, severity: "grave", scope: "work", proofMedium: "Testigos", form: { activity: "Cargaba", usualWork: true } } }
    const lane = { notificationType: "diat", status: "sent", deadlineAt: null, sentAt: "2026-10-20T12:00:00.000Z", evidenceReference: "F-123" }
    expect(diatStage.progress(fakeWs(sensitive, { notifications: [lane] } as never))).toMatchObject({ done: 6, total: 6, missing: [] })
  })
})

function props(): Re20WorkspaceProps {
  return {
    incident: {
      id: "inc-1", code: "INC-2026-001", companyName: "Chome", location: "Frente 3", occurredAt: "2026-10-20T10:00:00.000Z",
      knownAt: "2026-10-20T10:30:00.000Z", status: "under_investigation", actualSeverity: "lost_time", eventType: "work_accident",
      isFatalOrSerious: false, worksiteName: "Faena Norte", version: 3,
    },
    workspace: { version: 2, data: {}, updatedAt: "2026-10-20T11:00:00.000Z" },
    policy: DEFAULT_RE20_SLA_POLICY,
    options: [],
    qualityReviews: [],
    legacyInvestigation: null,
    sensitivePayload: { declarations: [], injuredInterview: { attachmentReferences: [] }, injuryClinical: {}, diat: { form: {}, status: "draft" } },
    sensitiveLoadError: null,
    permissions: { canInvestigate: true, canSensitive: true, canNotify: true, canReview: false, canConfigure: false, canConfirmDiffusion: false },
    currentUser: { id: "u1", name: "Ana Pérez" },
    userId: "u1",
    people: [{ id: "u1", name: "Ana Pérez", position: "Prevencionista" }],
    involvedPeople: [],
    diffusions: [],
    notifications: [{ notificationType: "diat", status: "pending", deadlineAt: "2026-10-21T10:30:00.000Z", sentAt: null, evidenceReference: null }],
    capa: [],
    initialPurpose: "Investigación del incidente",
    initialStage: "declaraciones",
  }
}

describe("etapas Declaraciones y DIAT en el expediente", () => {
  it("agrega una declaración plegada con su resumen y deja el foco en el nombre", async () => {
    render(<Re20WorkspaceShell {...props()} />)
    fireEvent.click(screen.getAllByRole("button", { name: "Agregar declaración" })[0]!)
    await waitFor(() => expect(document.activeElement?.id).toMatch(/^re20-declaraciones-.*-name$/))
    expect(screen.getByText(/Testigo · .* · Sin firmar/)).toBeTruthy()
    expect(screen.getByText(/Declaro que la información precedente/)).toBeTruthy()
  })

  it("la DIAT avisa que es un borrador interno y muestra la hora de ocurrencia", () => {
    render(<Re20WorkspaceShell {...props()} initialStage="diat" />)
    expect(screen.getByText(/La DIAT válida es la que se presenta al organismo administrador dentro de 24 horas/)).toBeTruthy()
    expect(screen.getByText("Hora de ocurrencia")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Registrar presentación" }).hasAttribute("disabled")).toBe(true)
  })
})
