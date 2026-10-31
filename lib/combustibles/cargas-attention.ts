/**
 * La tira de señales de terreno que va sobre la lista de Cargas: cuatro cifras de los
 * registros en terreno que piden una mirada (por validar, con observación, con el sello
 * incompleto y con menos de las 4 fotos), cada una un atajo a su filtro. Módulo puro: la
 * página trae las cifras (`getFieldLoadAttention`) y la URL, y pinta lo que sale de aquí con
 * `FilterSummaryBar`.
 *
 * Por qué cumple A5 («una dimensión = una representación interactiva»): las cifras viven
 * SÓLO en esta tira (el `Select` de estado de la barra de filtros no lleva contadores, y no
 * hay un tile ni una pestaña más por estado), y cada celda no es un control aparte sino un
 * atajo al MISMO parámetro de URL que ya escribe el control de la barra (`estado`) o su casilla
 * de «Más filtros» (`sello`, `evidencia`). Una cifra, un lugar; un filtro, un parámetro.
 *
 * Las cifras se cuentan sin los cuatro filtros de atención (ver `getFieldLoadAttention`), de
 * modo que no se desploman al activar uno. Por eso un atajo se SUMA a los demás filtros de la
 * URL: con `estado=validada` activo, «Sello incompleto» muestra todas las del período y al
 * pulsarlo quedan las validadas con el sello incompleto.
 */
import type { SummaryStat } from "@/components/ui/summary-bar"
import { withCargasParams, type CargasSearchParams } from "@/lib/combustibles/fuel-log-params"
import { FUEL_LOAD_STATE_LABEL, type FieldLoadAttention } from "@/lib/combustibles/fuel-log-shared"

/**
 * Una cifra con algo que mirar es un número naranja que filtra la lista; en cero dice
 * «Ninguna» y no es un enlace (no hay filas a las que llevar). Un «0» pelado se lee como
 * un dato que falta; «Ninguna» dice que no hay nada que atender.
 */
function attentionCell(searchParams: CargasSearchParams, key: string, label: string, count: number, patch: Record<string, string>): SummaryStat {
  if (count > 0) return { key, label, value: count, tone: "signal", href: withCargasParams(searchParams, patch) }
  return { key, label, value: "Ninguna", valueKind: "text" }
}

/**
 * Las cuatro celdas de la tira, en el orden en que se atienden: primero lo que espera una
 * decisión y después lo que está incompleto. `searchParams` es la URL actual de Cargas: los
 * enlaces la conservan (período, faena, búsqueda…), cambian el parámetro de su filtro y sueltan
 * la página. Las dos de estado rotulan con el mismo vocabulario que el `Select` y los chips.
 */
export function buildFieldAttentionStats(attention: FieldLoadAttention, searchParams: CargasSearchParams): SummaryStat[] {
  return [
    attentionCell(searchParams, "por-validar", FUEL_LOAD_STATE_LABEL["por-validar"], attention.toValidate, { estado: "por-validar" }),
    attentionCell(searchParams, "con-observacion", FUEL_LOAD_STATE_LABEL["con-observacion"], attention.observed, { estado: "con-observacion" }),
    attentionCell(searchParams, "sello-incompleto", "Sello incompleto", attention.sealIncomplete, { sello: "faltante" }),
    attentionCell(searchParams, "menos-de-4-fotos", "Menos de 4 fotos", attention.photosIncomplete, { evidencia: "faltante" }),
  ]
}
