import { describe, expect, it, vi } from "vitest"
import {
  isEvidenceReady,
  NO_SLOT,
  resolvesToSlot,
  slotsAvailableForWorksite,
  uploadSlotEvidenceSequentially,
} from "./slot-selection"

describe("slotsAvailableForWorksite", () => {
  it("las casillas están disponibles cuando la faena del diálogo coincide con la de la página", () => {
    expect(slotsAvailableForWorksite("ws-1", "ws-1")).toBe(true)
  })

  it("se apagan si el operador elige otra faena dentro del diálogo", () => {
    expect(slotsAvailableForWorksite("ws-2", "ws-1")).toBe(false)
  })

  it("se apagan si la página todavía no tiene faena filtrada", () => {
    expect(slotsAvailableForWorksite("ws-1", null)).toBe(false)
  })
})

describe("resolvesToSlot", () => {
  it("no cumple ninguna casilla si las casillas no están disponibles, aunque el id no sea el centinela", () => {
    expect(resolvesToSlot("slot-1", false)).toBe(false)
  })

  it("no cumple ninguna casilla con el centinela «Ninguna»", () => {
    expect(resolvesToSlot(NO_SLOT, true)).toBe(false)
  })

  it("cumple la casilla elegida cuando está disponible y no es el centinela", () => {
    expect(resolvesToSlot("slot-1", true)).toBe(true)
  })
})

describe("isEvidenceReady", () => {
  it("sin casilla elegida siempre está lista: no hay nada que cumplir", () => {
    expect(isEvidenceReady({ hasSlot: false, activeEvidenceCount: 0, newFileCount: 0 })).toBe(true)
  })

  it("con casilla elegida y sin evidencia (ni previa ni nueva) no está lista", () => {
    expect(isEvidenceReady({ hasSlot: true, activeEvidenceCount: 0, newFileCount: 0 })).toBe(false)
  })

  it("con casilla elegida y evidencia ya activa (de un intento previo) está lista sin subir nada nuevo", () => {
    expect(isEvidenceReady({ hasSlot: true, activeEvidenceCount: 1, newFileCount: 0 })).toBe(true)
  })

  it("con casilla elegida y un archivo nuevo seleccionado está lista aunque no haya evidencia previa", () => {
    expect(isEvidenceReady({ hasSlot: true, activeEvidenceCount: 0, newFileCount: 1 })).toBe(true)
  })
})

describe("uploadSlotEvidenceSequentially", () => {
  function file(name: string) {
    return new File(["contenido"], name)
  }

  it("no llama al subidor si no hay archivos", async () => {
    const uploadOne = vi.fn()
    const result = await uploadSlotEvidenceSequentially([], uploadOne)
    expect(result).toEqual({ ok: true })
    expect(uploadOne).not.toHaveBeenCalled()
  })

  it("sube todos los archivos en orden cuando todos tienen éxito", async () => {
    const seen: string[] = []
    const uploadOne = vi.fn(async (f: File) => { seen.push(f.name); return { ok: true } })
    const result = await uploadSlotEvidenceSequentially([file("a.pdf"), file("b.pdf")], uploadOne)
    expect(result).toEqual({ ok: true })
    expect(seen).toEqual(["a.pdf", "b.pdf"])
    expect(uploadOne).toHaveBeenCalledTimes(2)
  })

  /**
   * Si el segundo de tres falla, el tercero nunca se intenta: la evidencia
   * "flotante" del primero es un riesgo conocido y aceptado (mismo patrón que
   * `CompleteDrillDialog`), pero detenerse ahí evita subir MÁS archivos a una
   * casilla cuyo registro ya se sabe que va a fallar.
   */
  it("se detiene en el primer error y no sube los archivos restantes", async () => {
    const seen: string[] = []
    const uploadOne = vi.fn(async (f: File) => {
      seen.push(f.name)
      if (f.name === "b.pdf") return { ok: false, message: "El archivo supera el máximo permitido." }
      return { ok: true }
    })
    const result = await uploadSlotEvidenceSequentially([file("a.pdf"), file("b.pdf"), file("c.pdf")], uploadOne)
    expect(result).toEqual({ ok: false, message: "El archivo supera el máximo permitido." })
    expect(seen).toEqual(["a.pdf", "b.pdf"])
  })

  it("usa un mensaje por defecto si el subidor falla sin mensaje", async () => {
    const uploadOne = vi.fn(async () => ({ ok: false }))
    const result = await uploadSlotEvidenceSequentially([file("a.pdf")], uploadOne)
    expect(result).toEqual({ ok: false, message: "No se pudo subir la evidencia." })
  })
})
