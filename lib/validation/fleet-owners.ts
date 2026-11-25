import { z } from "zod"
import { FLEET_OWNER_KINDS, FLEET_OWNER_NAME_MAX_LENGTH } from "@/lib/fleet/fleet-owner-kinds"

/**
 * Formulario del catálogo de empresas propietarias (Administración › Catálogos de flota).
 * El servicio (`lib/services/fleet-owners.ts`) vuelve a validar; este esquema existe para
 * devolver `fieldErrors` al campo que corresponde.
 */
export const fleetOwnerSchema = z.object({
  id: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim()
    .min(2, "Escribe el nombre de la empresa (mínimo 2 letras)")
    .max(FLEET_OWNER_NAME_MAX_LENGTH, `Máximo ${FLEET_OWNER_NAME_MAX_LENGTH} caracteres`),
  kind: z.enum(FLEET_OWNER_KINDS, { message: "Elige el tipo de empresa" }),
})
