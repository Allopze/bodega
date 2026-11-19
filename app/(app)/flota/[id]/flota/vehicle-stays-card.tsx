import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { VehicleStay } from "@/lib/services/fleet-stays"
import { formatDate } from "@/lib/utils"

/** Días corridos de una estadía, ambos extremos incluidos (el día del traslado ya cuenta en la faena nueva). */
function stayDays(startedOn: string, endedOn: string): number {
  return Math.round((Date.parse(`${endedOn}T00:00:00Z`) - Date.parse(`${startedOn}T00:00:00Z`)) / 86_400_000) + 1
}

/** Cómo llegó el equipo a la faena: el traslado (con su folio, motivo y responsables), la reconstrucción o el alta. */
function originText(stay: VehicleStay): string {
  if (stay.transfer) {
    return [
      stay.transfer.folio,
      stay.transfer.reason,
      `autorizado por ${stay.transfer.authorizedBy}`,
      stay.transfer.createdByName ? `registrado por ${stay.transfer.createdByName}` : null,
    ].filter(Boolean).join(" · ")
  }
  if (stay.source === "reconstruccion") return stay.evidence ? `Reconstruido · ${stay.evidence}` : "Reconstruido"
  return "Alta"
}

/**
 * Recorrido del equipo por las faenas, de la más antigua a la actual. Es el dato que sostiene cuánto
 * combustible, kilómetros y mantención se le cargan a cada faena en cada fecha.
 */
export function VehicleStaysCard({ stays }: { stays: VehicleStay[] }) {
  if (stays.length === 0) return null
  return (
    <Card id="recorrido-faenas" className="scroll-mt-4">
      <CardHeader><CardTitle as="h2" className="text-base">Recorrido por faena</CardTitle></CardHeader>
      <CardContent>
        <ol className="divide-y divide-[var(--color-border)]">
          {stays.map((stay) => (
            <li key={stay.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[12rem_1fr_auto] sm:items-center sm:gap-4">
              <p className="font-medium">{stay.worksiteName}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{originText(stay)}</p>
              <p className="text-xs text-[var(--color-text-muted)] sm:text-right">
                {stay.startedOn ? `Desde ${formatDate(stay.startedOn)}` : "Desde el inicio del registro"}
                <span className="block">
                  {stay.endedOn ? `Hasta ${formatDate(stay.endedOn)}` : "Hasta hoy"}
                  {stay.startedOn && stay.endedOn ? ` · ${stayDays(stay.startedOn, stay.endedOn)} días` : ""}
                </span>
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
