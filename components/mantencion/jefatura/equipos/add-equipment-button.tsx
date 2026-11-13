"use client"

import * as React from "react"
import Link from "next/link"
import { CaretRight, FileXls, Plus, Truck, Wrench } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { plural } from "@/lib/mantencion/format"

const OPTION_CLASS = "group flex w-full items-center gap-3 rounded-(--radius-lg) border border-(--color-border) bg-(--color-surface) p-4 text-left"
const OPTION_ENABLED_CLASS = "transition-colors hover:border-(--color-primary) hover:bg-(--color-primary-tint) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)"

interface Option {
  key: "nuevo" | "importar" | "incorporar"
  href: string
  label: string
  description: string
  icon: typeof Plus
  /** Sin nada que hacer por esta vía se muestra, pero apagada y diciendo por qué. */
  disabledReason?: string
}

function OptionBody({ option }: { option: Option }) {
  const Icon = option.icon
  return (
    <>
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius) bg-(--color-surface-2) text-(--color-text-muted) group-hover:bg-white group-hover:text-(--color-primary)">
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-(--color-text)">{option.label}</span>
        <span className="block text-xs text-(--color-text-muted)">{option.disabledReason ?? option.description}</span>
      </span>
      {!option.disabledReason && <CaretRight aria-hidden size={16} className="shrink-0 text-(--color-text-faint)" />}
    </>
  )
}

/**
 * «Agregar equipos»: un solo botón de cabecera que pregunta cómo (regla 5 y A3 de AGENTS.md; mismo patrón que
 * «Agregar datos» de Combustibles). Reemplaza a tres puertas de alta —«Nuevo equipo», «Importar» y el aviso
 * «Incorporarlos»— que competían en la cabecera y en dos avisos (auditoría 2026-11-13, M11).
 *
 * `pendingFleet` son los vehículos que ya están en la flota y no tienen ficha de mantención: si hay, esa vía es
 * la recomendada (no se vuelve a escribir nada) y va primera.
 */
export function AddEquipmentButton({ pendingFleet }: { pendingFleet: number }) {
  const [open, setOpen] = React.useState(false)

  const options: Option[] = [
    {
      key: "incorporar",
      href: "/mantencion/equipos/incorporar",
      label: "Incorporar desde la flota",
      description: pendingFleet > 0
        ? `${plural(pendingFleet, "vehículo ya está", "vehículos ya están")} en la flota: sólo falta elegir su marca y su pauta.`
        : "Vehículos que ya están en la flota: sólo falta elegir su marca y su pauta.",
      icon: Truck,
      disabledReason: pendingFleet > 0 ? undefined : "Todos los vehículos de la flota ya están en Mantención.",
    },
    {
      key: "nuevo",
      href: "/mantencion/equipos/nuevo",
      label: "Nuevo equipo",
      description: "Un equipo con todos sus datos. Si ya está en la flota, se incorpora sin duplicarlo.",
      icon: Wrench,
    },
    {
      key: "importar",
      href: "/mantencion/equipos/importar",
      label: "Importar desde Excel",
      description: "Varios equipos y sus lecturas iniciales desde una planilla.",
      icon: FileXls,
    },
  ]
  // Con vehículos por incorporar esa vía va primera; sin ellos queda al final, apagada.
  const ordered = pendingFleet > 0 ? options : [options[1]!, options[2]!, options[0]!]

  return (
    <>
      <Button type="button" size="sm" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Plus size={14} aria-hidden />Agregar equipos
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Cómo quieres agregar equipos?</DialogTitle>
            <DialogDescription>Elige la vía que te ahorre más escritura.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {ordered.map((option) => option.disabledReason ? (
              <button key={option.key} type="button" data-choice={option.key} disabled className={`${OPTION_CLASS} cursor-not-allowed opacity-70`}>
                <OptionBody option={option} />
              </button>
            ) : (
              <Link key={option.key} href={option.href} data-choice={option.key} onClick={() => setOpen(false)} className={`${OPTION_CLASS} ${OPTION_ENABLED_CLASS}`}>
                <OptionBody option={option} />
              </Link>
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
