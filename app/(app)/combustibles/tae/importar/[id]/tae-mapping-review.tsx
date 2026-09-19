"use client"

import * as React from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { toast } from "@/lib/toast"
import { saveTaeVehicleMappingAction, saveTaeWorkerMappingAction } from "../actions"

export interface CatalogOption { id: string; label: string }
export interface AmbiguousIdentity { kind: "vehicle" | "driver" | "supervisor"; worksiteId: string; worksiteName: string; legacyValue: string }

const KIND_LABEL: Record<AmbiguousIdentity["kind"], string> = { vehicle: "Equipo", driver: "Conductor", supervisor: "Supervisor" }

export function TaeMappingReview({ items, vehicleOptions, workerOptions }: { items: AmbiguousIdentity[]; vehicleOptions: Record<string, CatalogOption[]>; workerOptions: Record<string, CatalogOption[]> }) {
  const [resolved, setResolved] = React.useState<Set<string>>(new Set())
  const pending = items.filter((item) => !resolved.has(`${item.kind}:${item.worksiteId}:${item.legacyValue}`))

  if (pending.length === 0) return <p className="text-sm text-(--color-text-muted)">Todas las identidades ambiguas de este lote ya tienen una decisión.</p>

  return (
    <div className="space-y-2">
      {pending.map((item) => (
        <MappingRow
          key={`${item.kind}:${item.worksiteId}:${item.legacyValue}`}
          item={item}
          options={(item.kind === "vehicle" ? vehicleOptions : workerOptions)[item.worksiteId] ?? []}
          onResolved={() => setResolved((prev) => new Set(prev).add(`${item.kind}:${item.worksiteId}:${item.legacyValue}`))}
        />
      ))}
    </div>
  )
}

function MappingRow({ item, options, onResolved }: { item: AmbiguousIdentity; options: CatalogOption[]; onResolved: () => void }) {
  const [selected, setSelected] = React.useState("")
  const [pending, startTransition] = React.useTransition()

  function save(targetId: string | null) {
    startTransition(async () => {
      const result = item.kind === "vehicle"
        ? await saveTaeVehicleMappingAction({ worksiteId: item.worksiteId, legacyCode: item.legacyValue, vehicleId: targetId })
        : await saveTaeWorkerMappingAction({ worksiteId: item.worksiteId, role: item.kind, legacyName: item.legacyValue, workerId: targetId })
      if (!result.ok) { toast.error(result.message); return }
      toast.success(result.message ?? "Decisión guardada")
      onResolved()
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-(--color-border) p-3 text-sm">
      <div>
        <span className="text-xs text-(--color-text-muted)">{KIND_LABEL[item.kind]} · {item.worksiteName}</span>
        <p className="font-medium">{item.legacyValue}</p>
      </div>
      <div className="flex items-center gap-2">
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger aria-label="Selecciona del catálogo" className="w-56"><SelectValue placeholder="Selecciona del catálogo" /></SelectTrigger>
          <SelectContent>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" size="sm" disabled={!selected || pending} onClick={() => save(selected)}>Asignar</Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => save(null)}>Sin equivalente</Button>
      </div>
    </div>
  )
}
