"use client"

import Link from "next/link"
import { FolderOpen, DotsThreeVertical } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TableCell, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { FolderRow } from "./documentacion-view.types"

interface FolderTableRowProps {
  folder: FolderRow
  canManage: boolean
  canArchive: boolean
  selected: boolean
  dragOver: boolean
  pending: boolean
  folderHref: string
  onToggleSelected: () => void
  onContextMenu: (event: React.MouseEvent) => void
  onRestore: () => void
  onArchive: () => void
  onRename: () => void
  onMove: () => void
  onDragStart: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
  onDragOver: (event: React.DragEvent) => void
  onDragLeave: () => void
}

export function FolderTableRow({
  folder,
  canManage,
  canArchive,
  selected,
  dragOver,
  pending,
  folderHref,
  onToggleSelected,
  onContextMenu,
  onRestore,
  onArchive,
  onRename,
  onMove,
  onDragStart,
  onDrop,
  onDragOver,
  onDragLeave,
}: FolderTableRowProps) {
  return (
    <TableRow
      draggable={canManage}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      className={cn(dragOver && "bg-(--color-surface-2) outline outline-2 -outline-offset-2 outline-(--color-primary)")}
    >
      <TableCell>
        <input
          type="checkbox"
          aria-label={`Seleccionar carpeta ${folder.name}`}
          checked={selected}
          onChange={onToggleSelected}
          className="h-4 w-4 accent-[var(--color-primary)]"
        />
      </TableCell>
      <TableCell>
        <Link
          href={folderHref}
          draggable={false}
          onContextMenu={onContextMenu}
          aria-label={`Carpeta ${folder.name}`}
          className="inline-flex items-center gap-2 font-medium text-(--color-text) hover:underline"
        >
          <FolderOpen size={18} weight="duotone" className="text-(--color-primary)" aria-hidden />
          {folder.name}
        </Link>
      </TableCell>
      <TableCell className="text-xs text-(--color-text-subtle)">Carpeta</TableCell>
      <TableCell className="text-xs text-(--color-text-subtle)">{formatDate(folder.updatedAt)}</TableCell>
      <TableCell className="text-xs">—</TableCell>
      <TableCell className="text-right">
        {folder.archivedAt && canArchive ? (
          <Button type="button" size="sm" variant="secondary" aria-label={`Restaurar carpeta ${folder.name}`} onClick={onRestore} disabled={pending}>
            Restaurar
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon-mobile" variant="ghost" aria-label={`Acciones de ${folder.name}`}>
                <DotsThreeVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild><Link href={folderHref}>Abrir</Link></DropdownMenuItem>
              {canManage && <DropdownMenuItem onSelect={onRename}>Renombrar</DropdownMenuItem>}
              {canManage && <DropdownMenuItem onSelect={onMove}>Mover</DropdownMenuItem>}
              {canArchive && <DropdownMenuItem onSelect={onArchive} className="text-(--color-danger)">Archivar</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  )
}

export function formatDate(value: string) {
  return value.slice(0, 10)
}
