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
  resultadoBadgeClass,
  estadoBadgeClass,
  estadoLabel,
} from "@/lib/sst/badges"

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
                  className="font-medium text-foreground hover:underline"
                >
                  {ev.workerName || <span className="text-muted-foreground italic">Sin nombre</span>}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {TIPO_LABELS[ev.tipo] ?? ev.tipo}
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {ev.fechaEvaluacion}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {ev.worksiteName || <span className="italic">—</span>}
              </TableCell>
              <TableCell>
                <Badge className={estadoBadgeClass(ev.estado)}>
                  {estadoLabel(ev.estado)}
                </Badge>
              </TableCell>
              <TableCell>
                {ev.resultadoFinal
                  ? (
                    <Badge className={resultadoBadgeClass(ev.resultadoFinal)}>
                      {RESULTADO_LABELS[ev.resultadoFinal] ?? ev.resultadoFinal}
                    </Badge>
                  )
                  : <span className="text-muted-foreground text-sm">—</span>
                }
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableRoot>
  )
}
