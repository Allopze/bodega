"use client"

import { DownloadSimple, DotsThreeVertical } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TableCell, TableRow } from "@/components/ui/table"
import { getFileIcon } from "@/lib/prevention/file-icon"
import { formatDate, formatFileSize } from "@/lib/utils"
import type { DocumentRow } from "./documentacion-view.types"
import { DRAG_MIME } from "./documentacion-view.types"

interface DocumentTableRowProps {
  document: DocumentRow
  canManage: boolean
  selected: boolean
  onToggleSelected: () => void
  onContextMenu: (event: React.MouseEvent) => void
  onOpenDetail: () => void
  onMove: () => void
}

export function DocumentTableRow({
  document: d,
  canManage,
  selected,
  onToggleSelected,
  onContextMenu,
  onOpenDetail,
  onMove,
}: DocumentTableRowProps) {
  const fileMeta = getFileIcon({ mimeType: d.mimeType ?? null, fileName: d.fileName ?? null })
  const FileIcon = fileMeta.Icon
  return (
    <TableRow
      draggable={canManage}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: "document", id: d.id }))
        event.dataTransfer.effectAllowed = "move"
      }}
      onContextMenu={onContextMenu}
    >
      <TableCell>
        <Checkbox
          labelHidden
          label={`Seleccionar documento ${d.title}`}
          checked={selected}
          onChange={onToggleSelected}
        />
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <button type="button" onClick={onOpenDetail} className="inline-flex items-center gap-2 font-medium text-(--color-text) hover:underline text-left">
            <FileIcon size={18} weight="duotone" style={{ color: fileMeta.color }} />
            {d.title}
          </button>
          {canManage && d.typeId === null && (
            <span className="text-xs text-[var(--color-text-muted)]">Sin clasificar: ábrelo para declarar su tipo y faena.</span>
          )}
          {d.fileName && d.fileName !== d.title && (
            <span className="text-xs text-(--color-text-subtle)">{d.fileName}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-xs text-(--color-text-subtle)">{fileMeta.label}</TableCell>
      <TableCell className="text-xs text-(--color-text-subtle)">{formatDate(d.updatedAt)}</TableCell>
      <TableCell className="text-xs text-(--color-text-subtle)">{formatFileSize(d.fileSize)}</TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button asChild size="sm" variant="secondary">
            <a href={`/api/prevencion/documentacion/${d.id}?download=1`} download>
              <DownloadSimple size={14} className="mr-1" />
              Descargar
            </a>
          </Button>
          {canManage && (
            <Button type="button" size="sm" variant="ghost" onClick={onMove}>
              Mover
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon-mobile" variant="ghost" aria-label={`Acciones de ${d.title}`}>
                <DotsThreeVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onOpenDetail}>Ver detalle</DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpenDetail}>Vista previa</DropdownMenuItem>
              <DropdownMenuItem asChild><a href={`/api/prevencion/documentacion/${d.id}?download=1`} download>Descargar</a></DropdownMenuItem>
              {canManage && <DropdownMenuSeparator />}
              {canManage && <DropdownMenuItem onSelect={onMove}>Mover</DropdownMenuItem>}
              {canManage && <DropdownMenuItem onSelect={onOpenDetail}>Subir nueva versión</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  )
}
