import Link from "next/link"
import { AgingBar, type AgingBucket } from "@/components/charts/aging-bar"
import { ChartSection } from "@/components/charts/chart-section"
import { NOTE_AGE_BUCKETS, noteAgeSummary, type NoteAgeCounts } from "@/lib/mantencion/parts-notes-age"
import type { PartsNoteAgeKey } from "@/lib/services/mantencion/parts/types"
import { inboxHref, type RawSearchParams } from "./parts-notes-format"

/**
 * Antigüedad de lo que espera en la pestaña (fase 2, punto 4): cuántas notas llevan 0–2, 3–6, 7–13 o 14 días o más en su
 * estado actual (los mismos días de «En este estado hace X»). Cada tramo filtra la bandeja por `?antiguedad=` y el elegido
 * se marca; elegirlo otra vez lo quita. El color sólo expresa cuánto esperan (gris → rojo): no hay un control nuevo, el
 * gráfico ES el selector del filtro (A5).
 *
 * Es la foto del momento y cuenta lo mismo que lista la pestaña con el resto de los filtros, sin el de antigüedad. Sin
 * notas no se dibuja: la página ya dice qué significa el vacío.
 */
export function PartsNotesAgeChart({ counts, active, path, raw }: {
  counts: NoteAgeCounts
  /** Tramo vigente en la URL; `undefined` si la bandeja no está filtrada por antigüedad. */
  active: PartsNoteAgeKey | undefined
  path: string
  /** Parámetros de la URL: los enlaces de los tramos conservan la pestaña y los demás filtros. */
  raw: RawSearchParams
}) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
  if (total === 0) return null

  const buckets: AgingBucket[] = NOTE_AGE_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: counts[bucket.key],
    active: active === bucket.key,
    // Elegir el tramo vigente otra vez es la salida: quita el filtro.
    href: inboxHref(path, raw, { antiguedad: active === bucket.key ? null : bucket.key }),
  }))

  return (
    <ChartSection
      className="mb-3 p-4 md:p-4"
      title="Antigüedad en este estado"
      summary={noteAgeSummary(counts, active)}
      aside={
        active ? (
          <Link
            href={inboxHref(path, raw, { antiguedad: null })}
            replace
            scroll={false}
            className="inline-flex min-h-11 items-center text-xs font-semibold text-[var(--color-primary-ink)] hover:underline sm:min-h-8"
          >
            Quitar filtro
          </Link>
        ) : undefined
      }
      data={{ caption: "Notas de pedido por antigüedad en su estado actual", headers: ["Antigüedad", "Notas"], rows: NOTE_AGE_BUCKETS.map((bucket) => [bucket.label, counts[bucket.key]]) }}
    >
      <AgingBar label="Notas de pedido por antigüedad en su estado actual" unit="notas" buckets={buckets} inPlace />
    </ChartSection>
  )
}
