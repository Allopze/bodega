import Link from "next/link"
import { CheckCircle, Plus, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { RankedList, type RankedListItem } from "@/components/ui/ranked-list"
import { MetaBadge } from "@/components/states/state-badge"
import type { FieldPanelData } from "@/lib/combustibles/panel/data"
import { myLoadsHref } from "@/lib/combustibles/panel/links"
import { TAE_STATUS_LABELS } from "@/lib/combustibles/labels"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { FUEL_PATHS, fuelBatchHref, fuelEquipmentHref, fuelLoadHref } from "@/lib/combustibles/routes"
import { formatDate, formatDateTime, formatQty } from "@/lib/utils"
import { PanelDueList } from "./panel-due-list"

/**
 * Panel de terreno y de administración de contrato: lo propio de la persona.
 * Registra cargas, ve las suyas y lo que le toca corregir; el contrato además
 * ve su última planilla. No muestra montos ni nombres de personas: sólo litros,
 * equipos y el estado de sus cargas.
 */

const sectionTitle = "text-h3 text-[var(--color-text)]"
const quietLink = "text-sm font-semibold text-[var(--color-primary-ink)] hover:underline"

function Hero({ data, period, canRegister, link }: { data: FieldPanelData; period: ResolvedFuelPeriod; canRegister: boolean; link: (href: string) => string }) {
  const { counts } = data
  const stats = [
    { key: "todas", value: counts?.all, label: `cargas tuyas en ${period.inLabel}`, cta: "Ver cargas", href: myLoadsHref(link) },
    { key: "por-validar", value: counts?.toValidate, label: "por validar", cta: "Ver cuáles", href: myLoadsHref(link, "por-validar") },
    { key: "con-observacion", value: counts?.withObservation, label: "con observación", cta: "Corregir", href: myLoadsHref(link, "con-observacion") },
  ]
  return (
    <section
      aria-labelledby="panel-registrar"
      className="mb-5 grid gap-6 rounded-[var(--radius-2xl)] border border-[var(--color-primary-line)] bg-[var(--color-primary-tint)] p-6 md:grid-cols-[1.2fr_1fr] md:items-center md:p-7"
    >
      <div>
        <h2 id="panel-registrar" className="text-h2 text-[var(--color-text)]">Registrar una carga</h2>
        <p className="mt-2 max-w-[52ch] text-base text-[var(--color-primary-ink)]">
          Equipo, medidor, litros, sellos y personas, una pregunta por pantalla.
        </p>
        {canRegister ? (
          <Button asChild size="lg" className="mt-4">
            <Link href={FUEL_PATHS.registrar}>
              <Plus size={14} weight="bold" aria-hidden />
              Registrar carga
            </Link>
          </Button>
        ) : null}
      </div>
      <nav aria-label="Tus cargas del período" className="grid grid-cols-3 divide-x divide-[var(--color-primary-line)]">
        {stats.map((stat) => (
          <Link key={stat.key} href={stat.href} className="block rounded-[var(--radius-md)] px-3 py-1.5 text-sm text-[var(--color-primary-ink)] hover:bg-[var(--color-surface)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)] sm:px-4">
            <b className="block font-mono text-[28px] font-bold leading-tight tabular-nums">
              {stat.value === undefined ? <span className="font-sans text-base font-semibold">Sin datos</span> : formatQty(stat.value)}
            </b>
            {stat.label}
            <small className="mt-0.5 block text-xs font-semibold">{stat.cta}</small>
          </Link>
        ))}
      </nav>
    </section>
  )
}

function MyLoads({ data, period, canRegister, link }: { data: FieldPanelData; period: ResolvedFuelPeriod; canRegister: boolean; link: (href: string) => string }) {
  const { recent } = data
  return (
    <Card className="p-5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={sectionTitle}>Tus cargas · {period.label}</h2>
        <Link href={myLoadsHref(link)} className={quietLink}>Ver todas</Link>
      </div>
      {recent === null ? (
        <p className="py-3 text-sm text-[var(--color-text-muted)]">No se pudieron leer tus cargas. Reintenta en un momento.</p>
      ) : recent.length === 0 ? (
        <EmptyState
          compact
          title={`Todavía no registraste cargas en ${period.inLabel}`}
          description="Cuando registres una desde la plataforma, aparece acá con su estado."
          action={canRegister ? <Button asChild size="sm"><Link href={FUEL_PATHS.registrar}>Registrar carga</Link></Button> : undefined}
        />
      ) : (
        <ul aria-label="Tus últimas cargas" className="divide-y divide-[var(--color-border)]">
          {recent.map((load) => {
            const status = TAE_STATUS_LABELS[load.status]
            return (
              <li key={load.id}>
                <Link
                  href={fuelLoadHref({ origen: "terreno", id: load.id })}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-[var(--radius-md)] px-1.5 py-2.5 text-sm transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                >
                  <span className="min-w-0">
                    <span className="font-semibold text-[var(--color-text)]">{load.equipmentCode}</span>
                    {load.worksiteName ? <span className="text-[var(--color-text-muted)]"> · {load.worksiteName}</span> : null}
                  </span>
                  <span className="font-mono tabular-nums text-[var(--color-text)]">{formatQty(load.liters)} L</span>
                  <span className="flex w-full items-center justify-between gap-2 text-xs">
                    <span className="font-mono text-[var(--color-text-muted)]">{formatDateTime(load.loadedAt)}</span>
                    {status ? <MetaBadge meta={status} size="sm" /> : null}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function ToFix({ data, userId, link }: { data: FieldPanelData; userId: string; link: (href: string) => string }) {
  const { toFix, planilla } = data
  return (
    <Card className="p-5">
      <h2 className={sectionTitle}>Lo que te toca</h2>
      <p className="mb-3 mt-1 text-sm text-[var(--color-text-muted)]">
        Lo que está pendiente y puedes corregir, con lo más urgente arriba. Lo nuevo lleva un punto hasta que lo abres.
      </p>
      {toFix === null ? (
        <p className="flex items-start gap-2 py-2 text-sm text-[var(--color-text-muted)]">
          <WarningCircle size={18} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-signal-ink)]" />
          <span>
            No se pudo leer lo pendiente. <Link href={link(FUEL_PATHS.revisar)} className={quietLink}>Abre la bandeja</Link> para verlo.
          </span>
        </p>
      ) : toFix.length === 0 ? (
        <p className="flex items-center gap-2 py-2 text-sm text-[var(--color-text-muted)]">
          <CheckCircle size={18} weight="fill" aria-hidden className="shrink-0 text-[var(--color-success-ink)]" />
          Nada te espera: ninguna de tus cargas tiene algo pendiente.
        </p>
      ) : (
        <PanelDueList rows={toFix} userId={userId} ariaLabel="Lo que te toca" />
      )}
      {planilla ? (
        <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-sm text-[var(--color-text-muted)]">
          Tu última planilla de cargas llegó el {formatDate(planilla.importedAt)}: {formatQty(planilla.validRows)} {planilla.validRows === 1 ? "fila válida" : "filas válidas"}
          {planilla.invalidRows > 0 ? ` y ${formatQty(planilla.invalidRows)} con errores` : ""}.{" "}
          <Link href={fuelBatchHref("planilla", planilla.id)} className={quietLink}>Ver el archivo</Link>
        </p>
      ) : null}
    </Card>
  )
}

function MyEquipment({ data, period, canRegister, link }: { data: FieldPanelData; period: ResolvedFuelPeriod; canRegister: boolean; link: (href: string) => string }) {
  const { ranking } = data
  const items: RankedListItem[] = (ranking ?? []).map((entry) => ({ key: entry.vehicleId, label: entry.label, value: entry.liters, href: fuelEquipmentHref(entry.vehicleId) }))
  return (
    <Card className="mt-5 p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={sectionTitle}>Tus equipos en {period.inLabel}</h2>
        <Link href={link(FUEL_PATHS.consumo)} className={quietLink}>Ver rendimiento</Link>
      </div>
      <p className="mb-3 text-sm text-[var(--color-text-muted)]">Litros cargados por equipo en tus faenas.</p>
      {ranking === null ? (
        <p className="py-3 text-sm text-[var(--color-text-muted)]">No se pudo leer el consumo de tus equipos. Reintenta en un momento.</p>
      ) : items.length === 0 ? (
        <EmptyState
          compact
          title={`Todavía no hay cargas en tus faenas en ${period.inLabel}`}
          description="Cada carga que se registre suma a su equipo."
          action={canRegister ? <Button asChild size="sm"><Link href={FUEL_PATHS.registrar}>Registrar carga</Link></Button> : undefined}
        />
      ) : (
        <RankedList items={items} format="count" unit=" L" limit={8} ariaLabel={`Litros por equipo en ${period.inLabel}`} />
      )}
    </Card>
  )
}

export function FieldPanel({
  data,
  period,
  userId,
  canRegister,
  link,
}: {
  data: FieldPanelData
  period: ResolvedFuelPeriod
  userId: string
  canRegister: boolean
  link: (href: string) => string
}) {
  return (
    <>
      <Hero data={data} period={period} canRegister={canRegister} link={link} />
      <div className="grid gap-5 lg:grid-cols-2">
        <MyLoads data={data} period={period} canRegister={canRegister} link={link} />
        <ToFix data={data} userId={userId} link={link} />
      </div>
      <MyEquipment data={data} period={period} canRegister={canRegister} link={link} />
    </>
  )
}
