"use client"

import * as React from "react"
import { useActionState, useEffect } from "react"
import { toast } from "sonner"
import { Plus, PencilSimple, ToggleLeft, ToggleRight } from "@phosphor-icons/react"
import { DataTable } from "@/components/admin/data-table"
import { SupplierForm } from "./supplier-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TableRow, TableCell } from "@/components/ui/table"
import { toggleSupplierActive } from "./actions"
import { INITIAL_STATE } from "@/components/admin/form-state"

interface SupplierRow {
  id: string; name: string; rut: string | null; contactName: string | null
  email: string | null; phone: string | null; address: string | null
  paymentTerms: string | null; notes: string | null
  isActive: boolean; createdAt: string
}

const COLUMNS = [
  { key: "name",         label: "Proveedor",          sortable: true  },
  { key: "rut",          label: "RUT",                sortable: true, width: "w-32" },
  { key: "contactName",  label: "Contacto",           sortable: true  },
  { key: "paymentTerms", label: "Pago",               sortable: true, width: "w-28" },
  { key: "isActive",     label: "Estado",             sortable: true, width: "w-24" },
  { key: "",             label: "",                   sortable: false, width: "w-16" },
]

export function SupplierList({ suppliers }: { suppliers: SupplierRow[] }) {
  const [sheetOpen,    setSheetOpen]    = React.useState(false)
  const [editSupplier, setEditSupplier] = React.useState<SupplierRow | null>(null)
  const [toggleState,  toggleAction]   = useActionState(toggleSupplierActive, INITIAL_STATE)

  useEffect(() => {
    if (toggleState.message) {
      if (toggleState.ok) toast.success(toggleState.message)
      else toast.error(toggleState.message)
    }
  }, [toggleState])

  function openCreate()              { setEditSupplier(null);  setSheetOpen(true) }
  function openEdit(s: SupplierRow)  { setEditSupplier(s);     setSheetOpen(true) }

  return (
    <>
      <DataTable
        columns={COLUMNS}
        rows={suppliers as unknown as Record<string, unknown>[]}
        searchKeys={["name", "rut", "contactName"]}
        pageSize={25}
        searchPlaceholder="Buscar proveedor o RUT..."
        emptyTitle="Sin proveedores"
        emptyDescription="Registra el primer proveedor para comenzar."
        emptyAction={<Button size="sm" onClick={openCreate}><Plus size={14} />Nuevo proveedor</Button>}
        actions={<Button size="sm" onClick={openCreate}><Plus size={14} />Nuevo proveedor</Button>}
        renderMobileCard={(row) => {
          const s = row as unknown as SupplierRow
          return (
            <article className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium text-[var(--color-text)] truncate">{s.name}</h2>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">{s.rut ?? "—"}</p>
                </div>
                <Badge variant={s.isActive ? "success" : "default"} dot>
                  {s.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-[var(--color-text-subtle)]">Contacto</dt>
                  <dd className="text-[var(--color-text-muted)] truncate">{s.contactName ?? "—"}</dd>
                </div>
                <div className="text-right">
                  <dt className="text-[var(--color-text-subtle)]">Pago</dt>
                  <dd className="text-[var(--color-text-muted)]">{s.paymentTerms ?? "—"}</dd>
                </div>
                {s.phone && (
                  <div className="col-span-2">
                    <dt className="text-[var(--color-text-subtle)]">Teléfono</dt>
                    <dd className="font-mono text-[var(--color-text-muted)]">{s.phone}</dd>
                  </div>
                )}
              </dl>

              <div className="mt-3 flex items-center justify-end gap-2 border-t border-[var(--color-border)] pt-2">
                <button onClick={() => openEdit(s)} className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] active:scale-[0.97]" title="Editar">
                  <PencilSimple size={16} />
                </button>
                <form action={toggleAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="activate" value={String(!s.isActive)} />
                  <button type="submit" className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] active:scale-[0.97]" title={s.isActive ? "Desactivar" : "Activar"}>
                    {s.isActive ? <ToggleRight size={20} className="text-[var(--color-primary)]" /> : <ToggleLeft size={20} />}
                  </button>
                </form>
              </div>
            </article>
          )
        }}
        renderRow={(row) => {
          const s = row as unknown as SupplierRow
          return (
            <TableRow key={s.id}>
              <TableCell>
                <p className="text-sm font-medium text-[var(--color-text)]">{s.name}</p>
              </TableCell>
              <TableCell>
                <span className="font-mono text-xs text-[var(--color-text-muted)]">{s.rut ?? "—"}</span>
              </TableCell>
              <TableCell className="text-sm text-[var(--color-text-muted)]">
                {s.contactName ?? "—"}
                {s.phone && <span className="block text-xs font-mono">{s.phone}</span>}
              </TableCell>
              <TableCell className="text-xs text-[var(--color-text-muted)]">{s.paymentTerms ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={s.isActive ? "success" : "default"} dot className="w-20 justify-center">
                  {s.isActive ? "Activo" : "Inactivo"}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2 justify-end">
                  <button onClick={() => openEdit(s)} className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] active:scale-[0.97]" title="Editar">
                    <PencilSimple size={16} />
                  </button>
                  <form action={toggleAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="activate" value={String(!s.isActive)} />
                    <button type="submit" className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)] active:scale-[0.97]" title={s.isActive ? "Desactivar" : "Activar"}>
                      {s.isActive ? <ToggleRight size={20} className="text-[var(--color-primary)]" /> : <ToggleLeft size={20} />}
                    </button>
                  </form>
                </div>
              </TableCell>
            </TableRow>
          )
        }}
      />
      <SupplierForm open={sheetOpen} onClose={() => setSheetOpen(false)} editSupplier={editSupplier} />
    </>
  )
}
