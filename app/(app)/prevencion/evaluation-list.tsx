"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useActionState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog"
import { ClipboardText, Trash } from "@phosphor-icons/react"
import type { SstEvaluation } from "@/db/schema/sst"
import {
  RESULTADO_LABELS,
  estadoLabel,
  estadoBadgeVariant,
  resultadoBadgeVariant,
} from "@/lib/sst/badges"
import { formatDateDisplay } from "@/lib/sst/date"
import { deleteEvaluationAction } from "./actions"
import type { ActionState } from "@/lib/validation/sst"
import { toast } from "@/lib/toast"

const TIPO_LABELS: Record<string, string> = {
  nuevo:       "Nuevo",
  seguimiento: "Seguimiento",
}

type EvaluationRow = SstEvaluation & { workerName: string; worksiteName: string }

interface Props {
  evaluations: EvaluationRow[]
  canCreate: boolean
  canDelete: boolean
}

export function EvaluationList({ evaluations, canCreate, canDelete }: Props) {
  const router = useRouter()
  const [deleteTarget, setDeleteTarget] = React.useState<EvaluationRow | null>(null)
  const [_deleteState, deleteAction, deletePending] = useActionState(
    async (prev: ActionState, formData: FormData): Promise<ActionState> => {
      const res = await deleteEvaluationAction(prev, formData)
      if (res.ok) {
        toast.success(res.message ?? "Evaluación eliminada")
        setDeleteTarget(null)
      } else {
        toast.error(res.message ?? "Error al eliminar")
      }
      return res
    },
    { ok: false },
  )

  if (evaluations.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardText size={28} />}
        title="Sin evaluaciones"
        description="No hay evaluaciones SST registradas para tu faena."
        action={
          canCreate ? (
            <Button asChild>
              <Link href="/prevencion/nueva">Nueva Evaluación</Link>
            </Button>
          ) : undefined
        }
      />
    )
  }

  return (
    <TableRoot>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Trabajador</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Fecha</TableHead>
            <TableHead>Faena</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Resultado</TableHead>
            {canDelete && <TableHead><span className="sr-only">Acciones</span></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {evaluations.map((ev) => {
            const href = `/prevencion/${ev.id}`

            return (
              <TableRow
                key={ev.id}
                role="link"
                tabIndex={0}
                aria-label={`Abrir evaluación SST de ${ev.workerName || "trabajador sin nombre"}`}
                className="cursor-pointer"
                onClick={() => router.push(href)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    router.push(href)
                  }
                }}
              >
                <TableCell>
                  <Link
                    href={href}
                    onClick={(event) => event.stopPropagation()}
                    className="font-medium text-(--color-text) hover:underline"
                  >
                    {ev.workerName || <span className="text-text-subtle italic">Sin nombre</span>}
                  </Link>
                </TableCell>
                <TableCell className="text-(--color-text-muted)">
                  {TIPO_LABELS[ev.tipo] ?? ev.tipo}
                </TableCell>
                <TableCell className="text-(--color-text-muted) tabular-nums">
                  {formatDateDisplay(ev.fechaEvaluacion)}
                </TableCell>
                <TableCell className="text-(--color-text-muted)">
                  {ev.worksiteName || <span className="italic">—</span>}
                </TableCell>
                <TableCell>
                  <Badge variant={estadoBadgeVariant(ev.estado)}>
                    {estadoLabel(ev.estado)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {ev.resultadoFinal
                    ? (
                      <Badge variant={resultadoBadgeVariant(ev.resultadoFinal)}>
                        {RESULTADO_LABELS[ev.resultadoFinal] ?? ev.resultadoFinal}
                      </Badge>
                    )
                    : <span className="text-(--color-text-muted) text-sm">—</span>
                  }
                </TableCell>
                {canDelete && (
                  <TableCell className="w-12 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-[var(--color-text-subtle)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger-ink)]"
                      aria-label="Eliminar evaluación"
                      onClick={(event) => {
                        event.stopPropagation()
                        setDeleteTarget(ev)
                      }}
                    >
                      <Trash size={14} />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar evaluación?</DialogTitle>
            <DialogDescription>
              Esta acción eliminará la evaluación SST y sus respuestas, seguimientos y plan de acción.
            </DialogDescription>
          </DialogHeader>
          <form action={deleteAction}>
            <input type="hidden" name="evaluationId" value={deleteTarget?.id ?? ""} />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary" size="sm">Cancelar</Button>
              </DialogClose>
              <Button type="submit" variant="destructive" size="sm" disabled={deletePending}>
                {deletePending ? "Eliminando..." : "Eliminar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </TableRoot>
  )
}
