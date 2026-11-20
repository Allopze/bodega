import { describe, expect, it } from "vitest"
import { planShiftImport, type RalentiShiftDoc } from "./import-plan"

const catalog = {
  vehicles: [
    { id: "v-gr06", code: "GR-06" },
    { id: "v-gr10", code: "GR-10" },
    { id: "v-gr11", code: "GR-11" },
  ],
  workers: [
    { id: "w-briceno", firstName: "José Ignacio", lastName: "Briceño Soto" },
    { id: "w-vallejos", firstName: "Mauricio", lastName: "Vallejos Pérez" },
    { id: "w-godoy-1", firstName: "José", lastName: "Godoy Rojas" },
    { id: "w-godoy-2", firstName: "Jose Luis", lastName: "Godoy Mena" },
  ],
  existingImportRefs: new Set<string>(),
}

function doc(overrides: Partial<RalentiShiftDoc> = {}): RalentiShiftDoc {
  return { id: "d1", equipo: "GR-11", fecha: "2026-11-09", ini: 22, fin: 6, operador: "Jose Briceño", obs: "", ...overrides }
}

describe("planShiftImport", () => {
  it("calza «Jose Briceño» con «José Ignacio Briceño Soto» y arma la fila", () => {
    const plan = planShiftImport([doc()], catalog)
    expect(plan.errors).toEqual([])
    expect(plan.rows).toEqual([
      {
        vehicleId: "v-gr11",
        shiftDate: "2026-11-09",
        startHour: 22,
        endHour: 6,
        operatorWorkerId: "w-briceno",
        notes: "Importado de Ralentí Cholguán",
        importRef: "ralenti:d1",
        operatorName: "José Ignacio Briceño Soto",
      },
    ])
  })

  it("con apellido compuesto, distingue «Carlos San Martin» de «Claudio San Martin»", () => {
    const sanMartin = {
      ...catalog,
      workers: [
        { id: "w-carlos", firstName: "Carlos Hernan", lastName: "San Martin Valeria" },
        { id: "w-claudio", firstName: "Claudio Ernesto", lastName: "San Martin Riquelme" },
      ],
    }
    const plan = planShiftImport([
      doc({ id: "c1", operador: "Carlos San Martin" }),
      doc({ id: "c2", operador: "Claudio San Martin", fecha: "2026-11-10" }),
    ], sanMartin)
    expect(plan.errors).toEqual([])
    expect(plan.rows.map((row) => row.operatorWorkerId)).toEqual(["w-carlos", "w-claudio"])
  })

  it("un apellido que no es el comienzo de los apellidos no calza", () => {
    const plan = planShiftImport([doc({ operador: "Jose Soto" })], catalog)
    expect(plan.rows).toEqual([])
    expect(plan.errors).toHaveLength(1)
  })

  it("calza por nombre completo sin tildes, mayúsculas ni espacios de más", () => {
    const plan = planShiftImport([doc({ operador: "  MAURICIO   vallejos  PEREZ " })], catalog)
    expect(plan.errors).toEqual([])
    expect(plan.rows[0]?.operatorWorkerId).toBe("w-vallejos")
  })

  it("«Jose Godoy» con dos trabajadores es un error que nombra a ambos", () => {
    const plan = planShiftImport([doc({ operador: "Jose Godoy" })], catalog)
    expect(plan.rows).toEqual([])
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toContain("Jose Godoy")
    expect(plan.errors[0]).toContain("José Godoy Rojas")
    expect(plan.errors[0]).toContain("Jose Luis Godoy Mena")
  })

  it("un operador sin coincidencias es un error que lo nombra", () => {
    const plan = planShiftImport([doc({ operador: "Pedro Inexistente" })], catalog)
    expect(plan.rows).toEqual([])
    expect(plan.errors.join("\n")).toContain("Pedro Inexistente")
  })

  it("un equipo inexistente es un error", () => {
    const plan = planShiftImport([doc({ equipo: "ZZ-99" })], catalog)
    expect(plan.rows).toEqual([])
    expect(plan.errors.join("\n")).toContain("ZZ-99")
  })

  it("el equipo calza por código exacto sin distinguir mayúsculas", () => {
    const plan = planShiftImport([doc({ equipo: "gr-11" })], catalog)
    expect(plan.errors).toEqual([])
    expect(plan.rows[0]?.vehicleId).toBe("v-gr11")
  })

  it("un doc ya importado se cuenta y no va en las filas", () => {
    const plan = planShiftImport([doc(), doc({ id: "d2", fecha: "2026-11-10" })], {
      ...catalog,
      existingImportRefs: new Set(["ralenti:d1"]),
    })
    expect(plan.alreadyImported).toBe(1)
    expect(plan.rows.map((row) => row.importRef)).toEqual(["ralenti:d2"])
    expect(plan.errors).toEqual([])
  })

  it("importa tal cual los turnos cruzados de un operador y los avisa", () => {
    const plan = planShiftImport(
      [
        doc({ id: "a", equipo: "GR-06", fecha: "2026-11-03", ini: 6, fin: 18, operador: "Mauricio Vallejos" }),
        doc({ id: "b", equipo: "GR-10", fecha: "2026-11-03", ini: 14, fin: 22, operador: "Mauricio Vallejos" }),
      ],
      catalog,
    )
    expect(plan.rows).toHaveLength(2)
    expect(plan.operatorOverlaps).toEqual(["Mauricio Vallejos: 03-11 GR-06 06–18 y 03-11 GR-10 14–22"])
  })

  it("no avisa cruces cuando los turnos del operador no comparten horas", () => {
    const plan = planShiftImport(
      [
        doc({ id: "a", equipo: "GR-06", fecha: "2026-11-03", ini: 6, fin: 14, operador: "Mauricio Vallejos" }),
        doc({ id: "b", equipo: "GR-10", fecha: "2026-11-03", ini: 14, fin: 22, operador: "Mauricio Vallejos" }),
      ],
      catalog,
    )
    expect(plan.operatorOverlaps).toEqual([])
  })

  it("detecta el cruce de un turno nocturno con el del día siguiente", () => {
    const plan = planShiftImport(
      [
        doc({ id: "a", equipo: "GR-06", fecha: "2026-11-03", ini: 22, fin: 6, operador: "Mauricio Vallejos" }),
        doc({ id: "b", equipo: "GR-10", fecha: "2026-11-04", ini: 5, fin: 14, operador: "Mauricio Vallejos" }),
      ],
      catalog,
    )
    expect(plan.operatorOverlaps).toEqual(["Mauricio Vallejos: 03-11 GR-06 22–06 y 04-11 GR-10 05–14"])
  })

  it("las observaciones se agregan a la nota de importación", () => {
    const plan = planShiftImport([doc({ obs: "Cambio de turno" })], catalog)
    expect(plan.rows[0]?.notes).toBe("Importado de Ralentí Cholguán · Cambio de turno")
  })

  it("un doc con inicio igual a fin es un error", () => {
    const plan = planShiftImport([doc({ ini: 6, fin: 6 })], catalog)
    expect(plan.rows).toEqual([])
    expect(plan.errors.join("\n")).toContain("d1")
  })

  it("un doc con horas fuera de 0–23 es un error", () => {
    const plan = planShiftImport([doc({ id: "x", ini: 24, fin: 6 }), doc({ id: "y", ini: 6, fin: -1 }), doc({ id: "z", ini: 6.5, fin: 14 })], catalog)
    expect(plan.rows).toEqual([])
    expect(plan.errors).toHaveLength(3)
  })
})
