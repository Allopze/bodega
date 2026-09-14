/**
 * Types for the shared request actions factory.
 *
 * ARQ-1: acotado a lo que las tres acciones vivas (subir/eliminar/seleccionar
 * cotización) de verdad usan — `moduleName`, `itemMapper`, `permissions.create`
 * y los schemas `request`/`cancel` sólo los consumían las acciones de
 * borrador/envío/cancelación, ya eliminadas de aquí.
 */
import type { z } from "zod"
import type { Permission } from "@/modules/permissions"
import type {
  RequestServiceFunctions,
  AddQuotationInput,
  SelectQuotationInput,
} from "./request-config"

export interface RequestActionsConfig {
  /** Permission strings for each operation */
  permissions: {
    submit: Permission
    approve: Permission
  }
  /** Base path for revalidation and redirects */
  routePrefix: string
  /** Zod schemas for each action */
  schemas: {
    quotationUpload:  z.ZodType<Omit<AddQuotationInput, "fileBuffer" | "fileName" | "mimeType" | "fileSize" | "uploadedBy" | "userEmail">>
    selectQuotation:  z.ZodType<Pick<SelectQuotationInput, "requestId" | "quotationId" | "justification">>
  }
  /** Service functions (already bound to the correct module config) */
  services: RequestServiceFunctions
  /** Log prefix (e.g. "repuestos") */
  logPrefix: string
}
