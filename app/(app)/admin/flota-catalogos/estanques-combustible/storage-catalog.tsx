"use client"

import { useState } from "react"
import { PencilSimple, ToggleLeft, ToggleRight } from "@phosphor-icons/react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { formatQty } from "@/lib/utils"
import { setFuelStorageLocationStatusAction, createFuelStorageLocationAction, updateFuelStorageLocationAction } from "./actions"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRoot, TableRow } from "@/components/ui/table"

type Row = { id: string; name: string; worksiteId: string; productId: string; capacityLiters: number | null; taeCardNumber: string | null; notes: string | null; isActive: boolean; worksite: { name: string }; product: { name: string } }
type Option = { id: string; name: string }

export function StorageCatalog({ rows, worksites, products, initialOpen = false }: { rows: Row[]; worksites: Option[]; products: Option[]; initialOpen?: boolean }) {
  const [selected, setSelected] = useState<Row | null>(null)
  const [open, setOpen] = useState(initialOpen)
  const [worksiteId, setWorksiteId] = useState("")
  const [productId, setProductId] = useState("")

  // Los selects se siembran al abrir la ficha, no vía efecto: sincronizarlos
  // después del render dejaba un frame con la faena/producto de la fila
  // anterior visible en el formulario.
  const edit = (row: Row | null) => {
    setSelected(row)
    setWorksiteId(row?.worksiteId ?? "")
    setProductId(row?.productId ?? "")
    setOpen(true)
  }

  return <>
    <div className="overflow-x-auto border border-[var(--color-border)]">
      <TableRoot>
      <Table className="min-w-[760px]">
        <caption className="sr-only">Catálogo de estanques de combustible</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Estanque</TableHead><TableHead>Faena</TableHead><TableHead>Producto</TableHead><TableHead>Capacidad</TableHead>
            <TableHead>Estado</TableHead><TableHead className="w-24">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(row => <TableRow key={row.id}>
            <TableCell className="font-medium">{row.name}{row.notes && <span className="mt-0.5 block text-xs font-normal text-[var(--color-text-muted)]">{row.notes}</span>}</TableCell>
            <TableCell>{row.worksite.name}</TableCell>
            <TableCell>{row.product.name}</TableCell>
            <TableCell className="font-mono">{row.capacityLiters ? formatQty(row.capacityLiters, "L") : "—"}</TableCell>
            <TableCell>{row.isActive ? "Activo" : "Inactivo"}</TableCell>
            <TableCell>
              <div className="flex gap-1">
                <button type="button" aria-label={`Editar ${row.name}`} onClick={() => edit(row)} className="rounded p-1.5 hover:bg-[var(--color-surface-2)]"><PencilSimple size={17} /></button>
                <button type="button" aria-label={`${row.isActive ? "Desactivar" : "Activar"} ${row.name}`} onClick={async () => { await setFuelStorageLocationStatusAction(row.id, !row.isActive) }} className="rounded p-1.5 hover:bg-[var(--color-surface-2)]">{row.isActive ? <ToggleRight size={19} /> : <ToggleLeft size={19} />}</button>
              </div>
            </TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
      </TableRoot>
    </div>
    {rows.length === 0 && <p className="border border-dashed border-[var(--color-border-strong)] p-8 text-sm text-[var(--color-text-muted)]">Aún no hay estanques. Crea el primero para habilitar recepciones y entregas desde estanque.</p>}
    <CatalogFormSheet
      open={open}
      onClose={() => setOpen(false)}
      isEdit={Boolean(selected)}
      entityId={selected?.id}
      title={selected ? "Editar estanque" : "Nuevo estanque"}
      description="Un estanque pertenece a una faena y producto determinados."
      create={createFuelStorageLocationAction}
      update={updateFuelStorageLocationAction}
      submitLabel={selected ? "Guardar cambios" : "Crear estanque"}
      successMessage="Estanque guardado"
    >
      {state => <div className="grid gap-4">
        <Field label="Nombre"><Input name="name" defaultValue={selected?.name} required aria-label="Nombre" /></Field>
        <Field label="Faena">
          <Select value={worksiteId} onValueChange={setWorksiteId}>
            <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
            <SelectContent>
              {worksites.map(x => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <input type="hidden" name="worksiteId" value={worksiteId} />
        </Field>
        <Field label="Producto">
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger><SelectValue placeholder="Selecciona" /></SelectTrigger>
            <SelectContent>
              {products.map(x => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <input type="hidden" name="productId" value={productId} />
        </Field>
        <Field label="Capacidad (litros)"><Input name="capacityLiters" type="number" min="0.01" step="0.01" defaultValue={selected?.capacityLiters ?? ""} aria-label="Capacidad (litros)" /></Field>
        <Field label="Tarjeta Copec TAE"><Input name="taeCardNumber" defaultValue={selected?.taeCardNumber ?? ""} placeholder="1-242269-00230-9-1" aria-label="Tarjeta Copec TAE" /><p className="mt-1 text-xs text-[var(--color-text-muted)]">Número de tarjeta con que esta vasija carga en estación. Sin él, sus recepciones del informe TAE de Copec no se pueden atribuir.</p></Field>
        <Field label="Observaciones"><Textarea name="notes" rows={3} defaultValue={selected?.notes ?? ""} aria-label="Observaciones" className="min-h-0" /></Field>
        {state.fieldErrors && <p className="text-sm text-[var(--color-danger)]">Revisa los campos marcados.</p>}
      </div>}
    </CatalogFormSheet>
  </>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm font-medium"><span>{label}</span>{children}</label> }
