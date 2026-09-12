import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { TRAINING_MODALITIES } from "@/lib/validation/prevention-module/training"
import { TRAINING_MODALITY_LABELS } from "@/lib/prevention/training"

/**
 * La modalidad vive en tres lugares que tienen que decir lo mismo: el enum de
 * Zod, el CHECK de la base (dos tablas) y el mapa de etiquetas de la UI. Agregar
 * un valor en uno solo no falla en desarrollo —Zod acepta, la UI muestra el
 * valor crudo— y revienta recién al insertar en producción.
 */
describe("modalidades de capacitación", () => {
  const schema = readFileSync("db/schema/prevention/training.ts", "utf8")

  it("incluye `teorica`", () => {
    // Las fichas de los organismos administradores describen sus cursos como
    // "teórica" o "teórico-práctica", no por el canal de entrega.
    expect(TRAINING_MODALITIES).toContain("teorica")
  })

  it("cada modalidad tiene etiqueta en la UI", () => {
    for (const modality of TRAINING_MODALITIES) {
      expect(TRAINING_MODALITY_LABELS[modality], `falta la etiqueta de "${modality}"`).toBeTruthy()
    }
  })

  it("no hay etiquetas huérfanas", () => {
    for (const key of Object.keys(TRAINING_MODALITY_LABELS)) {
      expect(TRAINING_MODALITIES, `"${key}" tiene etiqueta pero no es una modalidad válida`).toContain(key)
    }
  })

  it("los CHECK de la base aceptan exactamente las mismas modalidades", () => {
    // Dos tablas las restringen: versiones de curso y sesiones. Si una se queda
    // atrás, la ficha se crea y la sesión no se puede programar.
    const checks = [...schema.matchAll(/\$\{table\.modality\} IN \(([^)]*)\)/g)]
    expect(checks.length, "esperaba un CHECK de modalidad en versiones y otro en sesiones").toBe(2)
    for (const [, list] of checks) {
      const allowed = [...(list ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1])
      expect(allowed.sort()).toEqual([...TRAINING_MODALITIES].sort())
    }
  })
})
