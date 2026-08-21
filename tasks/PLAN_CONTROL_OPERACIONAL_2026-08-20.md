# Plan activo: cierre integral de Control operacional

Fuente: `AUDITORIA_CONTROL_OPERACIONAL_2026-08-20.md`.

## Objetivo

Corregir CO-001–CO-042 y completar las capacidades necesarias de Control operacional sin desplegar ni alterar producción. La implementación conserva alcance por faena, mínimo privilegio, historia auditable, exportación Excel y migraciones generadas desde `db/schema`.

## Decisiones operativas

- Los costos sólo se consultan y muestran con `combustibles:view_costs`.
- `flota:view` sigue siendo lectura; documentos se administran con `flota:manage_documents`.
- La faena propietaria del activo gobierna el alcance. Lugar de ejecución e imputación se modelan como dimensiones explícitas cuando difieran.
- Cargas contables: `registered` y `reconciled`; `draft` y `cancelled` nunca alimentan saldos ni indicadores.
- Evidencia y documentos se reemplazan/superseden; no se destruye historia para corregir vigencia.
- Mutación y auditoría comparten transacción. Archivos usan staging/compensación y borrado lógico cuando sean evidencia.
- Por instrucción del usuario, se escriben pruebas de regresión durante la implementación pero no se ejecutan hasta terminar todas las fases.

## Dependencias

```text
RBAC y scope
  -> estados y transacciones
    -> migraciones/modelo
      -> planes preventivos/OT/reconciliación
        -> UI/reportes/observabilidad
          -> verificación integral
```

## Fases

### Fase 0 — Contención crítica

1. Alcance transaccional de anomalías (CO-001, CO-017).
2. Reversa TAE con cobertura completa de faenas (CO-002).
3. Cuenta corriente con gate global y de costos (CO-003).
4. Redacción server-side de costos en Combustibles, Flota y Dashboard (CO-004, CO-033).
5. Permiso documental de Flota (CO-006).
6. Máquina de estados Mantención/CAPA y evidencia idempotente (CO-005).

### Fase 1 — Alcance e integridad operacional

7. Guard central de toggles para páginas, rutas y acciones (CO-007).
8. Centros de costo scoped/activos y faena efectiva de mantención (CO-008, CO-012, CO-022).
9. Catálogos scoped en alta manual, TAE y Bitácora (CO-009, CO-013).
10. Vasija/punto TAE y vehículo/ciclo con invariantes de faena/producto (CO-010, CO-011).
11. Política canónica de cargas contabilizables (CO-014).
12. Máquina de estados y concurrencia de cargas (CO-015).
13. Idempotencia de sellos TAE (CO-016).
14. Severidad efectiva y detector de duplicados (CO-018, CO-019).
15. Fechas civiles, estados y metadatos documentales válidos (CO-020, CO-024, CO-036, CO-041).
16. Versionado documental y vigencia actual (CO-021).
17. Lecturas cronológicas con soporte de reset/corrección (CO-023).

### Fase 2 — Atomicidad, importaciones y automatización

18. Auditoría transaccional y ciclo seguro de archivos (CO-025, CO-028).
19. Dedupe transaccional TCT/log y ledger de rechazos/reproceso (CO-026, CO-027).
20. Scheduler versionado y salud durable (CO-029, CO-039).
21. Estados degradados visibles y ventanas temporales coherentes (CO-037, CO-038).
22. Evidencia externa TAE con destino seguro y exportación acotada (CO-040).

### Fase 3 — Capacidades funcionales

23. Paginación y exportación Excel de Mantenciones/Flota (CO-030).
24. Deep links, búsqueda y filtros coherentes (CO-031, CO-032, CO-035).
25. UX móvil y accesibilidad de Flota/Mantenciones (CO-034).
26. Plan preventivo configurable por activo/tipo/fecha/uso.
27. Orden de trabajo completa y sincronización con estado del activo.
28. Adjuntos reales, política documental y retención.
29. Notificaciones, SLA, responsables y escalamiento.
30. Reconciliación persistente TAE–TCT/factura–log y reproceso por mapping.
31. Observabilidad de jobs/importaciones y hub de Control operacional.
32. Reportes de disponibilidad, MTBF/MTTR, downtime, cumplimiento y costos.
33. Bandeja/contrato unificado entre vehículos y `service_equipment`.
34. Optimización de detalle de Flota sin N+1 (CO-042).

### Fase 4 — Verificación y estabilización

35. Generar y verificar migraciones; comprobar ausencia de drift.
36. Ejecutar pruebas focales, `test:fast`, PGlite y PostgreSQL real secuencial.
37. Ejecutar ESLint, TypeScript, secretos, seguridad, React Doctor y build.
38. Ejecutar E2E en base desechable y corregir hasta verde.
39. Auditoría final requisito por requisito y actualización del informe/TODO.

## Gates de cierre

- Ninguna mutación por ID cruza faena o permiso.
- Ningún costo se consulta sin autorización.
- Estados y reintentos son válidos, idempotentes y auditados.
- Reportes, saldos, Flota y Dashboard comparten semántica contable.
- Vencimientos y lecturas representan el estado vigente/cronológico.
- Jobs tienen scheduling, locking, health y alertas.
- Las nuevas capacidades funcionan de punta a punta.
- Todas las pruebas y gates pasan; lo no verificable en producción queda expresamente separado.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Migraciones extensas | Cambios aditivos, backfill validado, constraints después del saneamiento y `db:generate` sin editar journal. |
| Cambios de permisos | Grants explícitos, seed/paridad y pruebas con roles custom. |
| Mezcla de datos históricos | Preflight/report-only antes de backfill y conservación de snapshots. |
| Suite tardía por instrucción del usuario | Regresiones escritas con cada slice, revisión estática y cambios pequeños; ejecución integral sólo al final. |
| Trabajo ajeno concurrente | Revisar `git status` antes de cada fase y no sobrescribir archivos ajenos. |

