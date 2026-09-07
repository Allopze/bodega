/**
 * lib/services/purchasing-module/money-tolerance.ts
 *
 * Único lugar donde vive cuánto puede diferir un monto antes de considerarse
 * una discrepancia real.
 *
 * Existía por triplicado —`CLP_RECONCILIATION_TOLERANCE` en el motor de
 * conciliación, `AMOUNT_TOLERANCE_CLP` en el ranking de candidatos y
 * `AUTO_MATCH_AMOUNT_TOLERANCE_CLP` en el cotejo masivo del portal—, las tres
 * con el mismo valor y ninguna relación declarada entre sí. Aflojar una y
 * olvidar las otras dejaba al sistema aceptando una diferencia en una pantalla
 * y rechazándola en la siguiente.
 */

/**
 * Ruido de redondeo, en pesos. El CLP no tiene decimales: cualquier diferencia
 * mayor que un peso la produjo alguien, no la aritmética.
 */
export const CLP_ROUNDING_TOLERANCE = 1

/**
 * Tolerancia del vínculo automático DTE ↔ factura, que ocurre sin que ninguna
 * persona lo mire.
 *
 * Se declara aparte a propósito, aunque hoy valga lo mismo: la conciliación
 * puede necesitar aflojarse algún día (un proveedor que factura con flete
 * prorrateado), y el vínculo automático **no debe seguirla**. El test de este
 * módulo fija esa dirección.
 */
export const AUTO_LINK_CLP_TOLERANCE = CLP_ROUNDING_TOLERANCE
