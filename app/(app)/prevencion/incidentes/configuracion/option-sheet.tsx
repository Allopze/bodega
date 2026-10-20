"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OptionSelect } from "@/components/ui/option-select"
import { Switch } from "@/components/ui/switch"
import {
  Sheet, SheetBody, SheetCloseButton, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/admin/sheet"
import { useOperation } from "@/lib/hooks/use-operation"
import { savePreventionIncidentRe20CatalogOptionAction } from "../actions"
import { AGENT_CATEGORY_LIST, AGENT_LIST, RE20_CATALOG_LISTS, isLegacyCategory } from "./catalog-labels"
import type { CatalogRow } from "./catalog-types"

const EDITABLE_LISTS = RE20_CATALOG_LISTS.filter((list) => !isLegacyCategory(list.category))

/** Siguiente código `rNN` libre de la lista, como una fila nueva del libro. */
function suggestCode(rows: CatalogRow[], category: string) {
  const used = rows.filter((row) => row.category === category).map((row) => /^r(\d+)$/.exec(row.code)?.[1]).filter(Boolean).map(Number)
  return `r${(used.length ? Math.max(...used) : 11) + 1}`
}

export function OptionSheet({ open, onOpenChange, option, rows }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fila en edición; `null` crea un valor nuevo. */
  option: CatalogRow | null
  rows: CatalogRow[]
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        {open && <OptionForm option={option} rows={rows} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}

function OptionForm({ option, rows, onDone }: { option: CatalogRow | null; rows: CatalogRow[]; onDone: () => void }) {
  const router = useRouter()
  const { pending, run, message, fieldErrors } = useOperation({ feedback: "toast" })
  const editing = option !== null
  const [category, setCategory] = React.useState(option?.category ?? "")
  const [code, setCode] = React.useState(option?.code ?? "")
  const [name, setName] = React.useState(option?.name ?? "")
  const [sortOrder, setSortOrder] = React.useState(option ? String(option.sortOrder) : "")
  const [parentCode, setParentCode] = React.useState(option?.parentCode ?? "")
  const [isActive, setIsActive] = React.useState(option?.isActive ?? true)
  const agentCategories = rows.filter((row) => row.category === AGENT_CATEGORY_LIST && row.isActive || row.category === AGENT_CATEGORY_LIST && row.code === option?.parentCode)
  const valid = category !== "" && code.trim() !== "" && name.trim() !== ""

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid) return
    const input: Record<string, unknown> = { category, code: code.trim(), name: name.trim(), isActive }
    if (sortOrder.trim() !== "") input.sortOrder = Number(sortOrder)
    if (category === AGENT_LIST) input.parentCode = parentCode || null
    run(() => savePreventionIncidentRe20CatalogOptionAction(input), () => { router.refresh(); onDone() })
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader>
        <div>
          <SheetTitle>{editing ? "Editar valor de la lista" : "Nuevo valor de lista"}</SheetTitle>
          <SheetDescription>
            {editing
              ? "Cambia el nombre, el orden o si está disponible. La lista y el código no se pueden modificar."
              : "El valor queda disponible en los expedientes nuevos. Los valores no se borran: se desactivan."}
          </SheetDescription>
        </div>
        <SheetCloseButton />
      </SheetHeader>
      <SheetBody className="space-y-4">
        {message && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{message}</p>}
        <Field label="Lista" htmlFor="opcion-lista" required error={fieldErrors.category?.[0]}>
          <OptionSelect
            id="opcion-lista"
            value={category}
            disabled={editing}
            placeholder="Elige una lista"
            options={EDITABLE_LISTS.map((list) => ({ value: list.category, label: list.label }))}
            onValueChange={(next) => { setCategory(next); if (!editing) setCode(suggestCode(rows, next)) }}
          />
        </Field>
        <Field label="Nombre" htmlFor="opcion-nombre" required error={fieldErrors.name?.[0]}>
          <Input id="opcion-nombre" value={name} maxLength={240} onChange={(event) => setName(event.target.value)} />
        </Field>
        {category === AGENT_LIST && (
          <Field label="Categoría del agente" htmlFor="opcion-categoria" helper="Al elegir este agente en un expediente, la categoría se completa sola.">
            <OptionSelect
              id="opcion-categoria"
              value={parentCode}
              emptyLabel="Sin categoría"
              placeholder="Sin categoría"
              options={agentCategories.map((row) => ({ value: row.code, label: row.name }))}
              onValueChange={setParentCode}
            />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Código" htmlFor="opcion-codigo" required helper="Identificador estable; no cambia después." error={fieldErrors.code?.[0]}>
            <Input id="opcion-codigo" value={code} maxLength={40} disabled={editing} className="font-mono" onChange={(event) => setCode(event.target.value)} />
          </Field>
          <Field label="Orden en la lista" htmlFor="opcion-orden" helper={editing ? undefined : "Vacío: queda al final."} error={fieldErrors.sortOrder?.[0]}>
            <Input id="opcion-orden" type="number" min={0} step={1} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] p-3">
          <div>
            <p className="text-sm font-medium text-[var(--color-text)]">Disponible en los expedientes</p>
            <p className="text-xs text-[var(--color-text-muted)]">Si se desactiva, deja de ofrecerse pero los casos que ya lo usan lo conservan.</p>
          </div>
          <Switch checked={isActive} onCheckedChange={setIsActive} label="Disponible en los expedientes" />
        </div>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="secondary" onClick={onDone}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={pending || !valid}>{pending ? "Guardando…" : editing ? "Guardar cambios" : "Agregar valor"}</Button>
      </SheetFooter>
    </form>
  )
}
