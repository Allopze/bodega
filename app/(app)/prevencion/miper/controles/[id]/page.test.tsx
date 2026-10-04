// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ detail: vi.fn(), permissions: ["prevention:risk:view"] }))
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(href) }, notFound: () => { throw new Error("not found") } }))
vi.mock("@/lib/auth/can", () => ({
  requireAuth: async () => ({ user: { id: "u1", permissions: mocks.permissions } }),
  can: (_session: unknown, permission: string) => mocks.permissions.includes(permission),
}))
vi.mock("@/lib/auth/scope", () => ({ resolveWorksiteScope: () => ({ kind: "all" }) }))
vi.mock("@/lib/services/prevention-risk-legal", () => ({ getRiskControlDetail: mocks.detail }))
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header>,
  Breadcrumbs: () => null,
}))
vi.mock("./verify-control-form", () => ({ VerifyControlForm: () => <button>Verificar control</button> }))
import RiskControlDetailPage from "./page"

function detail() {
  return {
    control: { id: "c1", description: "Baranda", isCritical: true, status: "verified", responsibleUserId: "other", responsibleSnapshot: "Carla", performanceStandard: "Baranda firme", verificationFrequency: "Mensual", lastVerifiedAt: null, evidenceReference: "javascript:alert('evidencia')", hierarchy: "engineering", version: 2 },
    entry: { id: "e1", rowNumber: 7, classification: "important", magnitude: 8, residualLevel: null, hazard: "Trabajo en altura", responsibleUserId: "other" },
    matrix: { id: "m1", status: "published", createdByUserId: "other", period: 2026, matrixVersion: 1, publishedHashSha256: "abcdef0123456789" },
    worksiteName: "Planta", process: { name: "Mantención" }, task: { name: "Revisar equipo" }, position: { name: "Mecánico" }, links: [{ id: "l1", activityId: "a1" }], linkedActivities: [{ id: "a1", n: 12, activity: "Inspección de barandas", programId: "p1" }],
  }
}

afterEach(() => { vi.clearAllMocks(); mocks.permissions = ["prevention:risk:view"] })

describe("Ficha de verificación", () => {
  it("conserva evidencia libre como texto, oculta huella en detalle y no ofrece acceso PDTP sin permiso", async () => {
    mocks.detail.mockResolvedValue(detail())
    render(await RiskControlDetailPage({ params: Promise.resolve({ id: "c1" }) }))
    expect(screen.getByText("javascript:alert('evidencia')")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "javascript:alert('evidencia')" })).toBeNull()
    expect(screen.queryByRole("link", { name: "Consultar cobertura del programa" })).toBeNull()
    expect(screen.queryByText(/Inspección de barandas/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Verificar control" })).toBeNull()
    expect(screen.getByText("Trazabilidad y datos técnicos").closest("details")).not.toHaveAttribute("open")
    expect(screen.getByRole("link", { name: "Volver al riesgo y sus medidas" })).toHaveAttribute("href", "/prevencion/miper/m1?fila=e1&paso=medidas")
  })

  it("usa la ruta real de cobertura con permiso y conserva la restricción de verificar una matriz vigente", async () => {
    mocks.permissions = ["prevention:risk:view", "prevention:pdtp:view", "prevention:risk:edit"]
    mocks.detail.mockResolvedValue({ ...detail(), matrix: { ...detail().matrix, status: "superseded" } })
    render(await RiskControlDetailPage({ params: Promise.resolve({ id: "c1" }) }))
    expect(screen.getByRole("link", { name: "Consultar cobertura del programa" })).toHaveAttribute("href", "/prevencion/pdtp/cobertura")
    expect(screen.getByText(/Inspección de barandas/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Verificar control" })).toBeNull()
  })
})
