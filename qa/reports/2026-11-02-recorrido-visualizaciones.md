# Recorrido en navegador: densidad de tablas, KPI y gráficos — 2 de noviembre de 2026

Evidencia del recorrido asistido de la auditoría [AUDITORIA_VISUALIZACIONES_CHOME.md](../../AUDITORIA_VISUALIZACIONES_CHOME.md). **No es una auditoría funcional**: no se ejecutaron acciones ni mutaciones, sólo se cargó cada ruta y se midió lo que se ve.

## Entorno

- `next dev` en `:3001`, rama `main` @ `d29767f66`, base `bodega_dev` (127.0.0.1:5433).
- Sesión QA `playwright/.auth/monkeytest.json` y Chromium de `@playwright/test`. Viewport 1440 × 900; capturas adicionales a 1440 × 2400 y 390 × 844.
- Primer recorrido: `bodega_dev` tenía **367 de las 370 migraciones** del journal; faltaba la 0369 (`mant_work_orders`).
- Segundo recorrido, el mismo día: `bodega_dev` migrada a 370/370, después de retirar 2 OT `QA_` del módulo antiguo y los residuos de Aramco con `scripts/retire-aramco.ts`.

## Alcance

- **Recorridas:** las 198 rutas estáticas de `app/(app)` (las `page.tsx` sin segmentos dinámicos).
- **No recorridas:**
  - las rutas dinámicas (`[id]`, `[programId]`…);
  - los modales, pestañas no activas y pliegues `<details>` (no se abrieron);
  - otros roles: sólo se usó la sesión QA.
- **Resultado del alcance:** 100 % de las rutas estáticas descubiertas fueron procesadas. Esto **no** equivale a haber recorrido el 100 % de la aplicación.

## Qué se midió por ruta

Medido dentro de `#main-content`, contando sólo elementos visibles:

- tablas, filas de cuerpo y máximo de columnas;
- gráficos recharts (`svg.recharts-surface`);
- tiles `KpiCard` (`[data-kpi-card]`);
- cifras numéricas en el texto;
- errores de consola.

## Resultado

| Medida | Valor |
|---|---|
| Rutas | 198 · HTTP 200 en todas |
| Con error de entorno («Algo salió mal») | 5: `/flota`, `/mantencion`, `/mantencion/equipos`, `/mantencion/ot`, `/mantencion/panel`. Causa: `relation "mant_work_orders" does not exist` (migración 0369 sin aplicar en `bodega_dev`). **No es un defecto del producto** |
| Rutas válidas | 193 |
| Con tabla visible | 91 |
| Con gráfico visible | 6 (3 son la misma bandeja de combustible vía redirección) |
| Tabla sin gráfico | 90 |
| Tablas / filas / gráficos / tiles | 97 / 1.363 / 20 / 47 |

## Clasificación

| Hallazgo | Clase | Evidencia |
|---|---|---|
| `/prevencion/pdtp`: «Avance anual por faena» sin barras visibles (0 % sin rótulo) | UX FINDING | captura de 1440 px |
| `/prevencion/capacitacion`: 2.730 tarjetas en una página (11.558 cifras) | UX FINDING | métrica y captura |
| `/analitica`: baja de 100 % del gasto mostrada en rojo | PRODUCT BUG (semántica de delta) | captura; `analitica/page.tsx:104-114`, `kpi-card.tsx:28` |
| `/control-operacional`: disponibilidad 100 % junto a una cobertura de estado de 20,8 % | FUNCTIONAL FINDING (riesgo de interpretación) | captura |
| `/prevencion/pdtp/aprobaciones`: error de hidratación (`pdtp-evidence-thumbs.tsx:112`) | FUNCTIONAL FINDING (fuera del alcance de visualización) | log del servidor |
| `/combustibles/consumo/*`: estado vacío en el período por defecto | COVERAGE GAP (datos de desarrollo) | captura |
| 5 rutas de mantención y flota no cargan (primer recorrido) | AUTOMATION WARNING / entorno. **Resuelto**: en el segundo recorrido cargan sin errores | log del servidor |
| `/mantencion/panel`: «Mantenciones vencidas: 0» cuando ningún equipo es evaluable | UX FINDING (A1) | captura del segundo recorrido |
| `/flota/[id]`: «Rendimiento» muestra sólo «km/L», sin valor | UX FINDING | captura del segundo recorrido |
| Mantención sin registros ni OT en `bodega_dev` | COVERAGE GAP (datos de desarrollo) | 0 filas en `mant_records` y `mant_work_orders` |
| Avatares de `api.dicebear.com` | Ruido conocido (sandbox sin internet) | consola |

## Capturas

Las capturas no se versionan: muestran el nombre y el correo del usuario QA y datos operativos (patentes y textos de pendientes). Se describen en la sección H de la auditoría.

## Segundo recorrido (después de migrar)

| Ruta | HTTP | Tablas | Filas | Cols. máx. | Gráficos | Tiles KPI | Cifras | Errores consola |
|---|---|---|---|---|---|---|---|---|
| `/flota` | 200 | 1 | 25 | 7 | 0 | 0 | 141 | 0 |
| `/mantencion` (→ panel) | 200 | 1 | 8 | 3 | 0 | 4 | 20 | 0 |
| `/mantencion/panel` | 200 | 1 | 8 | 3 | 0 | 4 | 20 | 0 |
| `/mantencion/equipos` | 200 | 1 | 50 | 7 | 0 | 0 | 204 | 0 |
| `/mantencion/ot` | 200 | 0 | 0 | 0 | 0 | 0 | 8 | 0 |
| `/control-operacional` | 200 | 1 | 25 | 16 | 0 | 4 | 269 | 0 |
| `/flota/[id]` | 200 | 0 | 0 | 0 | 0 | 0 | 7 | 0 |
| `/mantencion/equipos/[id]` | 200 | 0 | 0 | 0 | 0 | 0 | 16 | 0 |
| `/combustibles/consumo/equipos/[id]` | 200 | 0 | 0 | 0 | 0 | 0 | 13 | 0 |

## Métricas por ruta (primer recorrido)

| Ruta | HTTP | Tablas | Filas | Cols. máx. | Gráficos | Tiles KPI | Cifras | Errores consola |
|---|---|---|---|---|---|---|---|---|
| `/admin` | 200 | 0 | 0 | 0 | 0 | 4 | 0 | 0 |
| `/admin/almacenamiento` | 200 | 0 | 0 | 0 | 0 | 0 | 9 | 0 |
| `/admin/auditoria` | 200 | 1 | 30 | 6 | 0 | 0 | 201 | 0 |
| `/admin/backups` | 200 | 0 | 0 | 0 | 0 | 0 | 7 | 0 |
| `/admin/cargos` | 200 | 1 | 2 | 5 | 0 | 0 | 8 | 0 |
| `/admin/catalogos-productos` | 200 | 1 | 16 | 5 | 0 | 0 | 0 | 0 |
| `/admin/centros-costo` | 200 | 1 | 1 | 5 | 0 | 0 | 0 | 0 |
| `/admin/configuracion` | 200 | 0 | 0 | 0 | 0 | 0 | 7 | 0 |
| `/admin/contenedores` | 200 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/admin/correo-smtp` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/admin/desviaciones` | 200 | 1 | 1 | 5 | 0 | 0 | 0 | 0 |
| `/admin/dte` | 200 | 1 | 30 | 8 | 0 | 0 | 303 | 0 |
| `/admin/epps` | 200 | 1 | 8 | 8 | 0 | 0 | 38 | 0 |
| `/admin/equipos` | 200 | 1 | 5 | 7 | 0 | 0 | 12 | 0 |
| `/admin/escenarios-emergencia` | 200 | 1 | 20 | 5 | 0 | 0 | 40 | 0 |
| `/admin/faenas` | 200 | 1 | 18 | 5 | 0 | 0 | 6 | 0 |
| `/admin/flota-catalogos` | 200 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |
| `/admin/flota-catalogos/estanques-combustible` | 200 | 1 | 3 | 6 | 0 | 0 | 12 | 0 |
| `/admin/flota-catalogos/productos-combustible` | 200 | 1 | 5 | 6 | 0 | 0 | 5 | 0 |
| `/admin/flota-catalogos/proveedores-combustible` | 200 | 1 | 1 | 7 | 0 | 0 | 2 | 0 |
| `/admin/flota-catalogos/tipos-equipo` | 200 | 1 | 18 | 7 | 0 | 0 | 22 | 0 |
| `/admin/flota-catalogos/vehiculos` | 200 | 1 | 25 | 8 | 0 | 0 | 61 | 0 |
| `/admin/folios` | 200 | 1 | 9 | 6 | 0 | 0 | 35 | 0 |
| `/admin/inventario-faena` | 200 | 0 | 0 | 0 | 0 | 0 | 6 | 0 |
| `/admin/modulos` | 200 | 0 | 0 | 0 | 0 | 0 | 44 | 0 |
| `/admin/notificaciones` | 200 | 1 | 25 | 5 | 0 | 0 | 202 | 0 |
| `/admin/parametros-operativos` | 200 | 1 | 6 | 2 | 0 | 0 | 19 | 0 |
| `/admin/pdtp-catalogos` | 200 | 1 | 20 | 5 | 0 | 0 | 58 | 0 |
| `/admin/plantillas` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/admin/productos` | 200 | 1 | 25 | 8 | 0 | 0 | 124 | 0 |
| `/admin/productos/nuevo` | 200 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |
| `/admin/proveedores` | 200 | 1 | 3 | 6 | 0 | 0 | 9 | 0 |
| `/admin/roles` | 200 | 1 | 18 | 5 | 0 | 0 | 21 | 0 |
| `/admin/seguridad` | 200 | 1 | 1 | 6 | 0 | 0 | 12 | 0 |
| `/admin/suplencias` | 200 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/admin/taxonomia-sst` | 200 | 2 | 18 | 4 | 0 | 0 | 2 | 0 |
| `/admin/tipos-activo` | 200 | 1 | 3 | 6 | 0 | 0 | 3 | 0 |
| `/admin/trabajadores` | 200 | 1 | 25 | 6 | 0 | 0 | 61 | 0 |
| `/admin/usuarios` | 200 | 1 | 16 | 6 | 0 | 0 | 68 | 0 |
| `/analitica` | 200 | 0 | 0 | 0 | 0 | 4 | 21 | 0 |
| `/aprobaciones` | 200 | 0 | 0 | 0 | 0 | 0 | 13 | 0 |
| `/bodega` | 200 | 1 | 3 | 5 | 0 | 0 | 21 | 0 |
| `/bodega/documentos` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/bodega/guias` | 200 | 1 | 5 | 7 | 0 | 0 | 30 | 0 |
| `/bodega/guias/nueva` | 200 | 1 | 12 | 7 | 0 | 0 | 57 | 0 |
| `/bodega/trazabilidad` | 200 | 1 | 25 | 9 | 0 | 4 | 138 | 0 |
| `/bodega/trazabilidad/documento` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles` | 200 | 0 | 0 | 0 | 0 | 0 | 47 | 0 |
| `/combustibles/ajustes` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/ajustes/familias` | 200 | 1 | 18 | 3 | 0 | 0 | 20 | 0 |
| `/combustibles/ajustes/integraciones` | 200 | 0 | 0 | 0 | 0 | 0 | 11 | 0 |
| `/combustibles/ajustes/mandantes` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/ajustes/medios` | 200 | 1 | 5 | 7 | 0 | 0 | 5 | 0 |
| `/combustibles/ajustes/puntos-de-carga` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/ajustes/reglas` | 200 | 2 | 44 | 6 | 0 | 0 | 32 | 0 |
| `/combustibles/ajustes/umbrales` | 200 | 0 | 0 | 0 | 0 | 0 | 10 | 0 |
| `/combustibles/analisis` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/anomalias` | 200 | 0 | 0 | 0 | 5 | 0 | 51 | 0 |
| `/combustibles/anomalias/reglas` | 200 | 2 | 44 | 6 | 0 | 0 | 32 | 0 |
| `/combustibles/bitacora` | 200 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/combustibles/cargas` | 200 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/combustibles/cargas/registrar` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/cargas/tarjetas` | 200 | 1 | 1 | 11 | 0 | 0 | 1 | 0 |
| `/combustibles/ciclo` | 200 | 1 | 3 | 6 | 0 | 4 | 17 | 0 |
| `/combustibles/consumo` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/consumo/litros` | 200 | 0 | 0 | 0 | 0 | 0 | 15 | 0 |
| `/combustibles/consumo/motor-en-vacio` | 200 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |
| `/combustibles/control` | 200 | 0 | 0 | 0 | 0 | 0 | 15 | 0 |
| `/combustibles/control/configuracion` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/control/importar` | 200 | 1 | 6 | 7 | 0 | 0 | 74 | 0 |
| `/combustibles/control/ralenti` | 200 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |
| `/combustibles/control/registrar` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/control/revision` | 200 | 0 | 0 | 0 | 0 | 0 | 13 | 0 |
| `/combustibles/control/sellos` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/cuadratura` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/cuadratura/estanques` | 200 | 1 | 3 | 6 | 0 | 4 | 17 | 0 |
| `/combustibles/cuadratura/mandante` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/cuadratura/proveedor` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/cuadratura/sellos` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/cuadratura/tarjeta-y-terreno` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/cuenta-corriente` | 200 | 1 | 1 | 9 | 0 | 0 | 1 | 0 |
| `/combustibles/facturas` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/fuentes` | 200 | 1 | 6 | 7 | 0 | 0 | 74 | 0 |
| `/combustibles/fuentes/agregar/planilla` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/fuentes/agregar/sellos` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/fuentes/agregar/tarjeta` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/fuentes/archivos` | 200 | 1 | 24 | 7 | 0 | 0 | 283 | 0 |
| `/combustibles/importar` | 200 | 1 | 6 | 7 | 0 | 0 | 74 | 0 |
| `/combustibles/nueva` | 200 | 0 | 0 | 0 | 0 | 0 | 5 | 0 |
| `/combustibles/pagos` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/pagos/estados` | 200 | 1 | 1 | 9 | 0 | 0 | 1 | 0 |
| `/combustibles/pagos/nueva` | 200 | 0 | 0 | 0 | 0 | 0 | 5 | 0 |
| `/combustibles/proveedores-combustible` | 200 | 1 | 1 | 7 | 0 | 0 | 2 | 0 |
| `/combustibles/reportes` | 200 | 0 | 0 | 0 | 0 | 0 | 15 | 0 |
| `/combustibles/revisar` | 200 | 0 | 0 | 0 | 5 | 0 | 51 | 0 |
| `/combustibles/revision` | 200 | 0 | 0 | 0 | 5 | 0 | 51 | 0 |
| `/combustibles/sellos` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/tae` | 200 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| `/combustibles/tae/conciliacion` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/tae/importar` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/tae/importar/historial` | 200 | 0 | 0 | 0 | 0 | 0 | 7 | 0 |
| `/combustibles/vehiculos` | 200 | 1 | 25 | 8 | 0 | 0 | 61 | 0 |
| `/compras` | 200 | 2 | 13 | 10 | 0 | 0 | 76 | 0 |
| `/compras/dte` | 200 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| `/compras/nueva` | 200 | 0 | 0 | 0 | 0 | 0 | 84 | 0 |
| `/control-operacional` | 200 | 1 | 25 | 16 | 0 | 4 | 245 | 1 |
| `/dashboard` | 200 | 0 | 0 | 0 | 1 | 3 | 95 | 0 |
| `/entregas` | 200 | 1 | 25 | 7 | 0 | 0 | 185 | 0 |
| `/facturacion` | 200 | 1 | 5 | 3 | 0 | 4 | 75 | 0 |
| `/facturacion/clientes` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/facturacion/cobranza` | 200 | 1 | 89 | 8 | 0 | 0 | 720 | 0 |
| `/facturacion/duplicados` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/facturacion/facturas` | 200 | 1 | 50 | 11 | 0 | 0 | 713 | 0 |
| `/facturacion/pendientes` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/facturacion/propuestas` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/facturacion/sincronizacion` | 200 | 1 | 30 | 11 | 0 | 0 | 512 | 0 |
| `/flota` | error de entorno | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| `/flota/monitoreo` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/forbidden` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/mantencion` | error de entorno | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| `/mantencion/dispositivos` | 200 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/mantencion/equipos` | error de entorno | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| `/mantencion/equipos/importar` | 200 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| `/mantencion/equipos/nuevo` | 200 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| `/mantencion/ot` | error de entorno | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| `/mantencion/panel` | error de entorno | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| `/mantencion/pautas` | 200 | 1 | 2 | 6 | 0 | 0 | 13 | 0 |
| `/mantencion/registros` | 200 | 0 | 0 | 0 | 0 | 0 | 5 | 0 |
| `/modulo-inactivo` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/pendientes` | 200 | 1 | 50 | 7 | 0 | 0 | 311 | 0 |
| `/perfil` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion` | 200 | 0 | 0 | 0 | 0 | 0 | 9 | 0 |
| `/prevencion/alcotest` | 200 | 0 | 0 | 0 | 0 | 0 | 3 | 0 |
| `/prevencion/campanas` | 200 | 1 | 35 | 6 | 0 | 0 | 7 | 0 |
| `/prevencion/capa` | 200 | 1 | 5 | 6 | 0 | 0 | 24 | 0 |
| `/prevencion/capacitacion` | 200 | 0 | 0 | 0 | 0 | 0 | 11558 | 0 |
| `/prevencion/cgrd` | 200 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| `/prevencion/cgrd/mapa` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/constancias` | 200 | 0 | 0 | 0 | 0 | 0 | 50 | 0 |
| `/prevencion/coordinacion` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/cphs` | 200 | 0 | 0 | 0 | 0 | 0 | 10 | 0 |
| `/prevencion/documentacion` | 200 | 1 | 7 | 6 | 0 | 0 | 35 | 0 |
| `/prevencion/documentacion/papelera` | 200 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/prevencion/documentacion/regularizacion` | 200 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| `/prevencion/emergencias` | 200 | 1 | 7 | 5 | 0 | 0 | 40 | 0 |
| `/prevencion/epp-preventivo` | 200 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| `/prevencion/evaluaciones` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/faenas` | 200 | 1 | 18 | 5 | 0 | 0 | 46 | 0 |
| `/prevencion/higiene` | 200 | 0 | 0 | 0 | 0 | 0 | 6 | 0 |
| `/prevencion/incidentes` | 200 | 1 | 1 | 5 | 0 | 0 | 4 | 0 |
| `/prevencion/incidentes/configuracion` | 200 | 1 | 50 | 6 | 0 | 0 | 131 | 0 |
| `/prevencion/incidentes/reportar` | 200 | 0 | 0 | 0 | 0 | 0 | 7 | 0 |
| `/prevencion/indicadores` | 200 | 1 | 12 | 6 | 0 | 0 | 51 | 0 |
| `/prevencion/indicadores-material-ambiental` | 200 | 1 | 12 | 5 | 0 | 0 | 53 | 0 |
| `/prevencion/inspecciones` | 200 | 1 | 5 | 6 | 0 | 0 | 36 | 0 |
| `/prevencion/inspecciones/plantillas` | 200 | 1 | 19 | 6 | 0 | 0 | 74 | 0 |
| `/prevencion/inspecciones/programacion` | 200 | 1 | 5 | 6 | 0 | 0 | 23 | 0 |
| `/prevencion/inspecciones/seguimiento` | 200 | 1 | 8 | 6 | 0 | 0 | 83 | 0 |
| `/prevencion/miper` | 200 | 1 | 18 | 4 | 0 | 0 | 10 | 0 |
| `/prevencion/miper/factores` | 200 | 1 | 11 | 6 | 0 | 0 | 22 | 0 |
| `/prevencion/nueva` | 200 | 0 | 0 | 0 | 0 | 0 | 217 | 0 |
| `/prevencion/pdtp` | 200 | 0 | 0 | 0 | 2 | 4 | 33 | 0 |
| `/prevencion/pdtp/acciones` | 200 | 1 | 1 | 10 | 0 | 0 | 0 | 0 |
| `/prevencion/pdtp/actividades` | 200 | 1 | 31 | 7 | 0 | 0 | 158 | 0 |
| `/prevencion/pdtp/aplicabilidad` | 200 | 1 | 87 | 7 | 0 | 0 | 125 | 0 |
| `/prevencion/pdtp/aprobaciones` | 200 | 1 | 15 | 3 | 0 | 0 | 71 | 0 |
| `/prevencion/pdtp/cierres` | 200 | 0 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/prevencion/pdtp/cobertura` | 200 | 0 | 0 | 0 | 0 | 0 | 112 | 0 |
| `/prevencion/pdtp/nuevo` | 200 | 0 | 0 | 0 | 0 | 0 | 11 | 0 |
| `/prevencion/pdtp/obligaciones` | 200 | 0 | 0 | 0 | 0 | 0 | 290 | 0 |
| `/prevencion/pdtp/plantillas` | 200 | 0 | 0 | 0 | 0 | 0 | 25 | 0 |
| `/prevencion/pdtp/programas` | 200 | 0 | 0 | 0 | 0 | 0 | 14 | 0 |
| `/prevencion/permisos` | 200 | 1 | 1 | 7 | 0 | 0 | 4 | 0 |
| `/prevencion/ppa` | 200 | 1 | 1 | 6 | 0 | 0 | 14 | 0 |
| `/prevencion/privacidad` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/privacidad/auditoria` | 200 | 2 | 2 | 6 | 0 | 0 | 18 | 0 |
| `/prevencion/privacidad/solicitudes` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/requisitos-legales` | 200 | 0 | 0 | 0 | 0 | 0 | 7 | 0 |
| `/recepcion` | 200 | 1 | 12 | 7 | 0 | 0 | 57 | 0 |
| `/recepcion/nueva` | 200 | 1 | 12 | 7 | 0 | 0 | 57 | 0 |
| `/reportes` | 200 | 0 | 0 | 0 | 0 | 0 | 39 | 0 |
| `/seguimiento` | 200 | 1 | 25 | 9 | 0 | 4 | 138 | 0 |
| `/solicitudes` | 200 | 1 | 25 | 9 | 0 | 0 | 135 | 0 |
| `/solicitudes/nueva` | 200 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| `/soporte` | 200 | 1 | 2 | 7 | 0 | 0 | 12 | 0 |
| `/soporte/nuevo` | 200 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| `/ti` | 200 | 2 | 14 | 5 | 2 | 4 | 44 | 0 |
| `/ti/accesos` | 200 | 1 | 2 | 3 | 0 | 0 | 2 | 0 |
| `/ti/activos` | 200 | 1 | 6 | 8 | 0 | 0 | 31 | 0 |
| `/ti/asignaciones` | 200 | 1 | 2 | 8 | 0 | 0 | 24 | 0 |
| `/ti/bajas` | 200 | 1 | 3 | 8 | 0 | 0 | 17 | 0 |
| `/ti/garantias` | 200 | 1 | 4 | 7 | 0 | 0 | 56 | 0 |
| `/ti/licencias` | 200 | 0 | 0 | 0 | 0 | 0 | 21 | 0 |
| `/ti/mantenciones` | 200 | 1 | 2 | 8 | 0 | 0 | 29 | 0 |
| `/ti/reportes` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/ti/tickets` | 200 | 1 | 4 | 8 | 0 | 0 | 52 | 0 |
| `/trazabilidad` | 200 | 1 | 25 | 9 | 0 | 4 | 138 | 0 |
| `/trazabilidad/documento` | 200 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |