"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { isRetiredStatus, itStatusLabel } from "@/lib/services/ti/constants"
import { AssignmentSheet } from "../../asignaciones/assignment-sheet"
import { AcceptanceSheet } from "../../asignaciones/acceptance-sheet"
import { ReturnSheet } from "../../asignaciones/return-sheet"
import { TransferSheet } from "../../asignaciones/transfer-sheet"
import { MaintenanceSheet } from "../../mantenciones/maintenance-sheet"
import { RetirementSheet } from "../../bajas/retirement-sheet"
import { CorrectStatusDialog } from "./asset-status-control"
import { Archive, ArrowsLeftRight, ArrowUUpLeft, CaretDown, HandArrowUp, Signature, Wrench } from "@phosphor-icons/react"

interface Custody {
  id: string
  code: string
  assetId: string
  assetCode: string
  workerName: string
  worksiteName: string
  acceptanceStatus: string
  accessories: { id: string; name: string; returnedAt: string | null }[]
  deliveredAt: string
  physicalState: string
  photos: { id: string; stage: string; caption: string | null }[]
}

interface AssetNextActionProps {
  asset: {
    id: string
    code: string
    status: string
    typeName: string
    brand: string | null
    model: string | null
    workerName: string | null
    worksiteName: string | null
  }
  custody: Custody | null
  /** `ti:manage_assets`: entregar, devolver, transferir, acusar, dar de baja y corregir estado. */
  canManage: boolean
  /** `ti:manage_maintenance`: permiso propio. */
  canManageMaintenance: boolean
  /** Hay una baja vigente registrada para el activo. */
  hasRetirement: boolean
  /** Catálogos que solo se cargan para quien gestiona. */
  workers: { id: string; name: string; lastName: string }[]
  worksites: { id: string; name: string }[]
  suppliers: { id: string; name: string }[]
  retirementUsers: { id: string; name: string }[]
}

/**
 * Panel «Siguiente acción» de la ficha (TIUX-11). La ficha lideraba con un
 * formulario de «Cambiar estado»; lo que el técnico necesita es el siguiente
 * paso de la vida del equipo según su estado. El botón primario es ese paso;
 * el resto son alternativas y la corrección de estado queda en «Más acciones».
 */
export function AssetNextAction({
  asset, custody, canManage, canManageMaintenance, hasRetirement, workers, worksites, suppliers, retirementUsers,
}: AssetNextActionProps) {
  const [correctOpen, setCorrectOpen] = React.useState(false)

  const terminal = isRetiredStatus(asset.status)
  const assignable = asset.status === "disponible" || asset.status === "en_bodega"
  const acusePending = custody?.acceptanceStatus === "pendiente"

  // «Corregir estado» no se ofrece en estados terminales con baja vigente (se
  // revierte desde Bajas) ni con una entrega abierta: se explica en vez de dejar
  // que el servidor rechace opciones que el menú sí mostraba. Un perdido/robado
  // fijado a mano, sin registro de baja, sí se puede recuperar.
  const correctBlocked = custody ? "Hay una entrega abierta: registra la devolución primero." : null
  const showMenu = canManage && (!terminal || (asset.status !== "dado_de_baja" && !hasRetirement))

  const triggers = {
    deliver: (
      <AssignmentSheet
        trigger={<Button type="button"><HandArrowUp size={14} className="mr-1.5" aria-hidden /> Entregar</Button>}
        assetId={asset.id}
        workers={workers}
        worksites={worksites}
      />
    ),
    acknowledge: custody ? (
      <AcceptanceSheet
        trigger={<Button type="button"><Signature size={14} className="mr-1.5" aria-hidden /> Registrar acuse</Button>}
        assignment={custody}
      />
    ) : null,
    return: custody ? (
      <ReturnSheet
        trigger={<Button type="button" variant={acusePending ? "secondary" : "primary"}><ArrowUUpLeft size={14} className="mr-1.5" aria-hidden /> Devolver</Button>}
        assignment={custody}
        reference={{
          deliveredAt: custody.deliveredAt,
          physicalState: custody.physicalState,
          accessories: custody.accessories.map((a) => a.name),
          photos: custody.photos.filter((p) => p.stage === "delivery").map((p) => ({ id: p.id, caption: p.caption })),
        }}
      />
    ) : null,
    transfer: custody ? (
      <TransferSheet
        trigger={<Button type="button" variant="secondary"><ArrowsLeftRight size={14} className="mr-1.5" aria-hidden /> Transferir</Button>}
        assignment={custody}
        workers={workers}
        worksites={worksites}
      />
    ) : null,
    maintenance: (
      <MaintenanceSheet
        trigger={<Button type="button" variant={asset.status === "en_reparacion" ? "primary" : "secondary"}><Wrench size={14} className="mr-1.5" aria-hidden /> Registrar mantención</Button>}
        assetId={asset.id}
        suppliers={suppliers}
      />
    ),
    retire: (
      <RetirementSheet
        trigger={<Button type="button" variant="secondary"><Archive size={14} className="mr-1.5" aria-hidden /> Dar de baja</Button>}
        assetId={asset.id}
        assets={[{
          id: asset.id, code: asset.code, typeName: asset.typeName,
          workerName: asset.workerName ?? undefined, worksiteName: asset.worksiteName ?? undefined,
          brand: asset.brand ?? undefined, model: asset.model ?? undefined,
        }]}
        users={retirementUsers}
      />
    ),
  }

  const heading = terminal ? "Estado del activo" : "Siguiente acción"
  let description: string
  let buttons: React.ReactNode[] = []

  if (terminal) {
    description = asset.status === "dado_de_baja"
      ? "Este activo ya salió del inventario vigente. No admite más movimientos."
      : hasRetirement
        ? `El activo figura como ${itStatusLabel(asset.status).toLowerCase()} por una baja registrada. No admite entregas ni mantenciones.`
        : `El activo figura como ${itStatusLabel(asset.status).toLowerCase()}. Si apareció, corrige el estado para volver a usarlo.`
  } else if (custody) {
    description = acusePending
      ? `El acta ${custody.code} está sin acuse de ${custody.workerName}. Registra el acuse cuando lo tengas firmado.`
      : `En custodia de ${custody.workerName} (acta ${custody.code}).`
    if (canManage) {
      buttons = acusePending
        ? [triggers.acknowledge, triggers.return, triggers.transfer]
        : [triggers.return, triggers.transfer]
    }
  } else if (asset.status === "en_reparacion") {
    description = "El equipo está en reparación. Registra la mantención y, al terminar, corrige el estado."
    if (canManageMaintenance) buttons = [triggers.maintenance]
  } else if (assignable) {
    description = asset.status === "disponible"
      ? "El equipo está disponible. Entrégalo para registrar quién lo tiene."
      : "El equipo está en bodega. Entrégalo para registrar quién lo tiene."
    if (canManage) buttons = [triggers.deliver, triggers.retire]
  } else {
    description = `El activo está en estado «${itStatusLabel(asset.status)}» sin una entrega que lo respalde. Corrige el estado para continuar.`
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{heading}</h2>
        <p className="mt-1 text-sm text-[var(--color-text)]">{description}</p>
      </div>

      {(buttons.length > 0 || showMenu) && (
        <div className="flex flex-wrap items-center gap-2">
          {buttons.map((button, i) => <React.Fragment key={i}>{button}</React.Fragment>)}

          {showMenu && (
            <>
              {/* No modal: el ítem abre una hoja. Un menú modal deja `pointer-events: none`
                  en el body justo cuando monta la hoja, que lo guarda como valor original y
                  lo restaura al cerrarse: la página quedaba sin responder a clics. */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" aria-label="Más acciones">
                    Más acciones
                    <CaretDown size={13} weight="bold" className="ml-1" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-72">
                  <DropdownMenuItem
                    disabled={Boolean(custody)}
                    onSelect={() => setCorrectOpen(true)}
                    className="flex-col items-start gap-0.5"
                  >
                    <span>Corregir estado…</span>
                    {correctBlocked && <span className="text-xs font-normal text-[var(--color-text-muted)]">{correctBlocked}</span>}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <CorrectStatusDialog
                assetId={asset.id}
                currentStatus={asset.status}
                open={correctOpen}
                onOpenChange={setCorrectOpen}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}
