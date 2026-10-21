// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_RE20_SLA_POLICY } from "@/lib/prevention/incidents"
import { purgeRe20OfflineDrafts, putRe20OfflineDraft } from "@/lib/prevention/re20-offline-drafts"
import type { Re20LocalDraft } from "@/app/(app)/prevencion/incidentes/[id]/re20/types"

vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }))
vi.mock("@/app/(app)/prevencion/incidentes/actions", () => ({
  savePreventionIncidentRe20WorkspaceAction: vi.fn(),
  reportPreventionIncidentAction: vi.fn(),
}))

import { Re20OfflineShell } from "./offline-shell"

function workspaceDraft(incidentId: string, code: string): Re20LocalDraft {
  return {
    incidentId,
    baseVersion: 2,
    baseData: {},
    data: { preliminary: { managerName: "Jefe de terreno" } },
    attachments: [],
    context: {
      incident: {
        id: incidentId, code, companyName: "Chome", location: "Frente 3", occurredAt: "2026-10-20T10:00:00.000Z",
        knownAt: "2026-10-20T10:30:00.000Z", status: "under_investigation", actualSeverity: "lost_time", eventType: "work_accident",
        isFatalOrSerious: false, worksiteName: "Faena Norte", version: 3,
      },
      policy: DEFAULT_RE20_SLA_POLICY,
      options: [],
      qualityReviews: [],
      legacyInvestigation: null,
      diffusions: [],
      notifications: [],
      capa: [],
      currentUser: { id: "u1", name: "Ana Pérez" },
      people: [{ id: "u1", name: "Ana Pérez", position: "Prevencionista" }],
      involvedPeople: [],
      canSensitive: false,
      canNotify: false,
      canReview: false,
      canConfirmDiffusion: false,
    },
    savedAt: "2026-10-20T12:00:00.000Z",
  } as unknown as Re20LocalDraft
}

describe("Re20OfflineShell (pantalla pública sin conexión)", () => {
  beforeEach(async () => {
    await purgeRe20OfflineDrafts()
  })

  it("sin nada guardado en el equipo lo dice con una salida, sin frase ni bóveda", async () => {
    render(<Re20OfflineShell />)
    expect(await screen.findByText("No hay trabajo guardado en este equipo")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Ir a incidentes" }).getAttribute("href")).toBe("/prevencion/incidentes")
    expect(screen.queryByLabelText(/frase/i)).toBeNull()
    expect(screen.queryByText(/bóveda|cifrad/i)).toBeNull()
  })

  it("muestra directamente lo del último usuario del equipo, sin pedir frase", async () => {
    await putRe20OfflineDraft("u-anterior", { id: "incident-workspace:inc-viejo", kind: "incident_workspace", payload: workspaceDraft("inc-viejo", "INC-VIEJO"), attempts: 0, updatedAt: "2026-10-19T08:00:00.000Z" })
    await putRe20OfflineDraft("u1", { id: "incident-workspace:inc-1", kind: "incident_workspace", payload: workspaceDraft("inc-1", "INC-2026-001"), attempts: 0, updatedAt: "2026-10-20T12:00:00.000Z" })
    await putRe20OfflineDraft("u1", { id: "incident-report:offline-1", kind: "incident_report", payload: { clientSubmissionId: "offline-1" }, attempts: 0 })

    render(<Re20OfflineShell />)

    expect(await screen.findByRole("heading", { name: /Investigación INC-2026-001/ })).toBeTruthy()
    expect(screen.queryByText(/INC-VIEJO/)).toBeNull()
    expect(screen.getByText("1 reporte guardado en este equipo · 1 expediente de investigación con cambios sin enviar.")).toBeTruthy()
    expect((document.getElementById("re20-preliminar-managerName") as HTMLInputElement).value).toBe("Jefe de terreno")
    expect(screen.queryByLabelText(/frase/i)).toBeNull()
    expect(screen.queryByText(/bóveda|cifrad/i)).toBeNull()
  })

  it("con las faenas guardadas ofrece crear un reporte sin conexión; sin ellas explica cómo", async () => {
    await putRe20OfflineDraft("u1", { id: "incident-workspace:inc-1", kind: "incident_workspace", payload: workspaceDraft("inc-1", "INC-2026-001"), attempts: 0 })
    const first = render(<Re20OfflineShell />)
    expect(await screen.findByText(/abre «Reportar incidente» una vez con conexión/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Crear reporte sin conexión" })).toBeNull()
    first.unmount()

    await putRe20OfflineDraft("u1", {
      id: "incident-report-config",
      kind: "incident_report_config",
      payload: { worksites: [{ id: "w1", name: "Faena Norte", code: "FN" }], defaultDate: "2026-10-20", defaultTime: "10:00" },
      attempts: 0,
    })
    render(<Re20OfflineShell />)
    expect(await screen.findByRole("button", { name: "Crear reporte sin conexión" })).toBeTruthy()
  })
})
