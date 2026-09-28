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
})
