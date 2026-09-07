/**
 * lib/services/purchasing-module/order-reference.ts
 *
 * Vocabulario único de "qué tan utilizable es la referencia de OC que el
 * proveedor escribió en el XML". Lo consumen tres superficies —el ranking de
 * candidatos, el badge de la lista y el reporte de conciliación— y sin un solo
 * lugar terminarían nombrando distinto la misma cosa.
 *
 * Sin dependencias a propósito: lo importa un componente de cliente y no puede
 * arrastrar el parser de XML ni la base de datos al bundle.
 */

/** De más fuerte a más débil. Ver `classifyOrderReference` en `dte-candidates.ts`. */
export type DteCandidateOrderReference = "exact" | "correlative" | "year" | "foreign" | "none"

/**
 * `badge` null significa "no se dibuja nada en la lista de candidatos".
 *
 * `foreign` es el 86% de los documentos reales —el proveedor cita su propia
 * numeración interna— y `none` no aporta nada: un badge en cualquiera de los
 * dos sería ruido en casi todas las filas. En el reporte sí se nombran, porque
 * ahí la columna existe igual y una celda vacía se lee como dato faltante.
 */
export const ORDER_REFERENCE_META: Record<
  DteCandidateOrderReference,
  { label: string; badge: "success" | "info" | "warning" | null }
> = {
  exact:       { label: "Cita esta OC",          badge: "success" },
  correlative: { label: "Cita el N° de esta OC", badge: "info"    },
  year:        { label: "Sólo el año",           badge: "warning" },
  foreign:     { label: "Cita algo ajeno",       badge: null      },
  none:        { label: "No citó ninguna OC",    badge: null      },
}

/**
 * Etiqueta para el reporte. NULL no es `none`: significa que nadie miró un XML
 * —una factura cargada a mano como PDF—, y decir "no citó" sería inventarlo.
 */
export function orderReferenceLabel(value: DteCandidateOrderReference | null | undefined): string {
  return value ? ORDER_REFERENCE_META[value].label : "Sin XML"
}

/** Cómo llegó la factura a colgar de la OC. */
export const LINK_METHOD_LABELS: Record<string, string> = {
  legacy:        "Histórica",
  manual_upload: "Carga manual",
  dte_candidate: "Desde el portal",
}

export function linkMethodLabel(value: string | null | undefined): string {
  return value ? LINK_METHOD_LABELS[value] ?? value : "—"
}
