// @vitest-environment jsdom

/**
 * El diálogo de revisión es la vista del candado que aplica el servidor
 * (`assessRunReview`), así que tiene que evaluar lo mismo que él.
 *
 * #47: con una plantilla `declared_in_form` el servidor deja firmar a quien
 * transcribió —la persona que ejecutó está nombrada en el formulario—, pero la
 * vista no conocía `executorOfRecord` y le mostraba el bloqueo de independencia.
 * #17: un hallazgo alto ya cerrado tampoco debe contar como bloqueo.
 *
 * P1-3: derivar un hallazgo a CAPA desde este diálogo también enviaba la
 * revisión. El `CapaDialog` vive en un portal, pero React propaga el `submit` por
 * el árbol de componentes y no por el DOM: al estar anidado dentro del `<form>`
 * de la revisión, el formulario de CAPA lo disparaba también.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import * as React from "react"
import type { FormEvent } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FindingInfo, RunInfo } from "./types"

const reviewInspectionRunAction = vi.fn()
const createFindingCapaAction = vi.fn()
const stopVehicleForFindingAction = vi.fn()
const toastSuccess = vi.fn()

vi.mock("../../actions", () => ({
  reviewInspectionRunAction,
  createFindingCapaAction,
  stopVehicleForFindingAction,
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}))

const { ReviewDialog, assessReviewForRun, reviewActionLabel } = await import("./review-dialog")
const { CapaDialog, StopVehicleDialog } = await import("./finding-dialogs")

beforeEach(() => {
  reviewInspectionRunAction.mockReset()
  createFindingCapaAction.mockReset()
  stopVehicleForFindingAction.mockReset()
  toastSuccess.mockReset()
})

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

/**
 * El diálogo es controlado: lo abre un botón que vive afuera (en la pantalla real,
 * el de la cabecera o el de la barra del teléfono). Este arnés hace de esa
 * pantalla: un botón con el rótulo que calcula `reviewActionLabel` y UN diálogo.
 */
function ReviewHarness({ run: current, findings, currentUserId, assignees, canExecute }: {
  run: RunInfo
  findings: FindingInfo[]
  currentUserId: string
  assignees: { id: string; name: string }[]
  canExecute: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const review = assessReviewForRun({ run: current, findings, currentUserId })
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>{reviewActionLabel(review)}</button>
      <ReviewDialog
        run={current}
        findings={findings}
        currentUserId={currentUserId}
        version={current.version}
        assignees={assignees}
        canExecute={canExecute}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

function renderDialog(props: { run: RunInfo; findings?: FindingInfo[] }) {
  render(
    <ReviewHarness
      run={props.run}
      findings={props.findings ?? []}
      currentUserId={TRANSCRIPTOR}
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

/**
 * Un revisor distinto de quien ejecutó: el único bloqueo posible es el hallazgo
 * alto sin CAPA, que es justo el que ofrece «Derivar a CAPA» dentro del diálogo.
 */
const REVIEWER = "user-revisor"

function renderAsReviewer(findings: FindingInfo[]) {
  render(
    <ReviewHarness
      run={run()}
      findings={findings}
      currentUserId={REVIEWER}
      assignees={[{ id: "user-ana", name: "Ana Pérez" }]}
      canExecute
    />,
  )
}

async function openReview() {
  fireEvent.click(screen.getByRole("button", { name: /Revisar y cerrar/ }))
  return screen.findByRole("dialog", { name: "Revisar y cerrar INS-1" })
}

describe("ReviewDialog — controlado", () => {
  it("cerrado no pinta nada y se abre y cierra desde afuera", async () => {
    renderAsReviewer([])
    expect(screen.queryByRole("dialog")).toBeNull()

    const review = await openReview()
    expect(review).toBeInTheDocument()

    fireEvent.keyDown(review, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("el rótulo del botón cuenta los bloqueos con la misma regla que el diálogo", () => {
    expect(reviewActionLabel({ allowed: true, blockers: [] })).toBe("Revisar y cerrar")
    expect(reviewActionLabel({ allowed: false, blockers: [{}] })).toBe("Revisar y cerrar · 1 bloqueo")
    expect(reviewActionLabel({ allowed: false, blockers: [{}, {}] })).toBe("Revisar y cerrar · 2 bloqueos")
  })

  it("el diálogo lista el mismo bloqueo que anuncia el botón", async () => {
    renderAsReviewer([finding()])
    expect(screen.getByRole("button", { name: "Revisar y cerrar · 1 bloqueo" })).toBeInTheDocument()
    const review = await openReview()
    expect(within(review).getByText("No se puede cerrar:")).toBeInTheDocument()
    expect(within(review).getAllByRole("listitem")).toHaveLength(1)
  })
})

describe("ReviewDialog — derivar a CAPA (P1-3)", () => {
  it("el submit del formulario de CAPA crea la CAPA y no envía la revisión", async () => {
    createFindingCapaAction.mockResolvedValue({ ok: true })
    renderAsReviewer([finding()])

    const review = await openReview()
    fireEvent.change(within(review).getByLabelText("Comentario de revisión"), { target: { value: "Revisado en terreno con el jefe." } })
    fireEvent.click(within(review).getByRole("button", { name: "Derivar a CAPA" }))

    const capa = await screen.findByRole("dialog", { name: "Derivar hallazgo a CAPA" })
    fireEvent.change(within(capa).getByLabelText("Acción correctiva"), { target: { value: "Reparar los frenos antes de volver a operar." } })
    const form = capa.querySelector("form")
    expect(form).not.toBeNull()
    fireEvent.submit(form!)

    await waitFor(() => expect(createFindingCapaAction).toHaveBeenCalledOnce())
    expect(createFindingCapaAction).toHaveBeenCalledWith(expect.objectContaining({
      findingId: "f-1",
      actionDescription: "Reparar los frenos antes de volver a operar.",
    }))
    expect(reviewInspectionRunAction).not.toHaveBeenCalled()
  })

  it("al derivar, el diálogo de revisión sigue abierto con el comentario ya escrito", async () => {
    createFindingCapaAction.mockResolvedValue({ ok: true })
    renderAsReviewer([finding()])

    const review = await openReview()
    fireEvent.change(within(review).getByLabelText("Comentario de revisión"), { target: { value: "Revisado en terreno con el jefe." } })
    fireEvent.click(within(review).getByRole("button", { name: "Derivar a CAPA" }))
    const capa = await screen.findByRole("dialog", { name: "Derivar hallazgo a CAPA" })
    fireEvent.change(within(capa).getByLabelText("Acción correctiva"), { target: { value: "Reparar los frenos antes de volver a operar." } })
    fireEvent.submit(capa.querySelector("form")!)

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Derivar hallazgo a CAPA" })).toBeNull())
    expect(toastSuccess).toHaveBeenCalledWith("Hallazgo derivado a CAPA.")
    expect(screen.getByLabelText("Comentario de revisión")).toHaveValue("Revisado en terreno con el jefe.")
  })

  it("un rechazo de la CAPA se dice como alerta dentro de su diálogo", async () => {
    createFindingCapaAction.mockResolvedValue({ ok: false, message: "El hallazgo ya tiene una CAPA." })
    renderAsReviewer([finding()])

    const review = await openReview()
    fireEvent.click(within(review).getByRole("button", { name: "Derivar a CAPA" }))
    const capa = await screen.findByRole("dialog", { name: "Derivar hallazgo a CAPA" })
    fireEvent.change(within(capa).getByLabelText("Acción correctiva"), { target: { value: "Reparar los frenos antes de volver a operar." } })
    fireEvent.submit(capa.querySelector("form")!)

    expect(await within(capa).findByRole("alert")).toHaveTextContent("El hallazgo ya tiene una CAPA.")
  })
})

describe("ReviewDialog — envío de la revisión", () => {
  it("envía el comentario con la versión vigente y avisa por toast", async () => {
    reviewInspectionRunAction.mockResolvedValue({ ok: true })
    renderAsReviewer([])

    const review = await openReview()
    fireEvent.change(within(review).getByLabelText("Comentario de revisión"), { target: { value: "Todo conforme, se cierra." } })
    fireEvent.submit(review.querySelector("form")!)

    await waitFor(() => expect(reviewInspectionRunAction).toHaveBeenCalledWith({
      runId: "run-1",
      expectedVersion: 3,
      reviewComment: "Todo conforme, se cierra.",
    }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Inspección revisada y cerrada."))
  })

  it("un rechazo se dice como alerta y el error de un campo queda en su campo", async () => {
    reviewInspectionRunAction.mockResolvedValue({
      ok: false,
      message: "Revisa los campos marcados",
      fieldErrors: { reviewComment: ["El comentario es demasiado corto."] },
    })
    renderAsReviewer([])

    const review = await openReview()
    fireEvent.change(within(review).getByLabelText("Comentario de revisión"), { target: { value: "Todo conforme, se cierra." } })
    fireEvent.submit(review.querySelector("form")!)

    await waitFor(() => expect(within(review).getAllByRole("alert").length).toBeGreaterThan(0))
    expect(within(review).getByLabelText("Comentario de revisión")).toHaveAttribute("aria-invalid", "true")
    expect(within(review).getByText("El comentario es demasiado corto.")).toBeInTheDocument()
    expect(toastSuccess).not.toHaveBeenCalled()
  })
})

/**
 * Además de sacar el `CapaDialog` del formulario de revisión, el propio diálogo
 * corta la propagación: cualquier otro formulario que algún día lo contenga
 * tendría el mismo problema.
 */
describe("CapaDialog y StopVehicleDialog — el submit no sube al formulario que los contiene", () => {
  it("CapaDialog", async () => {
    createFindingCapaAction.mockResolvedValue({ ok: true })
    const outerSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    render(
      <form onSubmit={outerSubmit}>
        <CapaDialog finding={finding()} assignees={[]} hasVehicle={false} />
      </form>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Derivar a CAPA" }))
    const capa = await screen.findByRole("dialog", { name: "Derivar hallazgo a CAPA" })
    fireEvent.change(within(capa).getByLabelText("Acción correctiva"), { target: { value: "Reparar los frenos antes de volver a operar." } })
    fireEvent.submit(capa.querySelector("form")!)

    await waitFor(() => expect(createFindingCapaAction).toHaveBeenCalledOnce())
    expect(outerSubmit).not.toHaveBeenCalled()
  })

  it("StopVehicleDialog", async () => {
    stopVehicleForFindingAction.mockResolvedValue({ ok: true })
    const outerSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    render(
      <form onSubmit={outerSubmit}>
        <StopVehicleDialog finding={finding()} subjectLabel="Camión KA122" />
      </form>,
    )

    fireEvent.click(screen.getByRole("button", { name: "Sacar de servicio" }))
    const dialog = await screen.findByRole("dialog", { name: "Sacar el equipo de servicio" })
    fireEvent.change(within(dialog).getByLabelText("Motivo"), { target: { value: "Frenos sin respuesta, no puede circular." } })
    fireEvent.submit(dialog.querySelector("form")!)

    await waitFor(() => expect(stopVehicleForFindingAction).toHaveBeenCalledOnce())
    expect(outerSubmit).not.toHaveBeenCalled()
  })
})
