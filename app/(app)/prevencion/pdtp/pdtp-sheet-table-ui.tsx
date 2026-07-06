import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import type { PdtpActivityStatus } from "@/lib/services/pdtp/period"

export function PdtpStatusBadge({ status }: { status: PdtpActivityStatus }) {
  const STATUS_BADGE: Record<PdtpActivityStatus, { label: string; variant: "default" | "success" | "danger" | "outline" }> = {
    executed: { label: "Ejecutado", variant: "success" },
    pending: { label: "Pendiente", variant: "default" },
    overdue: { label: "Atrasado", variant: "danger" },
    not_scheduled: { label: "—", variant: "outline" },
  }
  const { label, variant } = STATUS_BADGE[status]
  return <Badge variant={variant}>{label}</Badge>
}

const PDT_BASE = "/prevencion/pdtp"

export function PdtpWorksitePicker({
  current,
  sheetCode,
  worksites,
  programId,
}: {
  current?: string
  sheetCode: string
  worksites: Array<{ id: string; name: string }>
  programId?: string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {worksites.map((worksite) => (
        <Link
          key={worksite.id}
          href={programId
            ? `${PDT_BASE}/${programId}?hoja=${sheetCode}&faena=${worksite.id}`
            : `${PDT_BASE}?hoja=${sheetCode}&faena=${worksite.id}`}
          className={[
            "rounded-md border px-3 py-1.5 text-sm transition-colors",
            worksite.id === current
              ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-text)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          ].join(" ")}
        >
          {worksite.name}
        </Link>
      ))}
    </div>
  )
}

export function PdtpViewToggle({
  current,
  sheetCode,
  worksiteId,
  programId,
}: {
  current: "semana" | "anual"
  sheetCode: string
  worksiteId?: string
  programId?: string
}) {
  const options: Array<{ value: "semana" | "anual"; label: string }> = [
    { value: "semana", label: "Esta semana" },
    { value: "anual", label: "Vista anual" },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Link
          key={option.value}
          href={programId
            ? `${PDT_BASE}/${programId}?hoja=${sheetCode}${worksiteId ? `&faena=${worksiteId}` : ""}&vista=${option.value}`
            : `${PDT_BASE}?hoja=${sheetCode}${worksiteId ? `&faena=${worksiteId}` : ""}&vista=${option.value}`}
          className={[
            "rounded-md border px-3 py-1.5 text-sm transition-colors",
            option.value === current
              ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-text)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          ].join(" ")}
        >
          {option.label}
        </Link>
      ))}
    </div>
  )
}

export function PdtpSheetPicker({
  current,
  options,
  programId,
}: {
  current: string
  options: Array<{ code: string; label: string }>
  programId?: string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <Link
          key={option.code}
          href={programId
            ? `${PDT_BASE}/${programId}?hoja=${option.code}`
            : `${PDT_BASE}?hoja=${option.code}`}
          className={[
            "rounded-md border px-3 py-1.5 text-sm transition-colors",
            option.code === current
              ? "border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-text)]"
              : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
          ].join(" ")}
        >
          {option.label}
        </Link>
      ))}
    </div>
  )
}

export function PdtpMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <p className="text-xs text-[var(--color-text-subtle)]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[var(--color-text)]">{value}</p>
    </div>
  )
}

export function formatQuantity(value: number) {
  if (value === 0) return "-"
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}
