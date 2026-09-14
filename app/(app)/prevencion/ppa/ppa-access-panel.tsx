"use client"

import * as React from "react"
import { PublicFormQrDialog, type PublicFormQrOption } from "@/components/public-access/public-form-qr-dialog"

/**
 * PPA-001 (auditoría 2026-09-14): este panel repartía `"<origen>/ppa?faena=<id>"`.
 * El id de una faena no es una credencial —aparece en cualquier URL de la
 * aplicación—, así que el enlace no acreditaba nada y `submitPpaAction`
 * aceptaba cualquier faena activa. Ahora cada opción trae su `accessQuery`
 * firmada en el servidor (`ppaWorksiteAccessQuery`): el componente sólo le
 * antepone el origen, porque un componente de cliente no puede —ni debe—
 * derivar el HMAC.
 *
 * La opción "General (sin faena)" se conserva y se renombra: sigue abriendo el
 * formulario, pero ya no elige faena; quien la use se identifica con su RUT y
 * el servidor deriva la faena del catálogo de trabajadores.
 */
export function PpaAccessPanel({ worksites }: { worksites: { id: string; name: string; accessQuery: string }[] }) {
  const [worksiteId, setWorksiteId] = React.useState("")
  const [origin, setOrigin] = React.useState("")

  React.useEffect(() => { setOrigin(window.location.origin) }, [])

  const options = React.useMemo<PublicFormQrOption[]>(() => {
    if (!origin) return []
    return [
      {
        id: "general",
        label: "General (se identifica por RUT)",
        url: `${origin}/ppa`,
        pdfTitle: "Acceso general",
        pdfFileName: "ppa-acceso-general.pdf",
      },
      ...worksites.map((worksite) => ({
        id: worksite.id,
        label: worksite.name,
        url: `${origin}/ppa${worksite.accessQuery}`,
        pdfTitle: worksite.name,
        pdfFileName: `ppa-acceso-${worksite.id}.pdf`,
      })),
    ]
  }, [origin, worksites])

  return (
    <PublicFormQrDialog
      title="Acceso para el trabajador"
      description="Comparte el QR o el enlace directo. El enlace de cada faena va firmado: es lo que acredita la faena del envío. El enlace general no la acredita — quien lo use se identifica con su RUT."
      selectorLabel="Faena (precarga el formulario)"
      options={options}
      selectedOptionId={worksiteId || "general"}
      onSelectedOptionChange={(id) => setWorksiteId(id === "general" ? "" : id)}
      pdfSubtitle="Formulario PPA Digital"
      qrAlt={(option) => `Código QR del PPA para ${option.pdfTitle}`}
    />
  )
}
