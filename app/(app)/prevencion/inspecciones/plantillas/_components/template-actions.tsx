"use client"

import { Button } from "@/components/ui/button"
import { templateActionState } from "@/lib/prevention/inspection-catalog-logic"
import { toast } from "@/lib/toast"
import { useOperation } from "@/lib/hooks/use-operation"
import type { PdtpActivityPickerOption } from "@/components/prevention/pdtp-activity-picker"
import { remindTemplateApprovalAction } from "../../actions"
import type { DocumentSourceOption, TemplateItem } from "../../_components/catalog-types"
import { InlineError } from "../../_components/form-dialog"
import { DeviationCatalogDialog } from "./deviation-catalog-dialog"
import { PdtpActivitiesDialog } from "./pdtp-activities-dialog"
import {
  ApproveDialog,
  LinkSourceDialog,
  ParityDialog,
  RetireDialog,
  RollbackTemplateDialog,
} from "./template-lifecycle-dialogs"

/**
 * I-15: quien incorpora un borrador (`manage`) puede no tener `approve` — sin
 * esto podía crear una plantilla que nunca podría habilitar ella misma, sin
 * forma de avisarle a quien sí puede.
 */
export function RequestApprovalButton({ templateId }: { templateId: string }) {
  const operation = useOperation()
  return (
    <div className="text-right">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        loading={operation.pending}
        onClick={() => operation.run(
          () => remindTemplateApprovalAction({ templateId }),
          (result) => {
            const names = result.data?.notified
            toast.success(Array.isArray(names) && names.length > 0 ? `Solicitud enviada a ${names.join(", ")}.` : "Solicitud de aprobación enviada.")
          },
        )}
      >
        {operation.pending ? "Enviando…" : "Solicitar aprobación"}
      </Button>
      <InlineError operation={operation} className="max-w-64" />
    </div>
  )
}

export function TemplateActions({ item, templates, catalogActivities, documentSources, canManage, canApprove, currentUserId }: {
  item: TemplateItem
  templates: TemplateItem[]
  catalogActivities: PdtpActivityPickerOption[]
  documentSources: DocumentSourceOption[]
  canManage: boolean
  canApprove: boolean
  currentUserId: string | null
}) {
  // La versión a la que se puede volver es la que ESTA reemplazó al aprobarse.
  // Una versión retirada a propósito no apunta a nada y no se restaura.
  const previous = templates.find((candidate) => candidate.supersededByTemplateId === item.id)
  // Lo que el servidor rechazaría no se ofrece como botón: se dice por qué todavía
  // no (patrón I-04; un botón deshabilitado no avisa por teclado ni en móvil).
  const state = templateActionState(item, { canManage, canApprove, currentUserId })
  return (
    <div className="flex flex-col items-end gap-2">
      {state.notice && <p className="max-w-64 text-right text-xs text-[var(--color-warning-ink)]">{state.notice}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {state.deviations && <DeviationCatalogDialog templateCode={item.code} name={item.name} entries={item.deviations} unclassified={item.unclassifiedDeviations} />}
        {state.pdtp && <PdtpActivitiesDialog item={item} options={catalogActivities} />}
        {state.linkSource && <LinkSourceDialog item={item} documentSources={documentSources} label={state.linkSource} />}
        {state.declareParity && <ParityDialog item={item} />}
        {state.approve && <ApproveDialog templateId={item.id} name={item.name} expectedVersion={item.version} />}
        {state.requestApproval && <RequestApprovalButton templateId={item.id} />}
        {state.retire && <RetireDialog templateId={item.id} name={item.name} />}
        {item.status === "approved" && previous && canApprove && <RollbackTemplateDialog current={item} previous={previous} />}
      </div>
    </div>
  )
}
