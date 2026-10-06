import { describe, expect, it } from "vitest"
import { buildWorkerSearchText } from "./worker-search"

const worker = { name: "Andrea Rojas", position: "Operaria", worksiteName: "Faena Santa Fe", rut: "17.123.456-7" }

describe("buildWorkerSearchText", () => {
  // El selector filtra por subcadena literal (`select.tsx`): cada forma en que
  // se teclea un RUT tiene que estar contenida en el texto.
  it.each(["17", "17.123", "17123456", "17123456-7", "17.123.456-7", "171234567"])(
    "encuentra el RUT tecleado como %s",
    (typed) => {
      expect(buildWorkerSearchText(worker).toLowerCase()).toContain(typed.toLowerCase())
    },
  )

  it("sigue buscando por nombre, cargo y faena, y tolera un trabajador sin RUT", () => {
    const text = buildWorkerSearchText({ ...worker, rut: null }).toLowerCase()
    expect(text).toContain("andrea")
    expect(text).toContain("operaria")
    expect(text).toContain("santa fe")
  })
})
