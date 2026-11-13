// @vitest-environment jsdom
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { CopecCoverageStatusView, CopecSyncStateView } from "@/lib/combustibles/copec-sync"
import type { CopecOpenRejection } from "@/lib/combustibles/fuel-provider-ledger"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("./copec-review-actions", () => ({
  resolveCopecPeriodWithIssuesAction: vi.fn(),
  resolveCopecRejectionAction: vi.fn(),
}))

const { CopecPeriodReview } = await import("./copec-period-review")

function coverage(overrides: Partial<CopecCoverageStatusView> = {}): CopecCoverageStatusView {
  return {
    channel: "TCT", product: "diesel", status: "complete", canConfirmEmpty: false,
    canCloseWithIssues: false, closeWithIssuesBlockedReason: null,
    rowsReceived: 10, rowsAccepted: 10, rowsRejected: 0, rowsPending: 0,
    evidence: null, evidenceActorUserId: null, updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  }
}

function rejection(overrides: Partial<CopecOpenRejection> = {}): CopecOpenRejection {
  return {
    id: "rej-1", sourceAccount: "tct:diesel", sourceRowKey: "row-1", code: "possible_provider_correction",
    message: "La guía cambió de volumen", sourceProduct: "diesel", sourcePlate: "KA-1",
    occurredAt: "2026-10-05", quantity: 120, amount: null, status: "open",
    createdAt: "2026-11-01T00:00:00.000Z", isCorrection: true,
    ...overrides,
  }
}

function state(overrides: Partial<CopecSyncStateView> = {}): CopecSyncStateView {
  return {
    lastRunAt: null, lastRunStatus: null, lastRunMonth: null, rowsReceived: 0, rowsAccepted: 0,
    rowsRejected: 0, rowsPending: 0, affectedQuantity: 0, affectedAmount: 0, cursor: null,
    pending: 0, pendingItems: [], coverageMonth: "2026-10-01", coverage: [], openRejections: [],
    ...overrides,
  }
}

describe("CopecPeriodReview", () => {
  it("no ocupa espacio si no hay nada que decidir", () => {
    const { container } = render(<CopecPeriodReview state={state({ coverage: [coverage()] })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("ofrece cerrar con observaciones un mes que quedó con filas inválidas", () => {
    render(<CopecPeriodReview state={state({
      coverage: [coverage({ status: "failed", canCloseWithIssues: true, rowsAccepted: 9, rowsRejected: 1 })],
    })} />)
    expect(screen.getByRole("heading", { name: "Revisión de Copec" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cerrar con observaciones" })).toBeInTheDocument()
  })

  it("aprueba sólo correcciones: una fila inválida se marca revisada", () => {
    render(<CopecPeriodReview state={state({
      openRejections: [
        rejection(),
        rejection({ id: "rej-2", code: "invalid_quantity", message: "Volumen negativo", isCorrection: false }),
      ],
    })} />)
    expect(screen.getAllByRole("button", { name: "Aprobar corrección" })).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Descartar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Marcar revisada" })).toBeInTheDocument()
  })

  it("rotula la cuenta y la fecha en lenguaje de usuario, no con la clave ni el ISO crudo", () => {
    render(<CopecPeriodReview state={state({ openRejections: [rejection({ occurredAt: "2026-10-05T15:30:00.000Z" })] })} />)
    expect(screen.getByText("Tarjeta de equipos · Diésel · KA-1")).toBeInTheDocument()
    expect(screen.queryByText(/tct:diesel/)).not.toBeInTheDocument()
    expect(screen.queryByText(/2026-10-05T/)).not.toBeInTheDocument()
  })
})
