import { describe, expect, it } from "vitest"
import { REPUESTO_ATTRIBUTE_NAMES } from "@/lib/validation/repuestos"
import { SERVICE_ATTRIBUTE_NAMES } from "@/lib/validation/servicios"

/**
 * Los atributos que delatan una solicitud mal tipada (TASK-UI-003).
 *
 * `scripts/check-mistyped-requests.ts` busca solicitudes tipadas `epp` u `otro`
 * que lleven atributos que sólo el editor de repuestos y servicios escribe. Su
 * primera versión copió a mano los **rótulos del formulario**, y dos de tres
 * estaban mal: el campo rotulado "Equipo / Máquina" se persiste como `"Equipo"`,
 * y "Patente / Código interno" como `"Patente/Código"`.
 *
 * Eso habría producido **falsos negativos** —el peor sentido del error: un "no
 * hay nada" que nadie vuelve a cuestionar—. Y una versión anterior incluyó
 * "Marca" y "Modelo", que el catálogo EPP usa como atributos corrientes: contra
 * producción acusó a once solicitudes correctas, nueve de ellas ya en compra.
 *
 * Esta prueba fija las dos mitades del contrato: qué nombres son exclusivos y
 * cuáles son compartidos.
 */
const COMPARTIDOS_CON_CATALOGO = ["Marca", "Modelo"]

const EXCLUSIVOS = [
  ...new Set([...Object.values(REPUESTO_ATTRIBUTE_NAMES), ...Object.values(SERVICE_ATTRIBUTE_NAMES)]),
].filter((nombre) => !COMPARTIDOS_CON_CATALOGO.includes(nombre))

describe("atributos que delatan una solicitud mal tipada", () => {
  it("son los nombres que la aplicación persiste, no los rótulos del formulario", () => {
    // La distinción que costó dos nombres equivocados: el rótulo dice una cosa
    // y la columna guarda otra.
    expect(EXCLUSIVOS).toEqual(["N° de Parte", "Equipo", "Patente/Código", "Ubicación"])
    expect(EXCLUSIVOS).not.toContain("Equipo / Máquina")
    expect(EXCLUSIVOS).not.toContain("Patente / Código interno")
  })

  it("ninguno es un atributo que el catálogo de productos también use", () => {
    // "Modelo" es lo que tiene un casco. Incluirlo convirtió el detector en un
    // acusador de registros correctos.
    for (const compartido of COMPARTIDOS_CON_CATALOGO) {
      expect(EXCLUSIVOS, `${compartido} lo usa también el catálogo EPP`).not.toContain(compartido)
    }
  })

  it("cubre los dos editores, no sólo repuestos", () => {
    // "Ubicación" sólo existe en servicios: dejarlo fuera perdería la mitad del
    // alcance sin que ninguna prueba lo dijera.
    expect(EXCLUSIVOS).toContain(SERVICE_ATTRIBUTE_NAMES.location)
    expect(EXCLUSIVOS).toContain(REPUESTO_ATTRIBUTE_NAMES.partNumber)
  })
})
