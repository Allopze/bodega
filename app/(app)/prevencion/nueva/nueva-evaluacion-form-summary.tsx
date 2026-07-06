"use client"

export function SummaryItem({
  icon,
  label,
  value,
  muted,
}: {
  icon: React.ReactNode
  label: string
  value: string
  muted: boolean
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-(--radius) bg-(--color-surface) px-3 py-2">
      <span className={muted ? "mt-0.5 shrink-0 text-text-faint" : "mt-0.5 shrink-0 text-(--color-primary)"}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{label}</p>
        <p className={muted ? "truncate text-sm text-text-subtle" : "truncate text-sm font-medium text-(--color-text)"}>
          {value}
        </p>
      </div>
    </div>
  )
}
