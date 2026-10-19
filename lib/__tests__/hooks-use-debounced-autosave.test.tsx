// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDebouncedAutosave } from "@/lib/hooks/use-debounced-autosave"
import type { ActionState } from "@/lib/validation/operations"

const DEBOUNCE = 1200

type Options = Parameters<typeof useDebouncedAutosave>[0]

function setup(initial: Partial<Options> & Pick<Options, "onSave">) {
  return renderHook(
    (props: Options) => useDebouncedAutosave(props),
    { initialProps: { watchKey: 1, isDirty: true, debounceMs: DEBOUNCE, ...initial } as Options },
  )
}

/**
 * Avanza el reloj de a tramos, cada uno dentro de su propio `act`: React sólo
 * vuelve a renderizar y a armar los efectos al salir de `act`, así que un solo
 * tramo largo dejaría pasar un bucle de guardados sin que el hook llegara a
 * rearmarse (y un test de «no hace bucle» pasaría aun con el bucle).
 */
async function advance(ms: number) {
  let left = ms
  while (left > 0) {
    const step = Math.min(left, 100)
    await act(async () => { await vi.advanceTimersByTimeAsync(step) })
    left -= step
  }
}

/** Un guardado que se resuelve cuando el test lo decide. */
function deferred() {
  let resolve!: (value: ActionState) => void
  const promise = new Promise<ActionState>((done) => { resolve = done })
  return { promise, resolve }
}

describe("useDebouncedAutosave", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("guarda tras la pausa y avisa con onSaved", async () => {
    const onSave = vi.fn(async () => ({ ok: true }))
    const onSaved = vi.fn()
    setup({ onSave, onSaved })
    await advance(DEBOUNCE - 1)
    expect(onSave).not.toHaveBeenCalled()
    await advance(1)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledWith({ ok: true })
  })

  /*
   * Antes el efecto se rearmaba en cuanto `pending` volvía a false: un
   * `isDirty` que no se apaga tras guardar (el caso de `use-checklist-responses`,
   * `revision > 0`) guardaba cada 1,5 s para siempre.
   */
  it("un éxito con la misma clave estando sucio no hace bucle", async () => {
    const onSave = vi.fn(async () => ({ ok: true }))
    setup({ onSave })
    await advance(DEBOUNCE * 10)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it("un rechazo permanente no rearma hasta que cambia la clave", async () => {
    const onSave = vi.fn(async () => ({ ok: false, message: "La inspección cambió en otra sesión." }))
    const { rerender, result } = setup({ onSave })
    await advance(DEBOUNCE)
    expect(onSave).toHaveBeenCalledTimes(1)
    await advance(DEBOUNCE * 40)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(result.current.failure).toMatchObject({ transient: false, message: "La inspección cambió en otra sesión." })
    expect(result.current.retrying).toBe(false)
    expect(result.current.status).toBe("error")

    rerender({ watchKey: 2, isDirty: true, debounceMs: DEBOUNCE, onSave })
    await advance(DEBOUNCE)
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it("una excepción reintenta con backoff de 1,2 / 2,4 / 4,8 s", async () => {
    const onSave = vi.fn(async (): Promise<ActionState> => { throw new TypeError("Failed to fetch") })
    const { result } = setup({ onSave })

    await advance(DEBOUNCE)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(result.current.retrying).toBe(true)

    await advance(DEBOUNCE - 1)
    expect(onSave).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(onSave).toHaveBeenCalledTimes(2)

    await advance(2400 - 1)
    expect(onSave).toHaveBeenCalledTimes(2)
    await advance(1)
    expect(onSave).toHaveBeenCalledTimes(3)

    await advance(4800 - 1)
    expect(onSave).toHaveBeenCalledTimes(3)
    await advance(1)
    expect(onSave).toHaveBeenCalledTimes(4)
  })

  it("la espera entre reintentos tiene tope de 30 s", async () => {
    const onSave = vi.fn(async (): Promise<ActionState> => { throw new TypeError("Failed to fetch") })
    setup({ onSave, debounceMs: 20_000 })
    await advance(20_000)
    await advance(20_000)
    expect(onSave).toHaveBeenCalledTimes(2)
    // 20 s · 2 = 40 s, pero el tope es 30 s.
    await advance(30_000)
    expect(onSave).toHaveBeenCalledTimes(3)
  })

  it("un fallo transitorio sigue sin guardarse por sí solo, pero el error se conserva mientras reintenta", async () => {
    const gate = deferred()
    const onSave = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockReturnValueOnce(gate.promise)
    const { result } = setup({ onSave })
    await advance(DEBOUNCE)
    expect(result.current.error).toMatch(/Error de red/)

    // El reintento está en vuelo: el error NO se limpia (re-anunciaría el role=status en cada ciclo).
    await advance(DEBOUNCE)
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe("saving")
    expect(result.current.error).toMatch(/Error de red/)

    await act(async () => { gate.resolve({ ok: true }) })
    expect(result.current.error).toBeNull()
    expect(result.current.failure).toBeNull()
  })

  it("al volver la señal reintenta de inmediato", async () => {
    const onSave = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ ok: true })
    setup({ onSave })
    await advance(DEBOUNCE)
    expect(onSave).toHaveBeenCalledTimes(1)

    await act(async () => { window.dispatchEvent(new Event("online")) })
    expect(onSave).toHaveBeenCalledTimes(2)
  })

  it("el evento online no reintenta un rechazo permanente", async () => {
    const onSave = vi.fn(async () => ({ ok: false, message: "Rechazado" }))
    setup({ onSave })
    await advance(DEBOUNCE)
    await act(async () => { window.dispatchEvent(new Event("online")) })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it("isTransient decide si un ok:false se reintenta, y onFailed recibe la clasificación", async () => {
    const onFailed = vi.fn()
    const onSave = vi.fn(async () => ({ ok: false, message: "Servidor ocupado", data: { code: "busy" } }))
    setup({ onSave, onFailed, isTransient: (result) => result.data?.code === "busy" })
    await advance(DEBOUNCE)
    await advance(DEBOUNCE)
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ transient: true, message: "Servidor ocupado" }))
  })

  it("un watchKey nuevo reinicia el backoff", async () => {
    const onSave = vi.fn(async (): Promise<ActionState> => { throw new TypeError("Failed to fetch") })
    const { rerender } = setup({ onSave })
    await advance(DEBOUNCE)
    await advance(DEBOUNCE)
    await advance(2400)
    expect(onSave).toHaveBeenCalledTimes(3)

    rerender({ watchKey: 2, isDirty: true, debounceMs: DEBOUNCE, onSave })
    await advance(DEBOUNCE)
    expect(onSave).toHaveBeenCalledTimes(4)
    // El fallo con la clave nueva vuelve a empezar en 1,2 s, no en 7,2.
    await advance(DEBOUNCE)
    expect(onSave).toHaveBeenCalledTimes(5)
  })

  it("no guarda si está deshabilitado o limpio", async () => {
    const onSave = vi.fn(async () => ({ ok: true }))
    setup({ onSave, enabled: false })
    setup({ onSave, isDirty: false })
    await advance(DEBOUNCE * 3)
    expect(onSave).not.toHaveBeenCalled()
  })

  describe("saveNow y flush", () => {
    it("saveNow guarda al instante y devuelve el ActionState", async () => {
      const onSave = vi.fn(async () => ({ ok: true, data: { version: 4 } }))
      const { result } = setup({ onSave })
      let returned: ActionState | null = null
      await act(async () => { returned = await result.current.saveNow() })
      expect(returned).toEqual({ ok: true, data: { version: 4 } })
      expect(onSave).toHaveBeenCalledTimes(1)
      // Canceló el debounce: no guarda otra vez.
      await advance(DEBOUNCE * 3)
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it("devuelve el rechazo y nunca lanza, ni siquiera con una excepción", async () => {
      const onSave = vi.fn()
        .mockResolvedValueOnce({ ok: false, message: "No" })
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      const { result } = setup({ onSave, enabled: false })
      let first: ActionState | null = null
      await act(async () => { first = await result.current.saveNow() })
      expect(first).toEqual({ ok: false, message: "No" })
      let second: ActionState | null = null
      await act(async () => { second = await result.current.saveNow() })
      expect(second).toMatchObject({ ok: false })
    })

    it("sin nada que guardar devuelve null", async () => {
      const onSave = vi.fn(async () => ({ ok: true }))
      const { result } = setup({ onSave, isDirty: false })
      let returned: ActionState | null | undefined
      await act(async () => { returned = await result.current.saveNow() })
      expect(returned).toBeNull()
      expect(onSave).not.toHaveBeenCalled()
    })

    it("durante un guardado en vuelo espera, no lo duplica y devuelve su resultado", async () => {
      const gate = deferred()
      const onSave = vi.fn(() => gate.promise)
      const { result } = setup({ onSave })
      await advance(DEBOUNCE)
      expect(onSave).toHaveBeenCalledTimes(1)
      expect(result.current.status).toBe("saving")

      let returned: ActionState | null | undefined
      let settled = false
      act(() => { void result.current.saveNow().then((value) => { returned = value; settled = true }) })
      await advance(10)
      expect(settled).toBe(false)

      await act(async () => { gate.resolve({ ok: true, data: { version: 9 } }) })
      expect(settled).toBe(true)
      expect(returned).toEqual({ ok: true, data: { version: 9 } })
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it("si se editó durante el guardado en vuelo, vuelve a guardar lo nuevo", async () => {
      const gate = deferred()
      const onSave = vi.fn()
        .mockReturnValueOnce(gate.promise)
        .mockResolvedValue({ ok: true, data: { version: 10 } })
      const { result, rerender } = setup({ onSave })
      await advance(DEBOUNCE)
      rerender({ watchKey: 2, isDirty: true, debounceMs: DEBOUNCE, onSave })

      let returned: ActionState | null | undefined
      act(() => { void result.current.saveNow().then((value) => { returned = value }) })
      await act(async () => { gate.resolve({ ok: true, data: { version: 9 } }) })
      expect(onSave).toHaveBeenCalledTimes(2)
      expect(returned).toEqual({ ok: true, data: { version: 10 } })
    })

    it("si lo que estaba en vuelo falló, devuelve ese fallo sin repetirlo", async () => {
      const gate = deferred()
      const onSave = vi.fn(() => gate.promise)
      const { result } = setup({ onSave })
      await advance(DEBOUNCE)
      let returned: ActionState | null | undefined
      act(() => { void result.current.saveNow().then((value) => { returned = value }) })
      await act(async () => { gate.resolve({ ok: false, message: "Conflicto" }) })
      expect(returned).toEqual({ ok: false, message: "Conflicto" })
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it("saveNow vuelve a intentar un rechazo permanente de la misma clave (Reintentar)", async () => {
      const onSave = vi.fn()
        .mockResolvedValueOnce({ ok: false, message: "No" })
        .mockResolvedValueOnce({ ok: true })
      const { result } = setup({ onSave })
      await advance(DEBOUNCE)
      let returned: ActionState | null | undefined
      await act(async () => { returned = await result.current.saveNow() })
      expect(returned).toEqual({ ok: true })
      expect(onSave).toHaveBeenCalledTimes(2)
    })

    it("flush repite hasta que no queda nada sin guardar y se detiene ante un fallo", async () => {
      const gate = deferred()
      const onSave = vi.fn()
        .mockReturnValueOnce(gate.promise)
        .mockResolvedValueOnce({ ok: false, message: "Rechazado" })
      const { result, rerender } = setup({ onSave })
      let returned: ActionState | null | undefined
      act(() => { void result.current.flush().then((value) => { returned = value }) })
      expect(onSave).toHaveBeenCalledTimes(1)
      rerender({ watchKey: 2, isDirty: true, debounceMs: DEBOUNCE, onSave })
      await act(async () => { gate.resolve({ ok: true }) })
      expect(onSave).toHaveBeenCalledTimes(2)
      expect(returned).toEqual({ ok: false, message: "Rechazado" })
    })
  })

  describe("aviso al salir", () => {
    function leave() {
      const event = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }

    it("advierte con cambios sin guardar y no cuando está limpio", () => {
      const onSave = vi.fn(async () => ({ ok: true }))
      const dirty = setup({ onSave })
      expect(leave()).toBe(true)
      dirty.unmount()
      const clean = setup({ onSave, isDirty: false })
      expect(leave()).toBe(false)
      clean.unmount()
    })

    it("hasUnsavedWork manda sobre isDirty y sobre enabled", () => {
      const onSave = vi.fn(async () => ({ ok: true }))
      const paused = setup({ onSave, enabled: false, isDirty: false, hasUnsavedWork: true })
      expect(leave()).toBe(true)
      paused.unmount()
      const quiet = setup({ onSave, isDirty: true, hasUnsavedWork: false })
      expect(leave()).toBe(false)
      quiet.unmount()
    })
  })
})
