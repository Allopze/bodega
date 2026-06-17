import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { SstEvaluation } from "@/db/schema/sst"

type EvaluationRow = SstEvaluation & { workerName: string; worksiteName: string }

const TIPO_LABELS: Record<string, string> = {
  nuevo:       "Nuevo",
  seguimiento: "Seguimiento",
}

const RESULTADO_LABELS: Record<string, string> = {
  habilitado_autonomo:      "Habilitado Autónomo",
  habilitado_restricciones: "Habilitado c/Restricciones",
  no_habilitado:            "No Habilitado",
}

function EstadoBadge({ estado }: { estado: string }) {
  if (estado === "cerrado") {
    return <Badge className="bg-green-100 text-green-800 border-green-200">Cerrado</Badge>
  }
  return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Borrador</Badge>
}

function ResultadoBadge({ resultado }: { resultado: string | null }) {
  if (!resultado) return <span className="text-muted-foreground text-sm">—</span>
  if (resultado === "no_habilitado") {
    return <Badge className="bg-red-100 text-red-800 border-red-200">{RESULTADO_LABELS[resultado] ?? resultado}</Badge>
  }
  if (resultado === "habilitado_autonomo") {
    return <Badge className="bg-green-100 text-green-800 border-green-200">{RESULTADO_LABELS[resultado] ?? resultado}</Badge>
  }
  if (resultado === "habilitado_restricciones") {
    return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">{RESULTADO_LABELS[resultado] ?? resultado}</Badge>
  }
  return <Badge variant="outline">{resultado}</Badge>
}

interface Props {
  evaluations: EvaluationRow[]
  canCreate: boolean
}

export function EvaluationList({ evaluations, canCreate }: Props) {
  if (evaluations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <p className="text-lg font-medium mb-2">Sin evaluaciones</p>
        <p className="text-sm mb-6">No hay evaluaciones SST registradas para tu faena.</p>
        {canCreate && (
          <Button asChild>
            <Link href="/prevencion/nueva">Nueva Evaluación</Link>
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Trabajador</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Tipo</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Fecha</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Faena</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Resultado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-background">
          {evaluations.map((ev) => (
            <tr key={ev.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3">
                <Link href={`/prevencion/${ev.id}`} className="font-medium text-foreground hover:underline">
                  {ev.workerName || <span className="text-muted-foreground italic">Sin nombre</span>}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {TIPO_LABELS[ev.tipo] ?? ev.tipo}
              </td>
              <td className="px-4 py-3 text-muted-foreground tabular-nums">
                {ev.fechaEvaluacion}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {ev.worksiteName || <span className="italic">—</span>}
              </td>
              <td className="px-4 py-3">
                <EstadoBadge estado={ev.estado} />
              </td>
              <td className="px-4 py-3">
                <ResultadoBadge resultado={ev.resultadoFinal} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
