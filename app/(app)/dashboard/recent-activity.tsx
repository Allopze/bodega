import Link from "next/link"
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { cn, formatDateTime } from "@/lib/utils"
import type { ActivityGroup } from "./activity-groups"
import { ChartFrame } from "./charts/chart-frame"

const ROW = cn(
  "group -mx-2 flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-2 py-2",
  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]",
)

/**
 * Hechos auditables desde el despliegue; no infiere actividad histórica.
 *
 * Recibe los movimientos ya **agrupados** (`groupConsecutiveActivity`): una carga
 * masiva dejaba seis renglones idénticos y tapaba el resto. Es el contenido de un
 * bloque del panel del Resumen —el marco y el ancho los pone quien lo monta—, no
 * una tarjeta con superficie propia.
 *
 * Sin enlace "Ver toda la actividad": ninguna pantalla lista estos eventos —el
 * tablero es el único que los lee—, así que el enlace no tendría destino.
 */
export function RecentActivity({ groups }: { groups: ActivityGroup[] }) {
  return (
    <ChartFrame title="Actividad reciente" description="Últimos movimientos en tus áreas">
      {groups.length === 0 ? (
        // A4: lenguaje de usuario + CTA real. La actividad se genera al trabajar
        // las tareas, así que abrir los pendientes es literalmente la acción que
        // llena esta lista — no hay un "crear actividad" que inventar.
        <EmptyState
          compact
          align="start"
          icon={<ClockCounterClockwise size={20} />}
          title="Todavía no hay movimientos"
          description="Aquí van a aparecer las solicitudes, órdenes, recepciones y entregas a medida que tú y tu equipo las registren."
          action={<Button asChild size="sm" variant="secondary"><Link href="/pendientes">Ver mis pendientes</Link></Button>}
          className="px-0 py-2"
        />
      ) : (
        <ul className="divide-y divide-[var(--color-border)]">
          {groups.map((group) => {
            const content = (
              <>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-[var(--color-text)]">
                    {group.actionLabel}
                    {/* Con varios movimientos juntos el código sería el del más
                        reciente y parecería que todos eran de esa entidad. */}
                    {group.count === 1 && group.entityCode ? <span className="ml-1 font-mono tabular-nums text-[var(--color-text-muted)]">{group.entityCode}</span> : null}
                    {group.count > 1 && (
                      <span
                        title={`${group.count} movimientos iguales seguidos`}
                        className="ml-1.5 inline-block rounded-full bg-[var(--color-surface-2)] px-1.5 py-0.5 align-[1px] text-xs font-bold tabular-nums text-[var(--color-text-muted)]"
                      >
                        <span aria-hidden>×{group.count}</span>
                        <span className="sr-only">{group.count} veces</span>
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                    {group.worksiteName}{group.actorName ? ` · ${group.actorName}` : ""}
                  </span>
                </span>
                <time dateTime={group.occurredAt} className="shrink-0 text-right text-xs tabular-nums text-[var(--color-text-muted)]">
                  {formatDateTime(group.occurredAt)}
                </time>
              </>
            )
            return (
              <li key={group.id}>
                {group.href ? (
                  <Link href={group.href} className={cn(ROW, "transition-colors duration-150 hover:bg-[var(--color-surface-2)]")}>
                    {content}
                  </Link>
                ) : (
                  <div className={ROW}>{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </ChartFrame>
  )
}
