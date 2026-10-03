// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ProgramEvidenceView } from "@/lib/services/miper/program-queries"

vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("../actions", () => ({
  addOccurrenceEvidenceAction: vi.fn(),
  uploadProgramEvidenceAction: vi.fn(),
  withdrawOccurrenceEvidenceAction: vi.fn(),
}))

import { EvidenceSheet } from "./evidence-sheet"

const item = (patch: Partial<ProgramEvidenceView>): ProgramEvidenceView => ({
  id: "ev1",
  evidenceUploadId: "storage/miper-evidence/acta.pdf",
  fileName: "acta.pdf",
  description: "Acta de la reunión",
  uploadedAt: "2026-05-10T12:00:00Z",
  uploadedByName: "Ana",
  withdrawnAt: null,
  withdrawReason: null,
  mimeType: "application/pdf",
  inlineSafe: true,
  ...patch,
})

function renderSheet(evidence: ProgramEvidenceView[], canExecute = true) {
  return render(
    <EvidenceSheet
      open
      onOpenChange={() => {}}
      record={{ id: "r1", outcome: "done", effectiveOn: "2026-05-10", voidedAt: null, evidence }}
      occurrenceLabel="Ocurrencia del 10-05-2026"
      canExecute={canExecute}
      onChanged={() => {}}
    />,
  )
}

afterEach(() => { vi.clearAllMocks() })

describe("EvidenceSheet", () => {
  it("Abrir sólo para PDF e imágenes", () => {
    renderSheet([
      item({}),
      item({
        id: "ev2", evidenceUploadId: "storage/miper-evidence/planilla.xlsx", fileName: "planilla.xlsx",
        description: "Planilla", mimeType: "application/vnd.ms-excel", inlineSafe: false,
      }),
    ])
    const open = screen.getByRole("link", { name: "Abrir Acta de la reunión" })
    expect(open.getAttribute("target")).toBe("_blank")
    expect(open.getAttribute("rel")).toBe("noopener noreferrer")
    expect(screen.queryByRole("link", { name: "Abrir Planilla" })).toBeNull()
    expect(screen.getByRole("link", { name: "Descargar Planilla" })).toBeTruthy()
  })

  it("Descargar lleva ?descargar=1", () => {
    renderSheet([item({})])
    const download = screen.getByRole("link", { name: "Descargar Acta de la reunión" })
    expect(download.getAttribute("href")).toContain("?descargar=1")
    expect(screen.getByRole("link", { name: "Abrir Acta de la reunión" }).getAttribute("href")).not.toContain("descargar")
  })

  it("la retirada se marca Retirada y no ofrece retirar", () => {
    renderSheet([item({ withdrawnAt: "2026-05-12T09:00:00Z", withdrawReason: "Archivo equivocado" })])
    expect(screen.getByText("Retirada")).toBeTruthy()
    expect(screen.getByText(/Archivo equivocado/)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Retirar la evidencia/ })).toBeNull()
  })
})
