"use client"

import Link from "next/link"
import { CaretRight } from "@phosphor-icons/react"
import { useInboxSeen } from "@/components/combustibles/inbox/use-inbox-seen"
import type { PanelDueRow } from "@/lib/combustibles/panel/due"
import { cn } from "@/lib/utils"

/**
 * Lista de lo que espera una decisión, ordenada por fecha límite. Lo nuevo (lo
 * que llegó después de la primera visita de la persona y todavía no abrió)
 * lleva un punto hasta que lo abre: «nuevo» es una comodidad de lectura que
 * vive en el navegador (`useInboxSeen`), no un estado del negocio. Antes de
 * hidratar no se marca nada, para que el punto no parpadee.
 */
export function PanelDueList({ rows, userId, ariaLabel }: { rows: PanelDueRow[]; userId: string; ariaLabel: string }) {
  const { isNew, markSeen } = useInboxSeen(userId)

  return (
    <ul aria-label={ariaLabel} className="divide-y divide-[var(--color-border)]">
      {rows.map((row) => {
        const fresh = isNew(row.key, row.waitingSince)
        return (
          <li key={row.key} data-new={fresh ? "true" : undefined}>
            <Link
              href={row.href}
              onClick={() => markSeen(row.key)}
              className="group grid grid-cols-[4.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[var(--radius-md)] px-1.5 py-3 text-sm transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)]"
            >
              <span className={cn("font-mono text-xs", row.overdue ? "font-bold text-[var(--color-danger-ink)]" : "text-[var(--color-text-muted)]")}>
                {row.dueLabel}
                {row.overdue ? <span className="sr-only"> (vencido)</span> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-[var(--color-text)]">
                  {fresh ? (
                    <>
                      <span aria-hidden className="mr-2 inline-block size-[7px] rounded-full bg-[var(--color-accent)] align-[1px] shadow-[0_0_0_2px_var(--color-accent-tint)]" />
                      <span className="sr-only">Nuevo: </span>
                    </>
                  ) : null}
                  {row.equipment ? <><span className="font-semibold">{row.equipment}</span> · </> : null}
                  {row.title}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--color-text-subtle)]">{row.detail}</span>
              </span>
              <CaretRight size={14} aria-hidden className="text-[var(--color-text-subtle)] transition-transform duration-[var(--duration-fast)] group-hover:translate-x-0.5" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
