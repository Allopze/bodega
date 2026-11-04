# Siembra de datos de desarrollo — 4 de noviembre de 2026

## Destino y salvaguarda

- **Base sembrada:** `bodega_dev` en `127.0.0.1:5433`.
- **Producción:** `bodega` no se tocó. El guard la rechaza antes de abrir la conexión con el mensaje `La base "bodega" es de producción`.
- **Hosts:** sólo socket local, `localhost`, `127.0.0.1` o `::1`, y bases terminadas en `_dev`, `_test` o `_e2e`.

El `.env.local` actual apunta a `bodega_dev`. Los scripts `seed:dev*` cargan `.env.dev.local` después de limpiar `DATABASE_URL` del shell, para que una variable heredada no redirija la siembra.

## Cobertura inicial (antes de sembrar)

| Dominio | Faltaba |
|---|---|
| TI | `it_access_systems` 0/2 · `it_worker_checklists` 0/2 |
| Mantención | `mant_historical_records` faltaba la tabla · `mant_record_photos` 0/5 |
| MIPER | `prevention_risk_observations` 0/4 · `prevention_risk_review_rounds` 0/2 · `prevention_risk_programs` 1/2 |
| PDTP | `pdtp_obligations` 0/6 · `pdtp_scheduled_instances` 0/8 |
| Prevención | `prevention_privacy_requests` 0/6 · `prevention_emergency_drills` 0/6 · `sst_document_acks` 0/20 |
| Operaciones | `physical_inventory_counts` 0/2 · `feedback_reports` 2/8 · `repuesto_quotations` 0/5 · `service_quotations` 0/5 |
| Combustibles | `fuel_loads` 0/150 · `fuel_monthly_statements` 0/6 · `fuel_payments` 0/6 · `fuel_seal_movements` 0/20 · `fuel_anomaly_comments` 0/10 |
| Facturación | `clients` 0/6 · `contracts` 0/4 · `billing_invoice_items` 0/30 · `billing_invoice_payments` 2/8 · `billing_collection_actions` 0/5 · `billing_proposals` 0/3 |
| Flota | `fleet_gps_alert_rules` 0/3 · `fleet_gps_driver_mappings` 0/5 · `fleet_gps_position_history` 0/50 · `fleet_gps_trips` 0/8 · `fleet_vehicle_documents` 0/8 |
| Documentos SST | `sst_document_versions` 5/12 · `sst_document_acks` 0/20 |

La tabla `mant_historical_records` no existía: la migración `0370_marvelous_mentallo` estaba pendiente aunque el ledger tuviera 370 filas. Se aplicó sólo el migrador (`scripts/migrate.mjs`) sobre `bodega_dev`; no se corrieron backfills.

## Implementación

- `scripts/dev-seed/guard.ts`: guard compartido de base/host.
- `scripts/dev-seed/coverage.ts`: inventario exacto por tabla y dominio; distingue vacía, baja y tabla faltante.
- `scripts/dev-seed/index.ts`: orquestador `seed:dev` (dry-run), `seed:dev:apply` (`--apply --write-report`), `--only` y `--skip`.
- Sembradores: `combustibles`, `facturacion`, `operaciones`, `flota`, `ti`, `mantencion`, `miper`, `pdtp`, `prevencion`.
- `scripts/dev-seed/shared.ts`: PRNG determinista, fechas relativas a hoy, lotes de 500, carga de actores/faenas/trabajadores/vehículos.
- `scripts/seed-demo.ts` y `scripts/seed-inspecciones-demo.ts`: ahora usan el guard de desarrollo. En `seed-demo` el `TRUNCATE` quedó detrás de `--reset-demo`, para que una corrida normal no borre lo sembrado por `dev-seed`.
- Pruebas: `scripts/__tests__/dev-seed-guard.test.ts` (9 casos).
- **Integración con el deploy:** `deploy:dev` ejecuta el servicio one-shot `seed-dev` al final de las etapas de datos. El paso exige `DEPLOY_LABEL=dev` **y** que el destino no sea `/srv/plataforma`; `deploy:prod` usa ese path y no ejecuta el bloque aunque herede el label. El servicio recibe además `-e DEPLOY_LABEL=dev`; si alguien lo corre a mano contra el compose de producción, el label por defecto es `producción` y el guard rechaza el host `db`; si forzara el label, la denylist rechaza la base `bodega`.

## Cobertura final

Los 10 dominios quedan completos según `npm run seed:dev:status`.

| Tabla | Filas |
|---|---:|
| `fuel_loads` | 210 |
| `fuel_monthly_statements` | 6 |
| `fuel_payments` | 6 |
| `fuel_tae_submissions` | 3.298 |
| `fuel_seal_movements` | 80 |
| `fuel_anomaly_comments` | 10 |
| `clients` | 6 |
| `contracts` | 4 |
| `billing_invoice_items` | 80 |
| `billing_invoice_payments` | 12 |
| `billing_collection_actions` | 5 |
| `billing_proposals` | 3 |
| `it_assets` | 60 |
| `it_asset_types` | 7 |
| `it_tickets` | 120 |
| `it_licenses` | 15 |
| `it_access_systems` | 2 |
| `it_system_access` | 12 |
| `it_worker_checklists` | 4 |
| `it_checklist_tasks` | 20 |
| `it_license_assignments` | 50 (49 vigentes) |
| `mant_work_orders` | 36 |
| `mant_records` | 545 |
| `mant_historical_records` | 12 |
| `mant_record_photos` | 8 |
| `prevention_risk_matrices` | 3 |
| `prevention_risk_entries` | 540 |
| `prevention_risk_observations` | 4 |
| `prevention_risk_review_rounds` | 2 |
| `prevention_risk_programs` | 2 |
| `pdtp_obligations` | 8 |
| `pdtp_scheduled_instances` | 10 |
| `pdtp_executions` | 4.521 |
| `prevention_privacy_requests` | 6 |
| `prevention_emergency_drills` | 8 |
| `sst_document_versions` | 12 |
| `sst_document_acks` | 20 |
| `physical_inventory_counts` | 2 |
| `feedback_reports` | 8 |
| `repuesto_quotations` | 5 |
| `service_quotations` | 5 |
| `fleet_gps_alert_rules` | 4 |
| `fleet_gps_driver_mappings` | 5 |
| `fleet_gps_position_history` | 100 |
| `fleet_gps_trips` | 10 |
| `fleet_vehicle_documents` | 8 |
| `inventory_movements` | 724 |
| `purchase_requests` | 73 |

## Verificación

- **Typecheck:** `npm run typecheck` sin errores.
- **Lint:** `npm run lint` sin errores; sólo el warning preexistente de `lib/mantencion/client/ot-model.ts`.
- **Guard:** 6/6 pruebas. Se comprobó que `bodega` y un host remoto abortan antes de conectar.
- **Idempotencia:** una segunda corrida completa informó `0 filas insertadas`; los conteos no cambiaron.
- **Navegador:** 23 rutas con `next dev` local contra `bodega_dev`, sesión de administrador, 1440×900. Todas respondieron 200, sin errores de consola ni respuestas ≥ 400.
  - `/ti/activos`: 57 activos visibles.
  - `/ti/tickets`: 120 tickets, 3 nuevos.
  - `/mantencion/ot`: 19 abiertas y 15 cerradas.
  - `/mantencion/registros`: 542 registros vigentes.
  - `/prevencion/pdtp`: 2.362 ejecuciones aprobadas.
  - `/prevencion/privacidad/solicitudes`: 6 solicitudes.
  - `/prevencion/documentacion`: 15 filas y 10 acuses pendientes.
  - `/bodega`: 193 filas de stock y 724 movimientos.
  - `/facturacion`: $3.602.003.330 pendientes y 111 facturas vencidas.
  - `/combustibles/consumo/litros`: 1.433 L en 6 equipos.
  - `/flota`: 142 vehículos.
- Los textos “Sin datos” que aparecen en combustibles, facturación y flota son notas de cobertura de una fuente o de un período sin facturas, no pantallas vacías.

## Límites y advertencias

- **`bodega` no se tocó.** El guard la bloquea antes de conectar.
- **La app de :3001 usa otra base dev:** `plataforma-dev-app-1` apunta al volumen `plataforma-dev_bodega-db`, distinto de `bodega-dev-db` (5433). Esa base no se sembró; si se usa esa instancia, hay que ejecutar el mismo seed contra ella. La verificación en navegador se hizo con un `next dev` local contra `bodega_dev` (5433), que es el entorno confirmado.
- **Usuario temporal de QA:** se creó `dev-seed-admin` sólo para el recorrido, se eliminó al terminar y se restauró `playwright/.auth/monkeytest.json`.
- **Evidencia visual:** capturas locales en `qa/reports/evidence-seed-dev/` (ignoradas por git).
- **Sin commit:** los cambios quedaron en el working tree.

## Reproducir

```bash
npm run seed:dev:status     # inventario, sólo lectura
npm run seed:dev            # dry-run
npm run seed:dev:apply      # escribe en bodega_dev
```
