"use client"

import { useState, useTransition } from "react"
import { CheckCircle } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/lib/toast"
import { acknowledgeSstDocumentAction } from "../actions"

interface Props {
  documentId: string
  versionId: string
  currentUserId: string
  currentUserName: string
  acked: boolean
  onAcked: () => void
}

export function AckPanel({ versionId, currentUserName, acked, onAcked }: Props) {
  const [signature, setSignature] = useState(currentUserName)
  const [isPending, startTransition] = useTransition()

  if (acked) {
    return (
      <Card>
        <CardHeader><CardTitle>Acuse de lectura</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm flex items-center gap-2 text-[var(--color-success)]">
            <CheckCircle size={16} /> Acuse registrado para esta versión.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle>Acuse de lectura</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-[var(--color-text-subtle)]">
          Al registrar el acuse confirmas que has leído y comprendido este documento.
        </p>
        <Field label="Firma" htmlFor="ack-signature" required>
          <Input id="ack-signature" value={signature} onChange={(e) => setSignature(e.target.value)} />
        </Field>
        <Button
          disabled={isPending || signature.trim().length < 2}
          onClick={() => startTransition(async () => {
            const res = await acknowledgeSstDocumentAction({ versionId, signature: signature.trim() })
            if (res.ok) {
              toast.success(res.message ?? "Acuse registrado.")
              onAcked()
            } else {
              toast.error(res.message ?? "Error al registrar el acuse.")
            }
          })}
        >
          Registrar acuse
        </Button>
      </CardContent>
    </Card>
  )
}
