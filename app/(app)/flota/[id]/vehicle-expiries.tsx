"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { ExpiryStatus } from "@/components/ui/expiry-status"
import type { VehicleExpiryField } from "@/lib/combustibles/validation"
import { compareExpiryUrgency, expiryState } from "@/lib/expiry"
import { VehicleExpiriesSheet, type VehicleExpiryRow } from "./vehicle-expiries-sheet"

interface VehicleExpiriesProps {
  vehicleId: string
  vehicleLabel: string
  /** Las cuatro filas en el orden fijo de la ficha; esta lista las ordena por urgencia. */
  rows: VehicleExpiryRow[]
  today: string
  warningDays: number
  /** `flota:manage_documents` y alcance de la faena del equipo. La acción lo vuelve a exigir en el servidor. */
  canEdit: boolean
}

/**
 * Contenido de la tarjeta «Vencimientos» de la ficha: SOAP, permiso de
 * circulación, revisión técnica y seguro, lo vencido primero y lo sin fecha al
 * final, cada uno con su «Actualizar».
 *
 * La fecha que rige es la del equipo y, a falta de ella, la del documento
 * vigente subido (misma precedencia que la lista y los avisos); en ese caso la
 * fila lo dice.
 */
export function VehicleExpiries({ vehicleId, vehicleLabel, rows, today, warningDays, canEdit }: VehicleExpiriesProps) {
  const [sheet, setSheet] = React.useState<{ open: boolean; focusField: VehicleExpiryField }>({
    open: false,
    focusField: rows[0]?.field ?? "soapExpiresAt",
  })

  const sorted = React.useMemo(
    () => rows
      .map((row) => {
        const expiresAt = row.declared ?? row.documentExpiresAt
        return { ...row, fromDocument: !row.declared && !!row.documentExpiresAt, status: expiryState(expiresAt, today, warningDays) }
      })
      .sort((a, b) => compareExpiryUrgency(a.status, b.status)),
    [rows, today, warningDays],
  )

  return (
    <>
      <ul aria-label="Vencimientos del equipo" className="divide-y divide-[var(--color-border)]">
        {sorted.map((row) => (
          <li key={row.field} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--color-text)]">{row.label}</p>
              <ExpiryStatus status={row.status} warningDays={warningDays} layout="stacked" className="mt-1" />
              {row.fromDocument && (
                <p className="mt-1 text-xs text-[var(--color-text-subtle)]">según documento subido</p>
              )}
            </div>
            {canEdit && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                // Empieza con el texto visible (WCAG 2.5.3) y dice de qué documento habla: hay cuatro «Actualizar».
                aria-label={`Actualizar ${row.label}`}
                onClick={() => setSheet({ open: true, focusField: row.field })}
              >
                Actualizar
              </Button>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <VehicleExpiriesSheet
          open={sheet.open}
          onClose={() => setSheet((current) => ({ ...current, open: false }))}
          vehicleId={vehicleId}
          vehicleLabel={vehicleLabel}
          rows={rows}
          focusField={sheet.focusField}
          today={today}
          warningDays={warningDays}
        />
      )}
    </>
  )
}
