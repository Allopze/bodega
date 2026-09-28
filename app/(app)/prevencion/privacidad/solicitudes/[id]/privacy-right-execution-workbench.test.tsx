// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PrivacyRightExecutionWorkbench } from "./privacy-right-execution-workbench"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

afterEach(() => cleanup())

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    request: {
      id: "ppr-1",
      subjectWorkerId: "worker-1",
      rightType: "deletion",
      status: "en_proceso",
      requestScope: "Suprimir dato clínico",
      receivedAt: "2026-07-18T00:00:00.000Z",
      dueAt: null,
      handledByUserId: "manager-1",
      createdByUserId: "manager-1",
      identityVerifiedAt: "2026-07-18T01:00:00.000Z",
      identityVerifiedByUserId: "manager-1",
      completedAt: null,
      decisionReason: null,
      legalHold: false,
      legalHoldReason: null,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T01:00:00.000Z",
      ...overrides,
    },
    subject: { id: "worker-1", name: "Titular Prueba", rut: "11.111.111-1", worksiteId: "ws-1" },
    worksite: { id: "ws-1", name: "Faena Uno" },
    inventory: {
      healthRecords: [{ id: "health-1", recordType: "aptitud", status: "vigente", fitnessStatus: "apto", validUntil: null }],
      reservedCases: [],
      ppas: [{ id: "ppa-1", estado: "aprobado_auto", createdAt: "2026-07-15T00:00:00.000Z" }],
      documentLinks: [],
    },
    executions: [],
    restrictions: [],
    history: [],
    deliveries: [],
  } as unknown as Parameters<typeof PrivacyRightExecutionWorkbench>[0]["bundle"]
}

describe("privacy-right execution workbench", () => {
  it("avisa cuántos documentos sensibles vinculados no puede ver quien atiende", () => {
    render(<PrivacyRightExecutionWorkbench bundle={{ ...bundle(), restrictedDocumentCount: 2 }} />)
    expect(screen.getByText(/2 documento\(s\) sensible\(s\) vinculado\(s\) al titular no se muestran/)).toBeInTheDocument()
  })

  it("offers the domain mutation only after identity validation and without hold", () => {
    render(<PrivacyRightExecutionWorkbench bundle={bundle()} />)
    expect(screen.getAllByRole("button", { name: "Ejecutar" })).toHaveLength(2)
    expect(screen.getByText(/Aún no hay una mutación demostrable/i)).toBeInTheDocument()
  })

  // El identificador crudo se conserva a propósito: es la traza que una
  // solicitud legal necesita citar. Lo que no puede quedar crudo es el estado.
  it("names the PPA state and date in business language, never as an enum", () => {
    render(<PrivacyRightExecutionWorkbench bundle={bundle()} />)
    expect(screen.getByText("Aprob. auto")).toBeInTheDocument()
    expect(screen.queryByText("aprobado_auto")).not.toBeInTheDocument()
    expect(screen.getByText(/^PPA · \d{2}-\d{2}-\d{4}$/)).toBeInTheDocument()
  })

  // H4: la evidencia de ejecución imprimía `deletion · health_record` y
  // `applied`; quien responde la solicitud necesita leerlo en español.
  it("names the execution operation, domain and outcome in Spanish", () => {
    const withExecution = {
      ...bundle(),
      executions: [{
        id: "exec-1", operation: "deletion", domain: "health_record", outcome: "blocked_retention",
        createdAt: "2026-07-18T15:30:00.000Z", beforeHash: "a".repeat(64), afterHash: "b".repeat(64),
      }],
    } as unknown as Parameters<typeof PrivacyRightExecutionWorkbench>[0]["bundle"]
    render(<PrivacyRightExecutionWorkbench bundle={withExecution} />)
    expect(screen.getByText("Supresión · Registro de salud")).toBeInTheDocument()
    expect(screen.getByText(/Bloqueada por retención legal$/)).toBeInTheDocument()
    expect(screen.queryByText(/health_record|blocked_retention/)).not.toBeInTheDocument()
  })

  it("hides execution while legal retention is active", () => {
    render(<PrivacyRightExecutionWorkbench bundle={bundle({ legalHold: true, status: "suspendida_retencion" })} />)
    expect(screen.queryByRole("button", { name: "Ejecutar" })).not.toBeInTheDocument()
  })

  // FX-A (A10): la clave se generaba en cada clic. Un reintento tras un error
  // de red —justo el caso que la idempotencia cubre— mandaba otra clave y el
  // servidor lo trataba como un envío nuevo. La clave nace al abrir el diálogo.
  it("reuses one idempotency key per dialog opening and renews it on the next opening", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "caída de red" }), { status: 503 }))
      .mockResolvedValue(new Response(JSON.stringify({ execution: { id: "e-1", outcome: "applied" } }), { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)
    const keyOf = (call: number) => (fetchMock.mock.calls[call]![1] as RequestInit & { headers: Record<string, string> }).headers["idempotency-key"]

    render(<PrivacyRightExecutionWorkbench bundle={bundle()} />)
    const openFirst = () => fireEvent.click(screen.getAllByRole("button", { name: "Ejecutar" })[0]!)
    const apply = () => {
      fireEvent.change(screen.getByLabelText(/Motivo y evidencia revisada/), { target: { value: "Titular validado solicita supresión" } })
      fireEvent.click(screen.getByRole("button", { name: "Aplicar y auditar" }))
    }

    openFirst()
    apply()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByRole("button", { name: "Aplicar y auditar" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "Aplicar y auditar" }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(keyOf(1)).toBe(keyOf(0))

    await waitFor(() => expect(screen.queryByRole("button", { name: "Aplicar y auditar" })).not.toBeInTheDocument())
    openFirst()
    apply()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(keyOf(2)).not.toBe(keyOf(0))
    vi.unstubAllGlobals()
  })
})
