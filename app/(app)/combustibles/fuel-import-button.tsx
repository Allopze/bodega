"use client"

import { ChartBar, ClipboardText, QrCode, Upload } from "@phosphor-icons/react"
import { CreateChoiceButton, type CreateChoice } from "@/components/ui/create-choice-button"
import type { FuelImportAvailability } from "@/lib/combustibles/section-nav"

/**
 * La única entrada para importar datos de combustible. Había tres botones
 * «Importar» en tres pantallas, cada uno a un importador distinto y sin decir
 * cuál; este pregunta *qué* se importa (AGENTS.md, layout 5 y densidad A3).
 * Con un solo importador disponible va directo a él.
 */
export function FuelImportButton({ available }: { available: FuelImportAvailability }) {
  const choices: CreateChoice[] = []
  if (available.tct) choices.push({
    key: "tct",
    label: "Consumos por tarjeta (TCT)",
    description: "Sincroniza los consumos mensuales de Copec y Aramco, o sube el reporte Excel.",
    icon: <Upload size={18} />,
    soloLabel: "Importar consumos",
    href: "/combustibles/importar",
  })
  if (available.operaciones) choices.push({
    key: "operaciones",
    label: "Log operacional",
    description: "Planilla de cargas por transacción; alimenta el rendimiento por equipo.",
    icon: <ClipboardText size={18} />,
    soloLabel: "Importar log operacional",
    href: "/combustibles/importar?tab=operaciones",
  })
  if (available.control) choices.push({
    key: "control",
    label: "Telemetría y entradas de suministro",
    description: "Telemetría diaria y entradas de surtidor o tarjeta, con revisión antes de guardar.",
    icon: <ChartBar size={18} />,
    soloLabel: "Importar telemetría",
    href: "/combustibles/control/importar",
  })
  if (available.tae) choices.push({
    key: "tae",
    label: "Histórico TAE",
    description: "Cargas TAE anteriores al formulario con código QR.",
    icon: <QrCode size={18} />,
    soloLabel: "Importar histórico TAE",
    href: "/combustibles/tae/importar",
  })

  return (
    <CreateChoiceButton
      choices={choices}
      label="Importar"
      title="¿Qué quieres importar?"
      description="Cada fuente tiene su propio importador y su propia revisión antes de guardar."
      icon={<Upload size={14} aria-hidden />}
      variant="secondary"
    />
  )
}
