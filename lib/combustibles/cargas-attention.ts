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
import { countOf } from "@/lib/utils"
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
 * Las cuatro señales en cero: no hay nada que mirar en el período. Cuatro tiles que dicen
 * «Ninguna» son cuatro avisos para una sola buena noticia (auditoría UX-13, 2026-11-07), así
 * que la página pinta entonces una línea (`attentionClearText`) y no la tira. Basta UNA cifra
 * distinta de cero para volver a las cuatro celdas: ahí el «Ninguna» de las demás sí informa.
 */
export function isAttentionClear(attention: FieldLoadAttention): boolean {
  return attention.toValidate === 0 && attention.observed === 0 && attention.sealIncomplete === 0 && attention.photosIncomplete === 0
}

/**
 * La línea tranquila de «todo despejado». `inLabel` es la frase del período que ya resuelve la
 * página (`ResolvedFuelPeriod.inLabel`), SIN preposición: «noviembre», «la semana del 26 de
 * octubre», «el 3.er trimestre», «2026». La preposición «en» la pone esta función: antes se
 * esperaba dentro de `inLabel` y la frase salía «…completar noviembre».
 *
 * La línea no puede afirmar «nada pendiente» mientras la lista muestre cargas con algo abierto
 * (una marcada por revisar, un caso, un pedido): `pending` es cuántas hay con los mismos filtros
 * de la página, y si no es cero la frase las nombra en vez de contradecirlas.
 */
export function attentionClearText(inLabel: string, pending = 0): string {
  const when = `en ${inLabel}`
  if (pending > 0) return `Nada por validar ni completar ${when}; ${countOf(pending, "carga")} con algo pendiente`
  return `Nada por validar, observar ni completar ${when}`
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
