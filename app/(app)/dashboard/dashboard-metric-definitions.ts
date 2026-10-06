/**
 * Rótulos y definición de las cifras que el tablero muestra en más de una vista.
 *
 * INI-01 (auditoría 2026-10-05): "OC emitidas" daba 0, 2 y 2 con período Mes (y
 * 28 contra 29 con Año) porque cada vista armaba su propia consulta. Ahora una
 * sola función cuenta (`getOperationalPeriodMetrics`, con `issuedOrderPredicate`)
 * y este archivo fija **el nombre y la explicación** que acompañan a esa cifra,
 * para que la misma etiqueta no vuelva a significar dos cosas.
 *
 * Definición: una OC está emitida cuando salió de borrador y no fue anulada ni
 * eliminada; se fecha por su día de emisión (`issuedAt`), no por el de creación.
 */
export const ORDERS_ISSUED_METRIC = {
  label: "OC emitidas",
  glossary: "Órdenes de compra que salieron de borrador en el período, según su fecha de emisión. No cuenta borradores, anuladas ni eliminadas.",
} as const

export const ORDERS_SPEND_METRIC = {
  label: "Gasto en OC",
  glossary: "Suma del total de las OC emitidas en el período (misma definición que «OC emitidas»).",
} as const

/** Gasto en OC: una variación de dinero que sube es malo (A6/KpiCard `trendPolarity`). */
export const ORDERS_SPEND_TREND_POLARITY = "up-bad" as const
