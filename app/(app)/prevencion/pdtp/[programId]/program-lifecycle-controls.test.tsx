// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ProgramLifecycleControls } from "./program-lifecycle-controls"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("../actions", () => ({
  submitPdtpProgramForReviewAction: vi.fn(),
  approvePdtpProgramJdprAction: vi.fn(),
  signPdtpProgramLegalAction: vi.fn(),
  activatePdtpProgramAction: vi.fn(),
  rejectPdtpProgramAsJdprAction: vi.fn(),
  rejectPdtpProgramAsLegalAction: vi.fn(),
  reopenRejectedPdtpProgramAction: vi.fn(),
  archivePdtpProgramAction: vi.fn(),
}))

const baseProgram = {
  id: "program-1",
  status: "draft",
  contentVersion: 1,
  contentDigest: null,
  elaboratedByName: "Ana Prevención",
  elaboratedByTitle: "Prevencionista",
  reviewStartedAt: null,
  approvedByJdprAt: null,
  approvedByLegalAt: null,
  activatedAt: null,
  rejectionReason: null,
  archiveReason: null,
}

const permissions = {
  canSubmitReview: true,
  canApprove: true,
  canSignLegal: true,
  canActivate: true,
  canManageLifecycle: true,
}

describe("ProgramLifecycleControls", () => {
  it("offers review submission, not an approval, while content is draft", () => {
    render(<ProgramLifecycleControls program={baseProgram} permissions={permissions} />)
    expect(screen.getByText("Borrador")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Enviar a revisión" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Aprobar:/ })).not.toBeInTheDocument()
  })

  it("shows the signed content version and only the next valid technical decision", () => {
    render(<ProgramLifecycleControls program={{
      ...baseProgram,
      status: "in_review",
      contentVersion: 3,
      contentDigest: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      reviewStartedAt: "2026-07-21T12:00:00.000Z",
    }} permissions={permissions} />)

    expect(screen.getByText("En revisión")).toBeInTheDocument()
    expect(screen.getByText("contenido v3")).toBeInTheDocument()
    expect(screen.getByText(/SHA-256 abcdef123456/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Aprobar: Revisión JDPR" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Aprobar: Decisión Legal" })).not.toBeInTheDocument()
    expect(screen.getByText("Registrada")).toBeInTheDocument()
  })

  it("expands the JDPR abbreviation as a tooltip on the lifecycle step label", () => {
    render(<ProgramLifecycleControls program={{
      ...baseProgram,
      status: "in_review",
      contentDigest: "a".repeat(64),
      reviewStartedAt: "2026-07-21T12:00:00.000Z",
    }} permissions={permissions} />)

    const stepLabel = screen.getByText("Revisión JDPR", { selector: "p" })
    expect(stepLabel).toHaveAttribute("title", expect.stringContaining("Jefatura de Prevención de Riesgos"))
  })

  it("advances to Legal only after JDPR approved", () => {
    render(<ProgramLifecycleControls program={{
      ...baseProgram,
      status: "in_review",
      contentDigest: "a".repeat(64),
      reviewStartedAt: "2026-07-21T12:00:00.000Z",
      approvedByJdprAt: "2026-07-21T13:00:00.000Z",
    }} permissions={permissions} />)

    expect(screen.getByRole("button", { name: "Aprobar: Decisión Legal" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Aprobar: Revisión JDPR" })).not.toBeInTheDocument()
  })

  it("renders the next configured step instead of assuming fixed cargos", () => {
    render(<ProgramLifecycleControls
      program={{
        ...baseProgram,
        status: "in_review",
        contentDigest: "c".repeat(64),
        reviewStartedAt: "2026-07-21T12:00:00.000Z",
      }}
      permissions={permissions}
      approvalSteps={[
        { id: "s1", code: "tecnica", label: "Revisión técnica", isRequired: true, canDecide: false, decision: { decision: "approved", decidedAt: "2026-07-21T13:00:00.000Z" } },
        { id: "s2", code: "operacion", label: "Validación operacional", isRequired: true, canDecide: true, decision: null },
        { id: "s3", code: "final", label: "Aprobación final", isRequired: true, canDecide: false, decision: null },
      ]}
    />)

    expect(screen.getByText(/falta completar: Validación operacional/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Aprobar: Validación operacional" })).toBeInTheDocument()
    expect(screen.getByText("Aprobación final")).toBeInTheDocument()
  })

  it("explains a rejection and offers audited reopen or archive actions", () => {
    render(<ProgramLifecycleControls program={{
      ...baseProgram,
      status: "rejected",
      contentDigest: "b".repeat(64),
      reviewStartedAt: "2026-07-21T12:00:00.000Z",
      rejectionReason: "Falta justificar la programación crítica.",
    }} permissions={permissions} />)

    expect(screen.getByText("Rechazado")).toBeInTheDocument()
    expect(screen.getByText(/Falta justificar la programación crítica/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reabrir versión" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Archivar versión" })).toBeInTheDocument()
  })
})
