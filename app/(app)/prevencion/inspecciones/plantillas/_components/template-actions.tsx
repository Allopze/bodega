"use client"

import { DotsThree } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { templateActionState, type TemplateActionContext } from "@/lib/prevention/inspection-catalog-logic"
import { toast } from "@/lib/toast"
import { useOperation } from "@/lib/hooks/use-operation"
import { remindTemplateApprovalAction } from "../../actions"
import type { TemplateItem } from "../../_components/catalog-types"
import { InlineError } from "../../_components/form-dialog"

/**
 * Qué se hace con una plantilla desde su fila.
 *
 * La fila ofrece UNA acción visible —el siguiente paso del instrumento— y el
 * resto vive en un menú «Más acciones»: cinco botones por fila empujaban la
 * columna de acción fuera de la pantalla a 1280 px. El menú abre diálogos que
 * monta el panel (un `DialogTrigger` dentro de un ítem de menú se desmonta con
 * el menú), de modo que acá sólo se decide qué ofrecer y se avisa cuál se eligió.
 */
export type TemplateDialogKind = "preview" | "pdtp" | "deviations" | "link" | "parity" | "approve" | "retire" | "rollback"

export type TemplateOpenDialog = (kind: TemplateDialogKind, item: TemplateItem) => void

type PrimaryAction = { kind: "link" | "parity" | "approve" | "request"; label: string }
type MenuAction = { kind: TemplateDialogKind; label: string }

/**
 * La acción principal es el siguiente paso, en el orden en que el instrumento lo
 * necesita: vincular la planilla, aprobar si ya está lista, declarar la paridad
 * y, para quien no puede aprobar, avisar a quien sí. Lo que el servidor
 * rechazaría no se ofrece: el estado ya trae el aviso que ocupa su lugar.
 */
export function describeTemplateActions(
  item: TemplateItem,
  ctx: TemplateActionContext,
  previous: TemplateItem | null,
) {
  const state = templateActionState(item, ctx)

  let primary: PrimaryAction | null = null
  if (state.linkSource === "Vincular fuente") primary = { kind: "link", label: "Vincular fuente" }
  else if (state.approve) primary = { kind: "approve", label: "Aprobar" }
  else if (state.declareParity) primary = { kind: "parity", label: "Declarar paridad" }
  else if (state.requestApproval) primary = { kind: "request", label: "Solicitar aprobación" }

  const menu: MenuAction[] = [{ kind: "preview", label: "Ver cuestionario" }]
  if (state.pdtp) menu.push({ kind: "pdtp", label: "Acreditación PDTP" })
  if (state.deviations) {
    const pending = item.unclassifiedDeviations.length
    menu.push({ kind: "deviations", label: pending > 0 ? `Desviaciones (${pending})` : "Desviaciones" })
  }
  if (state.linkSource && primary?.kind !== "link") menu.push({ kind: "link", label: state.linkSource })
  if (state.declareParity && primary?.kind !== "parity") menu.push({ kind: "parity", label: "Declarar paridad" })
  // Sólo se vuelve a la versión que ESTA reemplazó; una retirada a propósito no apunta a nada.
  if (item.status === "approved" && previous && ctx.canApprove) {
    menu.push({ kind: "rollback", label: `Revertir a ${previous.versionLabel}` })
  }
  const destructive: MenuAction | null = state.retire ? { kind: "retire", label: "Retirar…" } : null

  return { state, primary, menu, destructive }
}

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
      <InlineError operation={operation} className="max-w-56" />
    </div>
  )
}

/**
 * La acción de la fila: el siguiente paso y, junto a él, «Más acciones de …».
 * El nombre del menú lleva el del instrumento porque hay un menú por fila y
 * «Más acciones» a secas no dice de cuál.
 */
export function TemplateRowActions({ item, ctx, previous, onOpen, menuLabelOf, mobile = false }: {
  item: TemplateItem
  ctx: TemplateActionContext
  previous: TemplateItem | null
  onOpen: TemplateOpenDialog
  /** El nombre con que se rotula el menú: el instrumento, más su versión si hay dos filas del mismo. */
  menuLabelOf: string
  mobile?: boolean
}) {
  const { primary, menu, destructive } = describeTemplateActions(item, ctx, previous)

  // Quien sólo mira no tiene nada más que «Ver cuestionario»: un menú de un solo
  // ítem es un clic de más, así que el botón lo ofrece directamente.
  const onlyPreview = menu.length === 1 && !destructive && !primary

  return (
    <div className={mobile ? "flex flex-wrap items-center justify-end gap-2" : "flex items-center justify-end gap-1.5"}>
      {primary?.kind === "request" && <RequestApprovalButton templateId={item.id} />}
      {primary && primary.kind !== "request" && (
        <Button type="button" size="sm" variant="secondary" onClick={() => onOpen(primary.kind, item)}>
          {primary.label}
        </Button>
      )}
      {onlyPreview ? (
        <Button type="button" size="sm" variant="ghost" onClick={() => onOpen("preview", item)}>
          Ver cuestionario
        </Button>
      ) : (
        /* No modal: los ítems abren un diálogo. Un menú modal deja
            `pointer-events: none` en el body justo cuando monta el diálogo, que lo
            guarda como valor original y lo restaura al cerrarse: la página
            quedaba sin responder a clics (patrón de ti/asignaciones). */
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size={mobile ? "sm" : "icon-sm"} aria-label={`Más acciones de ${menuLabelOf}`}>
              <DotsThree size={18} weight="bold" aria-hidden />
              <span className={mobile ? "ml-1" : "sr-only"}>Más</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {menu.map((entry) => (
              <DropdownMenuItem key={`${entry.kind}-${entry.label}`} onSelect={() => onOpen(entry.kind, item)}>
                {entry.label}
              </DropdownMenuItem>
            ))}
            {destructive && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-[var(--color-danger-ink)] focus:bg-[var(--color-danger-tint)] focus:text-[var(--color-danger-ink)]"
                  onSelect={() => onOpen(destructive.kind, item)}
                >
                  {destructive.label}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
