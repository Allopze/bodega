/**
 * Cuánto texto exige la plataforma cuando alguien hace algo irreversible.
 *
 * Patrón P6 de la auditoría 2026-09-14. El umbral dependía de quién había
 * escrito cada formulario: **1** carácter para ajustar inventario (`STK-002`),
 * **5** para anular una guía de despacho (`GDI-003`), **10** para anular una
 * entrega, regularizar una integridad, aceptar una diferencia de facturación o
 * cerrar una faena, y **ninguno** para rechazar un trabajo detenido
 * (`PPAI-002`), declarar controles implementados (`PPAI-003`) o cerrar un ticket
 * (`TIT-002`).
 *
 * El reparto no seguía ninguna lógica de riesgo. Al revés: la operación con
 * menos control —fijar cualquier saldo de inventario sin documento de origen—
 * era la que menos explicación pedía.
 *
 * Aquí hay **un** número, y es el que la mayoría de la plataforma ya usaba, así
 * que la mayoría de los `check` en base no cambia. Diez caracteres no garantizan
 * una buena explicación —nada lo hace—, pero descartan el punto y la letra
 * sueltos, que es la diferencia entre un campo obligatorio y un trámite.
 */

import { z } from "zod"

/** Mínimo para justificar un acto irreversible. */
export const REASON_MIN_LENGTH = 10

/**
 * Máximo. El motivo se lee en una tabla y en un correo, no es un informe; los
 * `check` existentes ya usaban 1000 o 2000, y 1000 es el más común.
 */
export const REASON_MAX_LENGTH = 1000

/**
 * El campo de motivo, con el mensaje ya redactado. `what` completa la frase
 * «Explica ...» y por eso va en infinitivo o como sustantivo: «por qué se anula
 * la guía», «el ajuste de inventario».
 */
export function reasonSchema(what: string) {
  return z.string()
    .trim()
    .min(REASON_MIN_LENGTH, `Explica ${what} en al menos ${REASON_MIN_LENGTH} caracteres`)
    .max(REASON_MAX_LENGTH, `El motivo no puede superar ${REASON_MAX_LENGTH} caracteres`)
}

/** La misma regla fuera de zod, para los servicios que validan a mano. */
export function isValidReason(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim()
  return trimmed.length >= REASON_MIN_LENGTH && trimmed.length <= REASON_MAX_LENGTH
}

/** El mensaje, para quien no usa zod y quiere decir lo mismo. */
export function reasonRequiredMessage(what: string): string {
  return `Explica ${what} en al menos ${REASON_MIN_LENGTH} caracteres`
}
