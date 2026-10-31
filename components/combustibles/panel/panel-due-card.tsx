import Link from "next/link"
import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { Card } from "@/components/ui/card"
import type { PanelDueState } from "@/lib/combustibles/panel/data"
import type { ResolvedFuelPeriod } from "@/lib/combustibles/period/types"
import { FUEL_PATHS } from "@/lib/combustibles/routes"
import { ofPeriod } from "@/lib/combustibles/panel/format"
import { PanelDueList } from "./panel-due-list"

/**
 * «Lo que vence primero» (o «Lo que quedó pendiente de …» cuando el período
 * cerró): lo que espera una decisión, con lo más urgente arriba. Sale de la
 * bandeja «Por revisar»; cada fila abre su ficha. Si la bandeja no respondió,
 * lo dice: nunca «nada» sin saberlo.
 */
export function PanelDueCard({
  due,
  period,
  userId,
  link,
}: {
  due: PanelDueState
  period: ResolvedFuelPeriod
  userId: string
  link: (href: string) => string
}) {
  const closed = period.status === "cerrado"
  const title = closed ? `Lo que quedó pendiente ${ofPeriod(period.inLabel)}` : "Lo que vence primero"
  const description = closed
    ? "El período está cerrado. Esto es lo que todavía espera una decisión."
    : "Ordenado por fecha límite: lo que cambia las cifras del mes debe quedar resuelto antes del cierre. Lo nuevo lleva un punto hasta que lo abres."

  return (
    <Card className="p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-h3 text-[var(--color-text)]">{title}</h2>
        {due.kind === "rows" ? (
          <Link href={link(FUEL_PATHS.revisar)} className="text-sm font-semibold text-[var(--color-primary-ink)] hover:underline">
            Ver todo lo pendiente ({due.total})
          </Link>
        ) : null}
      </div>
      <p className="mb-3 text-sm text-[var(--color-text-muted)]">{description}</p>

      {due.kind === "rows" ? (
        <PanelDueList rows={due.rows} userId={userId} ariaLabel={title} />
      ) : due.kind === "empty" ? (
        <p className="flex items-center gap-2 py-3 text-sm text-[var(--color-text-muted)]">
          <CheckCircle size={18} weight="fill" aria-hidden className="shrink-0 text-[var(--color-success-ink)]" />
          {closed ? `Nada quedó pendiente ${ofPeriod(period.inLabel)}.` : "No hay nada pendiente: todo lo que llegó ya tiene una decisión."}
        </p>
      ) : (
        <p className="flex items-start gap-2 py-3 text-sm text-[var(--color-text-muted)]">
          <WarningCircle size={18} aria-hidden className="mt-0.5 shrink-0 text-[var(--color-signal-ink)]" />
          <span>
            No se pudo confirmar lo que está pendiente.{" "}
            <Link href={link(FUEL_PATHS.revisar)} className="font-semibold text-[var(--color-primary-ink)] hover:underline">Abre la bandeja</Link>
            {" "}para verlo.
          </span>
        </p>
      )}
    </Card>
  )
}
