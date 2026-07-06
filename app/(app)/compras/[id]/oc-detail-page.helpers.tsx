export function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-xs text-[var(--color-text-subtle)]">{label}</dt>
      <dd className="text-right text-xs font-medium text-[var(--color-text)]">{value}</dd>
    </div>
  )
}

export function AmountLine({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={muted ? "text-[var(--color-text-subtle)]" : "text-[var(--color-text-muted)]"}>{label}</dt>
      <dd className={muted ? "font-mono tabular-nums text-[var(--color-text-subtle)]" : "font-mono tabular-nums text-[var(--color-text-muted)]"}>{value}</dd>
    </div>
  )
}
