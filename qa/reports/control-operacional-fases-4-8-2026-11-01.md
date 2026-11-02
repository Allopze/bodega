# Verificación — Fases 4–8 del Panel operacional

**Fecha:** 2026-11-01
**Alcance:** estado/detención/cobertura, mantención/SLA/plan, vencimientos y telemetría, equipos de servicio y gate de combustible.
**Estado:** implementado y verificado de forma determinista; la verificación de navegador/E2E quedó pendiente.

## Qué se implementó

- **Fase 4:** la detención se recorta al período; la disponibilidad excluye equipos inactivos; se agrega cobertura de estado (horas con historial / calendario de activos) y un `Callout` cuando la ficha y el intervalo abierto discrepan.
- **Fase 5:** costo aprobado separado del comprometido, OT fuera de SLA, OT sin responsable, adherencia a los planes preventivos y próximo plan por activo. La tira, la tabla, la tarjeta móvil y el Excel los muestran.
- **Fase 6:** próximo vencimiento y tipos vencidos por activo con el criterio canónico de Flota; última posición GPS por vehículo (`DISTINCT ON`), con odómetro, horómetro, nivel de estanque y fecha de observación. Quedaron deferidos el flag de discrepancia GPS ↔ lectura de carga y el motor en vacío por activo, a la espera de medir `dailyTelemetry`.
- **Fase 7:** los instrumentos de servicio se excluyen de la tabla y del Excel; se muestra un enlace compacto a Administración para quien tiene `admin:service_equipment`.
- **Fase 8:** `combustibles:view` abre el panel. Se actualizaron `lib/operational-control/capabilities.ts`, el guard del hub, `modules/flota/manifest.ts` y la prueba E2E de roles. Un usuario sólo de combustible ve el panel, el tile de revisión y las columnas de combustible, sin mantención, inspecciones ni costos.

## Verificación ejecutada

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | Verde |
| `npm run lint` | Verde |
| PGlite de las fases 1–6 | 19/19 (5 archivos) |
| Unitarias del panel/export/hub/fuentes/navegación | 101/101 (8 archivos) |
| `git diff --check` | Sin errores |

Cobertura PGlite nueva:

- estado: downtime recortado (24 h + 48 h), disponibilidad sin inactivos, cobertura y desajuste ficha ↔ intervalo;
- mantención: costo comprometido 2.000 vs aprobado 700, SLA, sin responsable y adherencia 50 %;
- documentos/GPS: columna canónica sobre documento, tipos vencidos y última telemetría entre dos dispositivos.

## Verificación no ejecutada

- **Navegador/E2E:** no se ejecutó la suite. `control-operacional-navegacion.spec.ts` fue actualizado para el rol `combustible_sin_costos`, pero no se corrió contra una base desechable.
- **Densidad y desborde:** la tabla suma vencimiento, GPS, SLA, responsable, plan y costo aprobado. No se verificó a 375/768/1440 px que el scroll horizontal de `TableRoot` siga siendo usable.
- **Consistencia entre pantallas:** no se comparó en navegador contra `/flota`, `/prevención` ni `/combustibles/fuentes`.
- **Performance:** no se midió el costo de documentos, GPS, hallazgos, CAPA y planes en cada carga del panel.
- **Gate de combustible:** la apertura del panel a `combustibles:view` está cubierta por código y E2E escrito, no ejecutado.

## Riesgos conocidos

- La tabla es ahora muy ancha. Si el scroll horizontal resulta incómodo, la salida correcta es una vista de detalle por activo, no eliminar dimensiones.
- El panel consulta documentos y GPS para todos los vehículos del alcance; si la flota crece, conviene medir y eventualmente paginar.
- Un fallo al cargar documentos deja el próximo vencimiento vacío sin una señal explícita de degradación; el tile de atención sí queda en `null`.
- El panel abre a roles sólo de combustible por decisión de producto; las columnas de otros dominios siguen ocultas por capacidad.

## Cómo cerrar la cobertura

```bash
E2E_DATABASE_URL=<base-desechable> E2E_ALLOW_DESTRUCTIVE_RESET=true \
  npx playwright test e2e/control-operacional-navegacion.spec.ts
```

Después, recorrer `/control-operacional?desde=2026-03-01&hasta=2026-03-31` con admin, un rol sólo de combustible y un rol sólo de inspecciones; verificar columnas por capacidad, 375/768/1440 px y el Excel.
