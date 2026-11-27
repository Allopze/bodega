import { describe, expect, it } from "vitest"
import { EMPTY_NOTE_AGE_COUNTS, NOTE_AGE_BUCKETS, noteAgeBucketKey, noteAgeBucketLabel, noteAgeSummary, parseNoteAgeParam } from "./parts-notes-age"

describe("antigüedad de las notas de pedido", () => {
  it("cuatro tramos cronológicos: 0–2, 3–6, 7–13 y 14 días o más, sin huecos ni solapes", () => {
    expect(NOTE_AGE_BUCKETS.map((bucket) => bucket.key)).toEqual(["0-2", "3-6", "7-13", "14+"])
    const keys = Array.from({ length: 40 }, (_, days) => noteAgeBucketKey(days))
    expect(keys.slice(0, 3)).toEqual(["0-2", "0-2", "0-2"])
    expect(keys.slice(3, 7)).toEqual(["3-6", "3-6", "3-6", "3-6"])
    expect(keys.slice(7, 14).every((key) => key === "7-13")).toBe(true)
    expect(keys.slice(14).every((key) => key === "14+")).toBe(true)
    // Una edad negativa (reloj adelantado) cuenta como reciente; una fracción, por su parte entera.
    expect(noteAgeBucketKey(-3)).toBe("0-2")
    expect(noteAgeBucketKey(2.9)).toBe("0-2")
  })

  it("`?antiguedad=` sólo deja pasar las claves de tramo; «14 » (el «+» sin codificar) y «14» valen como «14+»", () => {
    expect(parseNoteAgeParam("3-6")).toBe("3-6")
    expect(parseNoteAgeParam("14+")).toBe("14+")
    expect(parseNoteAgeParam("14 ")).toBe("14+")
    expect(parseNoteAgeParam(["7-13", "0-2"])).toBe("7-13")
    for (const bad of [undefined, "", "  ", "15", "0-3", "todas", "3-6; drop table"]) expect(parseNoteAgeParam(bad)).toBeUndefined()
  })

  it("el resumen responde antes que el dibujo: cuántas notas y cuántas llevan 14 días o más", () => {
    expect(noteAgeSummary({ ...EMPTY_NOTE_AGE_COUNTS }, undefined)).toBe("")
    expect(noteAgeSummary({ "0-2": 3, "3-6": 1, "7-13": 0, "14+": 0 }, undefined)).toBe("4 notas; ninguna lleva 14 días o más en su estado.")
    expect(noteAgeSummary({ "0-2": 0, "3-6": 0, "7-13": 0, "14+": 1 }, undefined)).toBe("1 nota; 1 lleva 14 días o más en su estado.")
    expect(noteAgeSummary({ "0-2": 2, "3-6": 0, "7-13": 1, "14+": 2 }, undefined)).toBe("5 notas; 2 llevan 14 días o más en su estado.")
    expect(noteAgeSummary({ "0-2": 2, "3-6": 0, "7-13": 1, "14+": 2 }, "14+")).toBe("Filtrando por «14 días o más»: 2 de 5 notas.")
    expect(noteAgeBucketLabel("7-13")).toBe("7–13 días")
    expect(noteAgeBucketLabel("otro")).toBeNull()
  })
})
