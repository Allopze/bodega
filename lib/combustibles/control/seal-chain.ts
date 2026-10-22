import type { SealChainStatus } from "./contracts"
import { normalizeSeal } from "./validation"

/**
 * Cadena de sellos de un equipo: el sello que se retira en esta carga debe ser
 * el que se instaló en la carga anterior del mismo equipo. Si no lo es, el
 * estanque se abrió entre medio sin registro.
 *
 * - `previousInstalledSeal === undefined` → no hay carga anterior con la que
 *   comparar (`no_previous`).
 * - `null` → hubo carga anterior, pero quedó sin sello instalado.
 *
 * La comparación usa la forma canónica (`normalizeSeal`): «0504» y «504» son el
 * mismo sello. `expected` es lo que debió retirarse, para mostrarlo al revisor.
 */
export function evaluateSealChain(
  current: { removedSeal: string | null; installedSeal: string | null; noSealReason: string | null },
  previousInstalledSeal: string | null | undefined,
): { status: SealChainStatus; expected: string | null } {
  const removed = normalizeSeal(current.removedSeal)
  const installed = normalizeSeal(current.installedSeal)

  if (removed === null && installed === null && (current.noSealReason ?? "").trim() !== "") {
    return { status: "no_seal", expected: null }
  }
  if (previousInstalledSeal === undefined) {
    return { status: "no_previous", expected: null }
  }

  const expected = normalizeSeal(previousInstalledSeal)
  if (expected === null) return { status: "ok", expected: null }

  // Retiró un sello distinto del instalado, o empezó sin romper el que esperaba.
  if (removed === null || removed !== expected) {
    return { status: "mismatch", expected: previousInstalledSeal?.trim() ?? expected }
  }
  return { status: "ok", expected: null }
}
