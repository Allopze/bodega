"use client"

import * as React from "react"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { WarningDiamond, Plus } from "@phosphor-icons/react"
import type { IperMatrix } from "@/db/schema"
import { IperForm } from "./iper-form"

interface Props {
  matrices: IperMatrix[]
  worksites: { id: string; name: string }[]
  canManage: boolean
  showForm: boolean
  onShowFormChange: (show: boolean) => void
}

const RISK_BADGE: Record<string, "default" | "warning" | "danger" | "success"> = {
  draft:   "default",
  active:  "warning",
  closed:  "success",
}

const STATUS_LABEL: Record<string, string> = {
  draft:  "Borrador",
  active: "Vigente",
  closed: "Cerrada",
}

export function IperList({ matrices, worksites, canManage, showForm, onShowFormChange }: Props) {
  const worksiteName = React.useCallback(
    (id: string) => worksites.find((w) => w.id === id)?.name ?? id,
    [worksites],
  )

  if (matrices.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={<WarningDiamond size={28} />}
          title="Sin matrices de riesgos"
          description="No hay matrices de identificación de peligros y evaluación de riesgos registradas para tu alcance."
          action={
            canManage ? (
              <Button onClick={() => onShowFormChange(true)}>
                <Plus size={16} className="mr-1" />
                Nueva matriz de riesgos
              </Button>
            ) : undefined
          }
        />
        {canManage && showForm ? (
          <IperForm worksites={worksites} onDone={() => onShowFormChange(false)} />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && showForm ? (
        <IperForm worksites={worksites} onDone={() => onShowFormChange(false)} />
      ) : null}

      <TableRoot>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Faena</TableHead>
              <TableHead>Versión</TableHead>
              <TableHead>Vigencia</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {matrices.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-xs">{m.code}</TableCell>
                <TableCell className="font-medium">{m.title}</TableCell>
                <TableCell>{worksiteName(m.worksiteId)}</TableCell>
                <TableCell className="font-mono">v{m.version}</TableCell>
                <TableCell>{m.effectiveFrom}</TableCell>
                <TableCell>
                  <Badge variant={RISK_BADGE[m.status] ?? "default"}>
                    {STATUS_LABEL[m.status] ?? m.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableRoot>
    </div>
  )
}
