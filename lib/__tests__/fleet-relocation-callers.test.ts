/**
 * Guarda de regresión — trasladar un equipo de faena tiene UNA sola puerta.
 *
 * Cambiar la faena de un vehículo mueve sus asignaciones de proveedor
 * (`moveProviderMappingsWithVehicleTx`) y, desde los contratos por faena, cierra
 * su asignación de contrato (`closeContractAssignmentsOnRelocationTx`). Los dos
 * pasos viven juntos en `relocateVehicleWorksiteTx`. Si alguien vuelve a llamar
 * sólo al primero —como hacían los cuatro sitios antes del traslado—, el equipo queda en un
 * contrato de una faena donde ya no está y su costo se atribuye mal sin que
 * nada lo avise.
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

/**
 * El sitio que cambia la faena de un vehículo y debe pasar por el envoltorio. Desde
 * el traslado de equipos (fleet-transfers) es el único: la edición, el padrón y
 * «Incorporar» ya no escriben la faena, la piden a `transferVehiclesTx`.
 */
const LLAMADORES = [
  "lib/services/fleet-transfers.ts",
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

  it("el traslado pasa por relocateVehicleWorksiteTx y su anulación por revertVehicleRelocationTx", () => {
    const transfers = readFileSync(path.join(ROOT, "lib/services/fleet-transfers.ts"), "utf8")
    expect(transfers.match(/relocateVehicleWorksiteTx\(/g)?.length, "transferVehiclesTx ya no cierra el contrato").toBe(1)
    expect(transfers.match(/revertVehicleRelocationTx\(/g)?.length, "voidTransferTx ya no devuelve el contrato").toBe(1)
  })

  it("nadie fuera del traslado escribe la faena de un vehículo con relocateVehicleWorksiteTx", () => {
    const otros = files.filter((rel) => !PERMITIDOS.has(rel) && !LLAMADORES.includes(rel)
      && readFileSync(path.join(ROOT, rel), "utf8").includes("relocateVehicleWorksiteTx("))
    expect(otros, "La faena de un equipo sólo cambia por un traslado (transferVehiclesTx).").toEqual([])
  })
})
