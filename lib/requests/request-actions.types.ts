/**
 * Types for the shared request actions factory.
 */
import type { z } from "zod"
import type { Permission } from "@/modules/permissions"
import type {
  RequestServiceFunctions,
  RequestServiceInput,
  RequestItemInput,
  AddQuotationInput,
  SelectQuotationInput,
} from "./request-config"

export interface RequestActionsConfig {
  /** Module identifier used to derive permissions and routes */
  moduleName: "repuestos" | "servicios"
  /** Permission strings for each operation */
  permissions: {
    create: Permission
    submit: Permission
    approve: Permission
  }
  /** Base path for revalidation and redirects */
  routePrefix: string
  /** Zod schemas for each action */
  schemas: {
    request:          z.ZodType<RequestServiceInput>
    quotationUpload:  z.ZodType<Omit<AddQuotationInput, "fileBuffer" | "fileName" | "mimeType" | "fileSize" | "uploadedBy" | "userEmail">>
    selectQuotation:  z.ZodType<Pick<SelectQuotationInput, "requestId" | "quotationId">>
    cancel:           z.ZodType<{ requestId: string; reason: string }>
  }
  /** Service functions (already bound to the correct module config) */
  services: RequestServiceFunctions
  /** Maps parsed form items to the shape expected by the service. Input is already RequestItemInput after Zod validation. */
  itemMapper: (item: RequestItemInput, index: number) => RequestItemInput
  /** Log prefix (e.g. "repuestos") */
  logPrefix: string
}
