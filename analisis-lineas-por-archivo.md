# Análisis de Líneas por Archivo

**Total:** 797 archivos fuente | **113,064** líneas totales  
**Promedio:** 142 líneas/archivo | **Mediana:** 95 líneas/archivo  
**Generado:** 2026-07-01

---

## Archivos más grandes (> 500 líneas)

Estos son los principales candidatos a dividir en módulos más pequeños:

| Líneas | Archivo |
|-------:|---------|
| 1653 | `scripts/capture-all-routes.ts` |
| 960 | `lib/services/prevention-pdtp.ts` |
| 878 | `app/(app)/solicitudes/request-form.tsx` |
| 873 | `lib/services/analytics.ts` |
| 840 | `lib/services/sst.ts` |
| 835 | `app/(print)/compras/[id]/print/page.tsx` |
| 834 | `app/(print)/sst/[id]/print/document.tsx` |
| 753 | `app/(app)/combustibles/actions.ts` |
| 732 | `app/(app)/prevencion/[id]/evaluation-detail.tsx` |
| 705 | `lib/services/item-state.ts` |
| 701 | `lib/services/purchasing.ts` |
| 659 | `e2e/setup-db.ts` |
| 646 | `lib/reports/export.ts` |
| 619 | `lib/__tests__/full-flow-integration.test.ts` |
| 599 | `app/(app)/admin/usuarios/user-form.tsx` |
| 598 | `lib/services/ppa.ts` |
| 556 | `app/(app)/compras/oc-form.tsx` |
| 553 | `lib/requests/request-service.ts` |
| 539 | `app/(app)/solicitudes/actions.ts` |
| 536 | `app/(app)/aprobaciones/approval-panel.tsx` |
| 528 | `app/(app)/trazabilidad/page.tsx` |
| 496 | `app/(app)/prevencion/trabajador/[workerId]/worker-evaluations.tsx` |
| 482 | `lib/sst/definitions/trabajador-antiguo.ts` |
| 479 | `db/seed.ts` |
| 477 | `app/(app)/prevencion/nueva/nueva-evaluacion-form.tsx` |

---

## Distribución por directorio

```
 25,417  lib/__tests__          (tests — no aplicar)
 12,153  lib/services           ← CORE: más denso del proyecto
  3,031  app/(app)/solicitudes
  2,806  scripts
  2,464  app/(app)/combustibles
  2,328  components/ui
  2,172  app/(app)/admin/usuarios
  2,150  e2e
  2,033  app/(app)/prevencion/[id]
  1,803  app/(app)/compras
  1,758  app/(app)/bodega
  1,673  components/layout
  1,508  lib/sst/__tests__
  1,299  lib
  1,137  lib/validation
  1,109  lib/requests
  1,089  app/(app)/admin/productos
  1,088  app/(app)/aprobaciones
  1,070  app/(app)/recepcion
  1,057  app/(app)/entregas
  1,039  app/(app)/compras/[id]
    988  app/(app)/prevencion/pdtp
    969  app/(app)/prevencion/comites
    956  app/(app)/prevencion/ppa
    932  app/(print)/sst/[id]/print
    926  app/(app)/prevencion/documentacion
    908  app/(print)/compras/[id]/print
    888  lib/sst/definitions
    835  db
    805  app/(app)/prevencion/salud
    785  app/(app)/mantenciones
    722  app/(app)/analitica
    721  app/(app)/prevencion/emergencias
    719  app/(app)/prevencion/permisos
    704  lib/sst
    685  app/(app)/dashboard
    683  lib/auth
    663  app/(app)/prevencion/capacitaciones
    657  app/(app)/prevencion
```

---

## Resumen de criticidad

| Rango | Cantidad | Acción sugerida |
|-------|----------|-----------------|
| > 500 líneas | **25 archivos** | 🔴 **Dividir urgentemente** |
| 300–500 líneas | **62 archivos** | 🟡 Revisar y considerar dividir |
| 200–300 líneas | **81 archivos** | 🟢 Monitorear, dividir si crece |
| < 200 líneas | **629 archivos** | ✅ Bien |

---

## Top 10 prioridad para dividir (producción, sin tests)

| # | Archivo | Líneas | Razón |
|---|---------|-------:|-------|
| 1 | `lib/services/prevention-pdtp.ts` | 960 | Servicio monolítico; separar lógica de validación, cálculos y persistencia |
| 2 | `app/(app)/solicitudes/request-form.tsx` | 878 | Componente UI masivo; extraer subcomponentes y lógica de negocio a hooks |
| 3 | `lib/services/analytics.ts` | 873 | Servicio de analytics; dividir por tipo de reporte/métrica |
| 4 | `lib/services/sst.ts` | 840 | Servicio SST monolítico; separar por dominio (evaluaciones, checklist, capacitaciones) |
| 5 | `app/(app)/combustibles/actions.ts` | 753 | Actions monolíticas; separar por entidad (carga, tanque, proveedor) |
| 6 | `app/(app)/prevencion/[id]/evaluation-detail.tsx` | 732 | Componente + lógica; extraer subcomponentes y lógica de negocio |
| 7 | `lib/services/item-state.ts` | 705 | Máquina de estados compleja; separar por tipo de ítem o workflow |
| 8 | `lib/services/purchasing.ts` | 701 | Servicio de compras; separar OC, recepción, facturación |
| 9 | `lib/reports/export.ts` | 646 | Exportación; separar por formato (XLSX, PDF) o módulo |
| 10 | `lib/services/ppa.ts` | 598 | Servicio PPA; separar evaluaciones, cálculos, reportes |

---

## Notas

- Los archivos en `lib/__tests__/` no requieren acción (son tests, pueden ser largos).
- `scripts/capture-all-routes.ts` (1653 lns) es un script de una sola ejecución — baja prioridad.
- Los prints (`app/(print)/...`) son plantillas de impresión — pueden ser extensas por naturaleza.
- El criterio sugerido de 300 líneas como límite práctico para archivos de producción sigue la convención general de maintainability.
