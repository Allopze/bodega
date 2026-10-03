"use client"

import { useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { applyEntryValues } from "@/lib/prevention/miper/entry-values"
import type { MiperEntrySnapshot } from "@/lib/prevention/miper/snapshot"
import type { MiperEntryValues } from "@/lib/validation/prevention-module/miper"
import type { AutosaveSync } from "./use-entry-autosave"

/** Lo que las acciones masivas (Fase D) necesitan del espacio de trabajo. Lo arma `miper-workspace.tsx`. */
export type BulkContext = {
  matrixId: string
  sync: AutosaveSync
  /** Aplica un cambio de riesgos en pantalla sin esperar la foto del servidor. */
  setRows: (updater: (rows: MiperEntrySnapshot[]) => MiperEntrySnapshot[]) => void
  riskFactors: ReadonlyArray<{ id: string; name: string }>
  responsibleOptions: ReadonlyArray<{ id: string; name: string }>
  measureSuggestions: readonly string[]
  dictionaries: { activities: readonly string[]; tasks: readonly string[]; positions: readonly string[]; locations: readonly string[] }
  controlVersions: Readonly<Record<string, number>>
}

export type EntryItem = { entryId: string; expectedVersion: number }

/** Sin versión conocida de un riesgo no se adivina una: se pide recargar. */
export const MISSING_VERSION = { ok: false as const, message: "Falta la versión de un riesgo; recarga la matriz." }

/**
 * Las versiones que se envían, leídas DESPUÉS de que terminen los guardados en
 * curso de esos riesgos (`whenIdle`): si no, un campo que se guardaba al salir
 * del editor dejaba una versión vieja y el lote chocaba consigo mismo.
 */
export async function entryItems(sync: AutosaveSync, entries: readonly MiperEntrySnapshot[]): Promise<EntryItem[] | null> {
  const ids = entries.map((entry) => entry.id)
  await sync.whenIdle(ids)
  const items: EntryItem[] = []
  for (const entryId of ids) {
    const expectedVersion = sync.versionOf(entryId)
    if (expectedVersion === undefined) return null
    items.push({ entryId, expectedVersion })
  }
  return items
}

/**
 * Después de un cambio de riesgos en lote: anota las versiones nuevas (el
 * siguiente guardado automático de cada uno parte de ahí) y aplica el cambio en
 * pantalla. La foto del servidor llega después, con la revalidación, y como trae
 * esas mismas versiones la reemplaza. Sólo se anotan y aplican los ids que el
 * servidor devolvió: con cero escritos (`entries` vacío) no cambia nada.
 */
export function settlePatchedEntries(context: BulkContext, data: Record<string, unknown> | undefined, values: MiperEntryValues) {
  const list = Array.isArray(data?.entries) ? data.entries : []
  const versions = Object.fromEntries(list.flatMap((item: unknown) => {
    const saved = item as { id?: unknown; version?: unknown }
    return typeof saved?.id === "string" && typeof saved.version === "number" ? [[saved.id, saved.version] as const] : []
  }))
  context.sync.acknowledge(versions)
  context.setRows((rows) => rows.map((row) => (row.id in versions ? applyEntryValues(row, values, context.riskFactors) : row)))
}

/**
 * Marco común de los diálogos de lote: el efecto en la completitud antes de
 * aplicar (no impide: el editor tampoco), el rechazo del servidor con «Recargar
 * la matriz» y el diálogo que no se cierra mientras guarda.
 */
export function BulkDialog({ open, onOpenChange, title, description, impact, error, busy, confirmLabel, confirmDisabled, onConfirm, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  impact: string | null
  error: string
  busy: boolean
  confirmLabel: string
  confirmDisabled: boolean
  onConfirm: () => void
  children: ReactNode
}) {
  const router = useRouter()
  const [reloading, startReload] = useTransition()
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {children}
          {impact && (
            <Callout tone="warning" title="Antes de aplicar">
              {impact} Puedes aplicarlo igual y completarlos después: el envío a revisión los va a pedir.
            </Callout>
          )}
          {error && (
            <Callout tone="danger" role="alert">
              <p>{error}</p>
              <Button className="mt-2" size="sm" variant="secondary" loading={reloading} onClick={() => startReload(() => router.refresh())}>Recargar la matriz</Button>
            </Callout>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button loading={busy} disabled={confirmDisabled} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
