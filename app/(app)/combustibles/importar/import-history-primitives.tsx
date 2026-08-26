"use client"

import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function ImportBatchStatusBadge({ status }: { status: string }) {
  return <Badge variant={status === "revertido" ? "danger" : "success"} size="sm">{status === "revertido" ? "Revertido" : "Importado"}</Badge>
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
