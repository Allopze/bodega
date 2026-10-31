// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FieldLoadDraft, FieldLoadPhotos } from "./types"

const queue = vi.hoisted(() => ({
  clearTaeDraft: vi.fn(async (_scopeKey: string) => {}),
  getTaeDraft: vi.fn(async (_scopeKey: string) => null),
  getTaeDraftPhotos: vi.fn(async (_scopeKey: string) => ({})),
  saveTaeDraft: vi.fn(async (_scopeKey: string, _value: Record<string, unknown>) => {}),
  saveTaeDraftPhotos: vi.fn(async (_scopeKey: string, _value: Record<string, unknown>) => {}),
}))
vi.mock("@/lib/pwa/tae-offline-queue", () => queue)

import { useFieldDraft } from "./use-field-draft"

const SCOPE = "public:punto-1"
const NO_PHOTOS: FieldLoadPhotos = {}
/** Sólo importa que el borrador tenga equipo: es lo que decide si hay algo que restaurar. */
const draftOf = (vehicleId: string) => ({ vehicleId }) as unknown as FieldLoadDraft

function mount(draft: FieldLoadDraft) {
  return renderHook(
    (props: { draft: FieldLoadDraft }) => useFieldDraft({ scopeKey: SCOPE, draft: props.draft, step: "review", photos: NO_PHOTOS, enabled: true, onRestore: () => true }),
    { initialProps: { draft } },
  )
}

/** Deja correr la lectura inicial del borrador guardado (asíncrona) hasta que el hook queda `ready`. */
async function untilReady(result: { current: { ready: boolean } }) {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  expect(result.current.ready).toBe(true)
}

describe("useFieldDraft: el guardado diferido del borrador", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })
  afterEach(() => vi.useRealTimers())

  it("guarda la carga en curso 400 ms después del último cambio", async () => {
    const { result, rerender } = mount(draftOf(""))
    await untilReady(result)

    rerender({ draft: draftOf("veh-1") })
    act(() => { vi.advanceTimersByTime(399) })
    expect(queue.saveTaeDraft).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(queue.saveTaeDraft).toHaveBeenCalledTimes(1)
    expect(queue.saveTaeDraft).toHaveBeenCalledWith(SCOPE, { draft: draftOf("veh-1"), step: "review" })
  })

  it("después de enviar la carga, el guardado que estaba pendiente no la devuelve como «carga a medias»", async () => {
    // La carga se armó hace poco y su guardado diferido todavía no corrió cuando el envío termina (un servidor rápido):
    // el borrado tiene que cancelarlo, o el borrador de la carga ya enviada reaparece al abrir el formulario otra vez.
    const { result } = mount(draftOf("veh-1"))
    await untilReady(result)
    act(() => { vi.advanceTimersByTime(100) })

    act(() => { result.current.discard() })
    act(() => { vi.advanceTimersByTime(1_000) })

    expect(queue.clearTaeDraft).toHaveBeenCalledWith(SCOPE)
    expect(queue.saveTaeDraft).not.toHaveBeenCalled()
  })

  it("una carga nueva, empezada después de enviar la anterior, sí se guarda", async () => {
    const { result, rerender } = mount(draftOf("veh-1"))
    await untilReady(result)
    act(() => { result.current.discard() })

    rerender({ draft: draftOf("veh-2") })
    act(() => { vi.advanceTimersByTime(400) })

    expect(queue.saveTaeDraft).toHaveBeenCalledTimes(1)
    expect(queue.saveTaeDraft).toHaveBeenCalledWith(SCOPE, { draft: draftOf("veh-2"), step: "review" })
  })
})
