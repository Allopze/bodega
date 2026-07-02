import Link from "next/link"
import { StateBadge } from "@/components/states/state-badge"
import { formatQty } from "@/lib/utils"
import { Warning, ArrowSquareOut } from "@phosphor-icons/react/dist/ssr"
import type { MatrixRow } from "@/lib/services/trazabilidad-matrix"

interface Props {
  row: MatrixRow
}

export function TrazabilidadMatrixCard({ row }: Props) {
  return (
    <article
      className={[
        "rounded-[var(--radius-2xl)] bg-[var(--color-surface)] shadow-[var(--shadow-card)] p-4",
        row.alert ? "ring-1 ring-inset ring-[var(--color-signal-line)]" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/trazabilidad/${row.itemId}`}
            className="text-sm font-medium text-[var(--color-primary)] hover:underline underline-offset-2"
          >
            {row.productName}
          </Link>
          <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
            {row.productSku ? <span className="font-mono">{row.productSku} · </span> : null}
            {row.worksiteName}
          </p>
        </div>
        <StateBadge state={row.status} entity="item" size="sm" />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div>
          <p className="text-[var(--color-text-subtle)]">Solicitud</p>
          <Link
            href={`/solicitudes/${row.requestId}`}
            className="inline-flex items-center gap-1 font-medium text-[var(--color-primary)]"
          >
            {row.requestCode}
            <ArrowSquareOut className="h-3 w-3 shrink-0" aria-hidden />
          </Link>
        </div>
        <div className="text-right">
          <p className="text-[var(--color-text-subtle)]">Solicitado</p>
          <p className="font-mono tabular-nums text-[var(--color-text)]">{formatQty(row.requested, row.uom)}</p>
        </div>
        <div>
          <p className="text-[var(--color-text-subtle)]">Aprobado</p>
          <p className="font-mono tabular-nums text-[var(--color-text)]">
            {row.approved !== null ? formatQty(row.approved, row.uom) : "—"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[var(--color-text-subtle)]">En OC</p>
          <p className={["font-mono tabular-nums", row.alert ? "font-semibold text-[var(--color-signal-ink)]" : "text-[var(--color-text)]"].join(" ")}>
            {formatQty(row.inOc, row.uom)}
            {row.alert && (
              <Warning
                weight="fill"
                className="ml-1 inline h-3.5 w-3.5 text-[var(--color-signal-ink)]"
                aria-label={`Faltan ${formatQty((row.approved ?? 0) - row.inOc, row.uom)} en OC`}
              />
            )}
          </p>
        </div>
        <div>
          <p className="text-[var(--color-text-subtle)]">Recibido</p>
          <p className="font-mono tabular-nums text-[var(--color-text)]">{formatQty(row.received, row.uom)}</p>
        </div>
      </div>
    </article>
  )
}
