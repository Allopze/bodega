"use client"

import * as React from "react"
import { DotsThreeVertical, Folder, FolderOpen } from "@phosphor-icons/react"
import type { FileIconDescriptor } from "@/lib/prevention/file-icon"
import { cn } from "@/lib/utils"

type CommonProps = {
  name: string
  selected: boolean
  /** When true, the multi-select checkbox is always visible (e.g. some items are already selected). */
  selectionActive: boolean
  canSelect: boolean
  onSelect: () => void
  onOpen: () => void
  onContextMenu: (event: React.MouseEvent) => void
  onAction: (event: React.MouseEvent) => void
  draggable: boolean
  onDragStart?: (event: React.DragEvent) => void
  dragOver?: boolean
  onDragOver?: (event: React.DragEvent) => void
  onDragLeave?: (event: React.DragEvent) => void
  onDrop?: (event: React.DragEvent) => void
}

export type DocumentTileProps =
  | (CommonProps & { kind: "folder" })
  | (CommonProps & { kind: "document"; fileMeta: FileIconDescriptor })

/**
 * One tile in the document grid. Folders and documents share the same
 * shape so the grid stays uniform; only the icon and label differ.
 */
export const DocumentTile = React.memo(React.forwardRef<HTMLDivElement, DocumentTileProps>(
  function DocumentTile(props, ref) {
    const { kind, name, selected, selectionActive, canSelect, onSelect, onOpen, onContextMenu, onAction, draggable, onDragStart, dragOver, onDragOver, onDragLeave, onDrop } = props
    const [hovered, setHovered] = React.useState(false)
    const isFolder = kind === "folder"
    const Icon = isFolder ? (hovered || selected ? FolderOpen : Folder) : props.fileMeta.Icon
    const iconColor = isFolder ? "var(--color-primary)" : props.fileMeta.color
    const ariaLabel = isFolder ? `Carpeta ${name}` : `Documento ${name}`

    return (
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onOpen()
          }
        }}
        onContextMenu={onContextMenu}
        aria-label={ariaLabel}
        data-selected={selected || undefined}
        data-drag-over={dragOver || undefined}
        className={cn(
          "group relative flex h-[168px] flex-col items-center justify-start gap-2 rounded-[var(--radius-xl)] border border-(--color-border) bg-(--color-surface) px-3 pb-3 pt-6 text-center",
          "transition-[background-color,box-shadow,outline-color] duration-[var(--duration-fast)] ease-[var(--ease-out)]",
          "hover:border-(--color-border-strong) hover:bg-(--color-surface-2)",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-primary)",
          selected && "border-(--color-primary) bg-(--color-primary-tint) hover:bg-(--color-primary-tint)",
          dragOver && "outline-2 outline-offset-[-2px] outline-(--color-primary)",
        )}
      >
        {canSelect && (hovered || selected || selectionActive) && (
          <span
            className="absolute left-2 top-2"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={onSelect}
              onClick={(event) => event.stopPropagation()}
              aria-label={`Seleccionar ${isFolder ? "carpeta" : "documento"} ${name}`}
              className="h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
            />
          </span>
        )}
        {(hovered || selected) && (
          <span
            className="absolute right-1 top-1"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              draggable={false}
              onClick={onAction}
              aria-label={`Acciones de ${name}`}
              className="inline-flex h-11 w-11 sm:h-7 sm:w-7 items-center justify-center rounded-md text-(--color-text-muted) hover:bg-(--color-chrome) hover:text-(--color-text)"
            >
              <DotsThreeVertical size={18} weight="bold" />
            </button>
          </span>
        )}
        <span
          aria-hidden
          className="mt-2 flex h-16 w-16 items-center justify-center"
          style={{ color: iconColor }}
        >
          <Icon size={56} weight="duotone" />
        </span>
        <span className="line-clamp-2 w-full break-words text-[13px] font-medium leading-tight text-(--color-text)" title={name}>
          {name}
        </span>
      </div>
    )
  },
))
