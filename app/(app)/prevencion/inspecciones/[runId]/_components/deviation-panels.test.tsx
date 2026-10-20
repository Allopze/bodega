// @vitest-environment jsdom

/**
 * Registrar una desviación o una acción preventiva puede pasar la ejecución de
 * `planned` a `in_progress` y subir su versión: si el panel no la devuelve al
 * padre, el siguiente autoguardado choca con su propio bloqueo optimista.
 *
 * Los participantes del Anexo 08 se editaban sin que nadie supiera que no estaban
 * guardados: el panel ahora lo dice y lo reporta al padre.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const registerDeviationAction = vi.fn()
const registerInspectionPreventiveActionAction = vi.fn()
const removeDeviationAction = vi.fn()
const saveInspectionParticipantsAction = vi.fn()
const toastSuccess = vi.fn()

vi.mock("../../actions", () => ({
  registerDeviationAction,
  registerInspectionPreventiveActionAction,
  removeDeviationAction,
  saveInspectionParticipantsAction,
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}))

const { DeviationsPanel, ParticipantsPanel, PreventiveActionsPanel } = await import("./deviation-panels")

beforeEach(() => {
  registerDeviationAction.mockReset()
  registerInspectionPreventiveActionAction.mockReset()
  removeDeviationAction.mockReset()
  saveInspectionParticipantsAction.mockReset()
  toastSuccess.mockReset()
})

afterEach(cleanup)

describe("DeviationsPanel", () => {
  function renderPanel(onVersion = vi.fn()) {
    render(
      <DeviationsPanel
        runId="run-1"
        editable
        canExecute
        catalog={[]}
        registered={[]}
        narrative={false}
        onVersion={onVersion}
      />,
    )
    return onVersion
  }

  it("devuelve la versión nueva al registrar «Otra desviación»", async () => {
    registerDeviationAction.mockResolvedValue({ ok: true, data: { version: 4 } })
    const onVersion = renderPanel()

    fireEvent.click(screen.getByRole("button", { name: "Otra desviación" }))
    const dialog = await screen.findByRole("dialog", { name: "Otra desviación" })
    fireEvent.change(within(dialog).getByLabelText("Descripción de la desviación"), { target: { value: "Extintor sin sello" } })
    fireEvent.submit(dialog.querySelector("form")!)

    await waitFor(() => expect(registerDeviationAction).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      description: "Extintor sin sello",
    })))
    await waitFor(() => expect(onVersion).toHaveBeenCalledWith(expect.objectContaining({ data: { version: 4 } })))
    expect(toastSuccess).toHaveBeenCalledWith("Desviación registrada.")
  })

  it("un rechazo no llama a onVersion y se dice como alerta dentro del diálogo", async () => {
    registerDeviationAction.mockResolvedValue({ ok: false, message: "La inspección cambió en otra sesión." })
    const onVersion = renderPanel()

    fireEvent.click(screen.getByRole("button", { name: "Otra desviación" }))
    const dialog = await screen.findByRole("dialog", { name: "Otra desviación" })
    fireEvent.change(within(dialog).getByLabelText("Descripción de la desviación"), { target: { value: "Extintor sin sello" } })
    fireEvent.submit(dialog.querySelector("form")!)

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("La inspección cambió en otra sesión.")
    expect(onVersion).not.toHaveBeenCalled()
  })

  it("el error de un campo queda junto a su campo", async () => {
    registerDeviationAction.mockResolvedValue({
      ok: false,
      message: "Revisa los campos marcados",
      fieldErrors: { description: ["Describe lo que se encontró."] },
    })
    renderPanel()

    fireEvent.click(screen.getByRole("button", { name: "Otra desviación" }))
    const dialog = await screen.findByRole("dialog", { name: "Otra desviación" })
    fireEvent.change(within(dialog).getByLabelText("Descripción de la desviación"), { target: { value: "Extintor sin sello" } })
    fireEvent.submit(dialog.querySelector("form")!)

    expect(await within(dialog).findByText("Describe lo que se encontró.")).toBeInTheDocument()
    expect(within(dialog).getByLabelText("Descripción de la desviación")).toHaveAttribute("aria-invalid", "true")
  })
})

describe("PreventiveActionsPanel", () => {
  it("devuelve la versión nueva al registrar una acción", async () => {
    registerInspectionPreventiveActionAction.mockResolvedValue({ ok: true, data: { version: 6 } })
    const onVersion = vi.fn()
    render(<PreventiveActionsPanel runId="run-1" actions={[]} assignees={[]} editable onVersion={onVersion} />)

    fireEvent.click(screen.getByRole("button", { name: "Agregar acción" }))
    const dialog = await screen.findByRole("dialog", { name: "Acción preventiva" })
    fireEvent.change(within(dialog).getByLabelText(/Acción acordada/), { target: { value: "Instalar señalética en el acceso" } })
    fireEvent.submit(dialog.querySelector("form")!)

    await waitFor(() => expect(registerInspectionPreventiveActionAction).toHaveBeenCalledOnce())
    await waitFor(() => expect(onVersion).toHaveBeenCalledWith(expect.objectContaining({ data: { version: 6 } })))
    expect(toastSuccess).toHaveBeenCalledWith("Acción preventiva creada en CAPA.")
  })
})

describe("ParticipantsPanel", () => {
  const SERVER = [{ id: "p-1", name: "Ana Pérez", position: "Jefa de faena", userId: null }]

  it("sin cambios no avisa de nada sin guardar", () => {
    render(<ParticipantsPanel runId="run-1" participants={SERVER} editable />)

    expect(screen.queryByText("Participantes sin guardar")).toBeNull()
  })

  it("editar un nombre lo marca sin guardar y avisa al padre con las filas y el estado", () => {
    const onRowsChange = vi.fn()
    render(<ParticipantsPanel runId="run-1" participants={SERVER} editable onRowsChange={onRowsChange} />)

    fireEvent.change(screen.getByLabelText(/Nombre 1/), { target: { value: "Ana María Pérez" } })

    expect(screen.getByText("Participantes sin guardar")).toBeInTheDocument()
    expect(onRowsChange).toHaveBeenLastCalledWith(
      [{ id: "p-1", name: "Ana María Pérez", position: "Jefa de faena", userId: null }],
      true,
    )
  })

  it("volver al valor guardado quita la marca", () => {
    const onRowsChange = vi.fn()
    render(<ParticipantsPanel runId="run-1" participants={SERVER} editable onRowsChange={onRowsChange} />)

    fireEvent.change(screen.getByLabelText(/Nombre 1/), { target: { value: "Ana María Pérez" } })
    fireEvent.change(screen.getByLabelText(/Nombre 1/), { target: { value: "Ana Pérez" } })

    expect(screen.queryByText("Participantes sin guardar")).toBeNull()
    expect(onRowsChange).toHaveBeenLastCalledWith(expect.any(Array), false)
  })

  it("guardar deja las filas como lo guardado y lo avisa", async () => {
    saveInspectionParticipantsAction.mockResolvedValue({ ok: true })
    const onRowsChange = vi.fn()
    render(<ParticipantsPanel runId="run-1" participants={SERVER} editable onRowsChange={onRowsChange} />)

    fireEvent.change(screen.getByLabelText(/Nombre 1/), { target: { value: "Ana María Pérez" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar participantes" }))

    await waitFor(() => expect(saveInspectionParticipantsAction).toHaveBeenCalledWith({
      runId: "run-1",
      participants: [{ id: "p-1", name: "Ana María Pérez", position: "Jefa de faena", userId: null }],
    }))
    await waitFor(() => expect(screen.queryByText("Participantes sin guardar")).toBeNull())
    expect(onRowsChange).toHaveBeenLastCalledWith(expect.any(Array), false)
    expect(toastSuccess).toHaveBeenCalledWith("Participantes guardados.")
  })

  it("un rechazo al guardar conserva la marca y se dice como alerta", async () => {
    saveInspectionParticipantsAction.mockResolvedValue({ ok: false, message: "Los participantes corresponden al Anexo 08." })
    render(<ParticipantsPanel runId="run-1" participants={SERVER} editable />)

    fireEvent.change(screen.getByLabelText(/Nombre 1/), { target: { value: "Ana María Pérez" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar participantes" }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Los participantes corresponden al Anexo 08.")
    expect(screen.getByText("Participantes sin guardar")).toBeInTheDocument()
  })

  it("adopta las filas que el padre manda (las del dispositivo) y las marca sin guardar", () => {
    const { rerender } = render(<ParticipantsPanel runId="run-1" participants={SERVER} editable />)
    expect(screen.getByLabelText(/Nombre 1/)).toHaveValue("Ana Pérez")

    rerender(
      <ParticipantsPanel
        runId="run-1"
        participants={SERVER}
        editable
        initialRows={[{ id: "p-1", name: "Ana Pérez", position: "Jefa de faena", userId: null }, { id: "p-2", name: "Luis Soto", position: "Supervisor", userId: null }]}
      />,
    )

    expect(screen.getByLabelText(/Nombre 2/)).toHaveValue("Luis Soto")
    expect(screen.getByText("Participantes sin guardar")).toBeInTheDocument()
  })

  it("un arreglo equivalente en cada render no pisa lo que la persona escribe", () => {
    const rows = () => [{ id: "p-1", name: "Ana Pérez", position: "Jefa de faena", userId: null }]
    const { rerender } = render(<ParticipantsPanel runId="run-1" participants={SERVER} editable initialRows={rows()} />)

    fireEvent.change(screen.getByLabelText(/Nombre 1/), { target: { value: "Ana María Pérez" } })
    rerender(<ParticipantsPanel runId="run-1" participants={SERVER} editable initialRows={rows()} />)

    expect(screen.getByLabelText(/Nombre 1/)).toHaveValue("Ana María Pérez")
  })

  it("en solo lectura no hay marca ni controles", () => {
    render(<ParticipantsPanel runId="run-1" participants={SERVER} editable={false} />)

    expect(screen.queryByRole("button", { name: "Guardar participantes" })).toBeNull()
    expect(screen.queryByText("Participantes sin guardar")).toBeNull()
  })
})
