"use client"

import * as React from "react"
import { QrCode, Copy, DownloadSimple } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select"
import { toast } from "@/lib/toast"

export interface PublicFormQrOption {
  id: string
  label: string
  url: string
  pdfTitle: string
  pdfFileName: string
}

interface PublicFormQrDialogProps {
  title: string
  description: string
  selectorLabel: string
  options: PublicFormQrOption[]
  selectedOptionId: string
  onSelectedOptionChange: (id: string) => void
  pdfSubtitle: string
  triggerLabel?: string
  qrAlt: (option: PublicFormQrOption) => string
}

/**
 * UI compartida para distribuir formularios públicos por QR/enlace.
 * PPA y TAE solo aportan sus opciones y textos; QR, PDF y clipboard no se duplican.
 */
export function PublicFormQrDialog({
  title,
  description,
  selectorLabel,
  options,
  selectedOptionId,
  onSelectedOptionChange,
  pdfSubtitle,
  triggerLabel = "QR / Enlace",
  qrAlt,
}: PublicFormQrDialogProps) {
  const [open, setOpen] = React.useState(false)
  const [qr, setQr] = React.useState("")
  const selected = options.find((option) => option.id === selectedOptionId) ?? options[0]
  const link = selected?.url ?? ""

  React.useEffect(() => {
    if (!open || !link) { setQr(""); return }
    let active = true
    import("qrcode").then((mod) => {
      (mod.default ?? mod).toDataURL(link, { width: 320, margin: 2 })
        .then((url: string) => { if (active) setQr(url) })
        .catch(() => { if (active) setQr("") })
    })
    return () => { active = false }
  }, [open, link])

  async function copyLink() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast.success("Enlace copiado")
    } catch {
      toast.error("No se pudo copiar el enlace")
    }
  }

  async function downloadQr() {
    if (!qr || !selected) return
    try {
      const { jsPDF } = await import("jspdf")
      const doc = new jsPDF({ format: "letter" })
      const pageW = doc.internal.pageSize.getWidth()

      doc.setFontSize(20)
      doc.text(selected.pdfTitle, pageW / 2, 30, { align: "center" })

      doc.setFontSize(12)
      doc.text(pdfSubtitle, pageW / 2, 40, { align: "center" })

      const qrSize = 80
      const qrX = (pageW - qrSize) / 2
      doc.addImage(qr, "PNG", qrX, 52, qrSize, qrSize)

      doc.setFontSize(10)
      doc.text("Enlace de acceso:", pageW / 2, 148, { align: "center" })
      doc.setFontSize(8)
      doc.text(link, pageW / 2, 155, { align: "center" })
      doc.save(selected.pdfFileName)
    } catch {
      toast.error("No se pudo generar el PDF del QR")
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <QrCode size={15} />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-eyebrow">{selectorLabel}</span>
            <Select value={selected?.id ?? ""} onValueChange={onSelectedOptionChange} disabled={options.length === 0}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={selectorLabel} />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <div className="flex flex-col items-center gap-3">
            <div className="flex h-44 w-44 items-center justify-center rounded-xl border border-(--color-border) bg-white p-2">
              {qr && selected ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt={qrAlt(selected)} className="h-full w-full animate-[fade-in_var(--duration-default)_var(--ease-out)]" />
              ) : (
                <QrCode size={52} className="text-text-faint" />
              )}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={downloadQr} disabled={!qr} className="w-44">
              <DownloadSimple size={14} /> Descargar QR
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-eyebrow">Enlace directo</span>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-(--color-border) bg-surface-2 px-2.5 py-1.5 font-mono text-xs">
                {link || "…"}
              </code>
              <Button type="button" variant="secondary" size="sm" onClick={copyLink} disabled={!link}>
                <Copy size={14} /> Copiar
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
