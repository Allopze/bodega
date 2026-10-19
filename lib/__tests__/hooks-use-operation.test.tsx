// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/lib/toast", () => ({ toast }))

import { useOperation } from "@/lib/hooks/use-operation"

describe("useOperation", () => {
  it("sin callback de éxito, deja el aviso de guardado a la vista", async () => {
    const { result } = renderHook(() => useOperation())
    act(() => result.current.run(async () => ({ ok: true })))
    await waitFor(() => expect(result.current.message).toBe("Guardado correctamente."))
  })

  /*
   * Casi todos los callbacks de éxito cierran el diálogo que llamó. El aviso
   * no lo veía nadie y quedaba en el estado del padre, que sigue montado: al
   * volver a abrir, el formulario vacío decía «Guardado correctamente.».
   */
  it("con callback de éxito, el aviso queda a cargo de quien llama", async () => {
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useOperation())
    act(() => result.current.run(async () => ({ ok: true, data: { version: 4 } }), onSuccess))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ ok: true, data: { version: 4 } }))
    expect(result.current.message).toBe("")
  })

  it("un error se muestra aunque haya callback de éxito", async () => {
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useOperation())
    act(() => result.current.run(async () => ({ ok: false, message: "Versión desactualizada" }), onSuccess))
    await waitFor(() => expect(result.current.message).toBe("Versión desactualizada"))
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it("en modo toast avisa con el mensaje de la acción", async () => {
    const onSuccess = vi.fn()
    const { result } = renderHook(() => useOperation({ feedback: "toast" }))
    act(() => result.current.run(async () => ({ ok: true, message: "Plan aprobado" }), onSuccess))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Plan aprobado"))
    expect(onSuccess).toHaveBeenCalled()
    expect(result.current.message).toBe("")
  })

  /*
   * El hook descartaba `fieldErrors`: la acción decía qué campo fallaba y el
   * diálogo sólo podía mostrar «Revisa los campos marcados.».
   */
  it("expone los errores por campo de la acción", async () => {
    const { result } = renderHook(() => useOperation())
    act(() => result.current.run(async () => ({
      ok: false,
      message: "Revisa los campos marcados: El motivo es obligatorio.",
      fieldErrors: { reason: ["El motivo es obligatorio.", "Otro"] },
    })))
    await waitFor(() => expect(result.current.fieldError("reason")).toBe("El motivo es obligatorio."))
    expect(result.current.fieldErrors).toEqual({ reason: ["El motivo es obligatorio.", "Otro"] })
    expect(result.current.fieldError("otro")).toBeUndefined()
  })

  it("una nueva operación limpia los errores por campo anteriores", async () => {
    const { result } = renderHook(() => useOperation())
    act(() => result.current.run(async () => ({ ok: false, fieldErrors: { reason: ["x"] } })))
    await waitFor(() => expect(result.current.fieldError("reason")).toBe("x"))
    act(() => result.current.run(async () => ({ ok: true })))
    await waitFor(() => expect(result.current.message).toBe("Guardado correctamente."))
    expect(result.current.fieldErrors).toEqual({})
  })

  /*
   * Sin conexión, la Server Action no responde `ok: false`: el fetch rechaza. Sin
   * try/catch la excepción subía hasta el error boundary de la página y la
   * pantalla se reemplazaba por «Algo salió mal», con todo lo escrito dentro.
   */
  describe("cuando la acción lanza", () => {
    function setOnline(value: boolean) {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value })
    }

    it("sin conexión no relanza: avisa, no llama onSuccess y entrega offline a onFailure", async () => {
      const onSuccess = vi.fn()
      const onFailure = vi.fn()
      const { result } = renderHook(() => useOperation())
      act(() => result.current.run(async () => { throw new TypeError("Failed to fetch") }, onSuccess, onFailure))
      await waitFor(() => expect(result.current.message).toMatch(/Sin conexión/))
      expect(result.current.messageTone).toBe("error")
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ ok: false, offline: true }))
    })

    it("con el navegador sin red, cualquier excepción cuenta como sin conexión", async () => {
      setOnline(false)
      try {
        const onFailure = vi.fn()
        const { result } = renderHook(() => useOperation())
        act(() => result.current.run(async () => { throw new Error("boom") }, undefined, onFailure))
        await waitFor(() => expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ offline: true })))
      } finally {
        setOnline(true)
      }
    })

    it("un error que no es de red no dice «Sin conexión»", async () => {
      const onFailure = vi.fn()
      const { result } = renderHook(() => useOperation())
      act(() => result.current.run(async () => { throw new TypeError("Cannot read properties of undefined") }, undefined, onFailure))
      await waitFor(() => expect(result.current.message).toBe("No se pudo completar la acción. Inténtalo de nuevo."))
      expect(result.current.message).not.toMatch(/Sin conexión/)
      expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ ok: false, offline: false }))
    })

    it("en modo toast lo avisa con toast.error", async () => {
      toast.error.mockClear()
      const { result } = renderHook(() => useOperation({ feedback: "toast" }))
      act(() => result.current.run(async () => { throw new TypeError("Failed to fetch") }))
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Sin conexión/)))
      expect(result.current.message).toBe("")
    })
  })

  describe("tono del mensaje", () => {
    it("distingue el aviso de éxito del error y del texto que pone quien llama", async () => {
      const { result } = renderHook(() => useOperation())
      act(() => result.current.run(async () => ({ ok: true })))
      await waitFor(() => expect(result.current.messageTone).toBe("success"))

      act(() => result.current.run(async () => ({ ok: false, message: "No se pudo" })))
      await waitFor(() => expect(result.current.messageTone).toBe("error"))

      act(() => result.current.setMessage("Recordatorio enviado."))
      expect(result.current.messageTone).toBe("neutral")
      act(() => result.current.setMessage("Algo falló", "error"))
      expect(result.current.messageTone).toBe("error")
      act(() => result.current.setMessage(""))
      expect(result.current.messageTone).toBe("neutral")
    })

    it("onFailure también recibe los rechazos normales de la acción", async () => {
      const onFailure = vi.fn()
      const { result } = renderHook(() => useOperation())
      act(() => result.current.run(async () => ({ ok: false, message: "Versión desactualizada" }), undefined, onFailure))
      await waitFor(() => expect(onFailure).toHaveBeenCalledWith({ ok: false, message: "Versión desactualizada" }))
    })
  })
})
