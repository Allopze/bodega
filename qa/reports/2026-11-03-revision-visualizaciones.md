# Revisión del recorrido de visualizaciones con datos — 3 de noviembre de 2026

Evidencia de la revisión de [AUDITORIA_VISUALIZACIONES_CHOME.md](../../AUDITORIA_VISUALIZACIONES_CHOME.md). Complementa el [recorrido del 2 de noviembre](2026-11-02-recorrido-visualizaciones.md), que se hizo sobre la base de desarrollo anterior. **No es una auditoría funcional**: no se ejecutaron acciones; sólo se cargó cada ruta y se midió lo visible.

## Entorno

- `next dev` en `:3001`, rama `fix/seed-faenas-y-defectos-sst` (las tres correcciones del Anexo C de la auditoría; nada de visualización cambió).
- `bodega_dev` es un **clon de producción del 2026-11-02 más datos simulados** (ids `mock-…`, texto `QA_mock`) en los módulos que en producción están vacíos: mantención, combustible en terreno, TI, incidentes, CAPA, PPA, alcotest, horas hombre, CPHS, higiene, permisos, recursos de emergencia, inspecciones y capacitación.
- Los volúmenes de producción salen de un restore íntegro y separado, sin datos simulados (Anexo B de la auditoría).
- Sesión QA `playwright/.auth/monkeytest.json`, Chromium de `@playwright/test`, 1440 × 900 px. Tope de 60 s por ruta.

## Alcance

- **Recorrido:** las 198 rutas estáticas de `app/(app)` y 27 fichas `[id]`, una por tipo de registro con datos.
- **No recorrido:** modales, pestañas inactivas, pliegues `<details>`, acciones y roles distintos del QA.
- **Cobertura:** se procesó el 100 % de las rutas estáticas descubiertas y de las fichas seleccionadas. Eso **no** equivale a recorrer toda la aplicación.

## Resultado

| Medida | Valor |
|---|---|
| Rutas estáticas únicas (sin contar las 35 redirecciones a otra ya medida) | 163 |
| Con tabla visible | 94 |
| Con gráfico visible al abrir | 7 |
| Fichas medidas / con gráfico | 27 / 1 |
| Cortes por tiempo | 1 (`/flota/monitoreo`) |
| Errores de consola | 3, todos de la CSP que bloquea `tiles.openfreemap.org` (estilo del mapa) |

## Clasificación

| Hallazgo | Clase | Evidencia |
|---|---|---|
| `/flota/monitoreo` no termina de cargar: la CSP (`connect-src 'self'`) bloquea el estilo del mapa en desarrollo | FUNCTIONAL FINDING (en producción no verificado) | consola; `lib/security/csp.ts:54`, `fleet-gps-map.tsx:7` |
| `/analitica` con datos: alza de gasto de 133 % pintada en verde | PRODUCT BUG (semántica del delta) | captura `2026-11-03-visualizaciones/a-analitica.png` |
| `/analitica`: tendencia mensual de un solo punto con la ventana por defecto | UX FINDING | misma captura |
| `/analitica`: combustible en $0 aunque existen transacciones Copec | FUNCTIONAL FINDING (fuente del dato) | `analytics-module/dashboard.ts:143-175` lee `fuel_loads` (0 filas en producción) |
| `/aprobaciones` vacía al momento del clon | Cobertura: la cola es una foto; la espera real se midió en la base (P50 8,3 h, P90 6 días) | captura `h5-aprobaciones.png` |
| Las pantallas de mantención, higiene, incidentes y cargas en terreno muestran datos simulados | COVERAGE GAP (producción vacía) | Anexo B de la auditoría |

## Capturas

Capturas anonimizadas en [2026-11-03-visualizaciones/](2026-11-03-visualizaciones/), sólo en este checkout: el `.gitignore` excluye a propósito las imágenes de `qa/`. Antes de cada captura se reemplazaron en la página los nombres de usuarios, trabajadores y conductores, los correos y las patentes, y se ocultaron los avatares.

## Rutas estáticas

| Ruta | Redirige a | HTTP | Tablas | Filas | Gráficos | Tiles KPI | Cifras | Errores consola |
|---|---|---|---|---|---|---|---|---|
| `/admin` |  | 200 | 0 | 0 | 0 | 4 | 2 | 0 |
| `/admin/almacenamiento` |  | 200 | 0 | 0 | 0 | 0 | 9 | 0 |
| `/admin/auditoria` |  | 200 | 1 | 30 | 0 | 0 | 190 | 0 |
| `/admin/backups` |  | 200 | 1 | 12 | 0 | 0 | 109 | 0 |
| `/admin/cargos` |  | 200 | 1 | 2 | 0 | 0 | 8 | 0 |
| `/admin/<id>` |  | 200 | 1 | 16 | 0 | 0 | 0 | 0 |
| `/admin/centros-costo` |  | 200 | 1 | 1 | 0 | 0 | 0 | 0 |
| `/admin/configuracion` |  | 200 | 0 | 0 | 0 | 0 | 7 | 0 |
| `/admin/contenedores` |  | 200 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/admin/correo-smtp` |  | 200 | 0 | 0 | 0 | 0 | 5 | 0 |
| `/admin/desviaciones` |  | 200 | 1 | 1 | 0 | 0 | 0 | 0 |
| `/admin/dte` |  | 200 | 1 | 30 | 0 | 0 | 305 | 0 |
| `/admin/epps` |  | 200 | 1 | 20 | 0 | 0 | 159 | 0 |
| `/admin/equipos` |  | 200 | 1 | 7 | 0 | 0 | 16 | 0 |
| `/admin/<id>` |  | 200 | 1 | 20 | 0 | 0 | 40 | 0 |
| `/admin/faenas` |  | 200 | 1 | 20 | 0 | 0 | 6 | 0 |
| `/admin/<id>` |  | 200 | 0 | 0 | 0 | 0 | 3 | 0 |
| `/admin/<id>/<id>` |  | 200 | 1 | 4 | 0 | 0 | 17 | 0 |
| `/admin/<id>/<id>` |  | 200 | 1 | 5 | 0 | 0 | 5 | 0 |
| `/admin/<id>/<id>` |  | 200 | 1 | 1 | 0 | 0 | 3 | 0 |
| `/admin/<id>/tipos-equipo` |  | 200 | 1 | 18 | 0 | 0 | 22 | 0 |
| `/admin/<id>/vehiculos` |  | 200 | 1 | 25 | 0 | 0 | 61 | 0 |
| `/admin/folios` |  | 200 | 1 | 10 | 0 | 0 | 39 | 0 |
| `/admin/<id>` |  | 200 | 1 | 59 | 0 | 0 | 564 | 0 |
| `/admin/modulos` |  | 200 | 0 | 0 | 0 | 0 | 44 | 0 |
| `/admin/notificaciones` |  | 200 | 1 | 25 | 0 | 0 | 189 | 0 |
| `/admin/<id>` |  | 200 | 1 | 6 | 0 | 0 | 19 | 0 |
| `/admin/pdtp-catalogos` |  | 200 | 1 | 1 | 0 | 0 | 0 | 0 |
| `/admin/plantillas` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/admin/productos` |  | 200 | 1 | 25 | 0 | 0 | 106 | 0 |
| `/admin/productos/nuevo` |  | 200 | 0 | 0 | 0 | 0 | 3 | 0 |
| `/admin/proveedores` |  | 200 | 1 | 8 | 0 | 0 | 11 | 0 |
| `/admin/roles` |  | 200 | 1 | 18 | 0 | 0 | 21 | 0 |
| `/admin/seguridad` |  | 200 | 1 | 20 | 0 | 0 | 181 | 0 |
| `/admin/suplencias` |  | 200 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/admin/taxonomia-sst` |  | 200 | 2 | 18 | 0 | 0 | 2 | 0 |
| `/admin/tipos-activo` |  | 200 | 1 | 7 | 0 | 0 | 7 | 0 |
| `/admin/trabajadores` |  | 200 | 1 | 25 | 0 | 0 | 61 | 0 |
| `/admin/usuarios` |  | 200 | 1 | 15 | 0 | 0 | 69 | 0 |
| `/analitica` |  | 200 | 4 | 26 | 3 | 4 | 139 | 0 |
| `/aprobaciones` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/bodega` |  | 200 | 1 | 29 | 0 | 0 | 225 | 0 |
| `/bodega/documentos` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/bodega/guias` |  | 200 | 1 | 7 | 0 | 0 | 42 | 0 |
| `/bodega/guias/nueva` | `/recepcion` | 200 | 1 | 22 | 0 | 0 | 116 | 0 |
| `/bodega/trazabilidad` | `/seguimiento` | 200 | 1 | 25 | 0 | 4 | 148 | 0 |
| `/bodega/trazabilidad/documento` | `/seguimiento` | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles` |  | 200 | 0 | 0 | 0 | 0 | 71 | 0 |
| `/combustibles/ajustes` | `/combustibles/ajustes/mandantes` | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/ajustes/familias` |  | 200 | 1 | 18 | 0 | 0 | 20 | 0 |
| `/combustibles/ajustes/integraciones` |  | 200 | 0 | 0 | 0 | 0 | 15 | 0 |
| `/combustibles/ajustes/mandantes` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/ajustes/medios` |  | 200 | 1 | 4 | 0 | 0 | 4 | 0 |
| `/combustibles/ajustes/<id>` |  | 200 | 1 | 14 | 0 | 0 | 17 | 0 |
| `/combustibles/ajustes/reglas` |  | 200 | 2 | 44 | 0 | 0 | 32 | 0 |
| `/combustibles/ajustes/umbrales` |  | 200 | 0 | 0 | 0 | 0 | 10 | 0 |
| `/combustibles/analisis` | `/combustibles/consumo/rendimiento/camiones` | 200 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/combustibles/anomalias` | `/combustibles/revisar` | 200 | 0 | 0 | 5 | 0 | 473 | 0 |
| `/combustibles/anomalias/reglas` | `/combustibles/ajustes/reglas` | 200 | 2 | 44 | 0 | 0 | 32 | 0 |
| `/combustibles/bitacora` | `/combustibles/cargas` | 200 | 1 | 6 | 0 | 0 | 66 | 0 |
| `/combustibles/cargas` |  | 200 | 1 | 6 | 0 | 0 | 66 | 0 |
| `/combustibles/cargas/registrar` |  | 200 | 0 | 0 | 0 | 0 | 2 | 0 |
| `/combustibles/cargas/tarjetas` |  | 200 | 1 | 4 | 0 | 0 | 36 | 0 |
| `/combustibles/ciclo` | `/combustibles/cuadratura/estanques` | 200 | 1 | 4 | 0 | 4 | 25 | 0 |
| `/combustibles/consumo` | `/combustibles/consumo/rendimiento/camiones` | 200 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/combustibles/consumo/litros` |  | 200 | 0 | 0 | 10 | 0 | 80 | 0 |
| `/combustibles/consumo/motor-en-vacio` |  | 200 | 1 | 4 | 7 | 0 | 53 | 0 |
| `/combustibles/control` | `/combustibles/consumo/litros` | 200 | 0 | 0 | 10 | 0 | 80 | 0 |
| `/combustibles/control/configuracion` | `/combustibles/ajustes/mandantes` | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/control/importar` | `/combustibles/fuentes` | 200 | 1 | 6 | 0 | 0 | 77 | 0 |
| `/combustibles/control/ralenti` | `/combustibles/consumo/motor-en-vacio` | 200 | 1 | 4 | 7 | 0 | 53 | 0 |
| `/combustibles/control/registrar` | `/combustibles/cargas/registrar` | 200 | 0 | 0 | 0 | 0 | 2 | 0 |
| `/combustibles/control/revision` | `/combustibles/revisar` | 200 | 0 | 0 | 0 | 0 | 537 | 0 |
| `/combustibles/control/sellos` | `/combustibles/cuadratura/mandante` | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/cuadratura` | `/combustibles/cuadratura/mandante` | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/cuadratura/estanques` |  | 200 | 1 | 4 | 0 | 4 | 25 | 0 |
| `/combustibles/cuadratura/mandante` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/cuadratura/proveedor` |  | 200 | 1 | 4 | 0 | 0 | 15 | 0 |
| `/combustibles/cuadratura/sellos` |  | 200 | 1 | 3 | 0 | 0 | 30 | 0 |
| `/combustibles/cuadratura/<id>` |  | 200 | 1 | 9 | 0 | 0 | 54 | 0 |
| `/combustibles/<id>` | `/combustibles/pagos/estados` | 200 | 1 | 1 | 0 | 0 | 1 | 0 |
| `/combustibles/facturas` | `/combustibles/pagos` | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/fuentes` |  | 200 | 1 | 6 | 0 | 0 | 77 | 0 |
| `/combustibles/fuentes/agregar/planilla` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/fuentes/agregar/sellos` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/fuentes/agregar/tarjeta` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/fuentes/archivos` |  | 200 | 1 | 25 | 0 | 0 | 216 | 0 |
| `/combustibles/importar` | `/combustibles/fuentes` | 200 | 1 | 6 | 0 | 0 | 77 | 0 |
| `/combustibles/nueva` | `/combustibles/pagos/nueva` | 200 | 0 | 0 | 0 | 0 | 5 | 0 |
| `/combustibles/pagos` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/pagos/estados` |  | 200 | 1 | 1 | 0 | 0 | 1 | 0 |
| `/combustibles/pagos/nueva` |  | 200 | 0 | 0 | 0 | 0 | 5 | 0 |
| `/combustibles/<id>` | `/admin/<id>/<id>` | 200 | 1 | 1 | 0 | 0 | 3 | 0 |
| `/combustibles/reportes` | `/combustibles/consumo/litros` | 200 | 0 | 0 | 23 | 0 | 162 | 0 |
| `/combustibles/revisar` |  | 200 | 0 | 0 | 5 | 0 | 482 | 0 |
| `/combustibles/revision` | `/combustibles/revisar` | 200 | 0 | 0 | 5 | 0 | 482 | 0 |
| `/combustibles/sellos` | `/combustibles/cuadratura/sellos` | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/tae` | `/combustibles/cargas` | 200 | 1 | 6 | 0 | 0 | 67 | 0 |
| `/combustibles/tae/conciliacion` | `/combustibles/cuadratura/<id>` | 200 | 1 | 9 | 0 | 0 | 54 | 0 |
| `/combustibles/tae/importar` | `/combustibles/fuentes/agregar/sellos` | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/combustibles/tae/importar/historial` | `/combustibles/fuentes/archivos` | 200 | 0 | 0 | 0 | 0 | 7 | 0 |
| `/combustibles/vehiculos` | `/admin/<id>/vehiculos` | 200 | 1 | 25 | 0 | 0 | 61 | 0 |
| `/compras` |  | 200 | 2 | 2 | 0 | 0 | 17 | 0 |
| `/compras/dte` |  | 200 | 1 | 14 | 0 | 0 | 100 | 0 |
| `/compras/nueva` |  | 200 | 0 | 0 | 0 | 0 | 13 | 0 |
| `/<id>` |  | 200 | 1 | 25 | 0 | 4 | 292 | 0 |
| `/dashboard` |  | 200 | 0 | 0 | 1 | 3 | 99 | 0 |
| `/entregas` |  | 200 | 1 | 25 | 0 | 0 | 188 | 0 |
| `/facturacion` |  | 200 | 1 | 5 | 0 | 4 | 78 | 0 |
| `/facturacion/clientes` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/facturacion/cobranza` |  | 200 | 1 | 131 | 0 | 0 | 1062 | 0 |
| `/facturacion/duplicados` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/facturacion/facturas` |  | 200 | 1 | 50 | 0 | 0 | 714 | 0 |
| `/facturacion/pendientes` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/facturacion/propuestas` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/facturacion/sincronizacion` |  | 200 | 1 | 30 | 0 | 0 | 546 | 0 |
| `/flota` |  | 200 | 1 | 25 | 0 | 0 | 141 | 0 |
| `/flota/monitoreo` |  | corte por tiempo | — | — | — | — | — | 0 |
| `/flota/monitoreo` | `/forbidden` | 200 | 0 | 0 | 0 | 0 | 0 | 3 |
| `/forbidden` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/mantencion` | `/mantencion/panel` | 200 | 2 | 16 | 1 | 4 | 120 | 0 |
| `/mantencion/dispositivos` |  | 200 | 0 | 0 | 0 | 0 | 44 | 0 |
| `/mantencion/equipos` |  | 200 | 1 | 50 | 0 | 0 | 508 | 0 |
| `/mantencion/equipos/importar` |  | 200 | 0 | 0 | 0 | 0 | 4 | 0 |
| `/mantencion/equipos/nuevo` |  | 200 | 0 | 0 | 0 | 0 | 4 | 0 |
| `/mantencion/ot` |  | 200 | 1 | 18 | 0 | 0 | 151 | 0 |
| `/mantencion/panel` |  | 200 | 2 | 16 | 1 | 4 | 120 | 0 |
| `/mantencion/pautas` |  | 200 | 1 | 3 | 0 | 0 | 18 | 0 |
| `/mantencion/registros` |  | 200 | 1 | 25 | 0 | 0 | 206 | 0 |
| `/<id>` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/pendientes` |  | 200 | 1 | 50 | 0 | 0 | 427 | 0 |
| `/perfil` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion` |  | 200 | 0 | 0 | 0 | 0 | 52 | 0 |
| `/prevencion/alcotest` |  | 200 | 0 | 0 | 0 | 0 | 1014 | 0 |
| `/prevencion/campanas` |  | 200 | 1 | 55 | 0 | 0 | 12 | 0 |
| `/prevencion/capa` |  | 200 | 1 | 50 | 0 | 0 | 317 | 0 |
| `/prevencion/capacitacion` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/cgrd` |  | 200 | 0 | 0 | 0 | 0 | 9 | 0 |
| `/prevencion/cgrd/mapa` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/constancias` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/coordinacion` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/cphs` |  | 200 | 1 | 1 | 0 | 0 | 15 | 0 |
| `/prevencion/documentacion` |  | 200 | 1 | 8 | 0 | 0 | 38 | 0 |
| `/prevencion/documentacion/papelera` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/documentacion/regularizacion` |  | 200 | 0 | 0 | 0 | 0 | 2 | 0 |
| `/prevencion/emergencias` |  | 200 | 1 | 10 | 0 | 0 | 57 | 0 |
| `/prevencion/epp-preventivo` |  | 200 | 0 | 0 | 0 | 0 | 4 | 0 |
| `/prevencion/evaluaciones` |  | 200 | 1 | 5 | 0 | 0 | 10 | 0 |
| `/prevencion/faenas` |  | 200 | 1 | 20 | 0 | 0 | 45 | 0 |
| `/prevencion/higiene` |  | 200 | 1 | 6 | 0 | 0 | 33 | 0 |
| `/prevencion/incidentes` |  | 200 | 1 | 20 | 0 | 0 | 169 | 0 |
| `/prevencion/incidentes/configuracion` |  | 200 | 1 | 50 | 0 | 0 | 131 | 0 |
| `/prevencion/incidentes/reportar` |  | 200 | 0 | 0 | 0 | 0 | 7 | 0 |
| `/prevencion/indicadores` |  | 200 | 1 | 12 | 0 | 0 | 89 | 0 |
| `/prevencion/<id>` |  | 200 | 1 | 12 | 0 | 0 | 53 | 0 |
| `/prevencion/inspecciones` |  | 200 | 1 | 50 | 0 | 0 | 423 | 0 |
| `/prevencion/inspecciones/plantillas` |  | 200 | 1 | 16 | 0 | 0 | 66 | 0 |
| `/prevencion/inspecciones/programacion` |  | 200 | 1 | 1 | 0 | 0 | 5 | 0 |
| `/prevencion/inspecciones/seguimiento` |  | 200 | 1 | 50 | 0 | 0 | 617 | 0 |
| `/prevencion/miper` |  | 200 | 1 | 20 | 0 | 0 | 15 | 0 |
| `/prevencion/miper/factores` |  | 200 | 1 | 18 | 0 | 0 | 36 | 0 |
| `/prevencion/nueva` |  | 200 | 0 | 0 | 0 | 0 | 227 | 0 |
| `/prevencion/pdtp` |  | 200 | 0 | 0 | 0 | 4 | 10 | 0 |
| `/prevencion/pdtp/acciones` |  | 200 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/prevencion/pdtp/actividades` |  | 200 | 1 | 32 | 0 | 0 | 158 | 0 |
| `/prevencion/pdtp/aplicabilidad` |  | 200 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/prevencion/pdtp/aprobaciones` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/pdtp/cierres` | `/prevencion/pdtp/pdtp-2026-v1/cierres` | 200 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/prevencion/pdtp/cobertura` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/pdtp/nuevo` |  | 200 | 0 | 0 | 0 | 0 | 6 | 0 |
| `/prevencion/pdtp/obligaciones` |  | 200 | 0 | 0 | 0 | 0 | 3 | 0 |
| `/prevencion/pdtp/plantillas` |  | 200 | 0 | 0 | 0 | 0 | 25 | 0 |
| `/prevencion/pdtp/programas` |  | 200 | 0 | 0 | 0 | 0 | 8 | 0 |
| `/prevencion/permisos` |  | 200 | 1 | 20 | 0 | 0 | 336 | 0 |
| `/prevencion/ppa` |  | 200 | 1 | 20 | 0 | 0 | 128 | 0 |
| `/prevencion/privacidad` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/privacidad/auditoria` |  | 200 | 2 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/privacidad/solicitudes` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/<id>` |  | 200 | 0 | 0 | 0 | 0 | 7 | 0 |
| `/recepcion` |  | 200 | 1 | 22 | 0 | 0 | 116 | 0 |
| `/recepcion/nueva` | `/recepcion` | 200 | 1 | 22 | 0 | 0 | 116 | 0 |
| `/reportes` |  | 200 | 0 | 0 | 0 | 0 | 34 | 0 |
| `/seguimiento` |  | 200 | 1 | 25 | 0 | 4 | 148 | 0 |
| `/solicitudes` |  | 200 | 1 | 25 | 0 | 0 | 137 | 0 |
| `/solicitudes/nueva` |  | 200 | 0 | 0 | 0 | 0 | 4 | 0 |
| `/soporte` |  | 200 | 1 | 2 | 0 | 0 | 12 | 0 |
| `/soporte/nuevo` |  | 200 | 0 | 0 | 0 | 0 | 2 | 0 |
| `/ti` |  | 200 | 2 | 17 | 2 | 4 | 45 | 0 |
| `/ti/accesos` |  | 200 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/ti/activos` |  | 200 | 1 | 25 | 0 | 0 | 147 | 0 |
| `/ti/asignaciones` |  | 200 | 1 | 25 | 0 | 0 | 250 | 0 |
| `/ti/bajas` |  | 200 | 1 | 3 | 0 | 0 | 16 | 0 |
| `/ti/garantias` |  | 200 | 1 | 25 | 0 | 0 | 250 | 0 |
| `/ti/licencias` |  | 200 | 0 | 0 | 0 | 0 | 156 | 0 |
| `/ti/mantenciones` |  | 200 | 1 | 17 | 0 | 0 | 174 | 0 |
| `/ti/reportes` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/ti/tickets` |  | 200 | 1 | 25 | 0 | 0 | 267 | 0 |
| `/trazabilidad` | `/seguimiento` | 200 | 1 | 25 | 0 | 4 | 148 | 0 |
| `/trazabilidad/documento` | `/seguimiento` | 200 | 0 | 0 | 0 | 0 | 0 | 0 |

## Fichas

| Ruta | Redirige a | HTTP | Tablas | Filas | Gráficos | Tiles KPI | Cifras | Errores consola |
|---|---|---|---|---|---|---|---|---|
| `/prevencion/incidentes/<id>` |  | 200 | 0 | 0 | 0 | 0 | 99 | 0 |
| `/prevencion/capa/<id>` |  | 200 | 0 | 0 | 0 | 0 | 30 | 0 |
| `/prevencion/higiene/grupos/<id>` |  | 200 | 2 | 13 | 0 | 0 | 128 | 0 |
| `/prevencion/pdtp/pdtp-2026-v1` |  | 200 | 0 | 0 | 0 | 0 | 167 | 0 |
| `/prevencion/pdtp/pdtp-2026-v1/reporte` |  | 200 | 0 | 0 | 0 | 0 | 0 | 0 |
| `/prevencion/pdtp/pdtp-2026-v1/cierres` |  | 200 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/prevencion/cphs/<id>` |  | 200 | 2 | 25 | 0 | 0 | 196 | 0 |
| `/prevencion/cphs/<id>/programa` |  | 200 | 1 | 23 | 0 | 0 | 137 | 0 |
| `/prevencion/permisos/<id>` |  | 200 | 3 | 10 | 0 | 0 | 44 | 0 |
| `/prevencion/emergencias/<id>` |  | 200 | 3 | 16 | 0 | 0 | 110 | 0 |
| `/prevencion/inspecciones/<id>` |  | 200 | 0 | 0 | 0 | 0 | 40 | 0 |
| `/prevencion/ppa/<id>` |  | 200 | 0 | 0 | 0 | 0 | 12 | 0 |
| `/mantencion/equipos/<id>` |  | 200 | 1 | 11 | 0 | 0 | 94 | 0 |
| `/mantencion/ot/<id>` |  | 200 | 2 | 2 | 0 | 0 | 104 | 0 |
| `/mantencion/registros/<id>` |  | 200 | 0 | 0 | 0 | 0 | 65 | 0 |
| `/flota/<id>` |  | 200 | 0 | 0 | 0 | 0 | 56 | 0 |
| `/combustibles/consumo/equipos/<id>` |  | 200 | 1 | 1 | 2 | 0 | 119 | 0 |
| `/combustibles/consumo/rendimiento/camiones` |  | 200 | 0 | 0 | 0 | 0 | 1 | 0 |
| `/compras/<id>` |  | 200 | 1 | 1 | 0 | 0 | 18 | 0 |
| `/solicitudes/<id>` |  | 200 | 0 | 0 | 0 | 0 | 30 | 0 |
| `/seguimiento/<id>` |  | 200 | 3 | 4 | 0 | 0 | 54 | 0 |
| `/recepcion/<id>` |  | 200 | 1 | 20 | 0 | 0 | 155 | 0 |
| `/bodega/guias/<id>` |  | 200 | 1 | 10 | 0 | 0 | 51 | 0 |
| `/facturacion/facturas/<id>` |  | 200 | 0 | 0 | 0 | 0 | 62 | 0 |
| `/ti/activos/<id>` |  | 200 | 0 | 0 | 0 | 0 | 29 | 0 |
| `/ti/tickets/<id>` |  | 200 | 0 | 0 | 0 | 0 | 27 | 0 |
| `/prevencion/miper/<id>` |  | 200 | 0 | 0 | 0 | 0 | 89 | 0 |
