// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ requirePermission: vi.fn(), loadData: vi.fn() }))

vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`redirect:${href}`) },
  notFound: () => { throw new Error("not-found") },
}))
vi.mock("@/lib/auth/can", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("./document", () => ({
  ACTA_STYLES: "",
  InspectionActaDocument: () => <div data-testid="acta" />,
  actaComplianceLabels: () => ({ official: "Sin fórmula en el documento", normalized: "80%" }),
  loadInspectionActaData: mocks.loadData,
}))
vi.mock("../../../../sst/[id]/print/print-trigger", () => ({
  PrintTrigger: ({ backHref, backLabel }: { backHref: string; backLabel?: string }) => (
    <a href={backHref}>{backLabel ?? "Volver al Acta"}</a>
  ),
}))

import InspectionPrintPage, { generateMetadata } from "./page"

function data() {
  return {
    detail: {
      run: { code: "INSP-0001", status: "completed", origin: "prevencion", subjectLabel: null, executedAt: null, nonConformingCount: 1 },
      templateName: "Inspección de extintores",
      worksiteName: "Faena E2E",
      executorName: null,
      findings: [],
    },
    suggestedFilename: "INSP-0001.pdf",
  }
}

const params = (runId: string) => ({ params: Promise.resolve({ runId }) })

afterEach(() => vi.clearAllMocks())

describe("página de impresión del acta de inspección", () => {
  it("la pestaña dice «Acta <código> · <plantilla>»", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "u1" } })
    mocks.loadData.mockResolvedValue(data())

    await expect(generateMetadata(params("run-title-1"))).resolves.toEqual({ title: "Acta INSP-0001 · Inspección de extintores" })
  })

  it("sin permiso o sin la inspección el título es genérico y no revela el código", async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error("Forbidden"))
    await expect(generateMetadata(params("run-title-2"))).resolves.toEqual({ title: "Acta de inspección" })

    mocks.requirePermission.mockResolvedValue({ user: { id: "u1" } })
    mocks.loadData.mockResolvedValue(null)
    await expect(generateMetadata(params("run-title-3"))).resolves.toEqual({ title: "Acta de inspección" })
  })

  it("el enlace de vuelta nombra la inspección, no «el Acta»", async () => {
    mocks.requirePermission.mockResolvedValue({ user: { id: "u1" } })
    mocks.loadData.mockResolvedValue(data())

    render(await InspectionPrintPage(params("run-page-1")))

    expect(screen.getByRole("link", { name: "Volver a la inspección" })).toHaveAttribute("href", "/prevencion/inspecciones/run-page-1")
    expect(screen.getByTestId("acta")).toBeTruthy()
  })

  it("conserva las salidas de siempre: sin permiso va a /login y sin la inspección es 404", async () => {
    mocks.requirePermission.mockRejectedValueOnce(new Error("Unauthorized"))
    await expect(InspectionPrintPage(params("run-page-2"))).rejects.toThrow("redirect:/login")

    mocks.requirePermission.mockResolvedValue({ user: { id: "u1" } })
    mocks.loadData.mockResolvedValue(null)
    await expect(InspectionPrintPage(params("run-page-3"))).rejects.toThrow("not-found")
  })
})
