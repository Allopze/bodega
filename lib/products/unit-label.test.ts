import { describe, expect, it } from "vitest"
import { unitLabel, unitWord } from "./unit-label"

const LABELS = { bidon: "Bidón", juego: "Juego" }

describe("unitLabel / unitWord", () => {
  it("nombra la unidad con su rótulo del catálogo, sin importar mayúsculas ni espacios", () => {
    expect(unitLabel("bidon", LABELS)).toBe("Bidón")
    expect(unitLabel(" Juego ", LABELS)).toBe("Juego")
    expect(unitWord("bidon", LABELS)).toBe("bidón")
  })

  it("sin rótulo conocido muestra el código", () => {
    expect(unitLabel("galón", LABELS)).toBe("galón")
    expect(unitLabel("unidad")).toBe("unidad")
  })
})
