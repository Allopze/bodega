# Reporte de Líneas de Código por Archivo

**Generado:** Julio 2026  
**Fuente:** Proyecto Bodega (Next.js + TypeScript)

---

## Resumen General

| Categoría | Archivos | Líneas |
|-----------|----------|--------|
| Código fuente (`.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.sql`, `.mjs`) | 910 | **117,067** |
| Markdown (`.md`) | — | 29,486 |
| JSON (excluye `node_modules`) | — | 258,667 |
| YAML | — | 473 |
| **Total proyecto (todo incluido)** | — | **405,693** |

---

## app/ — Páginas, API Routes y Actions (47,306 líneas)

### print/ — Vistas de impresión

| Archivo | Líneas | Notas |
|---------|--------|-------|
| `app/(print)/compras/[id]/print/oc-print-styles.ts` | 493 | CSS — aceptable |
| `app/(print)/sst/[id]/print/acta-styles.ts` | 327 | CSS — aceptable |
| `app/(print)/sst/[id]/print/document.tsx` | 291 | ActaDocument (reducido) ✅ |
| `app/(print)/compras/[id]/print/page.tsx` | 168 | Reducido ✅ |
| `app/(print)/entregas/[id]/print/page.tsx` | 185 |
| `app/(print)/sst/[id]/print/acta-data.ts` | 137 | Data loading extractado |
| `app/(print)/compras/[id]/print/oc-print-data.ts` | 96 | Data loading extractado |
| `app/(print)/compras/[id]/print/pdf/route.ts` | 73 |
| `app/(print)/sst/[id]/print/acta-helpers.ts` | 68 | Label helpers extractados |
| `app/(print)/sst/[id]/print/print-trigger.tsx` | 65 |
| `app/(print)/compras/[id]/print/print-trigger.tsx` | 65 |
| `app/(print)/compras/[id]/print/oc-number-to-words.ts` | 64 | Números a palabras extractado |
| `app/(print)/sst/[id]/print/page.tsx` | 33 |
| `app/(print)/compras/[id]/print/oc-print-formatters.ts` | 42 | Formateadores extractados |
| `app/(print)/compras/[id]/print/oc-print-components.tsx` | 22 | Sub-componentes extractados |
| `app/(print)/compras/[id]/print/filename.ts` | 8 |
| `app/(print)/sst/[id]/print/acta-components.tsx` | 13 | Sub-componentes extractados |
| `app/(print)/layout.tsx` | 9 |

### prevencion/ — Módulo Prevención

| Archivo | Líneas |
|---------|--------|
| `app/(app)/prevencion/documentacion/documentacion-view.hooks.ts` | 337 |
| `app/(app)/prevencion/documentacion/documentacion-view-dialogs.tsx` | 332 |
| `app/(app)/prevencion/documentacion/documentacion-view.tsx` | 246 |
| `app/(app)/prevencion/documentacion/documentacion-view.test.tsx` | 403 |
| `app/(app)/prevencion/documentacion/documentacion-view-folder-row.tsx` | 116 |
| `app/(app)/prevencion/documentacion/documentacion-view-table-row.tsx` | 114 |
| `app/(app)/prevencion/documentacion/documentacion-view.types.ts` | 73 |
| `app/(app)/prevencion/trabajador/[workerId]/worker-evaluations.tsx` | **108** ⬇️496 |
| `app/(app)/prevencion/nueva/nueva-evaluacion-form.tsx` | 322 |
| `app/(app)/prevencion/nueva/nueva-evaluacion-form-seguimiento.tsx` | 101 |
| `app/(app)/prevencion/nueva/nueva-evaluacion-form-cargos.tsx` | 66 |
| `app/(app)/prevencion/nueva/nueva-evaluacion-form.types.ts` | 47 |
| `app/(app)/prevencion/nueva/nueva-evaluacion-form-summary.tsx` | 27 |
| `app/(app)/prevencion/actions/evaluations.ts` | 171 |
| `app/(app)/prevencion/actions/dashboard.ts` | 54 |
| `app/(app)/prevencion/actions/responses.ts` | 50 |
| `app/(app)/prevencion/actions/weekly.ts` | 48 |
| `app/(app)/prevencion/actions/followups.ts` | 47 |
| `app/(app)/prevencion/actions/action-plan.ts` | 44 |
| `app/(app)/prevencion/actions/helpers.ts` | 39 |
| `app/(app)/prevencion/actions/index.ts` | 23 |
| `app/(app)/prevencion/[id]/checklist-section-item.tsx` | 322 |
| `app/(app)/prevencion/[id]/checklist-section.tsx` | **58** ⬇️374 |
| `app/(app)/prevencion/pdtp/pdtp-sheet-table.tsx` | **230** ⬇️366 |
| `app/(app)/prevencion/pdtp/pdtp-sheet-table-ui.tsx` | 100 |
| `app/(app)/prevencion/documentacion/actions.ts` | 320 |
| `app/(app)/prevencion/pdtp/page.tsx` | 317 |
| `app/(app)/prevencion/[id]/evaluation-detail.test.tsx` | 305 |
| `app/(app)/prevencion/ppa/ppa-list.tsx` | 285 |
| `app/(app)/prevencion/pdtp/actions.ts` | 279 |
| `app/(app)/prevencion/[id]/evaluation-detail/use-evaluation-detail.ts` | 262 |
| `app/(app)/prevencion/documentacion/papelera/papelera-view.tsx` | 262 |
| `app/(app)/prevencion/[id]/action-plan-panel.tsx` | 249 |
| `app/(app)/prevencion/[id]/evaluation-detail/evaluation-info-section.tsx` | 245 |
| `app/(app)/prevencion/ppa/[id]/page.tsx` | 244 |
| `app/(app)/prevencion/documentacion/documentacion-header-actions.tsx` | 236 |
| `app/(app)/prevencion/[id]/followups-panel.tsx` | 216 |
| `app/(app)/prevencion/pdtp/pdtp-add-activity-form.tsx` | 189 |
| `app/(app)/prevencion/pdtp/pdtp-approval-buttons.tsx` | 150 |
| `app/(app)/prevencion/pdtp/aprobaciones/page.tsx` | 145 |
| `app/(app)/prevencion/pdtp/pdtp-sheet-table.test.tsx` | 144 |
| `app/(app)/prevencion/documentacion/document-viewer-modal.tsx` | 140 |
| `app/(app)/prevencion/ppa/actions.ts` | 139 |
| `app/(app)/prevencion/ppa/ppa-export-button.tsx` | 138 |
| `app/(app)/prevencion/pdtp/pdtp-execution-form.tsx` | 137 |
| `app/(app)/prevencion/pdtp/pdtp-override-form.tsx` | 135 |
| `app/(app)/prevencion/ppa/ppa-access-panel.tsx` | 133 |
| `app/(app)/prevencion/pdtp/pdtp-indicators-panel.tsx` | 129 |
| `app/(app)/prevencion/documentacion/[id]/document-detail-view.test.tsx` | 129 |
| `app/(app)/prevencion/documentacion/[id]/document-detail-view.tsx` | 124 |
| `app/(app)/prevencion/documentacion/[id]/versions-tab.tsx` | 123 |
| `app/(app)/prevencion/[id]/evaluation-detail/evaluation-acta-section.tsx` | 122 |
| `app/(app)/prevencion/[id]/evaluation-detail.tsx` | 119 |
| `app/(app)/prevencion/ppa/page.tsx` | 119 |
| `app/(app)/prevencion/evaluation-list.tsx` | 162 |
| `app/(app)/prevencion/[id]/page.tsx` | 111 |
| `app/(app)/prevencion/documentacion/documentacion-header-actions.test.tsx` | 110 |
| `app/(app)/prevencion/[id]/evaluation-detail/evaluation-weekly-section.tsx` | 107 |
| `app/(app)/prevencion/documentacion/page.tsx` | 107 |
| `app/(app)/prevencion/documentacion/papelera/papelera-view.test.tsx` | 99 |
| `app/(app)/prevencion/nueva/page.tsx` | 93 |
| `app/(app)/prevencion/pdtp/pdtp-evidence-thumbs.tsx` | 81 |
| `app/(app)/prevencion/documentacion/[id]/page.tsx` | 79 |
| `app/(app)/prevencion/documentacion/[id]/document-detail.helpers.ts` | 77 |
| `app/(app)/prevencion/pdtp/pdtp-year-picker.tsx` | 52 |
| `app/(app)/prevencion/page.tsx` | 51 |
| `app/(app)/prevencion/documentacion/[id]/archive-button.tsx` | 47 |
| `app/(app)/prevencion/[id]/loading.tsx` | 46 |
| `app/(app)/prevencion/[id]/evaluation-detail/evaluation-section-nav.tsx` | 60 |
| `app/(app)/prevencion/[id]/evaluation-detail/evaluation-action-plan-section.tsx` | 60 |
| `app/(app)/prevencion/[id]/evaluation-detail/evaluation-followups-section.tsx` | 58 |
| `app/(app)/prevencion/[id]/evaluation-detail/helpers.ts` | 33 |
| `app/(app)/prevencion/ppa/[id]/review-panel.tsx` | 152 |
| `app/(app)/prevencion/ppa/[id]/revoke-token-button.tsx` | 53 |
| `app/(app)/prevencion/ppa/[id]/close-case-button.tsx` | 46 |
| `app/(app)/prevencion/ppa/ppa-metric-bar.tsx` | 112 |
| `app/(app)/prevencion/documentacion/vencimientos/page.tsx` | 5 |
| `app/(app)/prevencion/documentacion/revisiones/page.tsx` | 5 |
| `app/(app)/prevencion/documentacion/nuevo/page.tsx` | 5 |
| `app/(app)/prevencion/documentacion/papelera/page.tsx` | 88 |
| `app/(app)/prevencion/loading.tsx` | 20 |
| `app/(app)/prevencion/pdtp/loading.tsx` | 20 |
| `app/(app)/prevencion/ppa/loading.tsx` | 20 |

### compras/ — Módulo Compras

| Archivo | Líneas |
|---------|--------|
| `app/(app)/compras/actions/create-order.ts` | 160 |
| `app/(app)/compras/actions/order-status.ts` | 142 |
| `app/(app)/compras/actions/order-cancel.ts` | 122 |
| `app/(app)/compras/actions/item-state.ts` | 117 |
| `app/(app)/compras/actions/helpers.ts` | 21 |
| `app/(app)/compras/actions/index.ts` | 11 |
| `app/(app)/compras/[id]/page.tsx` | **273** ⬇️383 |
| `app/(app)/compras/[id]/oc-detail-items.tsx` | 122 |
| `app/(app)/compras/[id]/oc-detail.types.ts` | 25 |
| `app/(app)/compras/[id]/oc-detail-page.helpers.tsx` | 17 |
| `app/(app)/compras/oc-list.tsx` | **135** ⬇️355 |
| `app/(app)/compras/oc-list-rows.tsx` | 194 |
| `app/(app)/compras/oc-list.types.ts` | 27 |
| `app/(app)/compras/page.tsx` | 291 |
| `app/(app)/compras/[id]/oc-actions.tsx` | 282 |
| `app/(app)/compras/[id]/invoices-section.tsx` | 272 |
| `app/(app)/compras/use-oc-form.ts` | 193 |
| `app/(app)/compras/nueva/page.tsx` | 172 |
| `app/(app)/compras/oc-form-items.tsx` | 167 |
| `app/(app)/compras/oc-form.tsx` | 158 |
| `app/(app)/compras/invoice-actions.ts` | 195 |
| `app/(app)/compras/oc-form-summary.tsx` | 77 |
| `app/(app)/compras/oc-form.helpers.ts` | 46 |
| `app/(app)/compras/[id]/oc-reception-cta.test.tsx` | 47 |
| `app/(app)/compras/[id]/oc-reception-cta.tsx` | 35 |
| `app/(app)/compras/actions.helpers.ts` | 24 |
| `app/(app)/compras/oc-form.types.ts` | 35 |
| `app/(app)/compras/loading.tsx` | 19 |

### solicitudes/ — Módulo Solicitudes

| Archivo | Líneas |
|---------|--------|
| `app/(app)/solicitudes/item-editor.tsx` | 232 |
| `app/(app)/solicitudes/request-form.tsx` | 341 |
| `app/(app)/solicitudes/item-editor-cotizaciones.tsx` | 117 |
| `app/(app)/solicitudes/item-editor-equipment.tsx` | 98 |
| `app/(app)/solicitudes/item-editor-attributes.tsx` | 75 |
| `app/(app)/solicitudes/item-editor-supplier.tsx` | 64 |
| `app/(app)/solicitudes/request-list.tsx` | 307 |
| `app/(app)/solicitudes/request-form.test.tsx` | 287 |
| `app/(app)/solicitudes/[id]/page.tsx` | 260 |
| `app/(app)/solicitudes/use-request-form.ts` | 249 |
| `app/(app)/solicitudes/product-picker.tsx` | 235 |
| `app/(app)/solicitudes/page.tsx` | 196 |
| `app/(app)/solicitudes/nueva/page.tsx` | 146 |
| `app/(app)/solicitudes/actions-module/draft.ts` | 148 |
| `app/(app)/solicitudes/actions-module/submit.ts` | 145 |
| `app/(app)/solicitudes/actions-module/cancel.ts` | 105 |
| `app/(app)/solicitudes/actions-module/duplicate.ts` | 101 |
| `app/(app)/solicitudes/actions-module/resubmit.ts` | 61 |
| `app/(app)/solicitudes/actions-module/delete.ts` | 48 |
| `app/(app)/solicitudes/request-form.types.ts` | 98 |
| `app/(app)/solicitudes/request-form.helpers.ts` | 67 |
| `app/(app)/solicitudes/[id]/duplicate-button.tsx` | 30 |
| `app/(app)/solicitudes/actions-module/index.ts` | 6 |
| `app/(app)/solicitudes/actions.ts` | 1 |

### combustibles/ — Módulo Combustibles

| Archivo | Líneas |
|---------|--------|
| `app/(app)/combustibles/import-fuel-modal-preview.tsx` | 252 |
| `app/(app)/combustibles/import-fuel-modal.tsx` | 220 |
| `app/(app)/combustibles/import-fuel-modal-upload.tsx` | 77 |
| `app/(app)/combustibles/import-fuel-modal-done.tsx` | 64 |
| `app/(app)/combustibles/import-fuel-modal.helpers.ts` | 61 |
| `app/(app)/combustibles/actions-module/loads.ts` | 260 |
| `app/(app)/combustibles/[id]/edit-fuel-load-form.tsx` | 239 |
| `app/(app)/combustibles/nueva/new-fuel-load-form.tsx` | 216 |
| `app/(app)/combustibles/cuenta-corriente/[id]/statement-detail.tsx` | 213 |
| `app/(app)/combustibles/fuel-charts.tsx` | 206 |
| `app/(app)/combustibles/page.tsx` | 190 |
| `app/(app)/combustibles/actions-module/statements.ts` | 167 |
| `app/(app)/combustibles/reportes/reports-view.tsx` | 155 |
| `app/(app)/combustibles/actions-loads.test.ts` | 172 |
| `app/(app)/combustibles/fuel-filters.tsx` | 138 |
| `app/(app)/combustibles/fuel-load-table.tsx` | 115 |
| `app/(app)/combustibles/actions-module/export.ts` | 109 |
| `app/(app)/combustibles/actions-module/vehicles.ts` | 122 |
| `app/(app)/combustibles/actions-module/suppliers.ts` | 91 |
| `app/(app)/combustibles/actions-vehicles.test.ts` | 102 |
| `app/(app)/combustibles/actions-export.test.ts` | 98 |
| `app/(app)/combustibles/vehiculos/vehicle-table.tsx` | 95 |
| `app/(app)/combustibles/vehiculos/edit-vehicle-dialog.tsx` | 93 |
| `app/(app)/combustibles/vehiculos/new-vehicle-dialog.tsx` | 83 |
| `app/(app)/combustibles/proveedores-combustible/supplier-table.tsx` | 83 |
| `app/(app)/combustibles/proveedores-combustible/edit-supplier-dialog.tsx` | 72 |
| `app/(app)/combustibles/proveedores-combustible/new-supplier-dialog.tsx` | 63 |
| `app/(app)/combustibles/cuenta-corriente/new-statement-dialog.tsx` | 63 |
| `app/(app)/combustibles/cuenta-corriente/statements-table.tsx` | 82 |
| `app/(app)/combustibles/cuenta-corriente/[id]/page.tsx` | 50 |
| `app/(app)/combustibles/cuenta-corriente/page.tsx` | 41 |
| `app/(app)/combustibles/fuel-charts.test.tsx` | 79 |
| `app/(app)/combustibles/fuel-kpis.tsx` | 94 |
| `app/(app)/combustibles/[id]/page.tsx` | 58 |
| `app/(app)/combustibles/export-button.tsx` | 46 |
| `app/(app)/combustibles/vehiculos/page.tsx` | 44 |
| `app/(app)/combustibles/reportes/page.tsx` | 42 |
| `app/(app)/combustibles/proveedores-combustible/page.tsx` | 29 |
| `app/(app)/combustibles/nueva/page.tsx` | 29 |
| `app/(app)/combustibles/actions-module/index.ts` | 5 |
| `app/(app)/combustibles/actions.ts` | 1 |

### admin/ — Módulo Administración

| Archivo | Líneas |
|---------|--------|
| `app/(app)/admin/usuarios/actions/create.ts` | 142 |
| `app/(app)/admin/usuarios/actions/invite.ts` | 113 |
| `app/(app)/admin/usuarios/actions/update.ts` | 111 |
| `app/(app)/admin/usuarios/actions/toggle-active.ts` | 75 |
| `app/(app)/admin/usuarios/actions/helpers.ts` | 11 |
| `app/(app)/admin/usuarios/actions/index.ts` | 4 |
| `app/(app)/dashboard/page.tsx` | **225** ⬇️338 |
| `app/(app)/dashboard/dashboard-task-row.tsx` | 110 |
| `app/(app)/dashboard/dashboard-helpers.ts` | 7 |
| `app/(app)/admin/usuarios/user-invite-form.tsx` | **261** ⬇️334 |
| `app/(app)/admin/usuarios/user-invite-form-pending.tsx` | 94 |
| `app/(app)/admin/usuarios/user-invite-form.types.ts` | 14 |
| `app/(app)/admin/productos/product-form.tsx` | **291** ⬇️321 |
| `app/(app)/admin/productos/product-form.types.ts` | 47 |
| `app/(app)/admin/productos/actions.ts` | 297 |
| `app/(app)/admin/productos/product-list.tsx` | 263 |
| `app/(app)/admin/configuracion/config-form.tsx` | 264 |
| `app/(app)/admin/usuarios/user-list.tsx` | 258 |
| `app/(app)/admin/page.tsx` | 193 |
| `app/(app)/admin/plantillas/template-list.tsx` | 227 |
| `app/(app)/admin/usuarios/use-user-form.ts` | 183 |
| `app/(app)/admin/usuarios/user-form.tsx` | 179 |
| `app/(app)/admin/trabajadores/worker-list.tsx` | 176 |
| `app/(app)/admin/trabajadores/worker-form.tsx` | 144 |
| `app/(app)/admin/trabajadores/actions.ts` | 144 |
| `app/(app)/admin/faenas/faenas-list.tsx` | 157 |
| `app/(app)/admin/correo-smtp/smtp-form.tsx` | 156 |
| `app/(app)/admin/proveedores/supplier-list.tsx` | 147 |
| `app/(app)/admin/proveedores/supplier-form.tsx` | 134 |
| `app/(app)/admin/proveedores/actions.ts` | 130 |
| `app/(app)/admin/auditoria/audit-log.tsx` | 130 |
| `app/(app)/admin/usuarios/permission-section.tsx` | 134 |
| `app/(app)/admin/productos/category-panel.tsx` | 98 |
| `app/(app)/admin/plantillas/actions.ts` | 78 |
| `app/(app)/admin/faenas/worksite-form.tsx` | 111 |
| `app/(app)/admin/faenas/actions.ts` | 103 |
| `app/(app)/admin/configuracion/actions.ts` | 104 |
| `app/(app)/admin/auditoria/page.tsx` | 59 |
| `app/(app)/admin/trabajadores/page.tsx` | 72 |
| `app/(app)/admin/usuarios/role-selector.tsx` | 53 |
| `app/(app)/admin/usuarios/worksite-selector.tsx` | 68 |
| `app/(app)/admin/productos/[id]/page.tsx` | 53 |
| `app/(app)/admin/usuarios/page.tsx` | 152 |
| `app/(app)/admin/productos/page.tsx` | 57 |
| `app/(app)/admin/faenas/page.tsx` | 57 |
| `app/(app)/admin/proveedores/page.tsx` | 50 |
| `app/(app)/admin/productos/nuevo/page.tsx` | 47 |
| `app/(app)/admin/plantillas/page.tsx` | 42 |
| `app/(app)/admin/usuarios/actions.helpers.ts` | 141 |
| `app/(app)/admin/usuarios/user-form.test.tsx` | 138 |
| `app/(app)/admin/usuarios/user-form.helpers.ts` | 115 |
| `app/(app)/admin/usuarios/actions-permissions.test.tsx` | 41 |
| `app/(app)/admin/correo-smtp/actions.ts` | 53 |
| `app/(app)/admin/correo-smtp/smtp-form.test.tsx` | 81 |
| `app/(app)/admin/correo-smtp/page.tsx` | 38 |
| `app/(app)/admin/configuracion/page.tsx` | 37 |
| `app/(app)/admin/usuarios/invite-pending-card.tsx` | 82 |

### aprobaciones/ — Módulo Aprobaciones

| Archivo | Líneas |
|---------|--------|
| `app/(app)/aprobaciones/actions.ts` | 296 |
| `app/(app)/aprobaciones/page.tsx` | 279 |
| `app/(app)/aprobaciones/item-row.tsx` | 155 |
| `app/(app)/aprobaciones/request-group.tsx` | 129 |
| `app/(app)/aprobaciones/approve-form.tsx` | 91 |
| `app/(app)/aprobaciones/approval-panel.tsx` | 47 |
| `app/(app)/aprobaciones/reason-form.tsx` | 59 |
| `app/(app)/aprobaciones/use-approval-actions.ts` | 55 |
| `app/(app)/aprobaciones/types.ts` | 64 |

### entregas/ — Módulo Entregas

| Archivo | Líneas |
|---------|--------|
| `app/(app)/entregas/delivery-form.tsx` | **268** ⬇️364 |
| `app/(app)/entregas/delivery-form-return.tsx` | 112 |
| `app/(app)/entregas/delivery-form.types.ts` | 32 |
| `app/(app)/entregas/page.tsx` | 347 |
| `app/(app)/entregas/deliveries-table.tsx` | 153 |
| `app/(app)/entregas/actions.ts` | 148 |
| `app/(app)/entregas/deliveries-table.test.tsx` | 26 |

### recepcion/ — Módulo Recepción

| Archivo | Líneas |
|---------|--------|
| `app/(app)/recepcion/receipt-form.tsx` | **255** ⬇️350 |
| `app/(app)/recepcion/receipt-form-progress.tsx` | 85 |
| `app/(app)/recepcion/receipt-form.types.ts` | 13 |
| `app/(app)/recepcion/receipt-form.test.tsx` | 337 |
| `app/(app)/recepcion/[id]/page.tsx` | 236 |
| `app/(app)/recepcion/page.tsx` | 165 |
| `app/(app)/recepcion/recepcion-table.tsx` | 118 |
| `app/(app)/recepcion/actions.ts` | 107 |
| `app/(app)/recepcion/nueva/page.tsx` | 101 |

### bodega/ — Módulo Bodega

| Archivo | Líneas |
|---------|--------|
| `app/(app)/bodega/page.tsx` | **214** ⬇️357 |
| `app/(app)/bodega/bodega-sections.tsx` | 109 |
| `app/(app)/bodega/bodega-header-metrics.tsx` | 43 |
| `app/(app)/bodega/actions.ts` | 341 |
| `app/(app)/bodega/stock-table.tsx` | 218 |
| `app/(app)/bodega/adjust-panel.tsx` | 178 |
| `app/(app)/bodega/return-panel.tsx` | 166 |
| `app/(app)/bodega/physical-inventory-panel.tsx` | 143 |
| `app/(app)/bodega/kardex-table.tsx` | 131 |
| `app/(app)/bodega/stock-export-button.tsx` | 90 |
| `app/(app)/bodega/kardex-export-button.tsx` | 90 |
| `app/(app)/bodega/types.ts` | 25 |

### Otros módulos app/

| Archivo | Líneas |
|---------|--------|
| `app/(app)/analitica/page.tsx` | 290 |
| `app/(app)/analitica/analytics-ranking-table.tsx` | 83 |
| `app/(app)/analitica/analytics-kpi-card.tsx` | 50 |
| `app/(app)/analitica/analytics-page.helpers.ts` | 41 |
| `app/(app)/trazabilidad/[itemId]/page.tsx` | 125 |
| `app/(app)/trazabilidad/[itemId]/trazabilidad-item-tables.tsx` | 288 |
| `app/(app)/trazabilidad/[itemId]/trazabilidad-item-summary-card.tsx` | 97 |
| `app/(app)/trazabilidad/[itemId]/trazabilidad-item-page.helpers.tsx` | 8 |
| `app/(app)/reportes/page.tsx` | **267** ⬇️357 |
| `app/(app)/reportes/reportes-page.helpers.tsx` | 92 |
| `app/(app)/dashboard/page.tsx` | 338 |
| `app/(app)/servicios/quotation-panel.tsx` | 325 |
| `app/(app)/repuestos/quotation-panel.tsx` | 325 |
| `app/(app)/dashboard/metric-bar.tsx` | 166 |
| `app/(app)/dashboard/pdtp-compliance-card.tsx` | 118 |
| `app/(app)/dashboard/recent-activity.tsx` | 112 |
| `app/(app)/dashboard/quick-actions.tsx` | 82 |
| `app/(app)/flota/page.tsx` | 227 |
| `app/(app)/flota/[id]/fleet-documents-panel.tsx` | 148 |
| `app/(app)/flota/[id]/page.tsx` | 111 |
| `app/(app)/flota/actions.ts` | 104 |
| `app/(app)/flota/fleet-filters.tsx` | 80 |
| `app/(app)/mantenciones/maintenance-form.tsx` | 225 |
| `app/(app)/mantenciones/page.tsx` | 217 |
| `app/(app)/mantenciones/actions.ts` | 113 |
| `app/(app)/mantenciones/maintenance-row-actions.tsx` | 89 |
| `app/(app)/mantenciones/maintenance-filters.tsx` | 81 |
| `app/(app)/mantenciones/actions.test.ts` | 59 |
| `app/(app)/soporte/nuevo/report-form.tsx` | 201 |
| `app/(app)/soporte/[id]/page.tsx` | 155 |
| `app/(app)/soporte/actions.ts` | 137 |
| `app/(app)/soporte/report-list.tsx` | 103 |
| `app/(app)/soporte/[id]/status-panel.tsx` | 86 |
| `app/(app)/soporte/page.tsx` | 52 |
| `app/(app)/trazabilidad/page.tsx` | 169 |
| `app/(app)/trazabilidad/_components/trazabilidad-matrix-table.tsx` | 102 |
| `app/(app)/trazabilidad/_components/trazabilidad-matrix-card.tsx` | 76 |
| `app/(app)/trazabilidad/trazabilidad-filters.tsx` | 88 |
| `app/(app)/analitica/analytics-charts.tsx` | 131 |
| `app/(app)/analitica/analytics-filters.tsx` | 125 |
| `app/(app)/servicios/actions.ts` | 63 |
| `app/(app)/servicios/actions.test.ts` | 41 |
| `app/(app)/repuestos/actions.ts` | 63 |
| `app/(app)/repuestos/actions.test.ts` | 41 |
| `app/(app)/perfil/actions.ts` | 98 |
| `app/(app)/perfil/password-change-form.tsx` | 80 |
| `app/(app)/perfil/page.tsx` | 73 |
| `app/(app)/perfil/email-notifications-form.tsx` | 39 |
| `app/(app)/notificaciones/actions.ts` | 35 |

### API Routes

| Archivo | Líneas |
|---------|--------|
| `app/api/combustibles/import/route.ts` | 229 |
| `app/api/combustibles/import/route.test.ts` | 196 |
| `app/api/prevencion/documentacion/bulk-download/route.ts` | 162 |
| `app/api/prevencion/documentacion/[id]/route.ts` | 90 |
| `app/api/prevencion/documentacion/upload/route.ts` | 80 |
| `app/api/prevencion/documentacion/[id]/version/[versionId]/route.ts` | 79 |
| `app/api/prevencion/pdtp/evidence/route.ts` | 85 |
| `app/api/prevencion/pdtp/evidence/route.test.ts` | 134 |
| `app/api/prevencion/pdtp/evidence/[name]/route.ts` | 107 |
| `app/api/prevencion/pdtp/evidence/[name]/route.test.ts` | 123 |
| `app/api/prevencion/pdtp/export/route.ts` | 71 |
| `app/api/prevencion/ppa/export/route.ts` | 50 |
| `app/api/prevencion/pdtp/evidence/gc/route.ts` | 43 |
| `app/api/reportes/export/route.ts` | 83 |
| `app/api/soporte/adjuntos/[id]/route.ts` | 72 |
| `app/api/attachments/[id]/route.ts` | 69 |
| `app/api/servicios/cotizaciones/[id]/route.ts` | 66 |
| `app/api/repuestos/quotaciones/[id]/route.ts` | 66 |
| `app/api/purchase-orders/invoices/[id]/route.ts` | 60 |
| `app/api/flota/documentos/[id]/route.ts` | 59 |
| `app/api/health/route.ts` | 94 |
| `app/api/cron/pdtp-evidence-gc/route.ts` | 56 |
| `app/api/cron/pdtp-weekly-reminders/route.ts` | 49 |
| `app/api/cron/sst-weekly-alerts/route.ts` | 44 |
| `app/api/cron/fuel-statement-notifications/route.ts` | 44 |
| `app/api/bodega/kardex/export/route.ts` | 46 |
| `app/api/bodega/stock/export/route.ts` | 45 |
| `app/api/trazabilidad/export/route.ts` | 45 |
| `app/api/trazabilidad/export/route.test.ts` | 35 |
| `app/api/notifications/route.ts` | 26 |
| `app/api/auth/[...nextauth]/route.ts` | 3 |

### Auth / Público / Layout

| Archivo | Líneas |
|---------|--------|
| `app/(public)/ppa/ppa-form.tsx` | **244** ⬇️473 |
| `app/(public)/ppa/ppa-form.types.ts` | 10 |
| `app/(public)/ppa/ppa-form-sino.tsx` | 42 |
| `app/(public)/ppa/ppa-form.hooks.ts` | 281 |
| `app/(public)/ppa/offline-saved.tsx` | 115 |
| `app/(public)/ppa/actions.ts` | 121 |
| `app/(public)/ppa/page.tsx` | 53 |
| `app/(public)/layout.tsx` | 43 |
| `app/(auth)/registro/actions.ts` | 208 |
| `app/(auth)/registro/register-form.tsx` | 165 |
| `app/(auth)/registro/page.tsx` | 84 |
| `app/(auth)/login/page.tsx` | 106 |
| `app/(auth)/login/login-form.tsx` | 104 |
| `app/(auth)/recuperar/[token]/reset-form.tsx` | 94 |
| `app/(auth)/recuperar/forgot-form.tsx` | 79 |
| `app/(auth)/recuperar/[token]/page.tsx` | 39 |
| `app/(auth)/recuperar/[token]/actions.ts` | 39 |
| `app/(auth)/recuperar/actions.ts` | 40 |
| `app/(auth)/recuperar/page.tsx` | 29 |
| `app/globals.css` | 268 |
| `app/layout.tsx` | 51 |
| `app/(app)/layout.tsx` | 121 |
| `app/global-error.tsx` | 55 |
| `app/not-found.tsx` | 31 |
| `app/(app)/template.tsx` | 7 |
| `app/page.tsx` | 6 |
| `app/(app)/not-found.tsx` | 53 |
| `app/(app)/forbidden/page.tsx` | 37 |
| `app/(app)/error.tsx` | 32 |
| `app/(app)/[...not-found]/page.tsx` | 5 |
| `app/(app)/reportes/page.tsx` | 357 |

---

## lib/ — Lógica de negocio, servicios y tests (49,526 líneas)

### Tests (lib/__tests__/)

| Archivo | Líneas |
|---------|--------|
| `lib/__tests__/prevention-pdtp.test.ts` | 826 |
| `lib/__tests__/full-flow-integration.test.ts` | 620 |
| `lib/__tests__/purchasing-service.test.ts` | 610 |
| `lib/__tests__/deliveries-service.test.ts` | 591 |
| `lib/__tests__/sst-service-full.test.ts` | 552 |
| `lib/__tests__/requests-draft-diff.test.ts` | 528 |
| `lib/__tests__/request-service-factory.test.ts` | 505 |
| `lib/__tests__/trazabilidad-export-scope.test.ts` | 505 |
| `lib/__tests__/stock-export.test.ts` | 491 |
| `lib/__tests__/trazabilidad-item.test.ts` | 466 |
| `lib/__tests__/report-export.test.ts` | 465 |
| `lib/__tests__/request-actions.test.ts` | 462 |
| `lib/__tests__/notification-service.test.ts` | 458 |
| `lib/__tests__/dashboard-service.test.ts` | 444 |
| `lib/__tests__/validation-masters.test.ts` | 390 |
| `lib/__tests__/cancel-request-action.test.ts` | 377 |
| `lib/__tests__/aprobaciones-actions.test.ts` | 369 |
| `lib/__tests__/work-queue.test.ts` | 355 |
| `lib/__tests__/bodega-actions.test.ts` | 341 |
| `lib/__tests__/delete-request-action.test.ts` | 332 |
| `lib/__tests__/stock-service.test.ts` | 317 |
| `lib/__tests__/prevencion-actions-extra.test.ts` | 317 |
| `lib/__tests__/admin-usuarios-actions.test.ts` | 297 |
| `lib/__tests__/sst-service.test.ts` | 292 |
| `lib/__tests__/report-export-route.test.ts` | 291 |
| `lib/__tests__/postpone-item-action.test.ts` | 289 |
| `lib/__tests__/notification-permission-targeting.test.ts` | 271 |
| `lib/__tests__/item-state-mutations.test.ts` | 266 |
| `lib/__tests__/change-password-action.test.ts` | 257 |
| `lib/__tests__/auth-config.test.ts` | 250 |
| `lib/__tests__/resume-item-action.test.ts` | 242 |
| `lib/__tests__/analytics-service.test.ts` | 242 |
| `lib/__tests__/resume-item-action-unit.test.ts` | 239 |
| `lib/__tests__/storage-config-full.test.ts` | 237 |
| `lib/__tests__/page-permissions.test.ts` | 236 |
| `lib/__tests__/browser-pool.test.ts` | 235 |
| `lib/__tests__/prevencion-ppa-admin.test.ts` | 233 |
| `lib/__tests__/receiving-concurrency-postgres.test.ts` | 226 |
| `lib/__tests__/sst-delete-evaluation.test.ts` | 220 |
| `lib/__tests__/sst-compliance.test.ts` | 220 |
| `lib/__tests__/deliveries-concurrency-postgres.test.ts` | 220 |
| `lib/__tests__/receiving-two-stage.test.ts` | 218 |
| `lib/__tests__/compras-actions-extra.test.ts` | 216 |
| `lib/__tests__/auth-rbac-user-permissions.test.ts` | 216 |
| `lib/__tests__/admin-config-smtp-templates.test.ts` | 214 |
| `lib/__tests__/operations-validation.test.ts` | 213 |
| `lib/__tests__/system-settings.test.ts` | 211 |
| `lib/__tests__/solicitudes-actions-extra.test.ts` | 208 |
| `lib/__tests__/submit-request-action.test.ts` | 199 |
| `lib/__tests__/faenas-actions.test.ts` | 197 |
| `lib/__tests__/email-templates.test.ts` | 195 |
| `lib/__tests__/requests-delete.test.ts` | 194 |
| `lib/__tests__/proveedores-actions.test.ts` | 193 |
| `lib/__tests__/physical-inventory-service.test.ts` | 193 |
| `lib/__tests__/integration-rbac-sequences.test.ts` | 189 |
| `lib/__tests__/hooks.test.tsx` | 189 |
| `lib/__tests__/ppa-stats.test.ts` | 185 |
| `lib/__tests__/trabajadores-actions.test.ts` | 183 |
| `lib/__tests__/purchasing-stock-validation.test.ts` | 183 |
| `lib/__tests__/password-reset.test.ts` | 181 |
| `lib/__tests__/approvals-concurrency-postgres.test.ts` | 181 |
| `lib/__tests__/hooks-use-notifications.test.tsx` | 179 |
| `lib/__tests__/utils.test.ts` | 172 |
| `lib/__tests__/item-state.test.ts` | 177 |
| `lib/__tests__/stock-concurrency-postgres.test.ts` | 169 |
| `lib/__tests__/sst-alerts.test.ts` | 166 |
| `lib/__tests__/mantenciones-actions.test.ts` | 166 |
| `lib/__tests__/maintenance-service.test.ts` | 165 |
| `lib/__tests__/cancel-order-action.test.ts` | 165 |
| `lib/__tests__/request-type-actions-rejection.test.ts` | 162 |
| `lib/__tests__/soporte-notificaciones.test.ts` | 160 |
| `lib/__tests__/ppa-actions.test.ts` | 159 |
| `lib/__tests__/recuperar-actions.test.ts` | 156 |
| `lib/__tests__/hooks-use-login.test.tsx` | 156 |
| `lib/__tests__/trazabilidad-matrix.test.ts` | 154 |
| `lib/__tests__/receiving-service.test.ts` | 154 |
| `lib/__tests__/logger-redaction.test.ts` | 153 |
| `lib/__tests__/prevention-documents-library.test.ts` | 151 |
| `lib/__tests__/admin-productos.test.ts` | 149 |
| `lib/__tests__/audit.test.ts` | 145 |
| `lib/__tests__/registro-action.test.ts` | 143 |
| `lib/__tests__/combustibles-actions-extra.test.ts` | 143 |
| `lib/__tests__/feedback.test.ts` | 138 |
| `lib/__tests__/file-validation.test.ts` | 133 |
| `lib/__tests__/ppa-service.test.ts` | 132 |
| `lib/__tests__/pdtp-evidence-gc.test.ts` | 132 |
| `lib/__tests__/auth-can.test.ts` | 129 |
| `lib/__tests__/auth-bootstrap-permissions.test.ts` | 129 |
| `lib/__tests__/create-order-action.test.ts` | 128 |
| `lib/__tests__/register-receipt-action.test.ts` | 124 |
| `lib/__ests__/destructive-database-guard.test.ts` | 120 |
| `lib/__tests__/smtp.test.ts` | 118 |
| `lib/__tests__/prevention-documents-library-service.test.ts` | 116 |
| `lib/__tests__/pdtp-period.test.ts` | 115 |
| `lib/__tests__/pdtp-reminders-dedup.test.ts` | 111 |
| `lib/__tests__/pglite-migrate.test.ts` | 108 |
| `lib/__tests__/register-delivery-action.test.ts` | 108 |
| `lib/__tests__/rate-limit-concurrency-postgres.test.ts` | 107 |
| `lib/__tests__/sst-integrity-constraints.test.ts` | 105 |
| `lib/__tests__/fleet-service.test.ts` | 98 |
| `lib/__tests__/pdtp-execution-action.test.ts` | 93 |
| `lib/__tests__/smtp-full.test.ts` | 91 |
| `lib/__tests__/quotation-access.test.ts` | 91 |
| `lib/__tests__/navigation.test.ts` | 90 |
| `lib/__tests__/admin-user-scope.test.ts` | 88 |
| `lib/__tests__/validation-sst.test.ts` | 87 |
| `lib/__tests__/bootstrap.test.ts` | 87 |
| `lib/__tests__/worksite-scope.test.ts` | 86 |
| `lib/__tests__/validation-repuestos.test.ts` | 84 |
| `lib/__tests__/code-sequences.test.ts` | 81 |
| `lib/__tests__/prevention-documentation-canonical.test.ts` | 79 |
| `lib/__tests__/pdtp-overrides.test.ts` | 77 |
| `lib/__tests__/prevention-document-folders.test.ts` | 76 |
| `lib/__tests__/client-server-boundary.test.ts` | 76 |
| `lib/__tests__/stock-alerts.test.ts` | 73 |
| `lib/__tests__/adquisiciones-list-query.test.ts` | 72 |
| `lib/__tests__/storage-helpers.test.ts` | 67 |
| `lib/__tests__/sentry.test.ts` | 67 |
| `lib/__tests__/order-totals.test.ts` | 66 |
| `lib/__tests__/smtp-settings.test.ts` | 63 |
| `lib/__tests__/pdtp-evidence-validation.test.ts` | 62 |
| `lib/__tests__/request-type-permissions.test.ts` | 60 |
| `lib/__tests__/prevention-pdtp-catalog.test.ts` | 57 |
| `lib/__tests__/maintenance-validation.test.ts` | 57 |
| `lib/__tests__/pagination.test.ts` | 56 |
| `lib/__tests__/csp.test.ts` | 52 |
| `lib/__tests__/ppa-token-revocation.test.ts` | 51 |
| `lib/__tests__/trazabilidad-export.test.ts` | 50 |
| `lib/__tests__/rut.test.ts` | 49 |
| `lib/__tests__/frozen-modular-migration.test.ts` | 46 |
| `lib/__tests__/toast.test.ts` | 46 |
| `lib/__tests__/prevention-rbac.test.ts` | 46 |
| `lib/__tests__/content-disposition.test.ts` | 46 |
| `lib/__tests__/env.test.ts` | 45 |
| `lib/__tests__/auth-rbac.test.ts` | 43 |
| `lib/__tests__/seed-workers.test.ts` | 39 |
| `lib/__tests__/storage-config.test.ts` | 35 |
| `lib/__tests__/constants.test.ts` | 27 |
| `lib/__tests__/id.test.ts` | 26 |
| `lib/__tests__/cron-auth.test.ts` | 20 |
| `lib/__tests__/password-setup.test.ts` | 17 |
| `lib/__tests__/deploy-workflow.test.ts` | 15 |
| `lib/__tests__/formatting.test.ts` | 14 |
| `lib/__tests__/db-safety.test.ts` | 14 |

### Servicios principales

| Archivo | Líneas |
|---------|--------|
| `lib/services/purchasing-module/purchase-orders.ts` | **35** ⬇️541 |
| `lib/services/purchasing-module/purchase-orders-create.ts` | 158 |
| `lib/services/purchasing-module/purchase-orders-status.ts` | 272 |
| `lib/services/purchasing-module/purchase-orders-delete.ts` | 110 |
| `lib/services/notifications.ts` | **34** ⬇️462 |
| `lib/services/notification-create.ts` | 248 |
| `lib/services/notification-read.ts` | 73 |
| `lib/services/notification-targeting.ts` | 109 |
| `lib/services/stock.ts` | **28** ⬇️432 |
| `lib/services/stock-movement.ts` | 237 |
| `lib/services/stock-export.ts` | 192 |
| `lib/services/dashboard.ts` | **20** ⬇️410 |
| `lib/services/dashboard-snapshot.ts` | 178 |
| `lib/services/dashboard-metrics.ts` | 242 |
| `lib/services/trazabilidad-item.ts` | **307** ⬇️395 |
| `lib/services/trazabilidad-item.types.ts` | 93 |
| `lib/services/deliveries.ts` | **11** ⬇️356 |
| `lib/services/deliveries.types.ts` | 39 |
| `lib/services/deliveries-worksite.ts` | 135 |
| `lib/services/deliveries-worker-epp.ts` | 197 |
| `lib/services/requests-draft.ts` | **52** ⬇️304 |
| `lib/services/requests-draft.types.ts` | 7 |
| `lib/services/requests-draft-create.ts` | 86 |
| `lib/services/requests-draft-update.ts` | 151 |
| `lib/services/prevention-documents/folders.ts` | **24** ⬇️270 |
| `lib/services/prevention-documents/folders-crud.ts` | 109 |
| `lib/services/prevention-documents/folders-move.ts` | 88 |
| `lib/services/prevention-documents/folders-queries.ts` | 105 |
| `lib/services/trazabilidad-matrix.ts` | 263 |
| `lib/services/prevention-pdtp-catalog.ts` | 260 |
| `lib/services/receiving.ts` | 251 |
| `lib/services/email-templates.ts` | 251 |
| `lib/services/prevention-documents/crud.ts` | 247 |
| `lib/services/system-settings.ts` | 244 |
| `lib/services/trazabilidad-export.ts` | 236 |
| `lib/services/pdtp/executions.ts` | 235 |
| `lib/services/maintenance.ts` | 233 |
| `lib/services/fleet.ts` | 231 |
| `lib/services/pdtp/overrides.ts` | 213 |
| `lib/services/item-state-module/approval.ts` | 212 |
| `lib/services/ppa-module/evaluaciones.ts` | 206 |
| `lib/services/prevention-documents/utils.ts` | 199 |
| `lib/services/ppa-module/calculos.ts` | 199 |
| `lib/services/purchasing-module/receiving.ts` | 196 |
| `lib/services/feedback.ts` | 186 |
| `lib/services/item-state-module/purchase-order.ts` | 181 |
| `lib/services/sst-module/evaluations.ts` | 172 |
| `lib/services/pdtp/reminders.ts` | 167 |
| `lib/services/pdtp/sheets.ts` | 143 |
| `lib/services/pdtp/activities.ts` | 129 |
| `lib/services/pdtp/evidence-gc.ts` | 121 |
| `lib/services/sst-module/evaluation-archive.ts` | 118 |
| `lib/services/purchasing-module/invoices.ts` | 131 |
| `lib/services/item-state-module/receiving.ts` | 132 |
| `lib/services/sst-alerts.ts` | 138 |
| `lib/services/physical-inventory.ts` | 125 |
| `lib/services/pdtp/catalog.ts` | 113 |
| `lib/services/prevention-documents/search.ts` | 113 |
| `lib/services/rate-limit.ts` | 120 |
| `lib/services/pdtp/helpers.ts` | 101 |
| `lib/services/prevention-documents/taxonomy.ts` | 99 |
| `lib/services/ppa-module/reportes.ts` | 145 |
| `lib/services/analytics-module/dashboard.ts` | 91 |
| `lib/services/analytics-module/helpers.ts` | 113 |
| `lib/services/pdtp/compliance.ts` | 77 |
| `lib/services/pdtp/lifecycle.ts` | 62 |
| `lib/services/pdtp/period.ts` | 61 |
| `lib/services/item-state-module/rollup.ts` | 64 |
| `lib/services/item-state-module/submit.ts` | 53 |
| `lib/services/sst-module/action-plan.ts` | 25 |
| `lib/services/sst-module/weekly.ts` | 23 |
| `lib/services/sst-module/responses.ts` | 22 |
| `lib/services/sst-module/followups.ts` | 21 |
| `lib/services/sst-module/dashboard.ts` | 21 |
| `lib/services/sst-module/helpers.ts` | 26 |
| `lib/services/ppa-module/index.ts` | 26 |
| `lib/services/oc-reconciliation.ts` | 26 |
| `lib/services/smtp-settings.ts` | 41 |
| `lib/services/servicios.ts` | 39 |
| `lib/services/repuestos.ts` | 39 |
| `lib/services/stock-alerts.ts` | 70 |
| `lib/services/analytics-module/types.ts` | 64 |
| `lib/services/analytics-module/alerts.ts` | 32 |

### Auth / RBAC

| Archivo | Líneas |
|---------|--------|
| `lib/auth/rbac.ts` | 161 |
| `lib/auth/auth.ts` | 154 |
| `lib/auth/can.ts` | 84 |
| `lib/auth/system-rbac.ts` | 82 |
| `lib/auth/scope.ts` | 67 |
| `lib/auth/bootstrap.ts` | 53 |
| `lib/auth/types.ts` | 34 |
| `lib/auth/admin-user-scope.ts` | 25 |
| `lib/auth/password-setup.ts` | 23 |

### Validation

| Archivo | Líneas |
|---------|--------|
| `lib/validation/masters.ts` | 186 |
| `lib/validation/operations.ts` | 184 |
| `lib/validation/sst.ts` | 82 |
| `lib/validation/prevention-module/sst-documents.ts` | 167 |
| `lib/validation/prevention-module/pdtp.ts` | 79 |
| `lib/validation/servicios.ts` | 75 |
| `lib/validation/repuestos.ts` | 74 |
| `lib/validation/ppa.ts` | 60 |
| `lib/validation/maintenance.ts` | 37 |
| `lib/validation/feedback.ts` | 29 |

### Requests / Workflows

| Archivo | Líneas |
|---------|--------|
| `lib/requests/request-actions.ts` | **37** ⬇️398 |
| `lib/requests/request-actions.types.ts` | 38 |
| `lib/requests/request-actions-draft.ts` | 60 |
| `lib/requests/request-actions-workflow.ts` | 297 |
| `lib/requests/request-config.ts` | 117 |
| `lib/requests/request-service-module/persist-draft.ts` | 115 |
| `lib/requests/request-service-module/submit-request.ts` | 78 |
| `lib/requests/request-service-module/add-quotation.ts` | 77 |
| `lib/requests/request-service-module/select-quotation.ts` | 137 |
| `lib/requests/request-service-module/cancel-request.ts` | 55 |
| `lib/requests/request-service-module/delete-quotation.ts` | 50 |
| `lib/requests/request-service-module/factory.ts` | 29 |
| `lib/requests/request-service-module/get-quotations.ts` | 15 |
| `lib/requests/request-service-module/types.ts` | 8 |
| `lib/requests/request-service-module/index.ts` | 9 |
| `lib/requests/quotation-access.ts` | 41 |
| `lib/requests/request-service.ts` | 1 |
| `lib/services/requests-delete.ts` | 117 |

### SST (Seguridad y Salud en el Trabajo)

| Archivo | Líneas |
|---------|--------|
| `lib/sst/definitions/trabajador-antiguo.ts` | **48** ⬇️482 |
| `lib/sst/definitions/trabajador-antiguo-sections.ts` | 154 |
| `lib/sst/definitions/trabajador-nuevo.ts` | **32** ⬇️390 |
| `lib/sst/definitions/trabajador-nuevo-sections.ts` | 158 |
| `lib/sst/__tests__/compliance.test.ts` | 383 |
| `lib/sst/__tests__/checklist.test.ts` | 303 |
| `lib/sst/compliance.ts` | 206 |
| `lib/sst/__tests__/compliance-helpers.test.ts` | 206 |
| `lib/sst/__tests__/badges.test.ts` | 166 |
| `lib/sst/__tests__/date.test.ts` | 150 |
| `lib/sst/checklist.ts` | 143 |
| `lib/sst/types.ts` | 143 |
| `lib/sst/__tests__/definitions.test.ts` | 132 |
| `lib/sst/badges.ts` | 74 |
| `lib/sst/date.ts` | 77 |
| `lib/sst/__tests__/cargos.test.ts` | 77 |
| `lib/sst/__tests__/section-access.test.ts` | 65 |
| `lib/sst/__tests__/compliance-input.test.ts` | 26 |
| `lib/sst/acta-filename.ts` | 22 |
| `lib/sst/acta-filename.test.ts` | 13 |
| `lib/sst/cargos.ts` | 20 |
| `lib/sst/definitions/index.ts` | 16 |

### Reportes / Export

| Archivo | Líneas |
|---------|--------|
| `lib/reports/export-module/analitica.ts` | 167 |
| `lib/reports/export-module/items-sin-oc.ts` | 83 |
| `lib/reports/export-module/compras.ts` | 69 |
| `lib/reports/export-module/solicitudes.ts` | 63 |
| `lib/reports/export-module/recepcion.ts` | 58 |
| `lib/reports/export-module/gasto-faena.ts` | 57 |
| `lib/reports/export-module/oc-por-estado.ts` | 53 |
| `lib/reports/export-module/excel-builder.ts` | 44 |
| `lib/reports/export-module/dispatcher.ts` | 29 |
| `lib/reports/export-module/utils.ts` | 28 |
| `lib/reports/export-module/types.ts` | 27 |
| `lib/reports/export-module/labels.ts` | 16 |
| `lib/reports/export-module/index.ts` | 10 |
| `lib/reports/export.ts` | 1 |

### Infraestructura / Core

| Archivo | Líneas |
|---------|--------|
| `lib/work-queue.ts` | **40** ⬇️437 |
| `lib/work-queue.types.ts` | 105 |
| `lib/work-queue-labels.ts` | 93 |
| `lib/work-queue-builders.ts` | 261 |
| `lib/combustibles/import.ts` | 230 |
| `lib/pwa/hooks.ts` | 229 |
| `lib/storage/config.ts` | 213 |
| `lib/pwa/offline-queue.ts` | 192 |
| `lib/logger.ts` | 136 |
| `lib/storage/helpers.ts` | 20 |
| `lib/file-validation.ts` | 121 |
| `lib/utils.ts` | 113 |
| `lib/audit.ts` | 97 |
| `lib/pdf/browser-pool.ts` | 95 |
| `lib/prevention/file-icon.ts` | 206 |
| `lib/prevention/badges.ts` | 178 |
| `lib/prevention/view-mode.ts` | 32 |
| `lib/prevention/incident-sla.ts` | 21 |
| `lib/email/smtp.ts` | 109 |
| `lib/security/csp.ts` | 34 |
| `lib/security/cron-auth.ts` | 10 |
| `lib/hooks/use-notifications.ts` | 113 |
| `lib/hooks/use-client-validation.ts` | 66 |
| `lib/hooks/use-login.ts` | 59 |
| `lib/testing/pglite-migrate.ts` | 184 |
| `lib/testing/destructive-database-guard.ts` | 75 |
| `lib/adquisiciones/list-query.ts` | 106 |
| `lib/combustibles/notifications.ts` | 101 |
| `lib/combustibles/validation.ts` | 93 |
| `lib/combustibles/calculations.ts` | 73 |
| `lib/combustibles/queries.ts` | 42 |
| `lib/combustibles/reports.ts` | 62 |
| `lib/combustibles/__tests__/import.test.ts` | 116 |
| `lib/combustibles/__tests__/calculations.test.ts` | 87 |
| `lib/combustibles/__tests__/reports.test.ts` | 65 |
| `lib/combustibles/__tests__/vehicle-queries.test.ts` | 28 |

### PPA / Evaluaciones

| Archivo | Líneas |
|---------|--------|
| `lib/ppa/evaluation.ts` | 100 |
| `lib/ppa/badges.ts` | 132 |
| `lib/ppa/types.ts` | 118 |
| `lib/ppa/utils.ts` | 16 |
| `lib/ppa/__tests__/evaluation.test.ts` | 148 |
| `lib/ppa/__tests__/badges.test.ts` | 44 |
| `lib/ppa/__tests__/utils.test.ts` | 30 |
| `lib/ppa/__tests__/review-validation.test.ts` | 26 |

### Utilidades / Config

| Archivo | Líneas |
|---------|--------|
| `lib/rut.ts` | 49 |
| `lib/sentry.ts` | 42 |
| `lib/env.ts` | 38 |
| `lib/constants.ts` | 39 |
| `lib/code-sequences.ts` | 39 |
| `lib/pagination.ts` | 75 |
| `lib/request-types.ts` | 76 |
| `lib/id.ts` | 19 |
| `lib/toast.ts` | 15 |
| `lib/navigation.ts` | 12 |
| `lib/order-totals.ts` | 10 |

---

## components/ — Componentes UI reutilizables (6,366 líneas)

| Archivo | Líneas |
|---------|--------|
| `components/ui/select.tsx` | **253** ⬇️332 |
| `components/ui/select-context.tsx` | 28 |
| `components/ui/select-parts.tsx` | 61 |
| `components/layout/desktop-nav.tsx` | **140** ⬇️297 |
| `components/layout/desktop-nav-areas.tsx` | 140 |
| `components/admin/data-table.tsx` | **235** ⬇️275 |
| `components/admin/data-table.types.ts` | 40 |
| `components/layout/top-bar.tsx` | **166** ⬇️234 |
| `components/layout/top-bar-user-menu.tsx` | 81 |
| `components/adquisiciones/list-filters.tsx` | 226 |
| `components/layout/nav-rows.tsx` | 177 |
| `components/ui/date-picker.tsx` | 176 |
| `components/layout/notification-bell.tsx` | 165 |
| `components/layout/command-palette.tsx` | 162 |
| `components/admin/sheet.tsx` | 156 |
| `components/layout/nav-items.ts` | 150 |
| `components/export-dialog.tsx` | 148 |
| `components/layout/mobile-nav.tsx` | 147 |
| `components/__tests__/data-table.test.tsx` | 146 |
| `components/ui/table.tsx` | 142 |
| `components/layout/app-shell.tsx` | 142 |
| `components/prevention/document-grid.tsx` | 141 |
| `components/states/state-badge.tsx` | 136 |
| `components/prevention/document-tile.tsx` | 121 |
| `components/ui/summary-bar.tsx` | 114 |
| `components/ui/dialog.tsx` | 112 |
| `components/ui/button.tsx` | 112 |
| `components/ui/pagination.tsx` | 108 |
| `components/ui/field.tsx` | 107 |
| `components/ui/server-pagination.tsx` | 104 |
| `components/pwa/offline-banner.tsx` | 102 |
| `components/states/entity-timeline.tsx` | 101 |
| `components/ui/dropdown-menu.tsx` | 98 |
| `components/ui/page-header.tsx` | 97 |
| `components/prevention/view-mode-toggle.tsx` | 95 |
| `components/layout/top-bar.test.tsx` | 90 |
| `components/solicitudes/delete-request-button.tsx` | 87 |
| `components/ui/empty-state.tsx` | 86 |
| `components/ui/confirm-dialog.tsx` | 83 |
| `components/ui/header-signals.tsx` | 81 |
| `components/ui/tooltip.tsx` | 77 |
| `components/ui/card.tsx` | 76 |
| `components/ui/tabs.tsx` | 69 |
| `components/ui/badge.tsx` | 69 |
| `components/ui/avatar.tsx` | 69 |
| `components/__tests__/field.test.tsx` | 69 |
| `components/layout/navigation-progress.tsx` | 69 |
| `components/states/request-progress-panel.tsx` | 68 |
| `components/layout/brand-mark.tsx` | 67 |
| `components/pwa/pwa-register.tsx` | 53 |
| `components/ui/skeleton.tsx` | 47 |
| `components/adquisiciones/onboarding-hint.tsx` | 47 |
| `components/layout/nav-icons.tsx` | 44 |
| `components/layout/header-context.tsx` | 44 |
| `components/__tests__/select.test.tsx` | 43 |
| `components/providers/query-provider.tsx` | 43 |
| `components/ui/popover.tsx` | 37 |
| `components/ui/input.tsx` | 36 |
| `components/__tests__/checkbox.test.tsx` | 35 |
| `components/__tests__/badge.test.tsx` | 35 |
| `components/ui/textarea.tsx` | 34 |
| `components/ui/page-container.tsx` | 34 |
| `components/ui/checkbox.tsx` | 32 |
| `components/layout/areas.ts` | 32 |
| `components/ui/page-header.test.tsx` | 22 |
| `components/admin/submit-button.tsx` | 22 |
| `components/prevention/export-button.tsx` | 20 |
| `components/providers/session-provider.tsx` | 14 |
| `components/admin/form-state.ts` | 8 |
| `components/__tests__/setup.ts` | 1 |

---

## db/ — Base de datos (5,769 líneas)

### Migraciones SQL

| Archivo | Líneas |
|---------|--------|
| `db/migrations/0000_vengeful_hulk.sql` | 1,006 |
| `db/migrations/0012_nosy_wolfpack.sql` | 392 |
| `db/migrations/0011_late_madrox.sql` | 270 |
| `db/migrations/0016_sst_document_library.sql` | 145 |
| `db/migrations/0008_outgoing_paladin.sql` | 124 |
| `db/migrations/0007_striped_mantis.sql` | 119 |
| `db/migrations/0001_brown_silver_fox.sql` | 103 |
| `db/migrations/0005_condemned_wild_child.sql` | 64 |
| `db/migrations/0018_public_night_thrasher.sql` | 60 |
| `db/migrations/0017_nervous_malice.sql` | 50 |
| `db/migrations/0023_rich_human_torch.sql` | 19 |
| `db/migrations/0019_cute_chimera.sql` | 17 |
| `db/migrations/0022_add_pdtp_check_constraints.sql` | 14 |
| `db/migrations/0006_flawless_vengeance.sql` | 13 |
| `db/migrations/0014_massive_lily_hollister.sql` | 12 |
| `db/migrations/0020_add_pdtp_rejection.sql` | 3 |
| `db/migrations/0013_robust_epoch.sql` | 3 |
| `db/migrations/0003_strange_titanium_man.sql` | 3 |
| `db/migrations/0021_add_notification_dedupe_key.sql` | 1 |

### Schema

| Archivo | Líneas |
|---------|--------|
| `db/schema/prevention/pdtp.ts` | 227 |
| `db/schema/prevention/library.ts` | 222 |
| `db/schema/purchasing.ts` | 154 |
| `db/schema/requests.ts` | 140 |
| `db/schema/sst.ts` | 132 |
| `db/schema/users.ts` | 126 |
| `db/schema/receiving.ts` | 124 |
| `db/schema/fuel-invoices.ts` | 116 |
| `db/schema/stock.ts` | 108 |
| `db/schema/audit.ts` | 102 |
| `db/schema/products.ts` | 77 |
| `db/schema/fuel-vehicles.ts` | 73 |
| `db/schema/ppa.ts` | 63 |
| `db/schema/worksites.ts` | 58 |
| `db/schema/maintenance.ts` | 52 |
| `db/schema/servicios.ts` | 47 |
| `db/schema/repuestos.ts` | 47 |
| `db/schema/feedback.ts` | 40 |
| `db/schema/fuel-suppliers.ts` | 24 |
| `db/schema/email-templates.ts` | 24 |
| `db/schema/cost-centers.ts` | 22 |
| `db/schema/rate-limits.ts` | 18 |
| `db/schema/code-sequences.ts` | 10 |
| `db/schema/system-settings.ts` | 7 |
| `db/schema/index.ts` | 24 |
| `db/schema/prevention/index.ts` | 2 |

### Seed / Tests

| Archivo | Líneas |
|---------|--------|
| `db/seed.ts` | 392 |
| `db/schema-consistency.test.ts` | 243 |
| `db/seed/nuevos-roles.ts` | 165 |
| `db/seed/workers.ts` | 114 |
| `db/seed-combustibles.ts` | 85 |
| `db/__tests__/pdtp-check-constraints.test.ts` | 171 |
| `db/__tests__/pdtp-worksite-cascade.test.ts` | 111 |
| `db/index.ts` | 30 |

---

## scripts/ — Scripts de utilidad (3,288 líneas)

| Archivo | Líneas |
|---------|--------|
| `scripts/capture-all-routes.ts` | 1,681 |
| `scripts/measure-operational-queries.ts` | 471 |
| `scripts/axe-audit.ts` | 185 |
| `scripts/seed-catalog.mjs` | 124 |
| `scripts/import-patentes-chile.ts` | 112 |
| `scripts/generate-test-pdfs.ts` | 111 |
| `scripts/release.ts` | 104 |
| `scripts/capture-all-routes.test.ts` | 101 |
| `scripts/rotate-secrets.sh` | 67 |
| `scripts/backup-pg.sh` | 55 |
| `scripts/backup-storage.sh` | 48 |
| `scripts/check-env-files.ts` | 47 |
| `scripts/migrate.mjs` | 46 |
| `scripts/read-xlsx.mjs` | 38 |
| `scripts/run-e2e.sh` | 37 |
| `scripts/read-xlsx-meta.mjs` | 35 |
| `scripts/generate-pdtp-catalog.ts` | 26 |

---

## e2e/ — Tests end-to-end (2,917 líneas)

| Archivo | Líneas |
|---------|--------|
| `e2e/ppa-offline.spec.ts` | 715 |
| `e2e/setup-db.ts` | 668 |
| `e2e/admin-flow.spec.ts` | 203 |
| `e2e/ppa-flow.spec.ts` | 177 |
| `e2e/pdf-exports.spec.ts` | 150 |
| `e2e/purchase-flow.spec.ts` | 144 |
| `e2e/negative-flows.spec.ts` | 136 |
| `e2e/worker-delivery-flow.spec.ts` | 105 |
| `e2e/repuestos-servicios-oc-flow.spec.ts` | 85 |
| `e2e/combustibles.spec.ts` | 77 |
| `e2e/restricted-roles.spec.ts` | 73 |
| `e2e/sst-pdf.spec.ts` | 71 |
| `e2e/repuestos-servicios-flow.spec.ts` | 49 |
| `e2e/export-volume.spec.ts` | 42 |
| `e2e/accessibility.spec.ts` | 42 |
| `e2e/prevencion-documentacion.spec.ts` | 36 |
| `e2e/helpers.ts` | 36 |
| `e2e/oc-reconciliation.spec.ts` | 19 |
| `e2e/soporte.spec.ts` | 18 |
| `e2e/flota.spec.ts` | 18 |
| `e2e/delivery-print.spec.ts` | 14 |
| `e2e/mantenciones.spec.ts` | 13 |
| `e2e/flota-documentos.spec.ts` | 13 |
| `e2e/bodega-conteo-fisico.spec.ts` | 13 |

---

## Archivos raíz de configuración

| Archivo | Líneas |
|---------|--------|
| `package-lock.json` | 15,150 |
| `package.json` | 108 |
| `docker-compose.yml` | 121 |
| `Dockerfile` | 93 |
| `.env.example` | 105 |
| `next.config.ts` | 67 |
| `tsconfig.json` | 35 |
| `playwright.config.ts` | 32 |
| `vitest.config.ts` | 58 |
| `drizzle.config.ts` | 13 |
| `postcss.config.mjs` | 7 |
| `eslint.config.mjs` | 57 |
| `instrumentation.ts` | 9 |
| `proxy.ts` | 51 |
| `public/manifest.json` | 49 |

---

## Top 25 archivos más grandes (código fuente)

| # | Archivo | Líneas |
|---|---------|--------|
| 1 | `scripts/capture-all-routes.ts` | 1,681 |
| 2 | `db/migrations/0000_vengeful_hulk.sql` | 1,006 |
| 3 | `app/(app)/prevencion/documentacion/documentacion-view.hooks.ts` | 337 |
| 4 | `lib/__tests__/prevention-pdtp.test.ts` | 826 |
| 5 | `app/(app)/prevencion/documentacion/documentacion-view-dialogs.tsx` | 332 |
| 6 | `app/(print)/sst/[id]/print/document.tsx` | 291 |
| 7 | `app/(app)/prevencion/documentacion/documentacion-view.tsx` | 246 |
| 8 | `app/(print)/compras/[id]/print/page.tsx` | 168 |
| 7 | `e2e/ppa-offline.spec.ts` | 715 |
| 8 | `e2e/setup-db.ts` | 668 |
| 9 | `lib/__tests__/full-flow-integration.test.ts` | 620 |
| 10 | `lib/__tests__/purchasing-service.test.ts` | 610 |
| 11 | `lib/__tests__/deliveries-service.test.ts` | 591 |
| 12 | `lib/__tests__/sst-service-full.test.ts` | 552 |
| 13 | `lib/services/purchasing-module/purchase-orders-status.ts` | 272 |
| 14 | `app/(app)/compras/actions/create-order.ts` | 160 |
| 15 | `lib/__tests__/requests-draft-diff.test.ts` | 528 |
| 16 | `lib/__tests__/request-service-factory.test.ts` | 505 |
| 17 | `lib/__tests__/trazabilidad-export-scope.test.ts` | 505 |
| 20 | `app/(app)/prevencion/trabajador/[workerId]/worker-evaluations-card.tsx` | 190 |
| 21 | `app/(app)/prevencion/trabajador/[workerId]/worker-evaluations.types.ts` | 37 |
| 22 | `app/(app)/prevencion/trabajador/[workerId]/worker-evaluations.tsx` | 108 |
| 19 | `lib/__tests__/stock-export.test.ts` | 491 |
| 20 | `app/(app)/prevencion/trabajador/[workerId]/worker-evaluations-card.tsx` | 190 |
| 21 | `app/(app)/prevencion/nueva/nueva-evaluacion-form.tsx` | 322 |
| `app/(app)/prevencion/nueva/nueva-evaluacion-form-seguimiento.tsx` | 101 |
| `app/(app)/prevencion/nueva/nueva-evaluacion-form-cargos.tsx` | 66 |
| `app/(app)/prevencion/nueva/nueva-evaluacion-form.types.ts` | 47 |
| `app/(app)/prevencion/nueva/nueva-evaluacion-form-summary.tsx` | 27 |
| 24 | `app/(app)/solicitudes/item-editor-attributes.tsx` | 75 |
| 25 | `app/(app)/solicitudes/item-editor-supplier.tsx` | 64 |
| 23 | `app/(public)/ppa/ppa-form.tsx` | 473 |
| 24 | `app/(app)/combustibles/import-fuel-modal-preview.tsx` | 252 |
| `app/(app)/combustibles/import-fuel-modal.tsx` | 220 |
| `app/(app)/combustibles/import-fuel-modal-upload.tsx` | 77 |
| `app/(app)/combustibles/import-fuel-modal-done.tsx` | 64 |
| `app/(app)/combustibles/import-fuel-modal.helpers.ts` | 61 |
| 25 | `scripts/measure-operational-queries.ts` | 471 |
