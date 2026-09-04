/**
 * lib/__tests__/pdtp-enganche-destinations.test.ts
 *
 * El contrato de cumplimiento 2026 y la clasificación por mecanismo tienen que
 * cubrir el mismo conjunto de actividades.
 *
 * El mapa se escribe a mano, desde el conocimiento de qué conector acredita qué
 * — ese conocimiento no está en ninguna tabla, y es la misma queja que
 * `STRUCTURALLY_WIRED_ACTIVITY_NUMBERS` documenta. Un número que se clasifica
 * como `enganche` y no está en el mapa deja de verificarse en silencio; un
 * permiso mal escrito produce un informe que acusa a quien no corresponde. Esta
 * suite cubre las dos cosas.
 */

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  PDTP_2026_ENGANCHE_DESTINATIONS,
  engancheDestinationFor,
} from "@/lib/services/pdtp-adapters/fulfillment-contract-2026"
import { preventionModule } from "@/modules/prevention/manifest"

const root = process.cwd()

/** Los números que `apply-pdtp-2026-mechanisms.ts` clasifica como `ENGANCHE`. */
function enganchesFromMechanismsScript(): number[] {
  const source = fs.readFileSync(path.join(root, "scripts/apply-pdtp-2026-mechanisms.ts"), "utf8")
  const block = source.match(/const ENGANCHE = \[([\s\S]*?)\n\] as const/)
  expect(block, "no se encontró el arreglo ENGANCHE").toBeTruthy()
  // Los comentarios del arreglo citan artículos, fechas y versiones, así que
  // se quitan antes de leer los números: si no, `DS 44` aportaría un "44".
  const sinComentarios = block![1]!.replace(/\/\/[^\n]*/g, "")
  return [...sinComentarios.matchAll(/\b(\d+)\b/g)].map((match) => Number(match[1]))
}

describe("contrato de cumplimiento de las actividades de enganche", () => {
  const enganches = enganchesFromMechanismsScript()

  it("el script de mecanismos declara un conjunto no vacío", () => {
    expect(enganches.length).toBeGreaterThan(50)
  })

  it("toda actividad clasificada como enganche tiene destino declarado", () => {
    // Si falta, la compuerta deja de verificar esa actividad sin decir nada.
    const sinDestino = enganches.filter((n) => engancheDestinationFor(n) === null)
    expect(sinDestino, `sin entrada en el contrato: ${sinDestino.join(", ")}`).toEqual([])
  })

  it("todo permiso del mapa existe en el manifest del módulo", () => {
    // Un permiso inventado nunca lo tiene nadie, así que produciría un informe
    // que acusa a todos los responsables de una actividad que está bien.
    const declared = new Set<string>(preventionModule.permissions as readonly string[])
    for (const [n, destination] of Object.entries(PDTP_2026_ENGANCHE_DESTINATIONS)) {
      if (!destination.permission) continue
      if (destination.permission.startsWith("sst:")) continue // otro módulo
      expect(declared, `N°${n} → ${destination.permission}`).toContain(destination.permission)
    }
  })

  it("las actividades segregadas dicen por qué lo están", () => {
    // Una exención sin motivo escrito se lee como un parche y sobrevive a
    // cualquier revisión. Con motivo, alguien puede discutirla.
    for (const [n, destination] of Object.entries(PDTP_2026_ENGANCHE_DESTINATIONS)) {
      if (!destination.segregated) continue
      expect(destination.segregated.length, `N°${n}`).toBeGreaterThan(30)
    }
  })

  it("los trece pasos del RE-20 no comparten un solo permiso", () => {
    // Avisar no es investigar, y difundir no es cerrar. Suponer que todo el
    // bloque exige `investigate` producía cinco acusaciones falsas.
    const re20 = [66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78]
    const permisos = new Set(re20.map((n) => engancheDestinationFor(n)?.permission))
    expect(permisos.size).toBeGreaterThan(1)
    expect(engancheDestinationFor(66)?.permission).toBe("prevention:incidents:report")
    expect(engancheDestinationFor(72)?.permission).toBe("prevention:incidents:notify")
    expect(engancheDestinationFor(73)?.permission).toBe("prevention:incidents:investigate")
    expect(engancheDestinationFor(77)?.permission).toBe("prevention:incidents:close")
  })

  it("el href lleva la faena y apunta al módulo, no a la planilla", () => {
    const destino = engancheDestinationFor(24)
    expect(destino?.module).toBe("inspecciones")
    expect(destino?.href("ws-1")).toContain("ws-1")
    expect(destino?.href("ws-1")).not.toContain("/prevencion/pdtp/")
  })
})
