"use client"

import { Clock, CheckCircle, XCircle, Cloud, HardDrives, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { formatBytes } from "@/lib/format-bytes"
import { formatDateTime } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"

interface BackupRow {
  id: string
  date: string
  startedAt: string
  completedAt: string | null
  status: "success" | "failed" | "running"
  trigger: "cron" | "manual" | "deploy"
  pgSizeBytes: number | null
  storageSizeBytes: number | null
  configSizeBytes: number | null
  totalSizeBytes: number | null
  driveUploaded: boolean | null
  manifestSha256: string | null
  errorMessage: string | null
  appVersion: string | null
}

interface Props {
  backups: BackupRow[]
}

const STATUS_ICONS = {
  success: { icon: CheckCircle, color: "text-[var(--color-success)]", label: "Exitoso" },
  failed: { icon: XCircle, color: "text-[var(--color-danger)]", label: "Fallido" },
  running: { icon: Clock, color: "text-[var(--color-warning-ink)]", label: "En progreso" },
} as const

const TRIGGER_LABELS = {
  cron: "Programado",
  manual: "Manual",
  deploy: "Deploy",
} as const

export function BackupsList({ backups }: Props) {
  if (backups.length === 0) {
    return (
      <section className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-10 text-center shadow-[var(--shadow-card)]">
        <HardDrives size={32} className="mx-auto text-[var(--color-text-faint)]" />
        <h2 className="mt-3 text-h3 text-[var(--color-text)]">Sin respaldos registrados</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Los respaldos aparecerán aquí cuando el orquestador se ejecute (vía cron o manualmente).
        </p>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
              <th scope="col" className="px-4 py-2.5 th-type">Fecha</th>
              <th scope="col" className="px-4 py-2.5 th-type">Estado</th>
              <th scope="col" className="px-4 py-2.5 th-type">Origen</th>
              <th scope="col" className="px-4 py-2.5 th-type">PostgreSQL</th>
              <th scope="col" className="px-4 py-2.5 th-type">Storage</th>
              <th scope="col" className="px-4 py-2.5 th-type">Total</th>
              <th scope="col" className="px-4 py-2.5 th-type">Drive</th>
              <th scope="col" className="px-4 py-2.5 th-type">Manifiesto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {backups.map((b) => {
              const statusInfo = STATUS_ICONS[b.status]
              const StatusIcon = statusInfo.icon

              return (
                <tr
                  key={b.id}
                  className="transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]"
                >
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-[var(--color-text)]">
                    {b.date}
                    <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">
                      {formatDateTime(b.startedAt).slice(11, 16)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className="inline-flex items-center gap-1 text-sm">
                      <StatusIcon size={14} className={statusInfo.color} />
                      <span className={statusInfo.color}>{statusInfo.label}</span>
                    </span>
                    {b.errorMessage && (
                      /* La causa del fallo vivía **sólo** en el `title` de un
                         icono: invisible con teclado y en un teléfono. Es un
                         diagnóstico —lo que un administrador viene a buscar
                         cuando un respaldo falla—, así que necesita ser
                         alcanzable. `Tooltip` responde a foco, y el `button`
                         lo hace enfocable con un nombre propio. */
                      <Tooltip content={b.errorMessage} side="top">
                        <button
                          type="button"
                          aria-label={`Ver el error de este respaldo: ${b.errorMessage}`}
                          className="ml-1 inline-flex items-center rounded-(--radius-sm) text-xs text-[var(--color-text-muted)]"
                        >
                          <WarningCircle size={12} className="inline text-[var(--color-warning-ink)]" />
                        </button>
                      </Tooltip>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-[var(--color-text-muted)]">
                    {TRIGGER_LABELS[b.trigger]}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-[var(--color-text-muted)]">
                    {formatBytes(b.pgSizeBytes)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-[var(--color-text-muted)]">
                    {formatBytes(b.storageSizeBytes)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-[var(--color-text)]">
                    {formatBytes(b.totalSizeBytes)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {b.driveUploaded ? (
                      <Cloud size={14} className="text-[var(--color-success)]" />
                    ) : (
                      <span className="text-xs text-[var(--color-text-faint)]">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    {b.manifestSha256 ? (
                      <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs font-mono text-[var(--color-text-muted)]">
                        {b.manifestSha256}…
                      </code>
                    ) : (
                      <span className="text-xs text-[var(--color-text-faint)]">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
