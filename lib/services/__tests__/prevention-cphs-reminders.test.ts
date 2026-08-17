import { describe, expect, it } from "vitest"
import { selectMandateWarningThreshold } from "@/lib/services/prevention-cphs-reminders"

describe("selectMandateWarningThreshold", () => {
  it.each([
    ["2026-10-01", 60],
    ["2026-09-10", 30],
    ["2026-08-20", 7],
    ["2026-11-01", null],
  ] as const)("para vencimiento %s usa el umbral %s", (mandateEndsOn, expected) => {
    expect(selectMandateWarningThreshold(mandateEndsOn, "2026-08-14")).toBe(expected)
  })
})

/**
 * CPHS-04: la cadencia de sesiones se medía con dos relojes distintos — la
 * pantalla leía `heldAt` (cuándo sesionó el comité) y el job de recordatorios
 * `closedAt` (cuándo se firmó el acta), así que un acta de enero firmada en
 * marzo daba el comité "al día" en marzo y el aviso nunca salía.
 *
 * Es una divergencia entre dos archivos: ninguna prueba de comportamiento sobre
 * uno solo la detecta, y el job no tiene hoy banco de pruebas propio. Se fija
 * sobre la fuente, igual que la regresión de `getUTCFullYear()` de la Fase 2:
 * lo que importa es que ambos consulten la MISMA columna.
 */
describe("cadencia de sesiones: una sola fuente de verdad", () => {
  it("el job de recordatorios y la pantalla miden la última sesión por `heldAt`", async () => {
    const { readFileSync } = await import("node:fs")

    const job = readFileSync("lib/services/prevention-cphs-reminders.ts", "utf8")
    expect(job).toMatch(/max\(preventionCommitteeMeetings\.heldAt\)/)
    expect(job).not.toMatch(/max\(preventionCommitteeMeetings\.closedAt\)/)

    // `getCommitteeStatus` ordena por la misma columna para elegir la última
    // sesión cerrada y se la pasa a `assessMeetingCadence`.
    const service = readFileSync("lib/services/prevention-cphs.ts", "utf8")
    expect(service).toMatch(/orderBy\(desc\(preventionCommitteeMeetings\.heldAt\)\)/)
  })
})
