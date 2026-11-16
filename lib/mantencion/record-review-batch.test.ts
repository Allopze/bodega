import { describe, expect, it } from "vitest"
import { MAX_REVIEW_BATCH, isReviewableRecord, reviewBatchMessage, summarizeRecordSelection } from "./record-review-batch"

const row = (id: string, status = "vigente", review = "pendiente") => ({ id, status, review })

describe("qué registros admiten revisarse", () => {
  it("lo vigente pendiente u observado sí; lo ya revisado y lo anulado no", () => {
    expect(isReviewableRecord(row("a"))).toBe(true)
    expect(isReviewableRecord(row("a", "vigente", "observado"))).toBe(true)
    expect(isReviewableRecord(row("a", "vigente", "revisado"))).toBe(false)
    expect(isReviewableRecord(row("a", "anulado", "pendiente"))).toBe(false)
    expect(isReviewableRecord(row("a", "anulado", "observado"))).toBe(false)
  })
})

describe("la selección de la página", () => {
  const rows = [row("a"), row("b", "vigente", "observado"), row("c", "vigente", "revisado"), row("d", "anulado"), row("e")]

  it("conserva el orden de la lista y descarta lo que no admite revisión", () => {
    const selection = summarizeRecordSelection(rows, new Set(["e", "c", "a", "d", "b"]))
    expect(selection).toEqual({ ids: ["a", "b", "e"], count: 3, tooMany: false })
  })

  it("un id que ya no está en la página no viaja", () => {
    expect(summarizeRecordSelection(rows, new Set(["a", "zzz"])).ids).toEqual(["a"])
  })

  it("sin nada elegido no hay selección", () => {
    expect(summarizeRecordSelection(rows, new Set())).toEqual({ ids: [], count: 0, tooMany: false })
  })

  it("pasado el tope de un lote no se ofrece la acción", () => {
    const many = Array.from({ length: MAX_REVIEW_BATCH + 1 }, (_, index) => row(`r${index}`))
    const selection = summarizeRecordSelection(many, new Set(many.map((item) => item.id)))
    expect(selection.tooMany).toBe(true)
    expect(summarizeRecordSelection(many.slice(0, MAX_REVIEW_BATCH), new Set(many.map((item) => item.id))).tooMany).toBe(false)
  })
})

describe("el aviso del resultado", () => {
  it("dice cuántos se marcaron y cuántos ya estaban revisados", () => {
    expect(reviewBatchMessage({ marked: 12, skipped: [{ reason: "ya_revisado" }, { reason: "ya_revisado" }] }))
      .toBe("12 registros marcados como revisados; 2 ya estaban revisados")
  })

  it("concuerda en singular", () => {
    expect(reviewBatchMessage({ marked: 1, skipped: [{ reason: "ya_revisado" }, { reason: "anulado" }, { reason: "no_encontrado" }] }))
      .toBe("1 registro marcado como revisado; 1 ya estaba revisado; 1 está anulado; 1 no se encontró")
  })

  it("sin ninguno marcado lo dice, con el motivo", () => {
    expect(reviewBatchMessage({ marked: 0, skipped: [{ reason: "anulado" }, { reason: "anulado" }] })).toBe("No se marcó ninguno: 2 están anulados")
    expect(reviewBatchMessage({ marked: 0, skipped: [] })).toBe("No había registros que marcar.")
  })
})
