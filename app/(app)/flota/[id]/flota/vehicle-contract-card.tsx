"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { VehicleAssignmentRow } from "@/lib/services/contracts/assignments"
import { formatDate } from "@/lib/utils"
import { ChangeContractSheet, type ContractChoice } from "./change-contract-sheet"

interface VehicleContractCardProps {
  vehicleId: string
  /** «KA-90 · BPDH-67», o la patente sola si el equipo no tiene código. */
  vehicleLabel: string
  /** Historia del equipo, la más reciente primero. */
  history: VehicleAssignmentRow[]
  /** Contratos activos de la faena del equipo. Sólo se usan con `canChange`. */
  contractOptions: ContractChoice[]
  /** Hoy en Chile (`YYYY-MM-DD`). */
  today: string
  /** `mant:equipment:manage` y alcance de la faena del equipo. La acción lo vuelve a exigir en el servidor. */
  canChange: boolean
}

/** ¿La asignación rige en el día? (ambos extremos inclusivos; `validTo` nulo = sin término) */
function coversDay(row: { validFrom: string; validTo: string | null }, day: string): boolean {
  return row.validFrom <= day && (row.validTo === null || row.validTo >= day)
}

/**
 * Tarjeta «Contrato» de la pestaña Flota: para qué contrato trabaja hoy el equipo y por cuáles
 * pasó. Mismo patrón de lista de intervalos que «Historial de estado operacional».
 */
export function VehicleContractCard({ vehicleId, vehicleLabel, history, contractOptions, today, canChange }: VehicleContractCardProps) {
  const [open, setOpen] = React.useState(false)
  const current = history.find((row) => coversDay(row, today)) ?? null
  // El contrato de hoy va arriba; el resto (anteriores y los que empiezan más adelante) en la lista.
  const others = history.filter((row) => row !== current)

  return (
    <Card id="contrato" className="scroll-mt-4">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle as="h2" className="text-base">Contrato</CardTitle>
        {canChange && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>Cambiar contrato</Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm">
          {current ? (
            <>
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{current.contractName}</span>
                <Badge variant="success">Vigente</Badge>
              </p>
              <p className="text-xs text-[var(--color-text-muted)]">
                <span className="font-mono">{current.contractCode}</span> · desde {formatDate(current.validFrom)}
              </p>
            </>
          ) : (
            <p className="font-medium text-[var(--color-text-muted)]">Sin contrato</p>
          )}
        </div>

        {others.length > 0 && (
          <section aria-labelledby="contrato-historial" className="space-y-1">
            <h3 id="contrato-historial" className="text-eyebrow">Historial</h3>
            <ol className="divide-y divide-[var(--color-border)]">
              {others.map((row) => (
                <li key={row.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4">
                  <div>
                    <p>{row.contractName}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      <span className="font-mono">{row.contractCode}</span>
                      {row.reason ? ` · ${row.reason}` : ""}
                    </p>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] sm:text-right">
                    {formatDate(row.validFrom)}
                    <span className="block">{row.validTo ? `hasta ${formatDate(row.validTo)}` : "sin término"}</span>
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}
      </CardContent>

      {canChange && (
        <ChangeContractSheet
          open={open}
          onClose={() => setOpen(false)}
          vehicleId={vehicleId}
          vehicleLabel={vehicleLabel}
          current={current ? { id: current.contractId, name: current.contractName, code: current.contractCode } : null}
          options={contractOptions}
          today={today}
        />
      )}
    </Card>
  )
}
