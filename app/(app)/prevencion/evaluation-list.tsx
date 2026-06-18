import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  TableRoot, Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import { ClipboardText } from "@phosphor-icons/react/dist/ssr"
import type { SstEvaluation } from "@/db/schema/sst"
import {
  RESULTADO_LABELS,
  estadoLabel,
  estadoBadgeVariant,
  resultadoBadgeVariant,
} from "@/lib/sst/badges"
import { formatDateDisplay } from "@/lib/sst/date"

const TIPO_LABELS: Record<string, string> = {
  nuevo:       "Nuevo",
  seguimiento: "Seguimiento",
}

type EvaluationRow = SstEvaluation & { workerName: string; worksiteName: string }

interface Props {
  evaluations: EvaluationRow[]
  canCreate: boolean
}

export function EvaluationList({ evaluations, canCreate }: Props) {
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
          </TableRow>
        </TableHeader>
        <TableBody>
          {evaluations.map((ev) => (
            <TableRow key={ev.id}>
              <TableCell>
                <Link
                  href={`/prevencion/${ev.id}`}
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
