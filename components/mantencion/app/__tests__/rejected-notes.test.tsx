// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { RejectedNote } from "@/lib/mantencion/client/home-model"
import { RejectedNotesSection } from "../home-lists"

const notes: RejectedNote[] = [
  { id: "w1", type: "workshop", title: "KA-140 · Salida de taller", message: "El equipo ya salió de taller." },
  { id: "o1", type: "ot", title: "KA-140 · OT-BIO-0001 · Terminar la OT", message: "La OT ya no está en taller." },
]

describe("«No se pudo enviar» en la portada", () => {
  it("no pinta nada sin rechazos", () => {
    const { container } = render(<RejectedNotesSection notes={[]} onDismiss={() => {}} />)
    expect(container.textContent).toBe("")
  })

  it("lista cada rechazo con su motivo y lo descarta con «Entendido»", () => {
    const dismiss = vi.fn()
    render(<RejectedNotesSection notes={notes} onDismiss={dismiss} />)
    expect(screen.getByText("No se pudo enviar")).toBeTruthy()
    expect(screen.getByText("El equipo ya salió de taller.")).toBeTruthy()
    expect(screen.getByText("La OT ya no está en taller.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Entendido: KA-140 · OT-BIO-0001 · Terminar la OT" }))
    expect(dismiss).toHaveBeenCalledWith(notes[1])
  })
})
