"use client"

import * as React from "react"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ShieldCheck, Plus } from "@phosphor-icons/react"
import { EppMatrixForm } from "./epp-matrix-form"

interface EppMatrixEntry {
  id: string
  position: string
  eppProductId: string
  riskId: string | null
  notes: string | null
}

interface Props {
  entries: EppMatrixEntry[]
  worksites: { id: string; name: string }[]
  selectedWorksiteId?: string
  canManage: boolean
  showForm: boolean
  onShowFormChange: (show: boolean) => void
}

export function EppMatrixList({ entries, worksites, selectedWorksiteId, canManage, showForm, onShowFormChange }: Props) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={<ShieldCheck size={28} />}
          title="Sin entradas en la matriz"
          description="No hay elementos de protección personal asignados por cargo para esta faena."
          action={
            canManage ? (
              <Button onClick={() => onShowFormChange(true)}>
                <Plus size={16} className="mr-1" />
                Nueva entrada
              </Button>
            ) : undefined
          }
        />
        {canManage && showForm ? (
          <EppMatrixForm worksites={worksites} defaultWorksiteId={selectedWorksiteId} onDone={() => onShowFormChange(false)} />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && showForm ? (
        <EppMatrixForm worksites={worksites} defaultWorksiteId={selectedWorksiteId} onDone={() => onShowFormChange(false)} />
      ) : null}

      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cargo</TableHead>
              <TableHead>EPP</TableHead>
              <TableHead>Riesgo IPER</TableHead>
              <TableHead>Notas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-medium">{e.position}</TableCell>
                <TableCell className="font-mono text-xs">{e.eppProductId}</TableCell>
                <TableCell>{e.riskId ?? "-"}</TableCell>
                <TableCell>{e.notes ?? "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </div>
  )
}
