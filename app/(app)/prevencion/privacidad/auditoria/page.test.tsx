// @vitest-environment jsdom
/**
 * Fase 0.6 (AUDITORIA_VISUALIZACIONES_CHOME): la auditoría de accesos sensibles
 * mostraba `createdAt.slice(0, 16)`: un `timestamptz` en UTC, sin conversión.
 * Quien audita un acceso lee la hora en la que ocurrió; con el recorte la
 * veía 3–4 horas corrida y con el día cambiado en las noches de Chile.
 */
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

const mocks = vi.hoisted(() => ({ domainAudit: vi.fn(), libraryAudit: vi.fn() }))

vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`redirect:${href}`) } }))
vi.mock("next/link", () => ({ default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock("@/db", () => ({ db: {} }))
vi.mock("@/lib/auth/can", () => ({
  requireAuth: async () => ({ user: { id: "u-1", permissions: ["prevention:privacy:audit"] } }),
  can: () => true,
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ mode: "all", ids: [] }) }))
vi.mock("@/components/ui/page-header", () => ({ PageHeader: () => null, Breadcrumbs: () => null }))
vi.mock("@/lib/services/prevention-privacy", () => ({
  listPreventionSensitiveAccessAudit: mocks.domainAudit,
  listGeneralLibrarySensitiveAccess: mocks.libraryAudit,
}))

import PreventionPrivacyAuditPage from "./page"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Auditoría de accesos sensibles — fecha y hora", () => {
  it("convierte la hora a Chile, con el formato de la plataforma, en las dos tablas", async () => {
    // 2026-11-01 01:30Z = 31-10-2026 22:30 en Chile (UTC-3).
    mocks.domainAudit.mockResolvedValue([{
      id: "a-1", createdAt: "2026-11-01 01:30:00+00", domain: "health", action: "read",
      outcome: "granted", actorUserId: "u-9", purpose: "Revisión de ficha",
    }])
    mocks.libraryAudit.mockResolvedValue([{
      auditId: "b-1", createdAt: "2026-11-01 03:45:00+00", documentId: "d-1", documentTitle: "Procedimiento",
      action: "download", actorUserId: "u-9", dataClass: "personal", confidentiality: "restricted",
    }])

    render(await PreventionPrivacyAuditPage())

    expect(screen.getByText("31-10-2026 22:30")).toBeInTheDocument()
    expect(screen.getByText("01-11-2026 00:45")).toBeInTheDocument()
    // Antes: el recorte del texto UTC («2026-11-01 01:30»).
    expect(screen.queryByText("2026-11-01 01:30")).toBeNull()
    expect(screen.queryByText("2026-11-01 03:45")).toBeNull()
  })
})
