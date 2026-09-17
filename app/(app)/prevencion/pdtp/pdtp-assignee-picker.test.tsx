// @vitest-environment jsdom

/**
 * Fase 5, tarea 5.3: el menú "Asignar a…".
 *
 * Lo que se fija acá:
 *
 *  1. Los candidatos se piden al abrir el diálogo, no al pintar la tabla:
 *     hacerlo por fila serían 87 consultas para una lista que casi nadie abre.
 *  2. Lo que viaja es un `userIds` por persona marcada (multi-select: dos
 *     responsables por turnos son un caso normal), más la actividad, la faena y
 *     la fecha de vigencia — exactamente lo que valida el servicio.
 *  3. Una lista vacía es una instrucción válida: "que vuelva a verse por
 *     cargo", no un formulario incompleto.
 *  4. El diálogo dice el efecto antes de guardar: con alguien asignado, los
 *     demás del mismo cargo dejan de ver la fila en Pendientes.
 */

import type * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const setPdtpActivityAssigneesAction = vi.fn(async (_formData: FormData) => ({ ok: true }))
const listPdtpAssigneeCandidatesAction = vi.fn(async (_activityId: string, _worksiteId: string) => ({
  ok: true as const,
  candidates: [
    { userId: "u-ana", name: "Ana Jefa", roleLabels: ["Jefe de terreno"] },
    { userId: "u-beto", name: "Beto Jefe", roleLabels: ["Jefe de terreno"] },
  ],
}))

vi.mock("./actions", () => ({
  setPdtpActivityAssigneesAction: (fd: FormData) => setPdtpActivityAssigneesAction(fd),
  listPdtpAssigneeCandidatesAction: (activityId: string, worksiteId: string) =>
    listPdtpAssigneeCandidatesAction(activityId, worksiteId),
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import { PdtpAssigneeChip, PdtpAssigneePicker } from "./pdtp-assignee-picker"

afterEach(cleanup)
beforeEach(() => {
  setPdtpActivityAssigneesAction.mockClear()
  listPdtpAssigneeCandidatesAction.mockClear()
})

function renderPicker(overrides: Partial<React.ComponentProps<typeof PdtpAssigneePicker>> = {}) {
  return render(
    <PdtpAssigneePicker
      activityId="act-1"
      activityN={7}
      activityName="Charla de seguridad"
      worksiteId="ws-1"
      today="2026-09-17"
      {...overrides}
    />,
  )
}

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /Asignar la actividad N°7 a una persona/ }))
}

describe("PdtpAssigneePicker", () => {
  it("no pide los candidatos hasta que se abre el diálogo", async () => {
    renderPicker()
    expect(listPdtpAssigneeCandidatesAction).not.toHaveBeenCalled()
    openDialog()
    await waitFor(() => expect(listPdtpAssigneeCandidatesAction).toHaveBeenCalledWith("act-1", "ws-1"))
  })

  it("lista a los candidatos con su cargo, no con el slug del rol", async () => {
    renderPicker()
    openDialog()
    expect(await screen.findByLabelText("Ana Jefa")).toBeInTheDocument()
    expect(screen.getByLabelText("Beto Jefe")).toBeInTheDocument()
    expect(screen.getAllByText("Jefe de terreno").length).toBeGreaterThan(0)
    expect(screen.queryByText("jefe_terreno")).not.toBeInTheDocument()
  })

  it("advierte que asignar esconde la fila para el resto del cargo", async () => {
    renderPicker()
    openDialog()
    expect(await screen.findByText(/deja de aparecer en Pendientes/i)).toBeInTheDocument()
  })

  it("envía un userIds por persona marcada, con la actividad, la faena y la vigencia", async () => {
    renderPicker()
    openDialog()

    fireEvent.click(await screen.findByLabelText("Ana Jefa"))
    fireEvent.click(screen.getByLabelText("Beto Jefe"))
    fireEvent.click(screen.getByRole("button", { name: /Guardar asignación/ }))

    await waitFor(() => expect(setPdtpActivityAssigneesAction).toHaveBeenCalledTimes(1))
    const sent = setPdtpActivityAssigneesAction.mock.calls[0]![0]
    expect(sent.getAll("userIds")).toEqual(["u-ana", "u-beto"])
    expect(sent.get("activityId")).toBe("act-1")
    expect(sent.get("worksiteId")).toBe("ws-1")
    expect(sent.get("validFrom")).toBe("2026-09-17")
  })

  it("parte con los asignados actuales ya marcados", async () => {
    renderPicker({ currentAssignees: [{ userId: "u-ana", name: "Ana Jefa" }] })
    openDialog()
    const ana = await screen.findByLabelText("Ana Jefa")
    expect((ana as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText("Beto Jefe") as HTMLInputElement).checked).toBe(false)
  })

  it("desmarcar a todos es una instrucción válida: devuelve la actividad al cargo", async () => {
    renderPicker({ currentAssignees: [{ userId: "u-ana", name: "Ana Jefa" }] })
    openDialog()
    fireEvent.click(await screen.findByLabelText("Ana Jefa"))
    fireEvent.click(screen.getByRole("button", { name: /Dejar sin asignar/ }))

    await waitFor(() => expect(setPdtpActivityAssigneesAction).toHaveBeenCalledTimes(1))
    expect(setPdtpActivityAssigneesAction.mock.calls[0]![0].getAll("userIds")).toEqual([])
  })

  it("sin candidatos lo dice, en vez de dejar una lista vacía sin explicación", async () => {
    listPdtpAssigneeCandidatesAction.mockResolvedValueOnce({ ok: true as const, candidates: [] })
    renderPicker()
    openDialog()
    expect(await screen.findByText(/Nadie de esta faena tiene el cargo responsable/)).toBeInTheDocument()
  })
})

describe("PdtpAssigneeChip", () => {
  it("dice a quién está asignada, sin ids internos", () => {
    render(<PdtpAssigneeChip names={["Ana Jefa"]} />)
    expect(screen.getByText("Asignada a: Ana Jefa")).toBeInTheDocument()
  })

  it("nombra a los dos cuando son turnos", () => {
    render(<PdtpAssigneeChip names={["Ana Jefa", "Beto Jefe"]} />)
    expect(screen.getByText("Asignada a: Ana Jefa, Beto Jefe")).toBeInTheDocument()
  })

  it("sin asignados no dibuja nada: la actividad es del cargo, como siempre", () => {
    const { container } = render(<PdtpAssigneeChip names={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
