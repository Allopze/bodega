/**
 * Conciliación por mandante (C-02): entrada − (entregado directo + entregado
 * desde estanque). La diferencia porcentual es sobre la entrada; sin entrada no
 * hay porcentaje (null), porque dividir por cero no es «0 % de diferencia».
 */
export interface ReconciliationInput {
  inputLiters: number
  directLiters: number
  viaTankLiters: number
  tolerancePct: number
}

export interface ReconciliationResult {
  deliveredLiters: number
  differenceLiters: number
  differencePct: number | null
  /** null cuando no hay entrada contra la cual medir. */
  withinTolerance: boolean | null
}

export function reconcile({ inputLiters, directLiters, viaTankLiters, tolerancePct }: ReconciliationInput): ReconciliationResult {
  const deliveredLiters = directLiters + viaTankLiters
  const differenceLiters = inputLiters - deliveredLiters
  if (inputLiters <= 0) {
    return { deliveredLiters, differenceLiters, differencePct: null, withinTolerance: deliveredLiters === 0 ? null : false }
  }
  const differencePct = (differenceLiters / inputLiters) * 100
  return { deliveredLiters, differenceLiters, differencePct, withinTolerance: Math.abs(differencePct) <= tolerancePct }
}
