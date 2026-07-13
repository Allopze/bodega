"use client"

import * as React from "react"
import { PublicFormQrDialog, type PublicFormQrOption } from "@/components/public-access/public-form-qr-dialog"

export function PpaAccessPanel({ worksites }: { worksites: { id: string; name: string }[] }) {
  const [worksiteId, setWorksiteId] = React.useState("")
  const [origin, setOrigin] = React.useState("")

  React.useEffect(() => { setOrigin(window.location.origin) }, [])

  const options = React.useMemo<PublicFormQrOption[]>(() => {
    if (!origin) return []
    return [
      {
        id: "general",
        label: "General (sin faena)",
        url: `${origin}/ppa`,
        pdfTitle: "Acceso general",
        pdfFileName: "ppa-acceso-general.pdf",
      },
      ...worksites.map((worksite) => ({
        id: worksite.id,
        label: worksite.name,
        url: `${origin}/ppa?faena=${worksite.id}`,
        pdfTitle: worksite.name,
        pdfFileName: `ppa-acceso-${worksite.id}.pdf`,
      })),
    ]
  }, [origin, worksites])

  return (
    <PublicFormQrDialog
      title="Acceso para el trabajador"
      description="Comparte el QR o el enlace directo. El trabajador abre el formulario sin iniciar sesión, con la faena precargada."
      selectorLabel="Faena (precarga el formulario)"
      options={options}
      selectedOptionId={worksiteId || "general"}
      onSelectedOptionChange={(id) => setWorksiteId(id === "general" ? "" : id)}
      pdfSubtitle="Formulario PPA Digital"
      qrAlt={(option) => `Código QR del PPA para ${option.pdfTitle}`}
    />
  )
}
