/**
 * Guarda de regresión — trasladar un equipo de faena tiene UNA sola puerta.
 *
 * Cambiar la faena de un vehículo mueve sus asignaciones de proveedor
 * (`moveProviderMappingsWithVehicleTx`) y, desde los contratos por faena, cierra
 * su asignación de contrato (`closeContractAssignmentsOnRelocationTx`). Los dos
 * pasos viven juntos en `relocateVehicleWorksiteTx`. Si alguien vuelve a llamar
 * sólo al primero —como hacían los cuatro sitios antes—, el equipo queda en un
 * contrato de una faena donde ya no está y su costo se atribuye mal sin que
 * nada lo avise. El caso que se había escapado es la importación XLSX del
 * padrón de combustible.
 *
 * Mismo patrón de escaneo estático que `modal-alto-estable.test.ts`: sin base de
 * datos y en cada `npm test`.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const SCANNED_ROOTS = ["app", "lib"]

/** Quien define la función y quien la envuelve. */
const PERMITIDOS = new Set([
  "lib/combustibles/provider-mappings.ts",
  "lib/services/fleet-relocation.ts",
])

/** Los sitios que cambian la faena de un vehículo y deben pasar por el envoltorio. */
const LLAMADORES = [
  "app/(app)/combustibles/actions-module/vehicles.ts",
  "lib/services/mantencion/equipment.ts",
]

function scannedFiles(): string[] {
  return SCANNED_ROOTS.flatMap((root) =>
    readdirSync(path.join(ROOT, root), { recursive: true, encoding: "utf8" })
      .map((entry) => `${root}/${entry.split(path.sep).join("/")}`)
      .filter((rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel) && !rel.includes("/__tests__/") && !rel.includes("/node_modules/")),
  ).sort()
}

const files = scannedFiles()

describe("traslado de faena de un equipo", () => {
  it("encuentra archivos que escanear (el glob no quedó vacío)", () => {
    expect(files.length).toBeGreaterThan(500)
    for (const llamador of LLAMADORES) expect(files).toContain(llamador)
  })

  it("ningún archivo fuera de fleet-relocation llama a moveProviderMappingsWithVehicleTx", () => {
    const infractores = files.filter((rel) =>
      !PERMITIDOS.has(rel) && readFileSync(path.join(ROOT, rel), "utf8").includes("moveProviderMappingsWithVehicleTx"))
    expect(
      infractores,
      "Trasladar un equipo debe pasar por relocateVehicleWorksiteTx (lib/services/fleet-relocation.ts): " +
        "mueve los mapeos de combustible Y cierra el contrato.",
    ).toEqual([])
  })

  it("los sitios que trasladan equipos usan relocateVehicleWorksiteTx", () => {
    for (const rel of LLAMADORES) {
      const source = readFileSync(path.join(ROOT, rel), "utf8")
      expect(source, `${rel} ya no pasa por relocateVehicleWorksiteTx`).toContain("relocateVehicleWorksiteTx(")
    }
    // padrón: la acción de edición y la importación XLSX son dos sitios distintos del mismo archivo.
    const vehicles = readFileSync(path.join(ROOT, "app/(app)/combustibles/actions-module/vehicles.ts"), "utf8")
    expect(vehicles.match(/relocateVehicleWorksiteTx\(/g)?.length).toBe(2)
    const equipment = readFileSync(path.join(ROOT, "lib/services/mantencion/equipment.ts"), "utf8")
    expect(equipment.match(/relocateVehicleWorksiteTx\(/g)?.length).toBe(2)
  })
})
