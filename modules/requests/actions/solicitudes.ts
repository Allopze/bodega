"use server"

/**
 * modules/requests/actions/solicitudes.ts
 *
 * Forward shim → app/(app)/solicitudes/actions.ts
 * Fase 3: las acciones se mueven aquí y el archivo de app/ las importa desde aquí.
 */

export {
  saveDraft,
  submitRequest,
  duplicateRequest,
  cancelRequest,
} from "@/app/(app)/solicitudes/actions"
