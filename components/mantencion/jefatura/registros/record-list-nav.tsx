import Link from "next/link"
import { ArrowLeft, CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { recordDetailHref } from "@/lib/services/mantencion/records-filters"
import type { RecordNeighbors } from "@/lib/services/mantencion/records-query"

/**
 * «Volver a la lista» y «Anterior · N de M · Siguiente» del detalle, cuando se
 * llegó desde la lista. Anterior y siguiente son los de ESA lista —mismos
 * filtros, mismo orden— y llevan consigo el contexto para poder seguir. Van con
 * `replace`: recorrer una cola de revisión no apila una entrada de historial por
 * registro, y «Atrás» vuelve a la lista.
 *
 * Es de servidor: son enlaces, y el primer pintado ya navega.
 */
export function RecordListNav({ listHref, listQuery, neighbors }: { listHref: string; listQuery: string; neighbors: RecordNeighbors | null }) {
  return (
    <nav aria-label="Lista de registros" className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Button asChild variant="ghost" size="sm">
        <Link href={listHref}>
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          Volver a la lista
        </Link>
      </Button>
      {neighbors && (
        <div className="flex items-center gap-1">
          <Step direction="previous" target={neighbors.previous} listQuery={listQuery} />
          <p className="min-w-[4.5rem] whitespace-nowrap px-1 text-center text-xs text-[var(--color-text-muted)]">
            <span className="font-mono font-semibold tabular-nums text-[var(--color-text)]">{neighbors.position}</span>
            {" de "}
            <span className="font-mono tabular-nums">{neighbors.total}</span>
          </p>
          <Step direction="next" target={neighbors.next} listQuery={listQuery} />
        </div>
      )}
    </nav>
  )
}

function Step({ direction, target, listQuery }: { direction: "previous" | "next"; target: RecordNeighbors["next"]; listQuery: string }) {
  const previous = direction === "previous"
  const label = previous ? "Anterior" : "Siguiente"
  const icon = previous
    ? <CaretLeft className="h-3.5 w-3.5 shrink-0" weight="bold" aria-hidden />
    : <CaretRight className="h-3.5 w-3.5 shrink-0" weight="bold" aria-hidden />
  const content = previous ? <>{icon}{label}</> : <>{label}{icon}</>
  if (!target) {
    return <Button variant="secondary" size="sm" disabled>{content}</Button>
  }
  return (
    <Button asChild variant="secondary" size="sm">
      <Link href={recordDetailHref(target.id, listQuery)} replace aria-label={`${label}: ${target.folio ?? "registro sin folio"}`}>
        {content}
      </Link>
    </Button>
  )
}
