"use client"

import { CheckCircle, XCircle, Clock, Database, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import type { BackupStatusCard } from "./backup-health"

interface Props {
  cards: BackupStatusCard[]
}

const STATUS_ICONS = {
  success: CheckCircle,
  failed: XCircle,
  running: Clock,
  warning: WarningCircle,
  none: Database,
} as const

const STATUS_COLORS = {
  success: {
    bg: "bg-[var(--color-success-tint)]",
    border: "border-[var(--color-success)]",
    icon: "text-[var(--color-success)]",
    text: "text-[var(--color-success)]",
  },
  failed: {
    bg: "bg-[var(--color-danger-tint)]",
    border: "border-[var(--color-danger)]",
    icon: "text-[var(--color-danger)]",
    text: "text-[var(--color-danger)]",
  },
  running: {
    bg: "bg-[var(--color-warning-tint)]",
    border: "border-[var(--color-warning)]",
    icon: "text-[var(--color-warning-ink)]",
    text: "text-[var(--color-warning-ink)]",
  },
  warning: {
    bg: "bg-[var(--color-warning-tint)]",
    border: "border-[var(--color-warning)]",
    icon: "text-[var(--color-warning-ink)]",
    text: "text-[var(--color-warning-ink)]",
  },
  none: {
    bg: "bg-[var(--color-surface-2)]",
    border: "border-[var(--color-border)]",
    icon: "text-[var(--color-text-muted)]",
    text: "text-[var(--color-text-muted)]",
  },
} as const

export function BackupsStatusCards({ cards }: Props) {
  return (
    <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const colors = STATUS_COLORS[card.status]
        const Icon = STATUS_ICONS[card.status]

        return (
          <div
            key={card.label}
            role="status"
            className={`rounded-[var(--radius-xl)] border ${colors.border} ${colors.bg} p-4 shadow-[var(--shadow-card)] transition-colors duration-[var(--duration-fast)]`}
          >
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius)] ${colors.bg} ${colors.icon}`}>
                <Icon size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  {card.label}
                </p>
                <p className={`mt-0.5 text-sm font-semibold ${colors.text}`}>
                  {card.value}
                </p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
