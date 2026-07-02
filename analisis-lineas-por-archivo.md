# Análisis de Líneas por Archivo

**Total:** 863 archivos fuente | **123,267** líneas totales  
**Promedio:** 143 líneas/archivo | **Mediana:** 93 líneas/archivo  
**Generado:** 2026-07-01

---

## Archivos más grandes (> 500 líneas)

Estos son los principales candidatos a dividir en módulos más pequeños:

| Líneas | Archivo |
|-------:|---------|
| 1653 | `scripts/capture-all-routes.ts` |
| 1579 | `db/schema/prevention.ts` |
| 1316 | `lib/services/prevention-documents-library.ts` |
| 960 | `lib/services/prevention-pdtp.ts` |
| 878 | `app/(app)/solicitudes/request-form.tsx` |
| 873 | `lib/services/analytics.ts` |
| 840 | `lib/services/sst.ts` |
| 835 | `app/(print)/compras/[id]/print/page.tsx` |
| 834 | `app/(print)/sst/[id]/print/document.tsx` |
| 764 | `app/(app)/prevencion/biblioteca/[id]/document-detail-view.tsx` |
| 753 | `app/(app)/combustibles/actions.ts` |
| 732 | `app/(app)/prevencion/[id]/evaluation-detail.tsx` |
| 705 | `lib/services/item-state.ts` |
| 701 | `lib/services/purchasing.ts` |
| 659 | `e2e/setup-db.ts` |
| 646 | `lib/reports/export.ts` |
| 619 | `lib/__tests__/full-flow-integration.test.ts` |
| 599 | `app/(app)/admin/usuarios/user-form.tsx` |
| 598 | `lib/services/ppa.ts` |
| 597 | `lib/validation/prevention.ts` |
| 556 | `app/(app)/compras/oc-form.tsx` |
| 553 | `lib/requests/request-service.ts` |
| 552 | `lib/__tests__/sst-service-full.test.ts` |
| 549 | `lib/__tests__/deliveries-service.test.ts` |
| 539 | `app/(app)/solicitudes/actions.ts` |
| 536 | `app/(app)/aprobaciones/approval-panel.tsx` |
| 528 | `lib/__tests__/requests-draft-diff.test.ts` |
| 528 | `app/(app)/trazabilidad/page.tsx` |
| 510 | `lib/__tests__/request-service-factory.test.ts` |
| 496 | `app/(app)/prevencion/trabajador/[workerId]/worker-evaluations.tsx` |
| 491 | `lib/__tests__/stock-export.test.ts` |
| 490 | `db/seed.ts` |
| 482 | `lib/sst/definitions/trabajador-antiguo.ts` |
| 477 | `app/(app)/prevencion/nueva/nueva-evaluacion-form.tsx` |
| 475 | `app/(app)/solicitudes/item-editor.tsx` |
| 472 | `app/(app)/compras/actions.ts` |
| 471 | `scripts/measure-operational-queries.ts` |
| 471 | `app/(app)/combustibles/import-fuel-modal.tsx` |
| 466 | `lib/__tests__/trazabilidad-item.test.ts` |

---

## Distribución por directorio

```
 25,739  lib/__tests__          (tests — no aplicar)
 13,513  lib/services           ← CORE: más denso del proyecto
  4,214  app/(app)/combustibles
  3,507  app/(app)/solicitudes
  3,147  db/schema              ← nuevo schema masivo
  2,831  scripts
  2,328  components/ui
  2,255  db/migrations
  2,235  app/(app)/prevencion/biblioteca
  2,172  app/(app)/admin/usuarios
  2,150  e2e
  2,033  app/(app)/prevencion/[id]
  1,995  app/(app)/compras
  1,758  app/(app)/bodega
  1,673  components/layout
  1,508  lib/sst/__tests__
  1,451  app/(app)/prevencion/ppa
  1,435  modules
  1,424  app/(app)/recepcion
  1,324  lib/validation
  1,299  lib
  1,229  app/(app)/admin/productos
  1,175  app/(print)
  1,109  lib/requests
  1,088  app/(app)/aprobaciones
  1,059  app/(app)/trazabilidad
  1,057  app/(app)/entregas
  1,039  app/(app)/compras/[id]
    992  app/(auth)
    988  app/(app)/prevencion/pdtp
    988  app/(print)/sst/[id]/print
    974  app/(app)/prevencion/incidentes
    969  app/(app)/prevencion/comites
    926  app/(app)/prevencion/documentacion
    888  lib/sst/definitions
    887  app/(app)/prevencion/epp
    861  app/(app)/prevencion/salud
    848  lib/combustibles
    846  db
    820  app/(app)/soporte
    796  app/(app)/prevencion/equipos
    785  app/(app)/mantenciones
    753  app/(app)/prevencion/capacitaciones
    727  app/(public)
    722  app/(app)/analitica
    721  app/(app)/prevencion/emergencias
    719  app/(app)/prevencion/permisos
    704  lib/sst
    685  app/(app)/dashboard
    683  lib/auth
    670  app/(app)/flota
    657  app/(app)/prevencion
    646  lib/reports
    634  app/(app)/prevencion/contratistas
    623  app/(app)/prevencion/trabajador
    614  lib/ppa
    570  app/(app)/prevencion/nueva
    553  app/(app)/admin/trabajadores
    481  app/(app)/admin/proveedores
    478  app/(app)/prevencion/inspecciones
    460  components/admin
    451  app/(app)/admin/faenas
    443  app/(app)/prevencion/iper
    438  app/(app)/prevencion/alcotest
    429  app/(app)/repuestos
    429  app/(app)/servicios
    407  app/(app)/admin/configuracion
    393  app/(app)/prevencion/kpis
    376  app/(app)/reportes
    340  app/(app)/admin/plantillas
    332  app/(app)/admin/correo-smtp
    323  lib/hooks
    305  components/states
    290  app/(app)/perfil
    279  db/seed
    273  components/adquisiciones
    259  lib/testing
    218  app/(app)
    211  app/(app)/admin/auditoria
    202  lib/storage
    199  lib/prevention
    148  components
    109  lib/email
    106  lib/adquisiciones
     95  lib/pdf
     87  components/solicitudes
```

---

## Resumen de criticidad

| Rango | Cantidad | Acción sugerida |
|-------|----------|-----------------|
| > 500 líneas | **30 archivos** | 🔴 **Dividir urgentemente** |
| 300–500 líneas | **63 archivos** | 🟡 Revisar y considerar dividir |
| 200–300 líneas | **84 archivos** | 🟢 Monitorear, dividir si crece |
| < 200 líneas | **686 archivos** | ✅ Bien |

---

## Top 10 prioridad para dividir (producción, sin tests)

| # | Archivo | Líneas | Estado |
|---|---------|-------:|--------|
| 1 | `db/schema/prevention.ts` | 1579 | ✅ Dividido en 16 archivos por dominio |
| 2 | `lib/services/prevention-documents-library.ts` | 1316 | ✅ Dividido en 6 módulos (taxonomía, CRUD, linking, search, workflow) |
| 3 | `lib/services/prevention-pdtp.ts` | 960 | ✅ Dividido en 9 módulos (catálogo, sheets, ejecuciones, lifecycle, etc.) |
| 4 | `app/(app)/solicitudes/request-form.tsx` | 878 | ✅ Dividido en hook + helpers + subcomponentes |
| 5 | `lib/services/analytics.ts` | 873 | ✅ Dividido en 4 módulos (types, queries, alerts, dashboard) |
| 6 | `lib/services/sst.ts` | 840 | ✅ Dividido en 7 módulos por subdominio |
| 7 | `app/(app)/combustibles/actions.ts` | 753 | ✅ Dividido en 5 archivos por entidad |
| 8 | `app/(app)/prevencion/[id]/evaluation-detail.tsx` | 732 | ✅ Dividido en 8 archivos (hook + subcomponentes) |
| 9 | `lib/services/item-state.ts` | 705 | ✅ Dividido en 7 módulos por fase de workflow |
| 10 | `lib/services/purchasing.ts` | 701 | ✅ Dividido en 3 módulos (OC, recepción, facturación) |

---

## Notas

- Los archivos en `lib/__tests__/` no requieren acción (son tests, pueden ser largos).
- `scripts/capture-all-routes.ts` (1653 lns) es un script de una sola ejecución — baja prioridad.
- Los prints (`app/(print)/...`) son plantillas de impresión — pueden ser extensas por naturaleza.
- El criterio sugerido de 300 líneas como límite práctico para archivos de producción sigue la convención general de maintainability.
- Los 10 archivos del top prioridad fueron particionados (julio 2026). Ningún caller requirió cambios; todos importan vía barrel.

## Próximos candidatos (> 500 líneas aún sin dividir)

| Archivo | Líneas |
|---------|-------:|
| `app/(app)/prevencion/biblioteca/[id]/document-detail-view.tsx` | 764 |
| `lib/reports/export.ts` | 646 |
| `lib/validation/prevention.ts` | 597 |
| `lib/services/ppa.ts` | 598 |
| `app/(app)/admin/usuarios/user-form.tsx` | 599 |
| `app/(app)/compras/oc-form.tsx` | 556 |
| `lib/requests/request-service.ts` | 553 |
| `app/(app)/solicitudes/actions.ts` | 539 |
| `app/(app)/aprobaciones/approval-panel.tsx` | 536 |
| `app/(app)/trazabilidad/page.tsx` | 528 |
