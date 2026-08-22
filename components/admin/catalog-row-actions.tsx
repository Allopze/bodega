import { PencilSimple, ToggleLeft, ToggleRight } from "@phosphor-icons/react"

const BUTTON_CLASS =
  "h-8 w-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)] transition-colors duration-[var(--duration-fast)]"

interface CatalogRowActionsProps {
  id: string
  isActive: boolean
  /** Entity description used in aria-labels, e.g. "faena Norte" or "trabajador Juan Pérez". */
  label: string
  onEdit: () => void
  toggleAction: (formData: FormData) => void
  editDisabled?: boolean
  editPending?: boolean
  onDeactivateRequest?: () => void
  /**
   * Cuando se provee, el toggle en AMBAS direcciones abre confirmación en vez
   * de reactivar con un solo clic — para catálogos donde incluso reactivar
   * exige un paso explícito (ej. flota: exige motivo de vuelta a `fuel_vehicle`).
   * Reemplaza tanto `onDeactivateRequest` como el envío directo del form.
   */
  onToggleRequest?: (id: string, activate: boolean) => void
  togglePending?: boolean
}

/**
 * The Editar + Activar/Desactivar cell shared by every catalog row —
 * identical in faenas-list.tsx and worker-list.tsx before this extraction.
 * Renders only the two buttons; the caller keeps its own wrapper element
 * (desktop cell vs. mobile card use different containers).
 */
export function CatalogRowActions({
  id, isActive, label, onEdit, toggleAction, editDisabled = false, editPending = false,
  onDeactivateRequest, onToggleRequest, togglePending = false,
}: CatalogRowActionsProps) {
  return (
    <>
      <button
        type="button"
        onClick={onEdit}
        disabled={editDisabled}
        className={`${BUTTON_CLASS} disabled:opacity-50`}
        title="Editar"
        aria-label={`Editar ${label}`}
      >
        <PencilSimple size={16} className={editPending ? "animate-spin" : undefined} />
      </button>
      {onToggleRequest ? (
        <button
          type="button"
          onClick={() => onToggleRequest(id, !isActive)}
          disabled={togglePending}
          className={`${BUTTON_CLASS} disabled:opacity-50`}
          title={isActive ? "Desactivar" : "Activar"}
          aria-label={`${isActive ? "Desactivar" : "Activar"} ${label}`}
        >
          {isActive
            ? <ToggleRight size={20} className="text-[var(--color-primary)]" />
            : <ToggleLeft size={20} />}
        </button>
      ) : isActive && onDeactivateRequest ? (
        <button
          type="button"
          onClick={onDeactivateRequest}
          disabled={togglePending}
          className={`${BUTTON_CLASS} disabled:opacity-50`}
          title="Desactivar"
          aria-label={`Desactivar ${label}`}
        >
          <ToggleRight size={20} className="text-[var(--color-primary)]" />
        </button>
      ) : (
        <form action={toggleAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="activate" value={String(!isActive)} />
          <button
            type="submit"
            disabled={togglePending}
            className={`${BUTTON_CLASS} disabled:opacity-50`}
            title={isActive ? "Desactivar" : "Activar"}
            aria-label={`${isActive ? "Desactivar" : "Activar"} ${label}`}
          >
            {isActive
              ? <ToggleRight size={20} className="text-[var(--color-primary)]" />
              : <ToggleLeft size={20} />}
          </button>
        </form>
      )}
    </>
  )
}
