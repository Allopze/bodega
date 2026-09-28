// @vitest-environment jsdom

/**
 * El diálogo de revisión es la vista del candado que aplica el servidor
 * (`assessRunReview`), así que tiene que evaluar lo mismo que él.
 *
 * #47: con una plantilla `declared_in_form` el servidor deja firmar a quien
 * transcribió —la persona que ejecutó está nombrada en el formulario—, pero la
 * vista no conocía `executorOfRecord` y le mostraba el bloqueo de independencia.
 * #17: un hallazgo alto ya cerrado tampoco debe contar como bloqueo.
 */
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FindingInfo, RunInfo } from "./types"

vi.mock("../../actions", () => ({
  reviewInspectionRunAction: vi.fn(),
  createFindingCapaAction: vi.fn(),
}))

const { ReviewDialog } = await import("./review-dialog")

afterEach(cleanup)

const TRANSCRIPTOR = "user-transcriptor"

function run(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: "run-1", code: "INS-1", status: "completed", origin: "prevencion",
    subjectType: null, subjectLabel: null, subjectResourceId: null, subjectVehicleId: null,
    scheduledFor: null, executedAt: "2026-09-20T12:00:00.000Z", reviewedAt: null, reviewComment: null,
    conformingCount: 0, partialCount: 0, nonConformingCount: 0, notApplicableCount: 0,
    compliancePercent: null, officialComplianceBasisPoints: null, normalizedComplianceBasisPoints: null,
    executedByUserId: TRANSCRIPTOR, executorOfRecord: "platform_user",
    closingResult: null, closingRestrictions: null, closingSignatures: null,
    locationLatitude: null, locationLongitude: null, version: 3,
    ...overrides,
  }
}

function finding(overrides: Partial<FindingInfo> = {}): FindingInfo {
  return {
    id: "f-1", description: "Frenos con falla", criticality: "high", status: "open",
    capaActionId: null, origin: "derived", potentialDamageDescription: null,
    immediateMeasure: null, applicableLaw: null, evidence: [],
    ...overrides,
  }
}

function renderDialog(props: { run: RunInfo; findings?: FindingInfo[] }) {
  render(
    <ReviewDialog
      run={props.run}
      findings={props.findings ?? []}
      currentUserId={TRANSCRIPTOR}
      version={props.run.version}
      assignees={[]}
      canExecute={false}
    />,
  )
}

describe("ReviewDialog — bloqueos alineados con el servidor", () => {
  it("quien transcribió un formulario declared_in_form no ve el bloqueo de independencia", () => {
    renderDialog({ run: run({ executorOfRecord: "declared_in_form" }) })
    expect(screen.getByRole("button", { name: "Revisar y cerrar" })).toBeInTheDocument()
  })

  it("quien ejecutó en la plataforma sí lo ve", () => {
    renderDialog({ run: run({ executorOfRecord: "platform_user" }) })
    expect(screen.getByRole("button", { name: /Revisar y cerrar · 1 bloqueo/ })).toBeInTheDocument()
  })

  it("un hallazgo alto ya cerrado no cuenta como bloqueo", () => {
    renderDialog({
      run: run({ executorOfRecord: "declared_in_form" }),
      findings: [finding({ status: "closed" })],
    })
    expect(screen.getByRole("button", { name: "Revisar y cerrar" })).toBeInTheDocument()
  })
})
