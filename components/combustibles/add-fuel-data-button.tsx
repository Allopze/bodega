"use client"

import * as React from "react"
import Link from "next/link"
import { CaretRight, CloudArrowDown, Drop, FileXls, Gauge, GasPump, Lock, Receipt, SealCheck, UploadSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { FuelAddDataKind, FuelAddDataOption } from "@/lib/combustibles/section-nav"

const ICONS: Record<FuelAddDataKind, typeof Gauge> = {
  planilla: FileXls,
  tarjeta: CloudArrowDown,
  facturas: Receipt,
  telemetria: Gauge,
  surtidor: Drop,
  sellos: SealCheck,
  registrar: GasPump,
}

const OPTION_CLASS = "flex w-full items-center gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 text-left"
const OPTION_ENABLED_CLASS = "group transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-tint) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"

function OptionBody({ option, allowed }: { option: FuelAddDataOption; allowed: boolean }) {
  const Icon = ICONS[option.kind]
  return (
    <>
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--color-surface-2) text-(--color-text-muted) group-hover:bg-white group-hover:text-(--color-primary)">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-(--color-text)">{option.label}</span>
        <span className="block text-xs text-(--color-text-muted)">{option.description}</span>
      </span>
      {allowed
        ? <CaretRight aria-hidden size={16} className="shrink-0 text-(--color-text-faint)" />
        : <span className="inline-flex shrink-0 items-center gap-1 text-xs text-(--color-text-muted)"><Lock aria-hidden size={14} />Sin permiso</span>}
    </>
  )
}

/**
 * «Agregar datos»: un solo botón que pregunta «¿Qué tienes en la mano?» y lleva
 * al importador correspondiente. Las opciones salen de `fuelAddDataOptions(session)`
 * y cada una conserva el permiso de su importador: la que la persona no puede
 * usar se muestra deshabilitada, con su candado, para que sepa que existe y a
 * quién pedírsela. Sin ningún permiso de importación el botón no se pinta.
 *
 * Los importadores con pantalla propia (planilla, tarjeta, sellos) navegan a
 * `/combustibles/fuentes/agregar/…`; facturas, telemetría y surtidor abren su
 * diálogo en «Fuentes de datos» (`?agregar=`), donde `AddDataLauncher` lo lee.
 */
export function AddFuelDataButton({ options }: { options: FuelAddDataOption[] }) {
  const [open, setOpen] = React.useState(false)
  // Registrar a mano no es importar: sin ningún importador, el botón sobra.
  if (!options.some((option) => option.allowed && option.kind !== "registrar")) return null

  return (
    <>
      <Button type="button" size="sm" variant="secondary" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <UploadSimple size={14} aria-hidden />Agregar datos
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Qué tienes en la mano?</DialogTitle>
            <DialogDescription>Cada archivo se revisa antes de guardar y se puede revertir.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {options.map((option) => option.allowed ? (
              <Link key={option.kind} href={option.href} data-choice={option.kind} onClick={() => setOpen(false)} className={`${OPTION_CLASS} ${OPTION_ENABLED_CLASS}`}>
                <OptionBody option={option} allowed />
              </Link>
            ) : (
              <button key={option.kind} type="button" data-choice={option.kind} disabled className={`${OPTION_CLASS} cursor-not-allowed opacity-70`}>
                <OptionBody option={option} allowed={false} />
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
