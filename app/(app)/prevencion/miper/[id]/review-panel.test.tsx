// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { WorkspaceMode } from "@/lib/prevention/miper/workspace-mode"
import type { MiperObservationView, MiperWorkspace } from "@/lib/services/miper/queries"

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/prevencion/miper/m1", useSearchParams: () => new URLSearchParams("tab=revision") }))
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
const actions = vi.hoisted(() => ({
  addMiperObservationAction: vi.fn(), reopenMiperObservationAction: vi.fn(), resolveMiperObservationAction: vi.fn(),
  respondMiperObservationAction: vi.fn(async () => ({ ok: true, message: "Respuesta guardada" })),
}))
vi.mock("../actions", () => ({
  ...actions,
}))

import { ReviewPanel } from "./review-panel"

const row = (id: string, rowNumber: number, classification: MiperEntrySnapshot["classification"]) => ({
  id, rowNumber, activity: "A", task: "T", position: null, location: null, exposedFemale: 0, exposedMale: 0, exposedOther: 0,
  riskFactorId: null, riskFactor: null, isRoutine: null, hazard: `Peligro ${rowNumber}`, risk: null, probableDamage: null, probability: null,
  consequence: null, magnitude: null, classification, controlledStatus: null, controls: [],
}) as MiperEntrySnapshot
const rows = [row("e1", 1, "tolerable"), row("e2", 2, "important"), row("e3", 3, "intolerable")]
const mode = { canEdit: false, canReviewTechnical: false, canApproveLegal: false, canObserve: false, canRespond: false, isSubmitter: false, canExecuteProgram: false, readOnlyReason: null } as WorkspaceMode
const observation = { id: "o1", matrixId: "m1", entryId: "e2", entryLabel: "#2 Peligro 2", status: "open", stage: "technical", body: "Falta la medida", response: null, createdAt: "2026-10-01T12:00:00.000Z", authorName: "Revisora", responderName: null } as unknown as MiperObservationView
const workspace = (observations: MiperObservationView[] = []) => ({ openRound: null, observations, matrix: { id: "m1", status: "draft", reviewState: "none" }, versions: [], pendingDiff: { hasChanges: false } }) as unknown as MiperWorkspace

afterEach(cleanup)

describe("ReviewPanel: recorrer la MIPER", () => {
  it.each([
    ["none", "draft", false, "Elaboración"],
    ["observed", "published", false, "Elaboración"],
    ["in_review", "published", true, "Revisión técnica"],
    ["pending_approval", "draft", false, "Aprobación Legal/RRHH"],
    ["none", "published", false, "Vigente"],
    ["none", "published", true, "Elaboración"],
  ])("representa %s / %s / cambios %s sin alterar permisos", (reviewState, status, hasChanges, label) => {
    const data = workspace()
    data.matrix = { ...data.matrix, reviewState, status }
    data.pendingDiff = { ...data.pendingDiff, hasChanges }
    render(<ReviewPanel workspace={data} mode={mode} onOpenEntry={vi.fn()} rows={rows} observed={new Set()} modified={new Set()} hasBaseline={false} />)
    const progress = screen.getByRole("list", { name: "Etapas de revisión" })
    expect(progress.querySelector('[aria-current="step"]')).toHaveTextContent(label)
    expect(screen.queryByRole("button", { name: /Aprobar/ })).toBeNull()
  })
  it("distingue versión vigente, ronda enviada y responsable sin atribuir un revisor inexistente", () => {
    const data = workspace()
    data.matrix = { ...data.matrix, status: "published", reviewState: "in_review" }
    data.versions = [{ versionNumber: 2, approvedAt: "2026-10-01T12:00:00.000Z" }] as MiperWorkspace["versions"]
    data.openRound = { stage: "technical", roundNumber: 4, submittedAt: "2026-10-03T12:00:00.000Z", submittedByName: "Elena", openedAt: null } as MiperWorkspace["openRound"]
    const { unmount } = render(<ReviewPanel workspace={data} mode={{ ...mode, canReviewTechnical: true }} onOpenEntry={vi.fn()} rows={rows} observed={new Set()} modified={new Set()} hasBaseline />)
    expect(screen.getByText("Versión vigente: v2")).toBeTruthy()
    expect(screen.getByText(/Sigue vigente mientras se revisan los cambios/)).toBeTruthy()
    expect(screen.getByText(/Estás revisando la versión enviada en esta ronda/)).toBeTruthy()
    expect(screen.getByText(/A cargo de: Revisión técnica/)).toBeTruthy()
    expect(screen.getByText(/por Elena/)).toBeTruthy()
    unmount()
    render(<ReviewPanel workspace={data} mode={{ ...mode, canEdit: true, isSubmitter: true }} onOpenEntry={vi.fn()} rows={rows} observed={new Set()} modified={new Set()} hasBaseline />)
    expect(screen.getByText(/trabajo editable para otra ronda/)).toBeTruthy()
    // «Enviaste esta ronda» ya lo dice la tarjeta «Siguiente paso»: el panel no lo repite.
    expect(screen.queryByText(/la decisión corresponde a otra persona autorizada/)).toBeNull()
    expect(screen.queryByText(/Estás revisando la versión enviada/)).toBeNull()
  })
  it("prioriza observaciones por responder y confirmar antes de las resueltas y de crear otra", () => {
    const data = workspace([
      { ...observation, id: "resolved", status: "resolved" },
      { ...observation, id: "answered", status: "answered" },
      observation,
    ])
    const { container } = render(<ReviewPanel workspace={data} mode={{ ...mode, canObserve: true }} onOpenEntry={vi.fn()} rows={rows} observed={new Set()} modified={new Set()} hasBaseline={false} />)
    expect(Array.from(container.querySelectorAll("details > summary"), (node) => node.textContent)).toEqual(["Por responder (1)", "Por confirmar (1)", "Resueltas (1)"])
    const resolved = screen.getByText("Resueltas (1)").closest("details")
    expect(resolved).not.toHaveAttribute("open")
    const pending = screen.getByText("Por responder (1)")
    const add = screen.getByRole("button", { name: "Registrar observación general" })
    expect(pending.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it("tres enlaces con conteo; en cero, texto", () => {
    const { unmount } = render(<ReviewPanel workspace={workspace()} mode={mode} onOpenEntry={vi.fn()} rows={rows} observed={new Set(["e3"])} modified={new Set(["e1"])} hasBaseline />)
    const region = screen.getByRole("region", { name: "Recorrer la MIPER" })
    const critical = within(region).getByRole("link", { name: "Importantes e Intolerables (2)" })
    expect(within(region).getByRole("link", { name: "Modificados (1)" })).toBeTruthy()
    expect(within(region).getByRole("link", { name: "Observados (1)" })).toBeTruthy()
    // Abre el editor en el primero del filtro, con el filtro en la URL.
    const params = new URLSearchParams(critical.getAttribute("href")!.split("?")[1])
    expect(params.get("fila")).toBe("e2")
    expect(params.get("clasificacion")).toBe("important,intolerable")
    unmount()
    render(<ReviewPanel workspace={workspace()} mode={mode} onOpenEntry={vi.fn()} rows={rows} observed={new Set()} modified={new Set()} hasBaseline />)
    const empty = screen.getByRole("region", { name: "Recorrer la MIPER" })
    expect(within(empty).queryByRole("link", { name: /Observados/ })).toBeNull()
    // Mismo molde que un enlace, pero apagado y con «(0)»: no es un botón gris suelto.
    expect(within(empty).getByText("Observados (0)")).toHaveAttribute("aria-disabled", "true")
    expect(within(empty).getByText("Modificados (0)")).toHaveAttribute("aria-disabled", "true")
    expect(within(empty).getByText("Cada grupo abre el editor en su primer riesgo.")).toBeTruthy()
  })

  it("«Sin observaciones» vive bajo su propio encabezado, no bajo «Recorrer la MIPER»", () => {
    render(<ReviewPanel workspace={workspace()} mode={mode} onOpenEntry={vi.fn()} rows={rows} observed={new Set()} modified={new Set()} hasBaseline />)
    const section = screen.getByRole("region", { name: "Observaciones" })
    expect(within(section).getByText("Sin observaciones")).toBeTruthy()
    expect(within(screen.getByRole("region", { name: "Recorrer la MIPER" })).queryByText("Sin observaciones")).toBeNull()
  })

  it("el recorrido de etapas marca hechas, actual y pendientes con texto accesible", () => {
    const data = workspace()
    data.matrix = { ...data.matrix, reviewState: "pending_approval", status: "draft" }
    render(<ReviewPanel workspace={data} mode={mode} onOpenEntry={vi.fn()} rows={rows} observed={new Set()} modified={new Set()} hasBaseline={false} />)
    const items = within(screen.getByRole("list", { name: "Etapas de revisión" })).getAllByRole("listitem")
    const steps = items.filter((item) => /^\d\./.test(item.textContent ?? ""))
    expect(steps.map((item) => item.textContent)).toEqual(["1. Elaboración · completada", "2. Revisión técnica · completada", "3. Aprobación Legal/RRHH · etapa actual", "4. Vigente"])
  })

  it("un documento histórico no marca ninguna etapa", () => {
    const data = workspace()
    data.matrix = { ...data.matrix, status: "superseded" }
    const { container } = render(<ReviewPanel workspace={data} mode={mode} onOpenEntry={vi.fn()} rows={rows} observed={new Set()} modified={new Set()} hasBaseline={false} />)
    expect(container.querySelector('[aria-current="step"]')).toBeNull()
    expect(screen.queryByText(/completada/)).toBeNull()
  })

  it("el texto guía ya no manda «a la cabecera»", () => {
    render(<ReviewPanel workspace={workspace()} mode={{ ...mode, canEdit: true, canReviewTechnical: true, canApproveLegal: true }} onOpenEntry={vi.fn()} rows={rows} observed={new Set()} modified={new Set()} hasBaseline={false} />)
    expect(screen.getByText("Completa la ficha, los riesgos y sus medidas. Cuando no queden pendientes, envíala con «Enviar a revisión».")).toBeTruthy()
    expect(screen.getByText("Revisa los riesgos y las respuestas. Después aprueba la revisión técnica o devuélvela con observaciones.")).toBeTruthy()
    expect(screen.getByText("Decide sobre la versión revisada técnicamente: apruébala y séllala, o solicita correcciones.")).toBeTruthy()
    expect(screen.queryByText(/cabecera/)).toBeNull()
  })

  it("sin línea base no hay «Modificados»", () => {
    render(<ReviewPanel workspace={workspace()} mode={mode} onOpenEntry={vi.fn()} rows={rows} observed={new Set()} modified={new Set(["e1"])} hasBaseline={false} />)
    expect(screen.queryByText(/Modificados/)).toBeNull()
  })

  it("la observación de un riesgo enlaza a su paso de seguimiento", () => {
    render(<ReviewPanel workspace={workspace([observation])} mode={mode} onOpenEntry={vi.fn()} rows={rows} observed={new Set(["e2"])} modified={new Set()} hasBaseline={false} />)
    const link = screen.getByRole("link", { name: "#2 Peligro 2" })
    const params = new URLSearchParams(link.getAttribute("href")!.split("?")[1])
    expect(params.get("fila")).toBe("e2")
    expect(params.get("paso")).toBe("seguimiento")
  })
})

describe("ReviewPanel: preparación para enviar", () => {
  const editor = { ...mode, canEdit: true } as WorkspaceMode
  const issue = (field: string, entryId: string | null, scope: "header" | "entry" = "entry") => ({ severity: "error", scope, field, entryId, message: `Falta ${field}` }) as never

  it("agrupa los bloqueos del validador y cada uno lleva al paso donde se corrige", () => {
    const onOpenEntry = vi.fn()
    render(<ReviewPanel workspace={workspace()} mode={editor} onOpenEntry={onOpenEntry} rows={rows} observed={new Set()} modified={new Set()} hasBaseline={false}
      issues={[issue("hazard", "e1"), issue("controls", "e2")]} />)
    const section = screen.getByRole("region", { name: "Preparación para enviar" })
    expect(within(section).getByRole("region", { name: "Identificación y evaluación (1)" })).toBeTruthy()
    expect(within(section).getByRole("region", { name: "Medidas de control (1)" })).toBeTruthy()
    within(section).getByRole("button", { name: /Riesgo #1/ }).click()
    expect(onOpenEntry).toHaveBeenCalledWith("e1", expect.any(String))
  })

  it("sin bloqueos dice que está lista y a quien no edita no se la muestra", () => {
    const { rerender } = render(<ReviewPanel workspace={workspace()} mode={editor} onOpenEntry={vi.fn()} rows={rows} observed={new Set()} modified={new Set()} hasBaseline={false} issues={[]} />)
    expect(screen.getByText(/Sin pendientes: no queda/)).toBeTruthy()
    rerender(<ReviewPanel workspace={workspace()} mode={mode} onOpenEntry={vi.fn()} rows={rows} observed={new Set()} modified={new Set()} hasBaseline={false} issues={[]} />)
    expect(screen.queryByRole("region", { name: "Preparación para enviar" })).toBeNull()
  })
})

describe("ReviewPanel: sin refresco doble", () => {
  it("responder una observación no pide un router.refresh(): la acción ya revalida y Next refresca la página", async () => {
    render(<ReviewPanel workspace={workspace([observation])} mode={{ ...mode, canRespond: true }} onOpenEntry={vi.fn()} rows={rows} observed={new Set()} modified={new Set()} hasBaseline={false} />)
    fireEvent.change(screen.getByRole("textbox", { name: "Tu respuesta" }), { target: { value: "Se agregó la medida pedida." } })
    fireEvent.click(screen.getByRole("button", { name: "Responder" }))
    await waitFor(() => expect(actions.respondMiperObservationAction).toHaveBeenCalledWith({ observationId: "o1", response: "Se agregó la medida pedida." }))
    expect(router.refresh).not.toHaveBeenCalled()
  })
})
