"use client"

import * as React from "react"
import Image from "next/image"
import Link from "next/link"
import { formatDate, formatDateTime } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { X } from "@phosphor-icons/react"
import { IT_ASSIGNMENT_KIND_META, IT_PHYSICAL_STATE_META } from "@/lib/services/ti/constants"
import { AssignmentSheet } from "../../asignaciones/assignment-sheet"
import { ReturnSheet } from "../../asignaciones/return-sheet"
import { TransferSheet } from "../../asignaciones/transfer-sheet"

interface PhotoRecord {
  id: string
  stage: string
  fileName: string
  filePath: string
  mimeType: string | null
  caption: string | null
  uploadedAt: string
  uploadedByName: string | null
}

interface AssignmentRow {
  id: string
  code: string
  assetId: string
  assetCode: string
  assetBrand: string | null
  assetModel: string | null
  workerId: string
  workerName: string
  worksiteId: string
  worksiteName: string
  kind: string
  deliveredAt: string
  physicalState: string
  returnedAt: string | null
  returnPhysicalState: string | null
  deliveredByName: string | null
  photos: PhotoRecord[]
  accessories: { id: string; name: string; returnedAt: string | null }[]
}

function PhotoThumb({ photo, label }: { photo: PhotoRecord; label: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group block w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] text-left transition-colors hover:border-[var(--color-primary-line)]"
      >
        <Image
          unoptimized
          src={`/api/ti/photos/${photo.id}`}
          alt={photo.caption || label}
          width={480}
          height={320}
          className="aspect-[4/3] w-full object-cover"
        />
        <span className="block p-2">
          <span className="block truncate text-xs font-medium text-[var(--color-text)]">{photo.caption || photo.fileName}</span>
          <span className="mt-0.5 block text-[11px] text-[var(--color-text-muted)]">{formatDate(photo.uploadedAt)} · {photo.uploadedByName ?? "Sistema"}</span>
        </span>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label={photo.caption || "Fotografía de evidencia"}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar fotografía"
            className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:h-8 sm:w-8"
          >
            <X size={18} />
          </button>
          <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <Image unoptimized src={`/api/ti/photos/${photo.id}`} alt={photo.caption || "Evidencia"} width={1400} height={900} className="max-h-[85vh] w-auto rounded object-contain" />
            <p className="mt-2 text-center text-xs text-white/60">
              {photo.caption || photo.fileName} · subida {formatDateTime(photo.uploadedAt)} por {photo.uploadedByName ?? "Sistema"}
            </p>
          </div>
        </div>
      )}
    </>
  )
}

function PhotoCompare({ row }: { row: AssignmentRow }) {
  const delivery = row.photos.filter((p) => p.stage === "delivery")
  const returned = row.photos.filter((p) => p.stage === "return")
  if (delivery.length === 0 && returned.length === 0) return null

  return (
    <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
      <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
        Evidencia fotográfica — comparación entrega vs devolución
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold text-[var(--color-text)]">Estado al entregar</p>
          {delivery.length === 0 ? (
            <p className="text-xs italic text-[var(--color-text-subtle)]">Sin fotografías de entrega.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {delivery.map((photo) => <PhotoThumb key={photo.id} photo={photo} label="Foto de entrega" />)}
            </div>
          )}
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-[var(--color-text)]">Estado al devolver</p>
          {returned.length === 0 ? (
            <p className="text-xs italic text-[var(--color-text-subtle)]">{row.returnedAt ? "Sin fotografías de devolución." : "Aún no devuelto."}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {returned.map((photo) => <PhotoThumb key={photo.id} photo={photo} label="Foto de devolución" />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface AssetAssignmentsProps {
  assetId: string
  rows: AssignmentRow[]
  activeAssignment: AssignmentRow | null
  canManage: boolean
  workers: { id: string; name: string; lastName: string }[]
  worksites: { id: string; name: string }[]
  suppliers: { id: string; name: string }[]
}

export function AssetAssignments({ assetId, rows, activeAssignment, canManage, workers, worksites }: AssetAssignmentsProps) {
  return (
    <div className="space-y-4">
      {canManage && activeAssignment && (
        <div className="flex items-center justify-between rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-xs">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">Custodia vigente — acta {activeAssignment.code}</p>
            <p className="text-xs text-[var(--color-text-muted)]">{activeAssignment.workerName} · {activeAssignment.worksiteName}</p>
          </div>
          <div className="flex items-center gap-2">
            <TransferSheet
              trigger={<Button type="button" variant="secondary" size="sm">Transferir</Button>}
              assignment={activeAssignment}
              workers={workers}
              worksites={worksites}
            />
            <ReturnSheet
              trigger={<Button type="button" variant="secondary" size="sm">Registrar devolución</Button>}
              assignment={activeAssignment}
            />
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="Sin asignaciones"
          description="Este activo aún no tiene entregas registradas."
          action={canManage ? (
            <AssignmentSheet
              trigger={<Button type="button" variant="link" size="sm">Registrar entrega</Button>}
              assetId={assetId}
              workers={workers}
              worksites={worksites}
            />
          ) : undefined}
        />
      ) : (
        rows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-[var(--color-primary)]">{row.code}</span>
                <Badge variant={row.returnedAt ? "default" : "info"}>{row.returnedAt ? "Devuelto" : "Vigente"}</Badge>
                <span className="text-xs text-[var(--color-text-muted)]">{IT_ASSIGNMENT_KIND_META[row.kind] ?? row.kind}</span>
              </div>
              <div className="flex items-center gap-3">
                <Link href={`/ti/actas/${row.id}/print`} className="text-xs font-semibold text-[var(--color-primary)] hover:underline">
                  Ver acta
                </Link>
              </div>
            </div>

            <dl className="mt-3 grid gap-x-6 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Entregado a</dt>
                <dd className="font-medium text-[var(--color-text)]">{row.workerName}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Fecha de entrega</dt>
                <dd className="font-medium text-[var(--color-text)]">{formatDateTime(row.deliveredAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Estado físico al entregar</dt>
                <dd className="font-medium text-[var(--color-text)]">{IT_PHYSICAL_STATE_META[row.physicalState]?.label ?? row.physicalState}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--color-text-muted)]">Estado físico al devolver</dt>
                <dd className="font-medium text-[var(--color-text)]">
                  {row.returnPhysicalState ? IT_PHYSICAL_STATE_META[row.returnPhysicalState]?.label ?? row.returnPhysicalState : "—"}
                </dd>
              </div>
            </dl>

            {row.accessories.length > 0 && (
              <div className="mt-3">
                <dt className="text-xs text-[var(--color-text-muted)]">Accesorios</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {row.accessories.map((acc) => (
                    <Badge key={acc.id} variant={acc.returnedAt ? "default" : "outline"}>
                      {acc.name}{acc.returnedAt ? " (devuelto)" : ""}
                    </Badge>
                  ))}
                </dd>
              </div>
            )}

            <PhotoCompare row={row} />
          </article>
        ))
      )}
    </div>
  )
}
