import { z } from "zod"

/**
 * Mensajes de Zod en español para toda la aplicación.
 *
 * Buena parte de los esquemas declara reglas sin mensaje propio (`min(10)`,
 * `uuid()`): sin locale, esos mensajes salen en inglés («Too small: expected
 * string to have >=10 characters») y no se pueden mostrar al usuario, así que
 * `safeActionMessage` los tapaba con un texto genérico y la persona nunca sabía
 * qué corregir. Con el locale, `actionErrorResult` puede mostrarlos tal cual.
 *
 * `z.config` escribe en `globalThis.__zod_globalConfig`, compartido por todas
 * las copias del módulo en el proceso: basta llamarlo una vez por runtime
 * (servidor en `instrumentation.ts`, cliente en `use-client-validation`). Los
 * mensajes propios de cada esquema siguen teniendo prioridad.
 */
export function configureZodLocale(): void {
  z.config(z.locales.es())
}
