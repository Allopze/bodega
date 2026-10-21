// @vitest-environment jsdom
import "fake-indexeddb/auto"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_RE20_SLA_POLICY } from "@/lib/prevention/incidents"
import type { Re20WorkspaceProps } from "./types"

const saveAction = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))

vi.mock("@/lib/toast", () => ({ toast }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }))
vi.mock("../../actions", () => ({ savePreventionIncidentRe20WorkspaceAction: saveAction }))

import { getRe20OfflineDraft, purgeRe20OfflineDrafts } from "@/lib/prevention/re20-offline-drafts"
import { Re20WorkspaceShell } from "./re20-workspace-shell"
import type { Re20LocalDraft } from "./types"

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

const DRAFT_ID = "incident-workspace:inc-1"

function managerName() {
  return document.getElementById("re20-preliminar-managerName") as HTMLInputElement
}

/** Los textos del indicador de guardado (escritorio y barra del teléfono). */
function saveIndicators() {
  return Array.from(document.querySelectorAll("[data-save-state]")).map((node) => ({ state: node.getAttribute("data-save-state"), text: node.textContent }))
}

async function storedManagerName(userId = "u1") {
  const draft = await getRe20OfflineDraft<Re20LocalDraft>(userId, DRAFT_ID)
  return (draft?.payload.data as { preliminary?: { managerName?: string } } | undefined)?.preliminary?.managerName ?? null
}

describe("Re20WorkspaceShell", () => {
  beforeEach(async () => {
    saveAction.mockReset()
    toast.success.mockClear()
    toast.error.mockClear()
    toast.warning.mockClear()
    toast.info.mockClear()
    await purgeRe20OfflineDrafts()
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
  describe("trabajo sin conexión automático", () => {
    it("lo que se escribe queda guardado en este equipo sin pedir frase ni ofrecer una bóveda", async () => {
      render(<Re20WorkspaceShell {...props()} />)
      expect(screen.queryByText(/bóveda|frase|cifrad/i)).toBeNull()
      expect(screen.queryByRole("button", { name: /preparar para trabajar sin conexión/i })).toBeNull()

      fireEvent.change(managerName(), { target: { value: "Juan Soto" } })

      await vi.waitFor(async () => expect(await storedManagerName()).toBe("Juan Soto"), { timeout: 4000 })
      // Con conexión la copia es silenciosa: el indicador sigue diciendo lo de siempre.
      expect(saveIndicators().every((item) => item.text === "Cambios sin guardar")).toBe(true)
    })

    it("sin conexión lo dice en el indicador, guarda lo escrito en este equipo y no manda nada al servidor", async () => {
      const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
      try {
        render(<Re20WorkspaceShell {...props()} />)
        expect(saveIndicators().every((item) => item.state === "offline" && item.text === "Sin conexión · lo que escribas se guarda en este equipo")).toBe(true)

        fireEvent.change(managerName(), { target: { value: "Jefe sin señal" } })
        expect(saveIndicators().every((item) => item.text === "Sin conexión · tus cambios se guardan en este equipo")).toBe(true)
        await vi.waitFor(async () => expect(await storedManagerName()).toBe("Jefe sin señal"), { timeout: 4000 })

        await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Guardar en este equipo" })[0]!) })
        await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith("Guardado en este equipo. Para enviarlo, abre el caso con conexión y guarda."), { timeout: 4000 })
        expect(saveAction).not.toHaveBeenCalled()
        expect(screen.queryByText(/bóveda|frase|cifrad/i)).toBeNull()
      } finally {
        onLine.mockRestore()
      }
    })

    it("al volver la señal con cambios sin enviar avisa, no los envía solo y guardar los manda", async () => {
      const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false)
      try {
        render(<Re20WorkspaceShell {...props()} />)
        fireEvent.change(managerName(), { target: { value: "Jefe sin señal" } })
        await vi.waitFor(async () => expect(await storedManagerName()).toBe("Jefe sin señal"), { timeout: 4000 })

        onLine.mockReturnValue(true)
        await act(async () => { window.dispatchEvent(new Event("online")) })

        expect(toast.info).toHaveBeenCalledWith("Volvió la conexión. Guarda el expediente para enviar tus cambios.")
        expect(saveAction).not.toHaveBeenCalled()
        expect(saveIndicators().every((item) => item.text === "Cambios sin guardar")).toBe(true)

        saveAction.mockResolvedValue({ ok: true, message: "Expediente RE-20 guardado", version: 3 })
        await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Guardar" })[0]!) })
        expect(saveAction).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ preliminary: expect.objectContaining({ managerName: "Jefe sin señal" }) }) }))
        // El servidor ya lo tiene: la copia de este equipo se retira.
        await vi.waitFor(async () => expect(await getRe20OfflineDraft("u1", DRAFT_ID)).toBeNull(), { timeout: 4000 })
      } finally {
        onLine.mockRestore()
      }
    })

    it("al abrir de nuevo el expediente recupera lo que quedó sin enviar y lo avisa", async () => {
      const first = render(<Re20WorkspaceShell {...props()} />)
      fireEvent.change(managerName(), { target: { value: "Quedó pendiente" } })
      await vi.waitFor(async () => expect(await storedManagerName()).toBe("Quedó pendiente"), { timeout: 4000 })
      first.unmount()

      render(<Re20WorkspaceShell {...props()} />)
      await vi.waitFor(() => expect(managerName().value).toBe("Quedó pendiente"), { timeout: 4000 })
      expect(toast.info).toHaveBeenCalledWith("Recuperamos los cambios de este equipo que no se habían enviado. Revísalos y guarda.")
    })

    it("lo guardado por otra persona en el mismo equipo no se recupera", async () => {
      const first = render(<Re20WorkspaceShell {...props({ userId: "u2" })} />)
      fireEvent.change(managerName(), { target: { value: "Cosa de otra persona" } })
      await vi.waitFor(async () => expect(await storedManagerName("u2")).toBe("Cosa de otra persona"), { timeout: 4000 })
      first.unmount()

      render(<Re20WorkspaceShell {...props({ userId: "u1" })} />)
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
      expect(managerName().value).toBe("")
      expect(toast.info).not.toHaveBeenCalled()
    })
  })
})
