"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { PROVIDER_MAPPINGS, PROVIDER_MAPPING_LABELS, SUPPLY_MEDIUM_KINDS, type ProviderMapping } from "@/lib/combustibles/control/catalogs"
import { SUPPLY_MEDIUM_KIND_LABELS, type SupplyMediumKind } from "@/lib/combustibles/control/contracts"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { saveSupplyMediumAction, setSupplyMediumActiveAction } from "../actions"
import { ActiveBadge } from "../active-badge"
import type { Option, SupplyMediumRow } from "../config-types"

const NO_SUPPLIER = "_none"

function kindLabel(kind: string): string {
  return SUPPLY_MEDIUM_KIND_LABELS[kind as SupplyMediumKind] ?? "Otro"
}

/** «Nuevo medio» para `PageHeader.actions` (y el estado vacío); lleva su propio diálogo. */
export function NewSupplyMediumButton({ suppliers, label = "Nuevo medio", variant = "primary", withIcon = true }: {
  suppliers: Option[]
  label?: string
  variant?: "primary" | "secondary"
  withIcon?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {withIcon ? <Plus className="h-4 w-4" aria-hidden /> : null}{label}
      </Button>
      {open ? <SupplyMediumDialog medium={null} suppliers={suppliers} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

export function SupplyMediaTable({ media, suppliers, emptyAction }: { media: SupplyMediumRow[]; suppliers: Option[]; emptyAction?: React.ReactNode }) {
  const [editing, setEditing] = React.useState<SupplyMediumRow | null>(null)
  const toggle = useOperation({ feedback: "toast" })

  return (
    <>
      {media.length === 0 ? (
        <EmptyState
          compact
          align="start"
          title="Aún no hay medios de suministro"
          description="El formulario en terreno y los importadores necesitan al menos un medio para saber por dónde llegó el combustible. Crea el primero."
          action={emptyAction}
        />
      ) : (
        <TableRoot aria-label="Medios de suministro">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medio</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Se actualiza solo</TableHead>
                <TableHead>Alias en planillas</TableHead>
                <TableHead className="text-right">Orden</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right"><span className="sr-only">Acciones</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {media.map((medium) => (
                <TableRow key={medium.id}>
                  <TableCell>
                    <span className="font-medium">{medium.name}</span>
                    {medium.fuelSupplierName ? <span className="block text-xs text-[var(--color-text-muted)]">{medium.fuelSupplierName}</span> : null}
                  </TableCell>
                  <TableCell>{kindLabel(medium.kind)}</TableCell>
                  <TableCell>{PROVIDER_MAPPING_LABELS[medium.providerMapping]}</TableCell>
                  <TableCell className="max-w-xs text-[var(--color-text-muted)]">{medium.aliases.length ? medium.aliases.join(", ") : "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{medium.sortOrder}</TableCell>
                  <TableCell><ActiveBadge active={medium.isActive} /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(medium)} aria-label={`Editar ${medium.name}`}>Editar</Button>
                      <Button
                        variant={medium.isActive ? "ghost-danger" : "ghost"}
                        size="sm"
                        disabled={toggle.pending}
                        aria-label={`${medium.isActive ? "Desactivar" : "Activar"} ${medium.name}`}
                        onClick={() => toggle.run(() => setSupplyMediumActiveAction({ id: medium.id, isActive: !medium.isActive }))}
                      >
                        {medium.isActive ? "Desactivar" : "Activar"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableRoot>
      )}
      {editing ? <SupplyMediumDialog key={editing.id} medium={editing} suppliers={suppliers} onClose={() => setEditing(null)} /> : null}
    </>
  )
}

function SupplyMediumDialog({ medium, suppliers, onClose }: { medium: SupplyMediumRow | null; suppliers: Option[]; onClose: () => void }) {
  const op = useOperation()
  const [name, setName] = React.useState(medium?.name ?? "")
  const [kind, setKind] = React.useState<string>(medium?.kind ?? "other")
  const [supplierId, setSupplierId] = React.useState(medium?.fuelSupplierId ?? NO_SUPPLIER)
  const [mapping, setMapping] = React.useState<ProviderMapping>(medium?.providerMapping ?? "none")
  const [aliases, setAliases] = React.useState(medium?.aliases.join(", ") ?? "")
  const [sortOrder, setSortOrder] = React.useState(String(medium?.sortOrder ?? 0))
  const [isActive, setIsActive] = React.useState(medium?.isActive ?? true)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    op.run(
      () => saveSupplyMediumAction({
        id: medium?.id,
        name,
        kind: kind as (typeof SUPPLY_MEDIUM_KINDS)[number],
        fuelSupplierId: supplierId === NO_SUPPLIER ? null : supplierId,
        providerMapping: mapping,
        aliases,
        sortOrder,
        isActive,
      }),
      (result) => {
        toast.success(result.message ?? "Medio guardado")
        onClose()
      },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{medium ? "Editar medio de suministro" : "Nuevo medio de suministro"}</DialogTitle>
          <DialogDescription>Los alias son los textos con que este medio aparece en las planillas; se guardan en mayúsculas.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field label="Nombre" htmlFor="medium-name" required error={op.fieldError("name")}>
              <Input id="medium-name" value={name} onChange={(event) => setName(event.target.value)} error={!!op.fieldError("name")} autoComplete="off" />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Tipo de medio" htmlFor="medium-kind" required error={op.fieldError("kind")}>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger id="medium-kind"><SelectValue /></SelectTrigger>
                  <SelectContent>{SUPPLY_MEDIUM_KINDS.map((item) => <SelectItem key={item} value={item}>{SUPPLY_MEDIUM_KIND_LABELS[item]}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Proveedor de combustible" htmlFor="medium-supplier" error={op.fieldError("fuelSupplierId")}>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger id="medium-supplier"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SUPPLIER}>Sin proveedor</SelectItem>
                    {suppliers.map((supplier) => <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Se actualiza solo" htmlFor="medium-mapping" helper="Si el medio corresponde a una integración (Copec o Aramco), sus cargas se leen solas cada mañana. Si no, déjalo sin lectura automática y súbelas en Fuentes de datos.">
              <Select value={mapping} onValueChange={(value) => setMapping(value as ProviderMapping)}>
                <SelectTrigger id="medium-mapping"><SelectValue /></SelectTrigger>
                <SelectContent>{PROVIDER_MAPPINGS.map((item) => <SelectItem key={item} value={item}>{PROVIDER_MAPPING_LABELS[item]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Alias en planillas" htmlFor="medium-aliases" helper="Separados por coma. Ejemplo: CMPC, SURTIDOR CMPC." error={op.fieldError("aliases")}>
              <Textarea id="medium-aliases" rows={2} value={aliases} onChange={(event) => setAliases(event.target.value)} error={!!op.fieldError("aliases")} />
            </Field>
            <Field label="Orden" htmlFor="medium-order" helper="Menor número, aparece antes en los selectores." error={op.fieldError("sortOrder")}>
              <Input id="medium-order" inputMode="numeric" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} error={!!op.fieldError("sortOrder")} className="w-24 tabular-nums" />
            </Field>
            <Checkbox id="medium-active" label="Medio activo" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            {op.message ? <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{op.message}</p> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={op.pending}>{medium ? "Guardar cambios" : "Crear medio"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
