# Verificación — Fase 3: inspecciones, hallazgos y CAPA en el Panel operacional

**Fecha:** 2026-11-01
**Alcance:** tabla de activos, tarjeta móvil, Excel y permisos de inspecciones/CAPA.
**Estado:** implementado y verificado de forma determinista; la verificación de navegador quedó pendiente.

## Qué se implementó

- El agregado de inspecciones del período suma no conformes y parciales, y promedia el cumplimiento de las runs no canceladas.
- Los hallazgos abiertos (`open` o `capa_linked`) se cuentan por activo sin recortarse al período: un hallazgo crítico anterior sigue siendo trabajo vigente.
- Las CAPA vencidas se cuentan sólo si están vinculadas a hallazgos de inspección, no están cerradas ni canceladas y su fecha objetivo ya pasó. La consulta y la columna se omiten sin `prevention:inspections:view` o sin `prevention:capa:view`: una sin la otra no produce una columna vacía.
- La tabla muestra «Inspecciones», «Cumplimiento inspecciones» y «Hallazgos abiertos», con el crítico como marca discreta y el detalle de no conformes/parciales en el `title`. «CAPA vencidas» aparece como columna propia.
- La tarjeta móvil muestra las mismas tres dimensiones y el Excel agrega columnas e indicadores de hallazgos y CAPA.

## Verificación ejecutada

| Puerta | Resultado |
|---|---|
| `npm run typecheck` | Verde |
| `npm run lint` | Verde |
| PGlite `operational-control-inspections-pglite.test.ts` | 4/4 |
| Unitarias del panel/export/hub/fuentes | 70/70 (6 archivos) |

La prueba PGlite cubre: run cancelada que no suma inspección, no conformes ni cumplimiento; hallazgo cerrado y hallazgo de run cancelada que no cuentan; CAPA vencida vs. CAPA con fecha futura; ausencia de CAPA sin `prevention:capa:view`; ausencia de todas las métricas sin `prevention:inspections:view`, incluso con `prevention:capa:view`; y alcance por faena.

## Verificación no ejecutada

- **Navegador/E2E:** no se recorrió la tabla con las nuevas columnas a 375/768/1440 px. La tabla ahora tiene más columnas y depende del scroll horizontal de `TableRoot`; no se midió el desborde real.
- **Consistencia con Prevención:** no se comparó en navegador el conteo de hallazgos/CAPA del panel contra las pantallas de Prevención para el mismo vehículo.
- **Permiso CAPA en UI:** la omisión de la columna sin `prevention:capa:view` (o sin `prevention:inspections:view`) está cubierta por PGlite y por las pruebas del export, no por un usuario E2E.
- **Performance:** no se midió el costo de las consultas de hallazgos/CAPA en cada carga del panel.

## Cómo cerrar la cobertura

```bash
E2E_DATABASE_URL=<base-desechable> E2E_ALLOW_DESTRUCTIVE_RESET=true \
  npx playwright test e2e/control-operacional-navegacion.spec.ts
```

Después, recorrer `/control-operacional?desde=2026-03-01&hasta=2026-03-31`:

- admin: columnas de inspecciones, cumplimiento, hallazgos y CAPA;
- rol con `prevention:inspections:view` sin `prevention:capa:view`: sin columna CAPA;
- 375/768/1440 px: la tabla desplaza dentro de `TableRoot` sin desbordar el pozo;
- comparar los conteos con las pantallas de Prevención del mismo vehículo;
- medir el tiempo de carga del panel.

## Riesgos conocidos

- «Hallazgos abiertos» es trabajo vigente, no una cifra del período; el glosario lo explicita, pero el título de la sección («Activos y trabajo del período») puede invitar a leerlo como período.
- La CAPA se cuenta por el vínculo `finding.capaActionId`; una CAPA abierta vinculada a un hallazgo ya cerrado seguiría contando como vencida, que es el criterio actual.
- La tabla suma columnas; si el ancho se vuelve incómodo, la alternativa es una vista de detalle por activo, no reducir la información.
