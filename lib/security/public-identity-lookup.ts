/**
 * Superficies públicas que identifican a una persona por RUT.
 *
 * COM-003 / PPA-002 / AUTH-001 (auditoría 2026-09-14) son el mismo defecto en
 * tres puertas distintas: un endpoint sin autenticar que responde de forma
 * *distinguible* según si el RUT existe, y que además regala los aciertos —
 * sólo el fallo consumía cuota—. Con eso, quien tiene una lista de RUT
 * plausibles (en Chile son semi-públicos) confirma sin límite quién pertenece a
 * una faena: cada acierto sale gratis y sólo los diez errores de la lista topan
 * el contador.
 *
 * Este módulo concentra las tres piezas de la respuesta uniforme para que las
 * dos superficies de identificación por RUT (`/api/tae/identity` y la acción
 * pública del PPA) no vuelvan a divergir:
 *
 *  1. `PUBLIC_IDENTITY_LOOKUP_UNIFORM_MESSAGE`: un único cuerpo para TODOS los
 *     rechazos posteriores a la validación de formato — RUT que no está, enlace
 *     inválido, faena equivocada—. Antes cada rama tenía su texto y el propio
 *     mensaje decía "…con este RUT en esta faena", que es exactamente el dato
 *     que no debe confirmarse.
 *  2. `consumePublicIdentityLookupQuota`: cuota de ventana fija que cuenta
 *     TAMBIÉN los aciertos. Es lo que convierte la enumeración en algo acotado:
 *     el presupuesto se gasta igual acierte o falle.
 *  3. `settleUniformIdentityLookupLatency`: piso de latencia común. La rama "no
 *     encontrado" hacía una escritura extra (`recordFailure`) y la rama de
 *     acierto otra distinta; el tiempo de respuesta era, por sí solo, un
 *     oráculo.
 *
 * DECISIÓN PENDIENTE DE PLATAFORMA (no se inventa aquí): con una respuesta
 * exitosa que devuelve el nombre, la pertenencia a la faena sigue siendo
 * observable para quien acierta un RUT dentro del presupuesto. Eliminar del
 * todo esa señal exige un segundo factor de identificación (por ejemplo fecha
 * de nacimiento o un código entregado en faena) o renunciar a la
 * autocompletación pública. Esa es una decisión de producto y no se toma en
 * esta remediación: lo que sí queda cerrado es que la señal ya no es gratuita
 * ni distinguible en las ramas de rechazo.
 */

import { consumeFixedWindowLimit } from "@/lib/services/rate-limit"

/**
 * Cuota por IP de las identificaciones públicas por RUT.
 *
 * El umbral tolera a una faena entera detrás de un solo NAT —el criterio que ya
 * usaba `SUBMIT_IP_QUOTA` del envío PPA— y a la vez acota la enumeración a 30
 * confirmaciones cada 15 minutos desde una misma IP. El número exacto es una
 * constante de sintonía, no una regla declarada por la plataforma: si operación
 * define un objetivo distinto, se cambia aquí y aplica a las dos superficies.
 */
export const PUBLIC_IDENTITY_LOOKUP_QUOTA = { maxAttempts: 30, lockMs: 15 * 60 * 1000 } as const

/** Único cuerpo de rechazo posterior a la validación de formato del RUT. */
export const PUBLIC_IDENTITY_LOOKUP_UNIFORM_MESSAGE =
  "No pudimos identificarte automáticamente. Revisa el RUT o continúa ingresando tus datos manualmente."

/** Mensaje de cuota agotada (no revela existencia: es idéntico acierte o falle). */
export const PUBLIC_IDENTITY_LOOKUP_QUOTA_MESSAGE =
  "Demasiadas consultas desde esta conexión. Intenta de nuevo en 15 minutos."

/** Piso de latencia común a la rama de acierto y a la de rechazo. */
export const PUBLIC_IDENTITY_LOOKUP_MIN_LATENCY_MS = 120

/**
 * Consume una unidad de la cuota ANTES de saber el resultado, para que acertar
 * y fallar cuesten lo mismo. Devuelve `false` cuando el presupuesto se agotó.
 */
export async function consumePublicIdentityLookupQuota(key: string): Promise<boolean> {
  const { allowed } = await consumeFixedWindowLimit(key, PUBLIC_IDENTITY_LOOKUP_QUOTA)
  return allowed
}

/**
 * Espera hasta completar el piso de latencia. `startedAt` es el `Date.now()`
 * tomado justo antes de la búsqueda; la diferencia entre "existe" y "no existe"
 * (una consulta más, una escritura menos) queda por debajo de lo perceptible.
 */
export async function settleUniformIdentityLookupLatency(startedAt: number): Promise<void> {
  const elapsed = Date.now() - startedAt
  if (elapsed >= PUBLIC_IDENTITY_LOOKUP_MIN_LATENCY_MS) return
  await new Promise((resolve) => setTimeout(resolve, PUBLIC_IDENTITY_LOOKUP_MIN_LATENCY_MS - elapsed))
}
