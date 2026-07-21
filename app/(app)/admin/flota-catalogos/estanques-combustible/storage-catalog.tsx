"use client"

import { useEffect, useState } from "react"
import { PencilSimple, ToggleLeft, ToggleRight } from "@phosphor-icons/react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CatalogFormSheet } from "@/components/admin/catalog-form-sheet"
import { setFuelStorageLocationStatusAction, createFuelStorageLocationAction, updateFuelStorageLocationAction } from "./actions"

type Row = { id: string; name: string; worksiteId: string; productId: string; capacityLiters: number | null; taeCardNumber: string | null; notes: string | null; isActive: boolean; worksite: { name: string }; product: { name: string } }
type Option = { id: string; name: string }

export function StorageCatalog({ rows, worksites, products, initialOpen = false }: { rows: Row[]; worksites: Option[]; products: Option[]; initialOpen?: boolean }) {
  const [selected, setSelected] = useState<Row | null>(null)
  const [open, setOpen] = useState(initialOpen)
  const [worksiteId, setWorksiteId] = useState(selected?.worksiteId ?? "")
  const [productId, setProductId] = useState(selected?.productId ?? "")

  useEffect(() => {
    setWorksiteId(selected?.worksiteId ?? "")
    setProductId(selected?.productId ?? "")
  }, [selected])

  const edit = (row: Row | null) => { setSelected(row); setOpen(true) }

  return <>
    <div className="overflow-x-auto border border-[var(--color-border)]">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-[var(--color-surface-2)] text-left text-xs text-[var(--color-text-muted)]">
          <tr>
            <th className="p-3">Estanque</th>
            <th>Faena</th>
            <th>Producto</th>
            <th>Capacidad</th>
            <th>Estado</th>
            <th className="w-24">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {rows.map(row => <tr key={row.id}>
            <td className="p-3 font-medium">{row.name}{row.notes && <span className="mt-0.5 block text-xs font-normal text-[var(--color-text-muted)]">{row.notes}</span>}</td>
            <td>{row.worksite.name}</td>
            <td>{row.product.name}</td>
            <td className="font-mono">{row.capacityLiters ? `${new Intl.NumberFormat("es-CL").format(row.capacityLiters)} L` : "—"}</td>
            <td>{row.isActive ? "Activo" : "Inactivo"}</td>
            <td>
              <div className="flex gap-1">
                <button type="button" aria-label={`Editar ${row.name}`} onClick={() => edit(row)} className="rounded p-1.5 hover:bg-[var(--color-surface-2)]"><PencilSimple size={17} /></button>
                <button type="button" aria-label={`${row.isActive ? "Desactivar" : "Activar"} ${row.name}`} onClick={async () => { await setFuelStorageLocationStatusAction(row.id, !row.isActive) }} className="rounded p-1.5 hover:bg-[var(--color-surface-2)]">{row.isActive ? <ToggleRight size={19} /> : <ToggleLeft size={19} />}</button>
              </div>
            </td>
          </tr>)}
        </tbody>
      </table>
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
        <Field label="Nombre"><input name="name" defaultValue={selected?.name} required className="control" /></Field>
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
        <Field label="Capacidad (litros)"><input name="capacityLiters" type="number" min="0.01" step="0.01" defaultValue={selected?.capacityLiters ?? ""} className="control" /></Field>
        <Field label="Tarjeta Copec TAE"><input name="taeCardNumber" defaultValue={selected?.taeCardNumber ?? ""} placeholder="1-242269-00230-9-1" className="control" /><p className="mt-1 text-xs text-[var(--color-text-muted)]">Número de tarjeta con que esta vasija carga en estación. Sin él, sus recepciones del informe TAE de Copec no se pueden atribuir.</p></Field>
        <Field label="Observaciones"><textarea name="notes" rows={3} defaultValue={selected?.notes ?? ""} className="control" /></Field>
        {state.fieldErrors && <p className="text-sm text-[var(--color-danger)]">Revisa los campos marcados.</p>}
      </div>}
    </CatalogFormSheet>
  </>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm font-medium"><span>{label}</span>{children}</label> }
