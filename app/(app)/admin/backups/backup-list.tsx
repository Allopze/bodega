"use client"

import { Clock, CheckCircle, XCircle, Cloud, CloudCheck, HardDrives, WarningCircle } from "@phosphor-icons/react/dist/ssr"
import { formatBytes } from "@/lib/format-bytes"
import { formatDateTime } from "@/lib/utils"
import { Tooltip } from "@/components/ui/tooltip"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

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
  cloudreveUploaded: boolean | null
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
        <TableRoot className="rounded-none border-0">
        <Table className="text-left">
          <caption className="sr-only">Respaldos ejecutados y su estado de almacenamiento</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead><TableHead>Estado</TableHead><TableHead>Origen</TableHead><TableHead>PostgreSQL</TableHead>
              <TableHead>Storage</TableHead><TableHead>Total</TableHead><TableHead>Drive</TableHead><TableHead>Cloudreve</TableHead><TableHead>Manifiesto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {backups.map((b) => {
              const statusInfo = STATUS_ICONS[b.status]
              const StatusIcon = statusInfo.icon

              return (
                <TableRow
                  key={b.id}
                  className="transition-colors duration-[var(--duration-fast)] hover:bg-[var(--color-primary-tint)]"
                >
                  <TableCell className="whitespace-nowrap font-medium text-[var(--color-text)]">
                    {b.date}
                    <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">
                      {formatDateTime(b.startedAt).slice(11, 16)}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
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
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[var(--color-text-muted)]">
                    {TRIGGER_LABELS[b.trigger]}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[var(--color-text-muted)]">
                    {formatBytes(b.pgSizeBytes)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-[var(--color-text-muted)]">
                    {formatBytes(b.storageSizeBytes)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium text-[var(--color-text)]">
                    {formatBytes(b.totalSizeBytes)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {b.driveUploaded ? (
                      <Cloud size={14} className="text-[var(--color-success)]" />
                    ) : (
                      <span className="text-xs text-[var(--color-text-faint)]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {b.cloudreveUploaded ? (
                      <CloudCheck size={14} className="text-[var(--color-success)]" />
                    ) : (
                      <span className="text-xs text-[var(--color-text-faint)]">—</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {b.manifestSha256 ? (
                      <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs font-mono text-[var(--color-text-muted)]">
                        {b.manifestSha256}…
                      </code>
                    ) : (
                      <span className="text-xs text-[var(--color-text-faint)]">—</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        </TableRoot>
      </div>
    </section>
  )
}
