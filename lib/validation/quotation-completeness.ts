/**
 * Qué hace que una oferta esté completa.
 *
 * `COT-003` (auditoría 2026-09-14). La plataforma tenía dos puertas para cargar
 * una cotización y no pedían lo mismo. El borrador
 * (`actions-module/draft.ts`) descarta el archivo cuyo monto no es positivo o
 * que no identifica a su proveedor; el Server Action del panel usaba un schema
 * que sólo prohíbe el monto negativo y deja el proveedor opcional. El `required`
 * del formulario no protege nada: un Server Action se invoca sin navegador.
 *
 * El resultado era una fila «Proveedor sin nombre» por $0 que se puede
 * seleccionar y adjudicar. Las dos puertas usan ahora esta regla.
 */

import { z } from "zod"

/** Los campos de identidad e importe que toda oferta debe traer. */
export interface QuotationIdentity {
  totalAmount: number
  supplierId?: string | null
  supplierNameFree?: string | null
}

/**
 * Una oferta identifica a su proveedor con **una** de las dos vías: el
 * proveedor del maestro o el nombre libre de quien todavía no está dado de alta.
 * Ninguna de las dos es opcional cuando falta la otra.
 */
export function hasSupplierIdentity(input: QuotationIdentity): boolean {
  return Boolean(input.supplierId?.trim() || input.supplierNameFree?.trim())
}

/**
 * El importe tiene que ser positivo. Cero no es «gratis»: es el valor que deja
 * un campo vacío, y una oferta de $0 adjudicada origina una OC de $0.
 */
export function hasPositiveAmount(input: QuotationIdentity): boolean {
  return Number.isFinite(input.totalAmount) && input.totalAmount > 0
}

/** Qué le falta a esta oferta, en la voz de quien la carga. Vacío si está completa. */
export function quotationCompletenessProblems(input: QuotationIdentity): string[] {
  const problems: string[] = []
  if (!hasPositiveAmount(input)) problems.push("El monto de la cotización debe ser mayor que cero")
  if (!hasSupplierIdentity(input)) problems.push("Indica el proveedor de la cotización")
  return problems
}

export function isCompleteQuotation(input: QuotationIdentity): boolean {
  return quotationCompletenessProblems(input).length === 0
}

/**
 * Añade la regla a un schema de carga de cotización. Se aplica como refinamiento
 * y no como `min(1)` en cada campo porque la identidad del proveedor es una
 * condición **entre** dos campos: cualquiera de los dos sirve, ninguno solo es
 * obligatorio.
 */
export function withQuotationCompleteness<T extends z.ZodType>(schema: T) {
  return schema.superRefine((value: unknown, ctx: z.RefinementCtx) => {
    const input = value as QuotationIdentity
    if (!hasPositiveAmount(input)) {
      ctx.addIssue({
        code: "custom",
        path: ["totalAmount"],
        message: "El monto de la cotización debe ser mayor que cero",
      })
    }
    if (!hasSupplierIdentity(input)) {
      ctx.addIssue({
        code: "custom",
        path: ["supplierId"],
        message: "Indica el proveedor de la cotización",
      })
    }
  })
}
