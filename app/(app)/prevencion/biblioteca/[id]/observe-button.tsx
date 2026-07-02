"use client"

import { useState } from "react"
import { ThumbsDown } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface Props {
  documentId: string
  onSubmit: (comment: string) => void
  disabled: boolean
}

export function ObserveButton({ onSubmit, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState("")
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={disabled}>
        <ThumbsDown size={14} className="mr-1" /> Observar
      </Button>
    )
  }
  return (
    <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3">
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Motivo de la observación (obligatorio)"
        rows={3}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSubmit(comment)}>Enviar observación</Button>
        <Button size="sm" variant="secondary" onClick={() => { setOpen(false); setComment("") }}>Cancelar</Button>
      </div>
    </div>
  )
}
