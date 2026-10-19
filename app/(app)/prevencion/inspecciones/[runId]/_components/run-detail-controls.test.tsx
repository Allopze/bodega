// @vitest-environment jsdom

/**
 * P2-4: el botón que confirmaba una cancelación se llamaba «Cancelar» y el que la
 * descartaba «Cerrar». `ReasonDialog` se apoya ahora en `ConfirmDialog`: confirmar
 * repite la acción del disparador y descartar es «Volver».
 *
 * P2-8: el error de una operación se dice como alerta dentro del diálogo, y el éxito
 * por toast, porque el diálogo se cierra y el resultado no puede quedarse en él.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const remindInspectionReviewAction = vi.fn()
const toastSuccess = vi.fn()

vi.mock("../../actions", () => ({
  remindInspectionReviewAction,
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}))

const { ReasonDialog, RemindReviewButton } = await import("./run-detail-controls")

beforeEach(() => {
  remindInspectionReviewAction.mockReset()
  toastSuccess.mockReset()
})

afterEach(cleanup)

const MOTIVO = "La faena retiró el extintor de bodega antes de inspeccionarlo."

function renderCancel(action = vi.fn().mockResolvedValue({ ok: true, data: { version: 5 } }), onDone = vi.fn()) {
  render(
    <ReasonDialog
      trigger="Cancelar inspección"
      title="Cancelar INS-1"
      description="La inspección deja de estar pendiente."
      action={action}
      onDone={onDone}
      variant="ghost-danger"
      reasonLabel="Motivo de la cancelación"
    />,
  )
  return { action, onDone }
}

async function openDialog(name: string) {
  fireEvent.click(screen.getByRole("button", { name }))
  return screen.findByRole("dialog")
}

describe("ReasonDialog", () => {
  it("confirmar repite la acción del disparador y descartar se llama «Volver»", async () => {
    renderCancel()

    const dialog = await openDialog("Cancelar inspección")

    expect(within(dialog).getByRole("button", { name: "Cancelar inspección" })).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Volver" })).toBeInTheDocument()
    // Ya no existe el «Cancelar» que, dentro de «Cancelar inspección», confirmaba.
    expect(within(dialog).queryByRole("button", { name: "Cancelar" })).toBeNull()
    expect(within(dialog).getByLabelText("Motivo de la cancelación")).toBeInTheDocument()
  })

  it("no deja confirmar sin un motivo suficiente", async () => {
    const { action } = renderCancel()

    const dialog = await openDialog("Cancelar inspección")
    const confirm = within(dialog).getByRole("button", { name: "Cancelar inspección" })
    expect(confirm).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText("Motivo de la cancelación"), { target: { value: "corto" } })
    expect(confirm).toBeDisabled()
    expect(action).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText("Motivo de la cancelación"), { target: { value: MOTIVO } })
    expect(confirm).toBeEnabled()
  })

  it("envía el motivo, avisa por toast, entrega el resultado y se cierra", async () => {
    const { action, onDone } = renderCancel()

    const dialog = await openDialog("Cancelar inspección")
    fireEvent.change(within(dialog).getByLabelText("Motivo de la cancelación"), { target: { value: MOTIVO } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar inspección" }))

    await waitFor(() => expect(action).toHaveBeenCalledWith(MOTIVO))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ data: { version: 5 } })))
    expect(toastSuccess).toHaveBeenCalledWith("Cambio registrado.")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("un rechazo se dice como alerta dentro del diálogo, que sigue abierto", async () => {
    const { onDone } = renderCancel(vi.fn().mockResolvedValue({ ok: false, message: "La inspección cambió en otra sesión." }))

    const dialog = await openDialog("Cancelar inspección")
    fireEvent.change(within(dialog).getByLabelText("Motivo de la cancelación"), { target: { value: MOTIVO } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar inspección" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("La inspección cambió en otra sesión.")
    expect(onDone).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it("sin conexión el error no tira la pantalla: llega como alerta", async () => {
    renderCancel(vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))

    const dialog = await openDialog("Cancelar inspección")
    fireEvent.change(within(dialog).getByLabelText("Motivo de la cancelación"), { target: { value: MOTIVO } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar inspección" }))

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/Sin conexión/)
  })

  it("el error de un intento anterior no espera a quien vuelve a abrir el diálogo", async () => {
    renderCancel(vi.fn().mockResolvedValue({ ok: false, message: "La inspección cambió en otra sesión." }))

    let dialog = await openDialog("Cancelar inspección")
    fireEvent.change(within(dialog).getByLabelText("Motivo de la cancelación"), { target: { value: MOTIVO } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar inspección" }))
    await within(dialog).findByRole("alert")

    fireEvent.click(within(dialog).getByRole("button", { name: "Volver" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    dialog = await openDialog("Cancelar inspección")
    expect(within(dialog).queryByRole("alert")).toBeNull()
    // Y el motivo escrito tampoco se hereda.
    expect(within(dialog).getByLabelText("Motivo de la cancelación")).toHaveValue("")
  })

  it("por omisión descarta con «Volver», pide «Motivo» y confirma en rojo solo si el disparador es destructivo", async () => {
    render(
      <ReasonDialog
        trigger="Cerrar hallazgo"
        title="Cerrar hallazgo"
        description="Frenos con falla"
        action={vi.fn().mockResolvedValue({ ok: true })}
        confirmVariant="default"
        successMessage="Hallazgo cerrado."
      />,
    )

    const dialog = await openDialog("Cerrar hallazgo")
    expect(within(dialog).getByLabelText("Motivo")).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Volver" })).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText("Motivo"), { target: { value: MOTIVO } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar hallazgo" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Hallazgo cerrado."))
  })
})

describe("RemindReviewButton", () => {
  it("avisa a quién le llegó el recordatorio por toast", async () => {
    remindInspectionReviewAction.mockResolvedValue({ ok: true, data: { notified: ["Ana Pérez", "Luis Soto"] } })
    render(<RemindReviewButton runId="run-1" />)

    fireEvent.click(screen.getByRole("button", { name: "Recordar a quien revisa" }))

    await waitFor(() => expect(remindInspectionReviewAction).toHaveBeenCalledWith({ runId: "run-1" }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Recordatorio enviado a Ana Pérez, Luis Soto."))
  })

  it("un error se dice como alerta", async () => {
    remindInspectionReviewAction.mockResolvedValue({ ok: false, message: "No hay a quién avisar." })
    render(<RemindReviewButton runId="run-1" />)

    fireEvent.click(screen.getByRole("button", { name: "Recordar a quien revisa" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("No hay a quién avisar.")
  })
})
