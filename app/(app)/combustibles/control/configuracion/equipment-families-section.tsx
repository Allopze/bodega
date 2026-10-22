"use client"

import * as React from "react"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { PERFORMANCE_FAMILIES, PERFORMANCE_FAMILY_LABELS, type PerformanceFamily } from "@/lib/combustibles/control/contracts"
import { useOperation } from "@/lib/hooks/use-operation"
import { formatQty } from "@/lib/utils"
import { setEquipmentTypeFamilyAction } from "./actions"
import { ConfigSection } from "./config-section"
import type { EquipmentTypeRow } from "./config-types"

const OUTSIDE = "_none"

export function EquipmentFamiliesSection({ types }: { types: EquipmentTypeRow[] }) {
  const op = useOperation({ feedback: "toast" })
  // Valor elegido: se muestra de inmediato y coincide con el que queda en la base; si la acción falla, vuelve al anterior.
  const [overrides, setOverrides] = React.useState<Record<string, PerformanceFamily | null>>({})

  function change(type: EquipmentTypeRow, value: string) {
    const family = value === OUTSIDE ? null : (value as PerformanceFamily)
    setOverrides((current) => ({ ...current, [type.id]: family }))
    op.run(
      () => setEquipmentTypeFamilyAction({ equipmentTypeId: type.id, family }),
      undefined,
      () => setOverrides((current) => { const { [type.id]: _failed, ...rest } = current; return rest }),
    )
  }

  return (
    <ConfigSection
      id="familias"
      title="Familias de equipos"
      description="Cada tipo de equipo pertenece a una familia de las vistas de rendimiento. Un tipo fuera de las familias no aparece en esas vistas, pero sus litros siguen contando en la vista general."
    >
      {types.length === 0 ? (
        <EmptyState
          compact
          align="start"
          title="No hay tipos de equipo"
          description="Los tipos de equipo se crean en el catálogo de flota. Cuando existan, asígnales aquí su familia de rendimiento."
        />
      ) : (
        <TableRoot aria-label="Familias de rendimiento por tipo de equipo">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo de equipo</TableHead>
                <TableHead className="text-right">Equipos</TableHead>
                <TableHead>Familia de rendimiento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types.map((type) => {
                const family = type.id in overrides ? overrides[type.id]! : type.performanceFamily
                return (
                  <TableRow key={type.id}>
                    <TableCell className="font-medium">{type.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(type.vehicleCount)}</TableCell>
                    <TableCell>
                      <Select value={family ?? OUTSIDE} onValueChange={(value) => change(type, value)} disabled={op.pending}>
                        <SelectTrigger className="w-full max-w-sm" aria-label={`Familia de rendimiento de ${type.name}`}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PERFORMANCE_FAMILIES.map((item) => <SelectItem key={item} value={item}>{PERFORMANCE_FAMILY_LABELS[item]}</SelectItem>)}
                          <SelectItem value={OUTSIDE}>Fuera de las vistas de rendimiento</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableRoot>
      )}
    </ConfigSection>
  )
}
