/**
 * core/audit — Audit log recording
 *
 * Forward shim. Fuente de verdad: lib/audit.ts
 * En Fase 3 el contenido se moverá aquí y lib/audit.ts pasará a re-exportar.
 *
 * Uso en módulos:
 *   import { recordAudit, recordStatusChange } from "@/core/audit"
 */
export { recordAudit, recordStatusChange } from "@/lib/audit"
