"use client"

import * as React from "react"
import { Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useOperation } from "@/lib/hooks/use-operation"
import { toast } from "@/lib/toast"
import { createTaeLoadingPointAction } from "../../tae/actions"
import { LOADING_POINT_TYPE_CHOICES, loadingPointTypeLabel, type StorageOption, type WorksiteOption } from "./point-types"

const NO_STORAGE = "_none"

/** «Nuevo punto de carga» para `PageHeader.actions` (y el estado vacío); lleva su propio diálogo. */
export function NewLoadingPointButton({ worksites, storageLocations, label = "Nuevo punto de carga", withIcon = true }: {
  worksites: WorksiteOption[]
  storageLocations: StorageOption[]
  label?: string
  withIcon?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={worksites.length === 0} title={worksites.length === 0 ? "No hay faenas en tu alcance" : undefined}>
        {withIcon ? <Plus className="h-4 w-4" aria-hidden /> : null}{label}
      </Button>
      {open ? <NewLoadingPointDialog worksites={worksites} storageLocations={storageLocations} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function NewLoadingPointDialog({ worksites, storageLocations, onClose }: { worksites: WorksiteOption[]; storageLocations: StorageOption[]; onClose: () => void }) {
  const op = useOperation()
  const [worksiteId, setWorksiteId] = React.useState(worksites[0]?.id ?? "")
  const [name, setName] = React.useState("")
  const [type, setType] = React.useState<string>("fixed_dispenser")
  const [storageId, setStorageId] = React.useState(NO_STORAGE)
  const worksiteStorage = storageLocations.filter((location) => location.worksiteId === worksiteId)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    op.run(
      () => createTaeLoadingPointAction({ worksiteId, name, type, storageLocationId: storageId === NO_STORAGE ? null : storageId }),
      (result) => {
        toast.success(result.message ?? "Punto de carga creado")
        onClose()
      },
    )
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo punto de carga</DialogTitle>
          <DialogDescription>El lugar donde se carga combustible. Después podrás generar su QR.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate>
          <FieldGroup>
            <Field label="Faena" htmlFor="point-worksite" required>
              <Select value={worksiteId} onValueChange={(value) => { setWorksiteId(value); setStorageId(NO_STORAGE) }}>
                <SelectTrigger id="point-worksite"><SelectValue /></SelectTrigger>
                <SelectContent>{worksites.map((worksite) => <SelectItem key={worksite.id} value={worksite.id}>{worksite.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Nombre" htmlFor="point-name" required helper="Cómo lo reconoce el operador, p. ej. «Surtidor principal».">
              <Input id="point-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Tipo de lugar" htmlFor="point-type" required>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="point-type"><SelectValue /></SelectTrigger>
                  <SelectContent>{LOADING_POINT_TYPE_CHOICES.map((item) => <SelectItem key={item} value={item}>{loadingPointTypeLabel(item)}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Estanque (opcional)" htmlFor="point-storage" helper="De cuál estanque reparte este punto.">
                <Select value={storageId} onValueChange={setStorageId}>
                  <SelectTrigger id="point-storage"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_STORAGE}>Sin vincular</SelectItem>
                    {worksiteStorage.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {op.message ? <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{op.message}</p> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" loading={op.pending} disabled={!worksiteId || name.trim().length < 2}>Crear punto de carga</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
