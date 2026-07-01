"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDateSafe } from "@/lib/sst/date"
import { CONTRACTOR_DOCUMENT_TYPE_LABELS, CONTRACTOR_DOCUMENT_STATUS_LABELS, CONTRACTOR_DOCUMENT_STATUS_VARIANTS } from "@/lib/prevention/badges"
import type { Contractor, ContractorWorker, ContractorDocument } from "@/db/schema"
import { ContractorWorkerForm } from "./contractor-worker-form"
import { ContractorDocumentForm } from "./contractor-document-form"

interface Props {
  contractor: Contractor
  workers: ContractorWorker[]
  documents: ContractorDocument[]
  availableWorkers: { id: string; firstName: string; lastName: string; rut: string | null }[]
  expiringDocumentIds: Set<string>
  canManage: boolean
}

export function ContratistaDetail({ contractor, workers, documents, availableWorkers, expiringDocumentIds, canManage }: Props) {
  const [activeForm, setActiveForm] = React.useState<"worker" | "document" | null>(null)

  const workerLabel = React.useCallback(
    (workerId: string) => {
      const w = availableWorkers.find((worker) => worker.id === workerId)
      return w ? `${w.firstName} ${w.lastName}` : workerId
    },
    [availableWorkers],
  )

  return (
    <div className="flex flex-col gap-6 p-4">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Trabajadores destinados</h3>
          {canManage ? (
            <Button size="sm" variant={activeForm === "worker" ? "ghost" : "secondary"} onClick={() => setActiveForm((f) => (f === "worker" ? null : "worker"))}>
              <Plus size={14} className="mr-1" />
              {activeForm === "worker" ? "Cancelar" : "Agregar trabajador"}
            </Button>
          ) : null}
        </div>
        {activeForm === "worker" ? (
          <ContractorWorkerForm contractorId={contractor.id} workers={availableWorkers} onDone={() => setActiveForm(null)} />
        ) : null}
        {workers.length === 0 ? (
          <p className="text-sm text-[var(--color-text-subtle)]">Sin trabajadores asociados.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {workers.map((w) => (
              <li key={w.id} className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                <span className="font-medium">{workerLabel(w.workerId)}</span>
                <span className="text-[var(--color-text-subtle)]">— {w.position}</span>
                {w.endDate ? <Badge variant="outline">Finalizado {formatDateSafe(w.endDate)}</Badge> : <Badge variant="success">Activo</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Documentación (Ley 20.123)</h3>
          {canManage ? (
            <Button size="sm" variant={activeForm === "document" ? "ghost" : "secondary"} onClick={() => setActiveForm((f) => (f === "document" ? null : "document"))}>
              <Plus size={14} className="mr-1" />
              {activeForm === "document" ? "Cancelar" : "Agregar documento"}
            </Button>
          ) : null}
        </div>
        {activeForm === "document" ? (
          <ContractorDocumentForm contractorId={contractor.id} onDone={() => setActiveForm(null)} />
        ) : null}
        {documents.length === 0 ? (
          <p className="text-sm text-[var(--color-text-subtle)]">Sin documentos registrados.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                <span className="font-medium">{CONTRACTOR_DOCUMENT_TYPE_LABELS[d.type] ?? d.type}</span>
                <Badge variant={CONTRACTOR_DOCUMENT_STATUS_VARIANTS[d.status] ?? "default"}>
                  {CONTRACTOR_DOCUMENT_STATUS_LABELS[d.status] ?? d.status}
                </Badge>
                {d.expiresAt ? (
                  <span className={expiringDocumentIds.has(d.id) ? "text-[var(--color-danger-ink)]" : "text-[var(--color-text-subtle)]"}>
                    Vence {formatDateSafe(d.expiresAt)}{expiringDocumentIds.has(d.id) ? " · próximo a vencer" : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
