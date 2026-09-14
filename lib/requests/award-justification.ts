/**
 * Por qué se eligió esta oferta y no otra.
 *
 * `COT-002` (auditoría 2026-09-14). Al adjudicar viajaban dos identificadores y
 * nada más. La decisión guardaba el texto automático «Cotización seleccionada:
 * …», que dice **cuál** oferta se marcó y no **por qué**. La auditoría podía
 * probar la elección, no distinguir una decisión por plazo, calidad o
 * condiciones de una equivocación.
 *
 * **Qué política se aplica y por qué esta.** Exigir un fundamento en cada
 * adjudicación convierte el campo en trámite: quien adjudica la oferta más
 * barata entre tres escribe «la más barata» cien veces y nadie lo lee. La
 * excepción que sí necesita explicación es objetiva y el sistema la reconoce
 * solo: **adjudicar una oferta que no es la más económica**. Ahí el motivo es
 * obligatorio; en el resto es opcional y, si se escribe, se guarda igual. Es la
 * lectura estrecha de «al menos para excepciones que la política defina» que
 * hace la ficha, y deja la política más amplia disponible sin haberla inventado.
 */

import { isValidReason, reasonRequiredMessage } from "@/lib/validation/reason-thresholds"

export class AwardJustificationRequired extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AwardJustificationRequired"
  }
}

export interface OfferAmount {
  id: string
  totalAmount: number | string | null
}

function amountOf(offer: OfferAmount): number {
  const value = Number(offer.totalAmount ?? Number.NaN)
  return Number.isFinite(value) ? value : Number.NaN
}

/**
 * La oferta más económica entre las que compiten. Devuelve `null` cuando no hay
 * con qué comparar: una sola oferta, o importes que no son números.
 */
export function cheapestOffer(offers: OfferAmount[]): OfferAmount | null {
  const comparable = offers.filter((offer) => Number.isFinite(amountOf(offer)))
  if (comparable.length < 2) return null
  return comparable.reduce((best, offer) => (amountOf(offer) < amountOf(best) ? offer : best))
}

/**
 * ¿Esta adjudicación es la excepción que hay que explicar? Sólo si hay con qué
 * comparar y la elegida no es la más barata. Con una sola oferta no hay
 * elección que justificar, y con importes ilegibles el sistema no puede
 * afirmar que exista una más barata.
 */
export function requiresAwardJustification(chosenId: string, offers: OfferAmount[]): boolean {
  const cheapest = cheapestOffer(offers)
  if (!cheapest) return false
  if (cheapest.id === chosenId) return false
  const chosen = offers.find((offer) => offer.id === chosenId)
  if (!chosen || !Number.isFinite(amountOf(chosen))) return false
  // Empate en el importe más bajo: no es una excepción, es indiferencia de precio.
  return amountOf(chosen) > amountOf(cheapest)
}

/** Comprueba la política y devuelve el motivo ya saneado, o `null` si no hubo. */
export function validateAwardJustification(
  chosenId: string,
  offers: OfferAmount[],
  justification: string | null | undefined,
): string | null {
  const trimmed = (justification ?? "").trim()
  const required = requiresAwardJustification(chosenId, offers)

  if (required && !isValidReason(trimmed)) {
    throw new AwardJustificationRequired(
      trimmed.length === 0
        ? "Estás adjudicando una oferta que no es la más económica: explica por qué en al menos 10 caracteres"
        : reasonRequiredMessage("por qué se adjudica esta oferta y no la más económica"),
    )
  }
  if (!required && trimmed.length > 0 && !isValidReason(trimmed)) {
    throw new AwardJustificationRequired(reasonRequiredMessage("por qué se adjudica esta oferta"))
  }
  return trimmed.length > 0 ? trimmed : null
}

/**
 * El texto que queda en la decisión. Conserva el formato anterior —la identidad
 * de la oferta— y le añade el fundamento cuando existe, en vez de sustituirlo:
 * lo que ya se leía en el historial se sigue leyendo igual.
 */
export function describeAwardDecision(
  offerLabel: string,
  justification: string | null,
): string {
  const base = `Cotización seleccionada: ${offerLabel}`
  return justification ? `${base}. Fundamento: ${justification}` : base
}
