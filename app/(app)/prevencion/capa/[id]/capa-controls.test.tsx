// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
const addEvidenceMock = vi.hoisted(() => vi.fn())
vi.mock("../actions", () => ({
  addCapaEvidenceAction: addEvidenceMock, addCapaFollowupAction: vi.fn(), reconcileCapaActionAction: vi.fn(),
  transitionCapaActionAction: vi.fn(), updateCapaActionAction: vi.fn(),
}))

import { CapaControls } from "./capa-controls"

const none = { manage: false, complete: false, verify: false, close: false, reconcile: false, overrideSegregation: false }
const all = { manage: true, complete: true, verify: true, close: true, reconcile: true, overrideSegregation: true }
const manualSource = { sourceType: "manual", sourceId: "libre-1" }

describe("CapaControls permission visibility", () => {
  it("hides implementation and closure controls without their permissions", () => {
    const { rerender } = render(<CapaControls action={{
      id: "c1", version: 1, status: "pending", priority: "medium", targetDate: "2026-08-01",
      responsibleUserId: null, reconciliationStatus: "reconciled", ...manualSource,
    }} users={[]} permissions={none} />)
    expect(screen.queryByText("Iniciar implementación")).not.toBeInTheDocument()

    rerender(<CapaControls action={{
      id: "c1", version: 2, status: "verified", priority: "medium", targetDate: "2026-08-01",
      responsibleUserId: null, reconciliationStatus: "reconciled", ...manualSource,
    }} users={[]} permissions={none} />)
    expect(screen.queryByText("Cerrar CAPA")).not.toBeInTheDocument()
  })

  it("shows closure only with the dedicated permission", () => {
    render(<CapaControls action={{
      id: "c1", version: 2, status: "verified", priority: "medium", targetDate: "2026-08-01",
      responsibleUserId: null, reconciliationStatus: "reconciled", ...manualSource,
    }} users={[]} permissions={{ ...none, close: true }} />)
    expect(screen.getByText("Cerrar CAPA")).toBeInTheDocument()
  })
})

/**
 * PPA-03: el avance de una acción nacida de un PPA lo conduce el PPA. El
 * servidor rechaza transición y edición para ese origen; la UI no debe ofrecer
 * botones que sólo pueden fallar.
 */
describe("CapaControls con origen ppa", () => {
  it("oculta transición, verificación y asignación, y enlaza al PPA de origen", () => {
    render(<CapaControls action={{
      id: "c1", version: 1, status: "pending_verification", priority: "medium", targetDate: "2026-08-01",
      responsibleUserId: null, reconciliationStatus: "reconciled",
      sourceType: "ppa", sourceId: "ppa-9",
    }} users={[]} permissions={all} />)

    expect(screen.queryByText("Iniciar implementación")).not.toBeInTheDocument()
    expect(screen.queryByText("Cancelar CAPA")).not.toBeInTheDocument()
    expect(screen.queryByText("Verificar eficacia")).not.toBeInTheDocument()
    expect(screen.queryByText("Asignación y plazo")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "ver el PPA" })).toHaveAttribute("href", "/prevencion/ppa/ppa-9")
    // Lo que el servidor sí acepta para este origen sigue disponible.
    expect(screen.getByText("Agregar evidencia")).toBeInTheDocument()
    expect(screen.getByText("Conciliación histórica")).toBeInTheDocument()
  })

  it("mantiene los controles de transición para cualquier otro origen", () => {
    render(<CapaControls action={{
      id: "c1", version: 1, status: "pending_verification", priority: "medium", targetDate: "2026-08-01",
      responsibleUserId: null, reconciliationStatus: "reconciled",
      sourceType: "incident", sourceId: "inc-3",
    }} users={[]} permissions={all} />)

    expect(screen.getByText("Verificar eficacia")).toBeInTheDocument()
    expect(screen.getByText("Asignación y plazo")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "ver el PPA" })).not.toBeInTheDocument()
  })
})

const base = {
  id: "c1", version: 3, priority: "medium", targetDate: "2026-08-01",
  responsibleUserId: null, reconciliationStatus: "reconciled", ...manualSource,
}

/* FX-B (B11): el servicio permite closed → reopened, pero el botón vivía dentro
 * del bloque de estados no terminales y una CAPA cerrada nunca lo mostraba. */
describe("CapaControls: reabrir una CAPA cerrada", () => {
  it("ofrece Reabrir a quien verifica cuando la CAPA está cerrada", () => {
    render(<CapaControls action={{ ...base, status: "closed" }} users={[]} permissions={{ ...none, verify: true }} />)
    expect(screen.getByRole("button", { name: "Reabrir" })).toBeInTheDocument()
  })

  it("no lo ofrece sin el permiso de verificar ni en una cancelada", () => {
    const { rerender } = render(<CapaControls action={{ ...base, status: "closed" }} users={[]} permissions={none} />)
    expect(screen.queryByRole("button", { name: "Reabrir" })).not.toBeInTheDocument()
    rerender(<CapaControls action={{ ...base, status: "cancelled" }} users={[]} permissions={all} />)
    expect(screen.queryByRole("button", { name: "Reabrir" })).not.toBeInTheDocument()
  })
})

/* FX-B (B12): la segregación se exige en toda prioridad; la excepción sólo se
 * podía escribir en alta y crítica, así que en baja/media no había salida. */
describe("CapaControls: excepción de segregación", () => {
  it("muestra el campo en cualquier prioridad a quien puede ejercerla", () => {
    for (const priority of ["low", "medium", "high", "critical"]) {
      const { unmount } = render(<CapaControls action={{ ...base, priority, status: "pending_verification" }} users={[]} permissions={{ ...none, verify: true, overrideSegregation: true }} />)
      expect(screen.getByLabelText(/Excepción de segregación/)).toBeInTheDocument()
      unmount()
    }
  })
})

/* FX-B (B9): un documento o una foto se sube como archivo y la acción recibe la
 * ruta almacenada con su SHA-256, que es lo que el contrato de evidencia exige. */
describe("CapaControls: evidencia como archivo", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("sube el archivo y registra la ruta con su checksum", async () => {
    const checksum = "b".repeat(64)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: "storage/capa-evidence/acta.pdf", checksumSha256: checksum }),
    })
    vi.stubGlobal("fetch", fetchMock)
    addEvidenceMock.mockResolvedValue({ ok: true, message: "Evidencia registrada" })

    render(<CapaControls action={{ ...base, status: "in_progress" }} users={[]} permissions={{ ...none, complete: true }} />)
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "acta.pdf", { type: "application/pdf" })
    fireEvent.change(screen.getByLabelText("Archivo"), { target: { files: [file] } })
    fireEvent.click(screen.getByRole("button", { name: "Registrar evidencia" }))

    await waitFor(() => expect(addEvidenceMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith("/api/prevencion/capa/evidence", expect.objectContaining({ method: "POST" }))
    const body = fetchMock.mock.calls[0]![1].body as FormData
    expect(body.get("actionId")).toBe("c1")
    expect(addEvidenceMock).toHaveBeenCalledWith(expect.objectContaining({
      actionId: "c1", expectedVersion: 3, kind: "photo",
      reference: "storage/capa-evidence/acta.pdf", checksumSha256: checksum,
    }))
  })
})

