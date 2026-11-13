import { describe, expect, it } from "vitest"
import { FUEL_GLOSSARY, fuelTermDefinition } from "./glossary"

describe("glosario de combustible", () => {
  it("«Rinde peor» tiene una sola definición: 10 % peor que su modelo o que su propio historial", () => {
    const entries = FUEL_GLOSSARY.filter((entry) => entry.term === "Rinde peor")
    expect(entries).toHaveLength(1)
    expect(entries[0]!.definition).toBe("10 % peor que su modelo o que su propio historial.")
  })

  it("las siglas se entienden por sus nombres de antes y no se usan para definirse", () => {
    for (const sigla of ["TCT", "TAE", "IEC", "ralentí"]) {
      const definition = fuelTermDefinition(sigla)
      expect(definition, `definición de ${sigla}`).toBeTruthy()
    }
    // Las definiciones de las tarjetas hablan de lo que se hace, no de la sigla.
    expect(fuelTermDefinition("TCT")).not.toMatch(/\bTCT\b|\bTAE\b/)
    expect(fuelTermDefinition("TAE")).not.toMatch(/\bTCT\b|\bTAE\b/)
    expect(fuelTermDefinition("IEC")).toMatch(/litro/i)
    expect(fuelTermDefinition("ralentí")).toMatch(/motor encendido sin trabajar/i)
  })
})
