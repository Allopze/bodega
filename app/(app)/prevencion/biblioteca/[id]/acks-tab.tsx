"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import type { DocumentBundle } from "./document-detail.helpers"

interface Props {
  versions: DocumentBundle["versions"]
  acks: DocumentBundle["acks"]
  userMap: Record<string, { id: string; name: string; email: string }>
  documentId: string
}

export function AcksTab({ versions, acks, userMap }: Props) {
  if (versions.length === 0) {
    return <EmptyState title="Sin versiones" description="No hay acuses registrados." />
  }
  return (
    <Card>
      <CardHeader><CardTitle>Acuses de lectura</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-4">
          {versions.map((v) => {
            const vAcks = acks.filter((a) => a.versionId === v.id)
            return (
              <div key={v.id} className="rounded-md border border-[var(--color-border)] p-3">
                <p className="font-medium">v{v.version} — {v.fileName}</p>
                {vAcks.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-subtle)]">Sin acuses.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {vAcks.map((a) => (
                      <li key={a.id}>
                        <strong>{userMap[a.userId]?.name ?? a.userId}</strong> · {a.signature} · {a.acknowledgedAt.slice(0, 19).replace("T", " ")}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
