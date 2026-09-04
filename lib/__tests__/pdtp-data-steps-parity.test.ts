/**
 * lib/__tests__/pdtp-data-steps-parity.test.ts
 *
 * Los pasos de dato del PDTP están declarados dos veces —en
 * `scripts/apply-pdtp-data.sh` para desarrollo y en `scripts/deploy-prod.sh`
 * para producción— porque uno invoca scripts de npm y el otro one-shots de
 * compose. Dos listas que describen lo mismo se separan; es cuestión de tiempo.
 *
 * Este test es lo que impide que se separen. No es una precaución teórica: el
 * catálogo de tipos documentales existía desde siempre detrás de un botón, no
 * corría en ningún despliegue, y llegó vacío a producción — con él vacío, dos
 * actividades del programa no tenían dónde declarar su número y la compuerta
 * las daba por listas igual.
 */

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const devScript = fs.readFileSync(path.join(root, "scripts/apply-pdtp-data.sh"), "utf8")
const deployScript = fs.readFileSync(path.join(root, "scripts/deploy-prod.sh"), "utf8")
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>
}

/** Los pares `npm-script|servicio-compose` del arreglo del script de desarrollo. */
function devSteps(): { npmScript: string; composeService: string }[] {
  const block = devScript.match(/PDTP_DATA_STEPS=\(([\s\S]*?)\n\)/)
  expect(block, "no se encontró el arreglo PDTP_DATA_STEPS").toBeTruthy()
  return [...block![1]!.matchAll(/"([^"|]+)\|([^"]+)"/g)].map((match) => ({
    npmScript: match[1]!,
    composeService: match[2]!,
  }))
}

/** Posición del primer `docker compose run --rm <servicio>` en el deploy. */
function deployPositionOf(service: string): number {
  const index = deployScript.indexOf(`docker compose run --rm ${service}\n`)
  return index === -1 ? deployScript.indexOf(`docker compose run --rm ${service} `) : index
}

describe("paridad de los pasos de dato del PDTP entre dev y producción", () => {
  const steps = devSteps()

  it("declara al menos los pasos que el programa necesita para acreditar", () => {
    const services = steps.map((step) => step.composeService)
    expect(services).toEqual(expect.arrayContaining([
      "sync-rbac",
      "apply-pdtp-catalog-decisions",
      "apply-sst-taxonomy",
      "apply-pdtp-program-data",
      "apply-pdtp-mechanisms",
      "seed-inspection-templates",
    ]))
  })

  it("cada paso de dev existe como script de npm", () => {
    for (const step of steps) {
      expect(packageJson.scripts[step.npmScript], step.npmScript).toBeTruthy()
    }
  })

  it("cada paso de dev corre también en el despliegue de producción", () => {
    // El caso que este test persigue: alguien agrega un paso a la cadena de
    // desarrollo, funciona en su máquina, y producción se queda sin él.
    for (const step of steps) {
      expect(deployPositionOf(step.composeService), `${step.composeService} no corre en deploy-prod.sh`)
        .toBeGreaterThan(-1)
    }
  })

  it("el orden relativo es el mismo en los dos", () => {
    // El orden importa de verdad: la taxonomía documental es prerrequisito del
    // dato del programa, los mecanismos se clasifican después de los retiros, y
    // el diagnóstico va al final para reportar el estado ya aplicado.
    const positions = steps.map((step) => deployPositionOf(step.composeService))
    const sorted = [...positions].sort((a, b) => a - b)
    expect(positions, `orden en dev: ${steps.map((s) => s.composeService).join(" → ")}`).toEqual(sorted)
  })

  it("el diagnóstico de cableado va después de instalar el catálogo de inspecciones", () => {
    // Al revés informaría sobre un estado que el propio despliegue está por
    // cambiar, que es la forma más barata de que nadie le crea.
    const seed = deployPositionOf("seed-inspection-templates")
    const preflight = deployPositionOf("preflight-pdtp-wiring")
    expect(seed).toBeGreaterThan(-1)
    expect(preflight).toBeGreaterThan(seed)
  })
})
