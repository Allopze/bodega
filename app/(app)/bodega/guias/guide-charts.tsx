import Link from "next/link"
import { AgingBar, type AgingBucket } from "@/components/charts/aging-bar"
import { ChartSection } from "@/components/charts/chart-section"
import { RankedList } from "@/components/ui/ranked-list"
import {
  GUIDE_AGE_BUCKETS,
  GUIDE_MIN_N,
  GUIDE_MIN_N_P90,
  formatTransitDays,
  guideAgeHref,
  guideAgeSummary,
  guideDestinationHref,
  transitSummary,
  transitTable,
  type GuideAgeCounts,
  type GuideAgeFilter,
  type GuideTransitShape,
} from "@/lib/bodega/guide-transit"

/**
 * CHART-037 · las dos preguntas que la lista de guías no contesta: qué destino
 * tarda en confirmar y cuánto llevan esperando las que siguen por confirmar.
 *
 * Van **encima** de la lista y no la reemplazan: confirmar una guía es una decisión
 * sobre una fila y se sigue haciendo en la ficha. Cada barra de espera filtra la
 * lista (`?antiguedad=`) y cada destino lleva a sus guías confirmadas. Con RankedList
 * (un solo tono): el color no codifica nada acá, el largo sí.
 */
export function GuideCharts({
  transit,
  windowText,
  from,
  to,
  ageCounts,
  ageActive,
  faena,
}: {
  transit: GuideTransitShape
  /** Período de la medición, encabezando la frase («En los últimos 6 meses»). */
  windowText: string
  from: string
  to?: string
  ageCounts: GuideAgeCounts
  /** Tramo vigente en la URL; `""` si la lista no está filtrada por antigüedad. */
  ageActive: GuideAgeFilter
  /** Faena de destino a la vista (`""` = todas). */
  faena: string
}) {
  const agedTotal = Object.values(ageCounts).reduce((sum, count) => sum + count, 0)
  if (transit.destinations.length === 0 && agedTotal === 0) return null

  const summary = transitSummary(transit, windowText)
  const table = transitTable(transit)
  const buckets: AgingBucket[] = GUIDE_AGE_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: ageCounts[bucket.key],
    active: ageActive === bucket.key,
    // Elegir el tramo vigente otra vez es la salida: quita el filtro.
    href: guideAgeHref(ageActive === bucket.key ? "" : bucket.key, faena),
  }))

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartSection
        title="Cuánto tardan los destinos en confirmar"
        summary={summary}
        data={{ caption: "Días entre el despacho y la confirmación, por destino", headers: table.headers, rows: table.rows }}
        empty={transit.destinations.length > 0 ? null : {
          label: "Ninguna guía confirmada en este período",
          hint: "Cuando un destino confirme la recepción de una guía, aquí verás cuántos días tardó.",
          ctaLabel: "Ver todas las guías",
          ctaHref: "/bodega/guias?estado=todos&faena=todas",
        }}
      >
        {transit.measured.length > 0 && (
          <RankedList
            ariaLabel="Mediana de días hasta confirmar la recepción, por destino"
            format="count"
            unit=" días"
            mode="share"
            order="desc"
            showShare={false}
            limit={10}
            items={transit.measured.map((destination) => ({
              key: destination.worksiteId,
              label: destination.worksiteName,
              // Un decimal, como la frase: «11,888 d» venía del formato de cantidades (3 decimales).
              value: Math.round((destination.median ?? 0) * 10) / 10,
              detail: destination.p90 !== null
                ? `P90 ${formatTransitDays(destination.p90)} · n = ${destination.confirmed}`
                : `n = ${destination.confirmed} · P90 desde ${GUIDE_MIN_N_P90} guías`,
              href: guideDestinationHref(destination.worksiteId, from, to),
            }))}
          />
        )}
        {transit.insufficient.length > 0 && (
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            <span className="font-semibold text-[var(--color-text)]">Datos insuficientes</span>{" "}
            (menos de {GUIDE_MIN_N} guías confirmadas):{" "}
            {transit.insufficient.map((destination) => `${destination.worksiteName} (n = ${destination.confirmed})`).join(", ")}.
          </p>
        )}
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          Mide los días entre el despacho y la confirmación de las guías emitidas en el período.
          P90: el 90&nbsp;% de las guías se confirmó en ese tiempo o menos. Las confirmadas con diferencias no entran: su fecha de recepción es la del último cotejo.
        </p>
      </ChartSection>

      <ChartSection
        title="Antigüedad de las guías por confirmar"
        summary={guideAgeSummary(ageCounts, ageActive)}
        aside={
          ageActive ? (
            <Link
              href={guideAgeHref("", faena)}
              replace
              scroll={false}
              className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-8"
            >
              Quitar filtro
            </Link>
          ) : undefined
        }
        data={{
          caption: "Guías despachadas sin confirmar, por antigüedad",
          headers: ["Antigüedad", "Guías"],
          rows: GUIDE_AGE_BUCKETS.map((bucket) => [bucket.label, ageCounts[bucket.key]]),
        }}
        empty={agedTotal > 0 ? null : {
          label: "No hay guías despachadas esperando confirmación",
          hint: "Cuando salga una guía hacia una faena, aquí verás cuánto lleva esperando.",
          ctaLabel: "Ver todas las guías",
          ctaHref: "/bodega/guias?estado=todos&faena=todas",
        }}
      >
        <AgingBar label="Guías despachadas sin confirmar, por antigüedad" unit="guías" buckets={buckets} inPlace />
        <p className="mt-3 text-xs text-[var(--color-text-muted)]">
          Días desde que salió la guía, sin importar el período elegido: la más antigua suele estar fuera de cualquier ventana.
        </p>
      </ChartSection>
    </div>
  )
}
