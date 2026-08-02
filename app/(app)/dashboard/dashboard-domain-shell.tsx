import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import type { DashboardDomain } from "./dashboard-domains"

/**
 * Índice de las secciones por dominio.
 *
 * Rail vertical pegajoso desde `2xl` y barra horizontal pegajosa debajo. Es un
 * `<nav>` propio y no `SegmentedControl` porque ese componente envuelve sus
 * items en un `flex flex-wrap` interno al que no llega ninguna `className`, así
 * que no se puede volver columna.
 *
 * *Por qué no rail siempre:* a 1280px el sidebar de la app ya se lleva 256px
 * —medido por el e2e de la auditoría anterior— y un rail de 180px más dejaría
 * los gráficos bajo 420px de ancho.
 */
export function DomainIndex({ domains }: { domains: DashboardDomain[] }) {
  if (domains.length < 2) return null

  return (
    <nav
      aria-label="Secciones del tablero"
      className={cn(
        "sticky top-0 z-10 -mx-1 flex gap-1.5 overflow-x-auto bg-[var(--color-bg)]/95 px-1 py-2 backdrop-blur",
        "2xl:top-4 2xl:mx-0 2xl:flex-col 2xl:overflow-visible 2xl:bg-transparent 2xl:px-0 2xl:backdrop-blur-none",
      )}
    >
      {domains.map((domain) => (
        <Link
          key={domain.key}
          href={`#${domain.anchor}`}
          className={cn(
            "shrink-0 rounded-lg px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] transition-colors",
            "hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]",
            "2xl:text-left",
          )}
        >
          {domain.title}
        </Link>
      ))}
    </nav>
  )
}

/**
 * Una sección de dominio: KPIs arriba, gráficos abajo, enlaces al módulo.
 *
 * Los enlaces cierran G-03: los ocho gráficos anteriores no llevaban a ninguna
 * parte y `/analitica` —la pantalla con el detalle filtrable— no estaba
 * enlazada desde ningún punto del dashboard.
 *
 * **La sección no declara un período propio.** Lo hizo en una primera versión y
 * fue el hallazgo L-07/G-04.4 otra vez: "Adquisiciones · Mes en curso"
 * encabezaba una tendencia de 6 meses, un backlog de hoy y una inversión
 * acumulada histórica; "Prevención · Año en curso" encabezaba tres KPIs de
 * estado actual. Ninguna de estas secciones es homogénea en el tiempo, así que
 * **cada KPI y cada gráfico declara su propia ventana** y la cabecera no promete
 * una que no puede cumplir.
 */
export function DomainSection({ domain, kpis, charts, links, note }: {
  domain: DashboardDomain
  kpis: ReactNode
  charts: ReactNode
  links: Array<{ label: string; href: string }>
  /** Advertencia de alcance cuando alguna cifra no puede respetar el filtro. */
  note?: string
}) {
  return (
    <section id={domain.anchor} aria-labelledby={`${domain.anchor}-titulo`} className="scroll-mt-16 2xl:scroll-mt-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--color-border)] pb-2">
        <h2 id={`${domain.anchor}-titulo`} className="text-h3 text-[var(--color-text)]">{domain.title}</h2>
        <div className="flex flex-wrap items-center gap-x-3">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
            >
              {link.label}
              <ArrowRight size={12} weight="bold" aria-hidden />
            </Link>
          ))}
        </div>
      </div>

      {note && <p className="mb-3 text-[11px] text-[var(--color-text-faint)]">{note}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{kpis}</div>

      <div className="mt-4 grid gap-6 grid-cols-1 xl:grid-cols-2">{charts}</div>
    </section>
  )
}

/** Reserva el alto de una sección para que el índice no salte al resolver. */
export function DomainSectionFallback() {
  return (
    <div className="animate-pulse" aria-hidden>
      <div className="mb-3 h-6 w-48 rounded bg-[var(--color-surface-2)]" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-[var(--color-surface-2)]" />)}
      </div>
      <div className="mt-4 grid gap-6 grid-cols-1 xl:grid-cols-2">
        {[0, 1].map((i) => <div key={i} className="h-64 rounded-2xl bg-[var(--color-surface-2)]" />)}
      </div>
    </div>
  )
}
