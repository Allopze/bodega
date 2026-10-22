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
import { saveSupplyMediumAction, setSupplyMediumActiveAction } from "./actions"
import { ActiveBadge, ConfigSection } from "./config-section"
import type { Option, SupplyMediumRow } from "./config-types"

const NO_SUPPLIER = "_none"

function kindLabel(kind: string): string {
  return SUPPLY_MEDIUM_KIND_LABELS[kind as SupplyMediumKind] ?? "Otro"
}

export function SupplyMediaSection({ media, suppliers }: { media: SupplyMediumRow[]; suppliers: Option[] }) {
  const [editing, setEditing] = React.useState<SupplyMediumRow | "new" | null>(null)
  const toggle = useOperation({ feedback: "toast" })

  return (
    <ConfigSection
      id="medios"
      title="Medios de suministro"
      description="Por dónde llega el combustible: tarjetas, estaciones, surtidores del mandante, estanques propios. El mapeo al proveedor permite leer sus transacciones sin importar archivos."
      action={<Button size="sm" onClick={() => setEditing("new")}><Plus className="h-4 w-4" aria-hidden />Nuevo medio</Button>}
    >
      {media.length === 0 ? (
        <EmptyState
          compact
          align="start"
          title="Aún no hay medios de suministro"
          description="Los importadores de entradas y las cargas en terreno necesitan al menos un medio para saber de dónde viene el combustible."
          action={<Button size="sm" onClick={() => setEditing("new")}>Crear el primer medio</Button>}
        />
      ) : (
        <TableRoot aria-label="Medios de suministro">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medio</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Lectura del proveedor</TableHead>
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
                  <TableCell className="text-right tabular-nums">{medium.sortOrder}</TableCell>
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
      {editing ? (
        <SupplyMediumDialog key={editing === "new" ? "new" : editing.id} medium={editing === "new" ? null : editing} suppliers={suppliers} onClose={() => setEditing(null)} />
      ) : null}
    </ConfigSection>
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
            <Field label="Lectura automática del proveedor" htmlFor="medium-mapping" helper="Si el medio coincide con una integración, sus transacciones se leen del libro de proveedores. Si no, déjalo sin lectura y usa el importador de entradas.">
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
