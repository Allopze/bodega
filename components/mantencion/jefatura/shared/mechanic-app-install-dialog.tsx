"use client"

import * as React from "react"
import { PublicFormQrDialog, type PublicFormQrOption } from "@/components/public-access/public-form-qr-dialog"

export const MECHANIC_APP_PATH = "/m/mantencion"

/**
 * QR para que el mecánico instale la app en su teléfono. La app no está en el
 * menú de la plataforma: jefatura o supervisión muestran este código (o lo
 * imprimen para el taller) y el mecánico lo abre, entra con su cuenta y la
 * agrega a la pantalla de inicio. El enlace no es un dato protegido: la app
 * pide su propio login.
 *
 * El origen se toma del navegador, igual que el QR del PPA: es la dirección por
 * la que la persona está viendo la plataforma, la misma que alcanza el teléfono.
 */
export function MechanicAppInstallDialog() {
  const [origin, setOrigin] = React.useState("")
  React.useEffect(() => { setOrigin(window.location.origin) }, [])

  const options = React.useMemo<PublicFormQrOption[]>(() => origin
    ? [{
      id: "app",
      label: "App del mecánico",
      url: `${origin}${MECHANIC_APP_PATH}`,
      pdfTitle: "App de mantención — Chome",
      pdfFileName: "app-mantencion-chome-qr.pdf",
    }]
    : [], [origin])

  return (
    <PublicFormQrDialog
      title="Instalar la app del mecánico"
      description="El mecánico escanea este código con su teléfono, entra con su cuenta y deja la app en la pantalla de inicio. Funciona sin señal después del primer ingreso."
      selectorLabel="App"
      options={options}
      selectedOptionId="app"
      onSelectedOptionChange={() => {}}
      pdfSubtitle="Escanea con el teléfono, entra con tu cuenta e instálala"
      triggerLabel="Instalar app del mecánico"
      qrAlt={() => "Código QR para abrir la app de mantención en el teléfono"}
      hideSelector
    >
      <div className="flex flex-col gap-2 text-sm">
        <span className="text-eyebrow">Cómo instalarla</span>
        <ol className="list-decimal space-y-1.5 pl-5 text-[var(--color-text-muted)]">
          <li><strong className="text-[var(--color-text)]">Android:</strong> abre el enlace con Chrome, entra y toca «Instalar app» (o menú ⋮ → «Agregar a la pantalla principal»).</li>
          <li><strong className="text-[var(--color-text)]">iPhone:</strong> abre el enlace con Safari, entra y toca «Compartir» → «Agregar a inicio».</li>
          <li>La primera vez necesita señal; después registra sin conexión.</li>
        </ol>
      </div>
    </PublicFormQrDialog>
  )
}
