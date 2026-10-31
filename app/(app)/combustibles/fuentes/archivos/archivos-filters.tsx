"use client"

import { SegmentedControl } from "@/components/ui/segmented-control"
import { useUrlFilters } from "@/lib/hooks/use-url-filters"
import { formatQty } from "@/lib/utils"
import { IMPORTED_FILE_KIND_LABELS, IMPORTED_FILE_STATUS_LABELS, type ImportedFileKind, type ImportedFileStatus } from "../imported-file-kinds"

const STATUSES: ImportedFileStatus[] = ["importado", "revertido"]

/**
 * Filtros de «Archivos importados»: el tipo de archivo (con cuántos hay de cada
 * uno) y el estado. Cada uno es una sola dimensión con un solo control; cambian
 * la URL con `router.replace` sin saltar de posición ni apilar historial.
 */
export function ArchivosFilters({ kind, status, counts, visibleKinds, total }: {
  kind: ImportedFileKind | undefined
  status: ImportedFileStatus | undefined
  counts: Partial<Record<ImportedFileKind, number>>
  visibleKinds: ImportedFileKind[]
  total: number
}) {
  const { setFilter } = useUrlFilters({ pageKey: "pagina" })
  return (
    <div className="mb-4 flex flex-col gap-3">
      {visibleKinds.length > 1 ? (
        <SegmentedControl
          ariaLabel="Tipo de archivo"
          items={[
            { key: "todos", label: `Todos (${formatQty(Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0))})`, active: !kind, onClick: () => setFilter("tipo", null) },
            ...visibleKinds.map((visible) => ({
              key: visible,
              label: `${IMPORTED_FILE_KIND_LABELS[visible]} (${formatQty(counts[visible] ?? 0)})`,
              active: kind === visible,
              onClick: () => setFilter("tipo", visible),
            })),
          ]}
        />
      ) : null}
      <SegmentedControl
        variant="segmented"
        ariaLabel="Estado del archivo"
        items={[
          { key: "todos", label: "Todos", active: !status, onClick: () => setFilter("estado", null) },
          ...STATUSES.map((value) => ({ key: value, label: IMPORTED_FILE_STATUS_LABELS[value], active: status === value, onClick: () => setFilter("estado", value) })),
        ]}
      />
      <p className="sr-only" role="status">{formatQty(total)} archivos</p>
    </div>
  )
}
