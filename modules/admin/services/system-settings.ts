/**
 * modules/admin/services/system-settings.ts
 *
 * Servicio de configuración del sistema (perfil empresa, límite PDF).
 * Fuente de verdad: lib/services/system-settings.ts
 * En Fase 3 el contenido se moverá aquí.
 */
export {
  getPdfMaxSizeMb,
  setPdfMaxSizeMb,
  getCompanyProfile,
  setCompanyProfile,
} from "@/lib/services/system-settings"
export type { CompanyProfile } from "@/lib/services/system-settings"
