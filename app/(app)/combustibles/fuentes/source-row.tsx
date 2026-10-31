import type { ReactNode } from "react"
import Link from "next/link"
import { CloudArrowDown, Drop, FileXls, Gauge, QrCode, Receipt, SealCheck } from "@phosphor-icons/react/dist/ssr"
import { MetaBadge } from "@/components/states/state-badge"
import { cn } from "@/lib/utils"
import type { FuelSourceKey, FuelSourceStatus } from "@/lib/combustibles/sources-status"

const SOURCE_ICONS: Record<FuelSourceKey, typeof Gauge> = {
  copec: CloudArrowDown,
  aramco: CloudArrowDown,
  planilla: FileXls,
  telemetria: Gauge,
  surtidor: Drop,
  terreno: QrCode,
  "historico-sellos": SealCheck,
  facturas: Receipt,
}

const BADGE_VARIANT = { ok: "success", pendiente: "signal", falla: "danger", sin_datos: "neutral" } as const

/** El estado de una fuente: «Al día», «Hasta ayer», «Falló hoy a las 05:30». */
export function SourceStatusBadge({ status, label }: { status: FuelSourceStatus["status"]; label: string }) {
  return <MetaBadge meta={{ label, variant: BADGE_VARIANT[status] }} />
}

/**
 * Una fuente de datos: su estado, lo que llegó, lo que falta y su acción. El
 * detalle técnico va plegado: quien sólo quiere saber si están al día no lo
 * necesita. Sin hooks ni acceso a datos: lo usan la página (servidor) y los
 * componentes de sincronización (cliente), que le pasan `actions` y `children`.
 */
export function SourceRow({
  source,
  actions,
  status,
  children,
}: {
  source: Pick<FuelSourceStatus, "key" | "name" | "description" | "facts" | "feeds" | "problem" | "technical">
  /** Estado a pintar; si falta, no se pinta insignia (el contenedor la pasa ya resuelta). */
  status: Pick<FuelSourceStatus, "status" | "statusLabel">
  /** Botones y enlaces de la fuente (sincronizar, importar, plantilla…). */
  actions?: ReactNode
  /** Contenido técnico adicional, dentro del detalle plegado. */
  children?: ReactNode
}) {
  const Icon = SOURCE_ICONS[source.key]
  const titleId = `fuente-${source.key}-titulo`
  const hasTechnical = source.technical.length > 0 || Boolean(children)
  return (
    <article aria-labelledby={titleId} data-source={source.key} className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <header className="flex items-start gap-3">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
          <Icon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-sm font-semibold text-[var(--color-text)]">{source.name}</h3>
          <p className="text-xs text-[var(--color-text-muted)]">{source.description}</p>
        </div>
        <SourceStatusBadge status={status.status} label={status.statusLabel} />
      </header>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {source.facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-xs text-[var(--color-text-muted)]">{fact.label}</dt>
            <dd className="break-words font-medium text-[var(--color-text)]">
              {fact.value}
              {fact.href ? <> · <Link href={fact.href} className="font-normal text-[var(--color-primary-ink)] underline underline-offset-2">{fact.hrefLabel ?? "Cambiar"}</Link></> : null}
            </dd>
          </div>
        ))}
        {source.feeds.length > 0 ? (
          <div className="min-w-0">
            <dt className="text-xs text-[var(--color-text-muted)]">Llega a</dt>
            <dd className="font-medium text-[var(--color-text)]">{source.feeds.join(", ")}</dd>
          </div>
        ) : null}
        <div className={cn("min-w-0", source.problem ? "sm:col-span-2 lg:col-span-4" : undefined)}>
          <dt className="text-xs text-[var(--color-text-muted)]">Falta</dt>
          <dd className={cn("font-medium", source.problem ? "text-[var(--color-warning-ink)]" : "text-[var(--color-text)]")}>{source.problem ?? (status.status === "sin_datos" ? "Todavía no hay datos de este período" : "Nada")}</dd>
        </div>
      </dl>

      {actions ? <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">{actions}</div> : null}

      {hasTechnical ? (
        <details className="group mt-3 border-t border-[var(--color-border)] pt-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--color-text)] marker:text-[var(--color-text-muted)]">Detalle técnico</summary>
          <div className="mt-2 flex flex-col gap-3">
            {source.technical.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--color-text-muted)]">
                {source.technical.map((line) => <li key={line}>{line}</li>)}
              </ul>
            ) : null}
            {children}
          </div>
        </details>
      ) : null}
    </article>
  )
}
