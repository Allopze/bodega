"use client"

import type { PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"
import type { DocumentSourceOption, TemplateItem } from "../../_components/catalog-types"
import { DeviationCatalogDialog } from "./deviation-catalog-dialog"
import { PdtpActivitiesDialog } from "./pdtp-activities-dialog"
import type { TemplateDialogKind } from "./template-actions"
import {
  ApproveDialog,
  LinkSourceDialog,
  ParityDialog,
  RetireDialog,
  RollbackTemplateDialog,
} from "./template-lifecycle-dialogs"

/**
 * El diálogo abierto de la tabla. `open` y el resto viajan juntos: al cerrar sólo
 * baja `open`, así que el diálogo sigue montado mientras se anima su salida y
 * recién `nonce` —que sube en cada apertura— lo desmonta y lo vuelve a armar
 * desde la plantilla tal como está hoy.
 */
export type ActiveTemplateDialog = {
  kind: Exclude<TemplateDialogKind, "preview">
  item: TemplateItem
  nonce: number
  open: boolean
}

/**
 * Monta, una sola vez para toda la tabla, el diálogo que pidió una fila. Todos
 * son controlados: las acciones viven en un menú, y un `DialogTrigger` dentro de
 * un ítem de menú se desmonta con el menú (patrón de ti/asignaciones).
 */
export function TemplateDialogs({ active, onOpenChange, templates, catalogActivities, documentSources, onPreview }: {
  active: ActiveTemplateDialog | null
  onOpenChange: (open: boolean) => void
  templates: TemplateItem[]
  catalogActivities: PdtpActivityPickerOption[]
  documentSources: DocumentSourceOption[]
  /** Abre la vista previa apilada sobre el diálogo (aprobar y declarar paridad). */
  onPreview: (item: TemplateItem) => void
}) {
  if (!active) return null
  const { kind, open, nonce } = active
  // La versión viva de la plantilla y no la que había al abrir: marcar una
  // desviación revalida la página mientras el diálogo sigue abierto, y el
  // diálogo tiene que mostrar el resultado.
  const item = templates.find((candidate) => candidate.id === active.item.id) ?? active.item
  const key = `${kind}:${item.id}:${nonce}`

  switch (kind) {
    case "pdtp":
      return <PdtpActivitiesDialog key={key} item={item} options={catalogActivities} open={open} onOpenChange={onOpenChange} />
    case "deviations":
      return (
        <DeviationCatalogDialog
          key={key}
          templateCode={item.code}
          name={item.name}
          entries={item.deviations}
          unclassified={item.unclassifiedDeviations}
          open={open}
          onOpenChange={onOpenChange}
        />
      )
    case "link":
      return <LinkSourceDialog key={key} item={item} documentSources={documentSources} open={open} onOpenChange={onOpenChange} />
    case "parity":
      return <ParityDialog key={key} item={item} open={open} onOpenChange={onOpenChange} onPreview={() => onPreview(item)} />
    case "approve":
      return <ApproveDialog key={key} item={item} open={open} onOpenChange={onOpenChange} onPreview={() => onPreview(item)} />
    case "retire":
      return <RetireDialog key={key} item={item} open={open} onOpenChange={onOpenChange} />
    case "rollback": {
      // La versión a la que se puede volver es la que ESTA reemplazó al aprobarse.
      const previous = templates.find((candidate) => candidate.supersededByTemplateId === item.id)
      if (!previous) return null
      return <RollbackTemplateDialog key={key} current={item} previous={previous} open={open} onOpenChange={onOpenChange} />
    }
  }
}
