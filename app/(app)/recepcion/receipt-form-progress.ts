import type { ReceiptOcItem } from "./receipt-form.types"

export interface StageProgress {
  office:         string
  faena:          string
  officeComplete: boolean
  faenaComplete:  boolean
}

/**
 * Avance de cada etapa, en texto listo para pintar.
 *
 * Antes esto era un stepper propio (`1 → 2`) que vivía encima del selector de
 * etapa: dos bloques parecidos, uno que informaba y otro que decidía, y el que
 * informaba parecía clicable sin serlo. Ahora el selector es el único control y
 * muestra su propio avance (A5 de AGENTS.md: una dimensión, una representación).
 */
export function describeStageProgress(
  items: ReceiptOcItem[],
  deliveryMode: "via_oficina" | "directo_faena",
): StageProgress {
  const totalOrdered        = items.reduce((n, i) => n + i.quantity, 0)
  const totalOfficeReceived = items.reduce((n, i) => n + i.quantityOfficeReceived, 0)
  const totalFaenaReceived  = items.reduce((n, i) => n + i.quantityReceived, 0)

  // Sumar cantidades de líneas con unidades distintas da un número sin
  // significado ("12 par + 5 rollo = 17 un."). Sólo se muestran totales cuando
  // toda la OC comparte unidad; si no, se cuentan líneas, que sí es comparable
  // (auditoría UI/UX 2026-07-29, A-09).
  const units = new Set(items.map((i) => i.unitOfMeasure))
  const unit  = units.size === 1 ? [...units][0]! : null

  const linesOrdered  = items.length
  const linesInOffice = items.filter((i) => i.quantityOfficeReceived > 0).length
  const linesInFaena  = items.filter((i) => i.quantityReceived > 0).length

  const ratio = (received: number, lines: number) =>
    unit ? `${received} / ${totalOrdered} ${unit}` : `${lines} / ${linesOrdered} líneas`
  const done = (received: number, lines: number) =>
    unit ? `${received} ${unit} · completo` : `${lines} línea${lines === 1 ? "" : "s"} · completo`

  const officeComplete   = totalOfficeReceived >= totalOrdered && totalOrdered > 0
  const officeInProgress = totalOfficeReceived > 0 && !officeComplete
  const pendingDispatch  = Math.max(0, totalOfficeReceived - totalFaenaReceived)

  // `pendingDispatch === 0` sólo dice "no queda nada por despachar **de lo que
  // llegó**". Sin exigir que la oficina esté completa, una OC con 6 de 12
  // unidades recibidas y esas 6 despachadas se anunciaba como "Completo",
  // contradiciendo a la tarjeta "Recepción en faena" que seguía deshabilitada
  // justo debajo (A-08). En despacho directo la mercadería nunca pasa por
  // oficina, así que ahí la referencia es lo pedido.
  const faenaComplete = deliveryMode === "directo_faena"
    ? totalFaenaReceived >= totalOrdered && totalOrdered > 0
    : officeComplete && pendingDispatch === 0

  const office = officeComplete
    ? done(totalOfficeReceived, linesInOffice)
    : officeInProgress
      ? ratio(totalOfficeReceived, linesInOffice)
      : "Pendiente"

  const faena = faenaComplete
    ? done(totalFaenaReceived, linesInFaena)
    : deliveryMode === "directo_faena"
      ? totalFaenaReceived > 0 ? ratio(totalFaenaReceived, linesInFaena) : "Pendiente"
      : pendingDispatch > 0
        ? `${unit ? `${pendingDispatch} ${unit}` : "Hay líneas"} por despachar`
        : "Pendiente"

  return { office, faena, officeComplete, faenaComplete }
}
