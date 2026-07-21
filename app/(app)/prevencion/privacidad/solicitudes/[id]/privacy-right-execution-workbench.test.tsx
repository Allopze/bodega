// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react"
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
      ppas: [],
      documentLinks: [],
    },
    executions: [],
    restrictions: [],
    history: [],
    deliveries: [],
  } as unknown as Parameters<typeof PrivacyRightExecutionWorkbench>[0]["bundle"]
}

describe("privacy-right execution workbench", () => {
  it("offers the domain mutation only after identity validation and without hold", () => {
    render(<PrivacyRightExecutionWorkbench bundle={bundle()} />)
    expect(screen.getByRole("button", { name: "Ejecutar" })).toBeInTheDocument()
    expect(screen.getByText(/Aún no hay una mutación demostrable/i)).toBeInTheDocument()
  })

  it("hides execution while legal retention is active", () => {
    render(<PrivacyRightExecutionWorkbench bundle={bundle({ legalHold: true, status: "suspendida_retencion" })} />)
    expect(screen.queryByRole("button", { name: "Ejecutar" })).not.toBeInTheDocument()
  })
})
