/**
 * Archivos de test que usan @electric-sql/pglite (Postgres WASM in-memory).
 *
 * Cada uno instancia su propia BD y ejecuta migraciones completas, lo que
 * satura CPU si se ejecutan en paralelo. Se asignan a un proyecto vitest
 * separado con fileParallelism: false.
 *
 * ⚠️  Al agregar un nuevo test PGlite: agrégalo aquí para que se excluya
 *     del proyecto paralelo y se ejecute secuencialmente.
 */
export const pgliteTestFiles = [
  "db/schema-consistency.test.ts",
  "db/__tests__/pdtp-worksite-cascade.test.ts",
  "db/__tests__/pdtp-check-constraints.test.ts",
  "lib/services/billing/__tests__/sync-integration.test.ts",
  "lib/services/billing/__tests__/queries-scope.test.ts",
  "lib/services/billing/__tests__/payments-integration.test.ts",
  "lib/services/billing/__tests__/duplicates-integration.test.ts",
  "lib/__tests__/admin-user-scope.test.ts",
  "lib/__tests__/admin-roles-service.test.ts",
  "lib/__tests__/bootstrap.test.ts",
  "lib/__tests__/cancel-request-service.test.ts",
  "lib/__tests__/create-submitted-request-service.test.ts",
  "lib/__tests__/operational-work-queue-quotation-source.test.ts",
  "lib/__tests__/combustibles-scope.test.ts",
  "lib/__tests__/compras-export-invoice-filter.test.ts",
  // Faltaba desde que se escribió: instancia PGlite y migra, así que corriendo
  // en el proyecto paralelo competía por CPU con los demás.
  "lib/__tests__/compras-inbox-scope.test.ts",
  "lib/__tests__/code-sequences.test.ts",
  "lib/__tests__/dispatch-guides.test.ts",
  "lib/__tests__/document-chain.test.ts",
  "lib/__tests__/equipment-performance-integration.test.ts",
  "lib/__tests__/feedback.test.ts",
  "lib/__tests__/fuel-cycle-integration.test.ts",
  "lib/__tests__/fuel-load-anomaly-reevaluation.test.ts",
  "lib/__tests__/full-flow-integration.test.ts",
  "lib/__tests__/integration-rbac-sequences.test.ts",
  "lib/__tests__/item-state-mutations.test.ts",
  "lib/__tests__/module-toggles.test.ts",
  "lib/__tests__/notification-permission-targeting.test.ts",
  "lib/__tests__/notification-service.test.ts",
  "lib/__tests__/operational-assignments.test.ts",
  "lib/__tests__/pending-purchase-queue.test.ts",
  "lib/__tests__/pdtp-coverage-r2.test.ts",
  "lib/__tests__/pdtp-coverage-sources.test.ts",
  "lib/__tests__/pdtp-evidence-gc.test.ts",
  "lib/__tests__/pdtp-reminders-dedup.test.ts",
  "lib/__tests__/pdtp-worksites.test.ts",
  "lib/__tests__/physical-inventory-service.test.ts",
  "lib/__tests__/prevention-pdtp.test.ts",
  "lib/__tests__/prevention-capa-list.test.ts",
  "lib/__tests__/prevention-emergency-list.test.ts",
  "lib/__tests__/prevention-documents-persistence.test.ts",
  "lib/__tests__/prevention-ppa-workflow-persistence.test.ts",
  "lib/__tests__/purchasing-service.test.ts",
  "lib/__tests__/service-items-flow.test.ts",
  "lib/__tests__/receiving-two-stage.test.ts",
  "lib/__tests__/registro-action.test.ts",
  "lib/__tests__/requests-delete.test.ts",
  "lib/__tests__/sst-alerts.test.ts",
  "lib/__tests__/sst-delete-evaluation.test.ts",
  "lib/__tests__/sst-integrity-constraints.test.ts",
  "lib/__tests__/stock-alerts.test.ts",
  "lib/__tests__/stock-export.test.ts",
  "lib/__tests__/stock-service.test.ts",
  "lib/__tests__/trabajadores-scope.test.ts",
  "lib/__tests__/trazabilidad-export-scope.test.ts",
  "lib/__tests__/trazabilidad-item.test.ts",
  "lib/__tests__/traceability-integrity-cases.test.ts",
  "lib/__tests__/trazabilidad-matrix.test.ts",
]
