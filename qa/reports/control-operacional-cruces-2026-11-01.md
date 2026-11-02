# Verificación — Fase 1: combustible por activo en el Panel operacional

**Fecha:** 2026-11-01
**Alcance:** `/control-operacional`, hoja «Activos» del Excel y permisos de combustible.
**Estado:** implementado y verificado de forma determinista; la verificación de navegador quedó pendiente.

## Qué se implementó

- Nuevo agregado batch `getAssetFuelSummary` (`lib/combustibles/control/queries/asset-fuel-summary.ts`): litros operacionales, cantidad de cargas, rendimiento promedio, cargas por decidir, casos abiertos/críticos y costo facturado, por vehículo y en una sola consulta por dimensión.
- `OperationalAsset` incorpora esos campos; el hub los consulta sólo con `combustibles:view` y el monto sólo con `combustibles:view_costs`.
- La tabla y la tarjeta móvil muestran litros, rendimiento, cargas por decidir, casos abiertos y costo de combustible; agregan el enlace «Combustible» a la ficha de equipo.
- El Excel agrega las mismas columnas y los indicadores «Litros operacionales» y «Costo combustible facturado»; el costo operacional total sólo aparece si existen ambos costos.
- El glosario explica que los litros operacionales y el costo facturado son series distintas.

## Verificación ejecutada

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | Verde |
| `npm run lint` | Verde |
| Nuevo PGlite `operational-control-fuel-pglite.test.ts` | 5/5 |
| Unitarias del panel y export | 60/60 (5 archivos) |
| `git diff --check` | Sin errores |
| `npm run test:fast` | Ejecutada, pero **no verde**: 285 archivos y 2.168 pruebas fallan por `React.act is not a function` en pruebas de componentes ajenas al panel. El log no contiene fallas de `control-operacional` ni `operational-control`. |

La prueba PGlite cubre: suma de litros contables, exclusión de anuladas/duplicadas/rechazadas, rendimiento sin cargas marcadas, casos críticos, costo facturado, ausencia de montos sin `view_costs`, alcance por faena y período.

## Verificación no ejecutada

- **Navegador/E2E:** se agregó `e2e/control-operacional-combustible.spec.ts`, pero no se ejecutó. Playwright exige `E2E_DATABASE_URL` y `E2E_ALLOW_DESTRUCTIVE_RESET=true` sobre una base desechable; no se usó una base existente para no resetearla.
- **Anchos y accesibilidad:** no se recorrió el panel a 375/768/1440 px ni con lector de pantalla.
- **Consistencia entre pantallas:** no se comparó en navegador el panel contra `/combustibles/consumo/equipos/[id]` y `/flota` para el mismo vehículo y período.
- **Rol sin costos en navegador:** la redacción de montos está cubierta por la prueba PGlite, no por un usuario E2E con `mantenciones:view + combustibles:view` sin `view_costs`.

## Cómo cerrar la cobertura

```bash
E2E_DATABASE_URL=<base-desechable> E2E_ALLOW_DESTRUCTIVE_RESET=true \
  npx playwright test e2e/control-operacional-combustible.spec.ts
```

Después, recorrer `/control-operacional?desde=2026-10-01&hasta=2026-10-31` con:

- admin: columnas de combustible y enlace «Combustible»;
- rol con `mantenciones:view + combustibles:view` sin `view_costs`: sin montos;
- 375/768/1440 px: sin desborde fuera del `TableRoot`;
- export `.xlsx`: columnas y redacción por permiso.

## Riesgos conocidos

- El panel muestra dos series de combustible: litros operacionales (`fuel_equipment_loads`) y costo facturado (`fuel_loads`). No se suman; el glosario lo explicita.
- `fuel_anomaly_cases.vehicle_id` no tiene índice propio. Si el volumen crece, la consulta de casos por vehículo puede requerir una migración nueva.
- La suite rápida completa sigue bloqueada por una falla de entorno de `React.act`; no es un defecto de este cambio, pero impide usar esa puerta como evidencia global.
