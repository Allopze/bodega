// @vitest-environment jsdom
/**
 * Fase 0.6 (AUDITORIA_VISUALIZACIONES_CHOME): la tabla de solicitudes recortaba
 * `receivedAt`/`dueAt` con `.slice(0, 10)`. Son `timestamptz`, así que el
 * recorte entrega el día en UTC (el 31 de octubre a las 22:30 de Chile salía
 * como «2026-11-01»), con el formato ISO en vez del dd-mm-aaaa del resto de la
 * plataforma. El plazo de respuesta de un derecho ARCO se cuenta en días
 * corridos de Chile: un día de más o de menos cambia el vencimiento que se lee.
 */
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import { resolvePagination } from "@/lib/pagination"
import { PrivacyRequestsWorkbench } from "./privacy-requests-workbench"

afterEach(cleanup)

function row(overrides: Partial<Parameters<typeof PrivacyRequestsWorkbench>[0]["rows"][number]> = {}) {
  return {
    id: "req-1",
    subjectWorkerId: "w-1",
    subjectName: "Ana Pérez",
    subjectRut: "11.111.111-1",
    worksiteName: "Faena Norte",
    rightType: "access",
    status: "recibida",
    requestScope: "Copia de mis datos",
    // Forma en que `timestamptz` llega con `mode: "string"`: instante en UTC.
    receivedAt: "2026-11-01 01:30:00+00",
    dueAt: "2026-12-01 02:59:59+00",
    legalHold: false,
    legalHoldReason: null,
    identityVerifiedAt: null,
    ...overrides,
  }
}

function renderWorkbench(rows: ReturnType<typeof row>[]) {
  return render(
    <PrivacyRequestsWorkbench
      rows={rows}
      canExport={false}
      canExportClinical={false}
      pagination={resolvePagination({ pageParam: undefined, totalItems: rows.length, pageSize: 50 })}
    />,
  )
}

describe("PrivacyRequestsWorkbench — fechas de recepción y vencimiento", () => {
  it("muestra el día de Chile en dd-mm-aaaa, no el recorte UTC del ISO", () => {
    renderWorkbench([row()])

    // 2026-11-01 01:30Z = 31-10-2026 22:30 en Chile (UTC-3); el vencimiento
    // 2026-12-01 02:59:59Z = 30-11-2026 23:59 (el último minuto del plazo).
    expect(screen.getByText("31-10-2026")).toBeInTheDocument()
    expect(screen.getByText("Vence 30-11-2026")).toBeInTheDocument()
    expect(screen.queryByText(/2026-11-01/)).toBeNull()
  })

  it("sin plazo no inventa «Vence»", () => {
    renderWorkbench([row({ dueAt: null })])

    expect(screen.getByText("31-10-2026")).toBeInTheDocument()
    expect(screen.queryByText(/Vence/)).toBeNull()
  })
})
