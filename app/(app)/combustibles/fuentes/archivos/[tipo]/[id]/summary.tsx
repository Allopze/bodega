import type { ReactNode } from "react"
import { MetaBadge } from "@/components/states/state-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DetailItem } from "@/components/ui/detail-item"
import { IMPORTED_FILE_STATUS_LABELS, type ImportedFileStatus } from "../../../imported-file-kinds"

/** Estado de un archivo importado: «Importado» o «Revertido». */
export function FileStatusBadge({ status }: { status: ImportedFileStatus }) {
  return <MetaBadge meta={{ label: IMPORTED_FILE_STATUS_LABELS[status], variant: status === "revertido" ? "neutral" : "success" }} />
}

/** «Resumen del archivo»: cifras en una grilla de pares etiqueta/valor, con el estado a la derecha. */
export function SummaryCard({ title = "Resumen del archivo", status, items }: {
  title?: string
  status: ImportedFileStatus
  items: Array<{ label: string; value: ReactNode; mono?: boolean }>
}) {
  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle as="h2">{title}</CardTitle>
        <FileStatusBadge status={status} />
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {items.map((item) => <DetailItem key={item.label} layout="stacked" label={item.label} value={item.value} mono={item.mono} />)}
        </dl>
      </CardContent>
    </Card>
  )
}

/** Sección con título y una frase de contexto. */
export function Section({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle as="h2">{title}</CardTitle>
          {description ? <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
