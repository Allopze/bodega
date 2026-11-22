import Image from "next/image"
import Link from "next/link"
import { CaretRight } from "@phosphor-icons/react/dist/ssr"
import { MetaBadge } from "@/components/states/state-badge"
import type { FieldAppDef } from "@/lib/apps/field-apps"
import type { FieldAppSummary } from "@/lib/services/field-apps/types"
import { appStatusBadge, formatSince } from "./status"

const num = "font-mono tabular-nums"

/**
 * Tarjeta de una app del teléfono en `/ti/apps`: toda ella es el enlace al detalle.
 * Con tres apps la tarjeta ya es el resumen, por eso la lista no lleva tira de cifras.
 */
export function FieldAppCard({ app, summary, now }: { app: FieldAppDef; summary: FieldAppSummary; now: Date }) {
  const badge = appStatusBadge(summary)
  const attention = summary.byState.error + summary.byState.stuck
  const reported = summary.firstReportAt !== null

  return (
    <Link
      href={`/ti/apps/${app.id}`}
      data-pressable
      className="group block rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xs transition-colors hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
    >
      <div className="flex items-start gap-4">
        <Image src={app.iconSrc} alt="" width={48} height={48} className="size-12 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <h2 className="text-base font-semibold text-[var(--color-text)]">{app.label}</h2>
            <MetaBadge meta={badge} title={badge.hint} />
          </div>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{app.description}</p>

          {reported ? (
            <>
              <p className="mt-3 text-sm text-[var(--color-text)]">
                <span className={num}>{summary.activeDevices}</span> {summary.activeDevices === 1 ? "teléfono activo" : "teléfonos activos"}
                {" · "}
                <span className={`${num} ${attention > 0 ? "text-[var(--color-danger-ink)]" : ""}`}>{attention}</span> {attention === 1 ? "atascado o con error" : "atascados o con error"}
                {" · "}
                <span className={`${num} ${summary.versionBehind > 0 ? "text-[var(--color-signal-ink)]" : ""}`}>{summary.versionBehind}</span> con versión atrasada
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                Último aviso {formatSince(summary.lastReportAt, now)}
                {" · "}
                {summary.lastSubmissionAt ? `último envío ${formatSince(summary.lastSubmissionAt, now)}` : "todavía sin envíos"}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">
              Todavía no llegan avisos de esta app.
              {summary.lastSubmissionAt && <> Último envío {formatSince(summary.lastSubmissionAt, now)}.</>}
            </p>
          )}
        </div>
        <CaretRight size={18} aria-hidden className="mt-1 hidden shrink-0 text-[var(--color-text-faint)] transition-colors group-hover:text-[var(--color-primary)] sm:block" />
      </div>
    </Link>
  )
}
