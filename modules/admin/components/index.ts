/**
 * modules/admin/components/index.ts
 *
 * Re-exporta los componentes de administración.
 * Los shared admin primitives siguen en components/admin/ (son usados por varios módulos).
 */

// Shared admin UI primitives — fuente de verdad: components/admin/
export { DataTable } from "@/components/admin/data-table"
export type { ColumnDef, DataTableProps } from "@/components/admin/data-table"
export {
  Sheet, SheetClose, SheetContent, SheetHeader, SheetBody,
  SheetFooter, SheetTitle, SheetDescription, SheetCloseButton,
} from "@/components/admin/sheet"
export { SubmitButton } from "@/components/admin/submit-button"
export { INITIAL_STATE } from "@/components/admin/form-state"
export type { ActionState } from "@/components/admin/form-state"
