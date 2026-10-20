"use client"

import * as React from "react"
import { Check } from "@phosphor-icons/react"
import { Progress } from "@/components/ui/progress"
import { RunSaveStatus } from "./run-status"
import {
  collectProgressGaps,
  draftKey,
  groupProgressGaps,
  jumpToClosingAct,
  PROGRESS_GAP_SUFFIX,
  type ProgressGap,
  type ProgressGapKind,
} from "./run-view-helpers"
import type { RunViewModel } from "./run-view-types"

export type RunProgressModel = Pick<
  RunViewModel,
  "items" | "requiredItems" | "answeredRequired" | "answeredCount" | "drafts" | "completion" | "channel" | "jumpToItem"
>

/** El texto del avance: los obligatorios si los hay, y si no, lo respondido. */
export function progressText(model: Pick<RunProgressModel, "items" | "requiredItems" | "answeredRequired" | "answeredCount">): string {
  const { items, requiredItems, answeredRequired, answeredCount } = model
  // I-02: sin obligatorios efectivos «0 de N obligatorios» mentía; se dice lo respondido.
  return requiredItems.length > 0
    ? `${answeredRequired} de ${requiredItems.length} obligatorios`
    : `${answeredCount} de ${items.length} respondidos`
}

/**
 * El avance de quien está capturando, en vez del muro rojo de «Para declarar
 * ejecutada falta» (P2-1): una barra, cuántos obligatorios lleva y, en una línea,
 * lo que todavía impide declararla —«3 sin responder · 1 sin motivo · acta
 * incompleta»—, donde cada parte salta al primer ítem que corresponde. La lista
 * completa se despliega a pedido, sin scroll propio dentro del scroll de la
 * página. Es el mismo conjunto que bloquea el cierre y el que lista el diálogo.
 */
export function RunProgress({ model }: { model: RunProgressModel }) {
  const { items, requiredItems, answeredRequired, answeredCount, drafts, completion, channel, jumpToItem } = model
  const [listOpen, setListOpen] = React.useState(false)
  const listId = React.useId()

  const gaps = React.useMemo(
    () => collectProgressGaps({
      blockers: completion.blockers,
      held: channel.held,
      itemKeys: items.map((item) => draftKey(item.sectionId, item.itemId)),
      drafts,
    }),
    [completion.blockers, channel.held, items, drafts],
  )
  const groups = React.useMemo(() => groupProgressGaps(gaps), [gaps])

  const total = requiredItems.length > 0 ? requiredItems.length : items.length
  const done = requiredItems.length > 0 ? answeredRequired : answeredCount
  const text = progressText(model)

  if (items.length === 0 && gaps.length === 0) return null

  function jump(kind: ProgressGapKind, key: string | null) {
    if (key) jumpToItem(key, kind === "no_reason" ? "comment" : undefined)
    else jumpToClosingAct()
  }

  return (
    <div className="mt-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium tabular-nums">{text}</p>
        {/* El mismo estado que la barra del teléfono (P1-7); allí se ve en la barra fija. */}
        <RunSaveStatus state={channel.captureState} className="hidden md:inline" />
      </div>
      {total > 0 && <Progress className="mt-1.5" value={done} max={total} label={`Avance: ${text}`} />}

      {gaps.length > 0 ? (
        <>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5">
            {groups.map((group, index) => (
              <React.Fragment key={group.kind}>
                {index > 0 && <span aria-hidden="true" className="text-xs text-[var(--color-text-subtle)]">·</span>}
                <button
                  type="button"
                  className="min-h-11 rounded-[var(--radius-sm)] px-1 text-xs font-medium text-[var(--color-primary-ink)] underline underline-offset-2 md:min-h-8"
                  onClick={() => jump(group.kind, group.firstKey)}
                >
                  {group.label}
                </button>
              </React.Fragment>
            ))}
            <button
              type="button"
              aria-expanded={listOpen}
              aria-controls={listId}
              className="ml-auto min-h-11 rounded-[var(--radius-sm)] px-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] md:min-h-8"
              onClick={() => setListOpen((open) => !open)}
            >
              Ver lista ({gaps.length})
            </button>
          </div>
          {listOpen && (
            <ul id={listId} className="mt-1 divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
              {gaps.map((gap) => <GapLine key={`${gap.key ?? "acta"}:${gap.text}`} gap={gap} onJump={jump} />)}
            </ul>
          )}
        </>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[var(--color-success-ink)]">
          <Check aria-hidden="true" weight="bold" className="size-3.5" />
          Lista para declarar ejecutada
        </p>
      )}
    </div>
  )
}

function GapLine({ gap, onJump }: { gap: ProgressGap; onJump: (kind: ProgressGapKind, key: string | null) => void }) {
  const suffix = PROGRESS_GAP_SUFFIX[gap.kind]
  return (
    <li>
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-1.5 text-left text-sm md:min-h-9"
        onClick={() => onJump(gap.kind, gap.key)}
      >
        <span className="min-w-0">{gap.text}</span>
        {suffix && <span className="shrink-0 text-xs text-[var(--color-text-subtle)]">· {suffix}</span>}
      </button>
    </li>
  )
}
