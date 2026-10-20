"use client"

import { Wrench } from "@phosphor-icons/react"
import { EmptyState } from "@/components/ui/empty-state"
import type { Re20StageModule, Re20StageProgress, Re20StageProps } from "../stages"

/* Pieza provisional para las etapas que todavía se están construyendo. Cada
 * `stages/<id>.tsx` la reemplaza por su componente y su `progress()` reales. */

export const EMPTY_RE20_PROGRESS: Re20StageProgress = { done: 0, total: 0, missing: [] }

export function Re20StagePlaceholder({ stage }: Re20StageProps) {
  return (
    <EmptyState
      compact
      align="start"
      as="p"
      icon={<Wrench aria-hidden className="size-5" />}
      title="En construcción"
      description={`La etapa «${stage.title}» se está rediseñando. Por ahora sus datos se conservan tal como estaban.`}
    />
  )
}

export function placeholderStage(): Re20StageModule {
  return { Component: Re20StagePlaceholder, progress: () => EMPTY_RE20_PROGRESS }
}
