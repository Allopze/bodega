"use client"

import Link from "next/link"
import { SummaryBar, type SummaryLinkProps, type SummaryStat } from "@/components/ui/summary-bar"

/**
 * Las cifras de esta tira FILTRAN la lista que tiene debajo: navegan con `replace`
 * y sin mover el scroll (AGENTS, «Navigation and scroll preservation»), porque son
 * un cambio de vista y no una navegación. A nivel de módulo: `SummaryBar` es `memo`
 * y un `renderLink` nuevo en cada render lo invalidaría.
 */
function ReplaceLink({ href, className, children, ...rest }: SummaryLinkProps) {
  return <Link href={href} replace scroll={false} className={className} {...rest}>{children}</Link>
}

/**
 * `SummaryBar` para indicadores que aplican un filtro de la misma pantalla. Recibe
 * las cifras ya armadas (datos planos, así que se puede armar en el servidor).
 */
export function FilterSummaryBar({ stats, className }: { stats: SummaryStat[]; className?: string }) {
  return <SummaryBar stats={stats} className={className} renderLink={ReplaceLink} />
}
