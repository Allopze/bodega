"use client"

import { MetaBadge } from "@/components/states/state-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function ImportBatchStatusBadge({ status }: { status: string }) {
  return <MetaBadge meta={status === "revertido" ? { label: "Revertido", variant: "danger" } : { label: "Importado", variant: "success" }} />
}

export function ImportStatusFilter({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Estado" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="todas">Todos</SelectItem>
        <SelectItem value="importado">Importado</SelectItem>
        <SelectItem value="revertido">Revertido</SelectItem>
      </SelectContent>
    </Select>
  )
}
