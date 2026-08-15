import Link from "next/link"
import { FileText } from "@phosphor-icons/react/dist/ssr"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { SST_DOCUMENT_STATUS_LABELS } from "@/lib/prevention/privacy-inventory"

interface DocumentRow {
  linkId: string
  documentId: string
  title: string
  internalCode: string | null
  status: string
  notes: string | null
}

/**
 * Documentos del comité: acta de constitución, comprobante de registro ante la
 * Dirección del Trabajo y difusiones. Viven en Documentación SST —con
 * versionado, checksum y acuse firmado— y se vinculan al comité; el módulo CPHS
 * no guarda archivos propios.
 */
export function CommitteeDocuments({ documents }: { documents: DocumentRow[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Documentos del comité ({documents.length})</h2>
      {documents.length === 0 ? (
        <EmptyState
          icon={<FileText size={24} />}
          title="El comité aún no tiene documentos vinculados"
          description="Sube el acta de constitución o el comprobante de la Dirección del Trabajo en Documentación SST y vincúlalo a este comité."
          action={<Button asChild size="sm" variant="secondary"><Link href="/prevencion/documentacion">Ir a Documentación SST</Link></Button>}
          compact
        />
      ) : (
        <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {documents.map((document) => (
            <li key={document.linkId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="text-sm">
                <Link href={`/prevencion/documentacion/${document.documentId}`} className="font-medium hover:underline">
                  {document.title}
                </Link>
                {document.internalCode && (
                  <span className="ml-2 font-mono text-xs text-[var(--color-text-subtle)]">{document.internalCode}</span>
                )}
                {document.notes && (
                  <span className="block text-xs text-[var(--color-text-subtle)]">{document.notes}</span>
                )}
              </div>
              <Badge variant={document.status === "vigente" || document.status === "aprobado" ? "success" : document.status === "vencido" || document.status === "observado" ? "danger" : "outline"}>
                {SST_DOCUMENT_STATUS_LABELS[document.status] ?? document.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
