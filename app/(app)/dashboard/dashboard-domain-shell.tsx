import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowRight } from "@phosphor-icons/react/dist/ssr"
import type { DashboardDomain } from "./dashboard-domains"

/*
 * `DomainIndex` vivía acá: un rail de anclas `#dominio-*` sobre una página que
 * tenía las seis secciones montadas a la vez. Lo reemplaza
 * `DashboardViewTabs`, que conmuta la vista en vez de hacer scroll hasta ella.
 */

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
export interface DomainKpiGroup {
  key: string
  /** Rótulo de la fila. `null` la deja sin encabezado (grupo único). */
  label: string | null
  content: ReactNode
}

export function DomainSection({ domain, kpis, kpiGroups, summary, charts, links, note }: {
  domain: DashboardDomain
  /** Una sola fila sin rótulo. Excluyente con `kpiGroups`. */
  kpis?: ReactNode
  /**
   * Varias filas rotuladas. Finanzas las necesita: ocho cifras seguidas sin
   * separar ingresos de egresos se leen como una sola lista indistinguible, que
   * es el defecto que §A1 previene. Ver la excepción declarada en AGENTS.md.
   */
  kpiGroups?: DomainKpiGroup[]
  /** Métricas secundarias en tira editorial, fuera del conteo de tiles. */
  summary?: ReactNode
  charts: ReactNode
  links: Array<{ label: string; href: string }>
  /** Advertencia de alcance cuando alguna cifra no puede respetar el filtro. */
  note?: string
}) {
  const groups: DomainKpiGroup[] = kpiGroups ?? (kpis ? [{ key: "default", label: null, content: kpis }] : [])
  // scroll-mt = TopBar (3.5rem) + barra de pestañas sticky (~2.75rem) + aire.
  return (
    <section id={domain.anchor} aria-labelledby={`${domain.anchor}-titulo`} className="scroll-mt-28 2xl:scroll-mt-20">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--color-border)] pb-2">
        {/* Un escalón sobre los títulos de tarjeta (eyebrow uppercase): los
            dominios son el nivel de navegación de la mitad inferior y a la
            misma escala competían con sus propias tarjetas (§6.2). */}
        <h2 id={`${domain.anchor}-titulo`} className="text-h2 text-[var(--color-text)]">{domain.title}</h2>
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

      {groups.map((group, index) => (
        <div key={group.key} className={index === 0 ? undefined : "mt-4"}>
          {group.label && (
            <h3 className="text-eyebrow mb-2 text-[var(--color-text-faint)]">{group.label}</h3>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{group.content}</div>
        </div>
      ))}
      {summary && <div className="mt-3">{summary}</div>}

      {/* Bento: 3 columnas en 2xl, 2 en xl, 1 abajo. Un gráfico pide ancho
          doble envolviéndose en `<div className="xl:col-span-2">`; las series
          temporales lo necesitan y los donuts y rankings verticales se leen
          mejor en una sola columna. */}
      <div className="mt-4 grid grid-cols-1 gap-6 xl:grid-cols-2 2xl:grid-cols-3">{charts}</div>
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
