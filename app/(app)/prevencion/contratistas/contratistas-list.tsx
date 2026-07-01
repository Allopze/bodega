"use client"

import * as React from "react"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { UsersThree, CaretDown, CaretUp } from "@phosphor-icons/react"
import type { Contractor, ContractorWorker, ContractorDocument } from "@/db/schema"
import { CONTRACTOR_STATUS_LABELS, CONTRACTOR_STATUS_VARIANTS } from "@/lib/prevention/badges"
import { ContratistaDetail } from "./contratista-detail"

interface Props {
  contractors: Contractor[]
  workers: ContractorWorker[]
  documents: ContractorDocument[]
  availableWorkers: { id: string; firstName: string; lastName: string; rut: string | null }[]
  expiringDocumentIds: Set<string>
  canManage: boolean
}

export function ContratistasList({ contractors, workers, documents, availableWorkers, expiringDocumentIds, canManage }: Props) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null)

  if (contractors.length === 0) {
    return (
      <EmptyState
        icon={<UsersThree size={28} />}
        title="Sin contratistas registrados"
        description="Registra un contratista para asociar trabajadores y llevar su documentación habilitante (Ley 20.123)."
      />
    )
  }

  return (
    <TableRoot>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead aria-hidden className="w-8" />
            <TableHead>RUT</TableHead>
            <TableHead>Razón social</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Alertas</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contractors.map((c) => {
            const isOpen = expandedId === c.id
            const contractorDocuments = documents.filter((d) => d.contractorId === c.id)
            const hasExpiring = contractorDocuments.some((d) => expiringDocumentIds.has(d.id))
            return (
              <React.Fragment key={c.id}>
                <TableRow className="cursor-pointer" onClick={() => setExpandedId(isOpen ? null : c.id)} aria-expanded={isOpen}>
                  <TableCell>
                    <Button variant="ghost" size="icon-sm" aria-label={isOpen ? "Contraer" : "Expandir"}>
                      {isOpen ? <CaretUp size={14} /> : <CaretDown size={14} />}
                    </Button>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.rut}</TableCell>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>
                    <Badge variant={CONTRACTOR_STATUS_VARIANTS[c.status] ?? "default"}>
                      {CONTRACTOR_STATUS_LABELS[c.status] ?? c.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {hasExpiring ? <Badge variant="warning">Documentos por vencer</Badge> : null}
                  </TableCell>
                </TableRow>
                {isOpen ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="bg-[var(--color-surface-2)] p-0">
                      <ContratistaDetail
                        contractor={c}
                        workers={workers.filter((w) => w.contractorId === c.id)}
                        documents={contractorDocuments}
                        availableWorkers={availableWorkers}
                        expiringDocumentIds={expiringDocumentIds}
                        canManage={canManage}
                      />
                    </TableCell>
                  </TableRow>
                ) : null}
              </React.Fragment>
            )
          })}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
