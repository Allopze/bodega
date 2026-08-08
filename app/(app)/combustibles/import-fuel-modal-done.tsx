"use client"

import { CheckCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import type { ImportResult } from "./import-fuel-modal.helpers"

interface DoneStepProps {
  result: ImportResult
  onImportAnother: () => void
  onClose: () => void
}

export function DoneStep({ result, onImportAnother, onClose }: DoneStepProps) {
  return (
    <div className="text-center space-y-4 py-4">
      <CheckCircle className="h-12 w-12 mx-auto text-[var(--color-success)]" />
      <div>
        <p className="text-2xl font-bold">{result.imported}</p>
        <p className="text-[var(--color-text-muted)]">cargas importadas exitosamente</p>
      </div>

      {result.created.length > 0 && (
        <div className="text-sm text-left p-3 bg-[var(--color-surface-2)] rounded-md">
          <p className="font-medium mb-1">Entidades creadas automáticamente:</p>
          {result.created.map((c) => (
            <p key={`${c.type}:${c.name}`} className="text-[var(--color-text-muted)]">
              • {c.type.charAt(0).toUpperCase() + c.type.slice(1)}: {c.name}
            </p>
          ))}
        </div>
      )}

      {result.errors.length > 0 && (
        <div className="text-sm text-left p-3 bg-[var(--color-warning-tint)] rounded-md">
          <p className="font-medium text-[var(--color-warning-ink)] mb-1">
            {result.errors.length} filas omitidas por errores:
          </p>
          <div className="max-h-32 overflow-y-auto space-y-0.5 text-[var(--color-text-muted)]">
            {Object.entries(
              result.errors.reduce<Record<string, number>>((acc, e) => {
                const key = `${e.field}: ${e.message}`
                acc[key] = (acc[key] ?? 0) + 1
                return acc
              }, {}),
            )
              .sort((a, b) => b[1] - a[1])
              .map(([reason, count]) => (
                <p key={reason}>
                  • {reason} <span className="font-mono">({count})</span>
                </p>
              ))}
          </div>
        </div>
      )}

      <div className="flex justify-center gap-3">
        <Button variant="secondary" onClick={onImportAnother}>
          Importar otro archivo
        </Button>
        <Button onClick={onClose}>Cerrar</Button>
      </div>
    </div>
  )
}
