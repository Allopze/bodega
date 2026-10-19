// @vitest-environment jsdom

import * as React from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const removeAnswerEvidenceAction = vi.fn()
const toastSuccess = vi.fn()

vi.mock("../actions", () => ({
  removeAnswerEvidenceAction,
}))

vi.mock("@/lib/toast", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}))

vi.mock("@/lib/pwa/image-compress", () => ({
  compressPhoto: (file: File) => Promise.resolve(file),
}))

const { AnswerEvidence } = await import("./_components/inspection-evidence")

beforeEach(() => {
  removeAnswerEvidenceAction.mockReset()
  toastSuccess.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const PHOTO = { id: "evidence-1", path: "storage/inspection-evidence/photo-1.jpg", caption: null }
const OTHER_PHOTO = { id: "evidence-2", path: "storage/inspection-evidence/photo-2.jpg", caption: null }

describe("AnswerEvidence", () => {
  it("saves a new answer inside the same photo gesture and then uploads", async () => {
    const ensureAnswerId = vi.fn().mockResolvedValue("answer-1")
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "evidence-1",
      path: "storage/inspection-evidence/photo.jpg",
    }), { status: 200, headers: { "Content-Type": "application/json" } }))
    const onEvidenceChange = vi.fn()

    render(
      <AnswerEvidence
        answerId={null}
        evidence={[]}
        editable
        readyToPersist
        ensureAnswerId={ensureAnswerId}
        itemLabel="Casco"
        onEvidenceChange={onEvidenceChange}
      />,
    )

    expect(screen.getByRole("button", { name: "Adjuntar fotos" })).toBeEnabled()
    // El nombre lleva el ítem: con 24 filas, «Adjuntar evidencia fotográfica» las hacía indistinguibles.
    expect(screen.getByLabelText("Adjuntar fotos de Casco")).toHaveClass("sr-only")

    fireEvent.change(screen.getByLabelText("Adjuntar fotos de Casco"), {
      target: { files: [new File(["photo"], "photo.jpg", { type: "image/jpeg" })] },
    })

    await waitFor(() => expect(ensureAnswerId).toHaveBeenCalledOnce())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(body.get("answerId")).toBe("answer-1")
    // La foto subida se ve y se cuenta, aunque el padre siga pasando la lista vacía del servidor.
    expect(await screen.findByRole("link", { name: "Ver foto 1 de Casco" })).toBeInTheDocument()
    expect(onEvidenceChange).toHaveBeenCalledWith(1)
  })

  it("la foto subida no desaparece cuando el padre repinta con un arreglo vacío nuevo", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      id: "evidence-9",
      path: "storage/inspection-evidence/photo-9.jpg",
    }), { status: 200, headers: { "Content-Type": "application/json" } }))

    // El detalle pasa `savedAnswers.get(key)?.evidence ?? []`: otro arreglo en cada render.
    function Parent() {
      const [, setTick] = React.useState(0)
      return (
        <>
          <button type="button" onClick={() => setTick((tick) => tick + 1)}>repintar</button>
          <AnswerEvidence answerId="answer-1" evidence={[]} editable readyToPersist itemLabel="Casco" />
        </>
      )
    }
    render(<Parent />)

    fireEvent.change(screen.getByLabelText("Adjuntar fotos de Casco"), {
      target: { files: [new File(["photo"], "photo.jpg", { type: "image/jpeg" })] },
    })
    expect(await screen.findByRole("link", { name: "Ver foto 1 de Casco" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "repintar" }))
    fireEvent.click(screen.getByRole("button", { name: "repintar" }))

    expect(screen.getByRole("link", { name: "Ver foto 1 de Casco" })).toBeInTheDocument()
  })

  it("no pinta ningún control mientras el ítem no tiene respuesta", () => {
    render(<AnswerEvidence answerId={null} evidence={[]} editable readyToPersist={false} itemLabel="Casco" />)

    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByLabelText("Adjuntar fotos de Casco")).toBeNull()
    expect(screen.queryByText(/Responde el ítem/)).toBeNull()
  })

  it("blockedReason reemplaza al botón de adjuntar", () => {
    render(
      <AnswerEvidence
        answerId={null}
        evidence={[]}
        editable
        readyToPersist
        itemLabel="Casco"
        blockedReason="Completa el motivo antes de adjuntar fotos"
      />,
    )

    expect(screen.getByText("Completa el motivo antes de adjuntar fotos")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Adjuntar fotos" })).toBeNull()
  })

  /**
   * P1-6: no había forma de quitar una foto, y el servidor exige quitarlas antes
   * de dejar el ítem «Sin responder».
   */
  describe("quitar una foto", () => {
    function renderWithPhotos(onEvidenceChange = vi.fn()) {
      render(
        <AnswerEvidence
          answerId="answer-1"
          evidence={[PHOTO, OTHER_PHOTO]}
          editable
          readyToPersist
          itemLabel="Casco"
          onEvidenceChange={onEvidenceChange}
        />,
      )
      return onEvidenceChange
    }

    it("cada miniatura tiene su enlace y su botón de quitar, con el ítem en el nombre", () => {
      renderWithPhotos()

      expect(screen.getByRole("link", { name: "Ver foto 1 de Casco" })).toHaveAttribute("href", "/api/prevencion/inspecciones/evidence/photo-1.jpg")
      expect(screen.getByRole("link", { name: "Ver foto 2 de Casco" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Quitar foto 1 de Casco" })).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Quitar foto 2 de Casco" })).toBeInTheDocument()
    })

    it("pide confirmar, llama a la acción con el id de la evidencia y saca la miniatura", async () => {
      removeAnswerEvidenceAction.mockResolvedValue({ ok: true, data: { answerId: "answer-1", remaining: 1 } })
      const onEvidenceChange = renderWithPhotos()

      fireEvent.click(screen.getByRole("button", { name: "Quitar foto 1 de Casco" }))

      const dialog = await screen.findByRole("dialog", { name: "Quitar foto" })
      expect(dialog).toHaveTextContent("La foto 1 de «Casco» se quitará de la inspección. No se puede deshacer.")
      // Aún no se llamó: un clic accidental no borra nada.
      expect(removeAnswerEvidenceAction).not.toHaveBeenCalled()

      fireEvent.click(within(dialog).getByRole("button", { name: "Quitar foto" }))

      await waitFor(() => expect(removeAnswerEvidenceAction).toHaveBeenCalledWith({ evidenceId: "evidence-1" }))
      await waitFor(() => expect(screen.queryByRole("link", { name: "Ver foto 2 de Casco" })).toBeNull())
      // La que quedaba pasa a ser la primera.
      expect(screen.getByRole("link", { name: "Ver foto 1 de Casco" })).toHaveAttribute("href", "/api/prevencion/inspecciones/evidence/photo-2.jpg")
      expect(onEvidenceChange).toHaveBeenCalledWith(1)
      expect(toastSuccess).toHaveBeenCalledWith("Foto quitada.")
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    })

    it("al quitar la última foto avisa que quedan 0 y devuelve el foco a «Adjuntar fotos»", async () => {
      removeAnswerEvidenceAction.mockResolvedValue({ ok: true, data: { answerId: "answer-1", remaining: 0 } })
      const onEvidenceChange = vi.fn()
      render(
        <AnswerEvidence answerId="answer-1" evidence={[PHOTO]} editable readyToPersist itemLabel="Casco" onEvidenceChange={onEvidenceChange} />,
      )

      fireEvent.click(screen.getByRole("button", { name: "Quitar foto 1 de Casco" }))
      const dialog = await screen.findByRole("dialog", { name: "Quitar foto" })
      fireEvent.click(within(dialog).getByRole("button", { name: "Quitar foto" }))

      await waitFor(() => expect(onEvidenceChange).toHaveBeenCalledWith(0))
      await waitFor(() => expect(screen.queryByRole("link")).toBeNull())
      await waitFor(() => expect(screen.getByRole("button", { name: "Adjuntar fotos" })).toHaveFocus())
    })

    it("si el servidor no devuelve la cuenta, la descuenta de lo que se ve", async () => {
      removeAnswerEvidenceAction.mockResolvedValue({ ok: true })
      const onEvidenceChange = renderWithPhotos()

      fireEvent.click(screen.getByRole("button", { name: "Quitar foto 2 de Casco" }))
      const dialog = await screen.findByRole("dialog", { name: "Quitar foto" })
      fireEvent.click(within(dialog).getByRole("button", { name: "Quitar foto" }))

      await waitFor(() => expect(onEvidenceChange).toHaveBeenCalledWith(1))
    })

    it("un rechazo del servidor se dice como alerta dentro del diálogo y la foto sigue ahí", async () => {
      removeAnswerEvidenceAction.mockResolvedValue({ ok: false, message: "La inspección ya no se puede editar." })
      const onEvidenceChange = renderWithPhotos()

      fireEvent.click(screen.getByRole("button", { name: "Quitar foto 1 de Casco" }))
      const dialog = await screen.findByRole("dialog", { name: "Quitar foto" })
      fireEvent.click(within(dialog).getByRole("button", { name: "Quitar foto" }))

      expect(await within(dialog).findByRole("alert")).toHaveTextContent("La inspección ya no se puede editar.")
      expect(onEvidenceChange).not.toHaveBeenCalled()
      expect(toastSuccess).not.toHaveBeenCalled()

      // Se desiste: la foto no se tocó.
      fireEvent.click(within(dialog).getByRole("button", { name: "Volver" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
      expect(screen.getByRole("link", { name: "Ver foto 1 de Casco" })).toBeInTheDocument()
    })

    it("sin editar no se ofrece quitar", () => {
      render(<AnswerEvidence answerId="answer-1" evidence={[PHOTO]} editable={false} readyToPersist itemLabel="Casco" />)

      expect(screen.getByRole("link", { name: "Ver foto 1 de Casco" })).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: /Quitar foto/ })).toBeNull()
    })

    it("un ítem que se dejó sin responder conserva sus fotos a la vista para poder quitarlas", () => {
      render(
        <AnswerEvidence answerId="answer-1" evidence={[PHOTO]} editable readyToPersist={false} itemLabel="Casco" />,
      )

      expect(screen.getByRole("button", { name: "Quitar foto 1 de Casco" })).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Agregar fotos" })).toBeNull()
    })
  })
})
