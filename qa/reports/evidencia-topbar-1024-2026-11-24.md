# TopBar a 1024×768: descripción recortada y alto del banner (2026-11-24)

Medición de solo lectura, a 1024×768 con el administrador del fixture E2E, el menú lateral en su estado por
defecto y datos de fixture, contra `HEAD` con `lg:line-clamp-2` en la descripción del TopBar
(`components/layout/top-bar.tsx`). Es el insumo para decidir si hace falta rediseñar el TopBar a 1024 px; no
propone ni aplica ningún cambio. Las descripciones con conteos dinámicos pueden variar en producción.

- Rutas medidas: **131**. Con descripción: **130**. Recortadas (se ven 2 líneas): **80** (61,5 %).
- Banner de más de 73 px: **21** rutas (72–72,4 px es el alto base de dos líneas).
- Columnas: alto del `banner` en px; ancho del bloque de la descripción en px; líneas visibles / líneas totales.

## Rutas con el banner de más de 73 px

| Ruta | Banner (px) | Ancho desc. (px) | Líneas | Recortada |
|---|---:|---:|---:|---|
| `/prevencion/documentacion` | 160 | 128 | 2/2 | no |
| `/admin/proveedores` | 140 | 128 | 2/2 | no |
| `/admin/trabajadores` | 140 | 128 | 2/2 | no |
| `/admin/inventario-faena` | 122 | 128 | 2/9 | sí |
| `/admin/productos` | 118 | 128 | 2/6 | sí |
| `/combustibles` | 94 | 128 | 2/3 | sí |
| `/combustibles/cargas` | 94 | 128 | 2/2 | no |
| `/combustibles/configuracion → /combustibles/fuentes` | 94 | 128 | 2/4 | sí |
| `/combustibles/fuentes` | 94 | 128 | 2/4 | sí |
| `/combustibles/fuentes?desde=2026-08-01&hasta=2026-08-31` | 94 | 128 | 2/4 | sí |
| `/combustibles/pagos → /combustibles/pagos?desde=2026-08-01&hasta=2026-08-31` | 94 | 128 | 2/2 | no |
| `/flota/indicadores` | 90 | 128 | 2/3 | sí |
| `/mantencion/panel` | 90 | 128 | 2/6 | sí |
| `/mantencion/configuracion → /mantencion/pautas` | 84 | 128 | 2/3 | sí |
| `/mantencion/equipos` | 84 | 128 | 2/4 | sí |
| `/mantencion/pautas` | 84 | 128 | 2/3 | sí |
| `/mantencion/repuestos` | 84 | 128 | 2/3 | sí |
| `/admin/talana` | 82 | 128 | 2/4 | sí |
| `/admin/usuarios` | 82 | 128 | 2/3 | sí |
| `/prevencion/pdtp/actividades` | 82 | 128 | 2/6 | sí |
| `/admin/faenas` | 76 | 128 | 2/2 | no |

## Rutas con la descripción recortada, de más a menos líneas perdidas

| Ruta | Banner (px) | Ancho desc. (px) | Líneas | Recortada |
|---|---:|---:|---:|---|
| `/facturacion/pendientes` | 72.4 | 142 | 2/11 | sí |
| `/admin/dte` | 72.4 | 128 | 2/9 | sí |
| `/admin/inventario-faena` | 122 | 128 | 2/9 | sí |
| `/admin/desviaciones` | 72.4 | 140 | 2/8 | sí |
| `/facturacion/clientes` | 72.4 | 128 | 2/8 | sí |
| `/facturacion/propuestas` | 72.4 | 142 | 2/8 | sí |
| `/admin/contenedores` | 72.4 | 134 | 2/7 | sí |
| `/prevencion/epp-preventivo` | 72.4 | 128 | 2/7 | sí |
| `/prevencion/indicadores` | 72.4 | 128 | 2/7 | sí |
| `/admin/productos` | 118 | 128 | 2/6 | sí |
| `/control-operacional` | 72.4 | 128 | 2/6 | sí |
| `/mantencion/panel` | 90 | 128 | 2/6 | sí |
| `/prevencion/cgrd/mapa` | 72.4 | 164 | 2/6 | sí |
| `/prevencion/pdtp/actividades` | 82 | 128 | 2/6 | sí |
| `/ti/mantenciones` | 72.4 | 128 | 2/6 | sí |
| `/admin/modulos` | 72.4 | 263 | 2/5 | sí |
| `/admin/tipos-activo` | 72.4 | 151 | 2/5 | sí |
| `/flota` | 72.4 | 128 | 2/5 | sí |
| `/mantencion/catalogos` | 72.4 | 142 | 2/5 | sí |
| `/prevencion/alcotest` | 72.4 | 128 | 2/5 | sí |
| `/prevencion/emergencias` | 72.4 | 171 | 2/5 | sí |
| `/prevencion/indicadores-material-ambiental` | 72.4 | 128 | 2/5 | sí |
| `/prevencion/pdtp/cierres → /prevencion/pdtp/pdtp-2025-e2e/cierres` | 72.4 | 263 | 2/5 | sí |
| `/prevencion/permisos` | 72.4 | 128 | 2/5 | sí |
| `/prevencion/privacidad/auditoria` | 72.4 | 128 | 2/5 | sí |
| `/admin/almacenamiento` | 72.4 | 263 | 2/4 | sí |
| `/admin/backups` | 72.4 | 128 | 2/4 | sí |
| `/admin/cargos` | 72.4 | 132 | 2/4 | sí |
| `/admin/parametros-operativos` | 72.4 | 263 | 2/4 | sí |
| `/admin/pdtp-catalogos` | 72.4 | 175 | 2/4 | sí |
| `/admin/suplencias` | 72.4 | 136 | 2/4 | sí |
| `/admin/talana` | 82 | 128 | 2/4 | sí |
| `/combustibles/configuracion → /combustibles/fuentes` | 94 | 128 | 2/4 | sí |
| `/combustibles/fuentes` | 94 | 128 | 2/4 | sí |
| `/combustibles/fuentes?desde=2026-08-01&hasta=2026-08-31` | 94 | 128 | 2/4 | sí |
| `/facturacion` | 72.4 | 251 | 2/4 | sí |
| `/facturacion/cobranza` | 72.4 | 263 | 2/4 | sí |
| `/facturacion/duplicados` | 72.4 | 263 | 2/4 | sí |
| `/facturacion/sincronizacion` | 72.4 | 263 | 2/4 | sí |
| `/mantencion/equipos` | 84 | 128 | 2/4 | sí |
| `/prevencion/capa` | 72.4 | 128 | 2/4 | sí |
| `/prevencion/coordinacion` | 72.4 | 263 | 2/4 | sí |
| `/prevencion/cphs` | 72.4 | 175 | 2/4 | sí |
| `/prevencion/evaluaciones` | 72.4 | 139 | 2/4 | sí |
| `/prevencion/higiene` | 72.4 | 175 | 2/4 | sí |
| `/prevencion/incidentes` | 72.4 | 128 | 2/4 | sí |
| `/prevencion/incidentes/configuracion` | 72.4 | 144 | 2/4 | sí |
| `/prevencion/miper` | 72.4 | 128 | 2/4 | sí |
| `/prevencion/pdtp/programas` | 72.4 | 128 | 2/4 | sí |
| `/prevencion/privacidad/solicitudes` | 72.4 | 128 | 2/4 | sí |
| `/prevencion/requisitos-legales` | 72.4 | 128 | 2/4 | sí |
| `/ti/asignaciones` | 72.4 | 128 | 2/4 | sí |
| `/ti/licencias` | 72.4 | 129 | 2/4 | sí |
| `/admin/centros-costo` | 72.4 | 139 | 2/3 | sí |
| `/admin/escenarios-emergencia` | 72.4 | 150 | 2/3 | sí |
| `/admin/flota-catalogos` | 72.4 | 263 | 2/3 | sí |
| `/admin/folios` | 72.4 | 263 | 2/3 | sí |
| `/admin/notificaciones` | 72.4 | 202 | 2/3 | sí |
| `/admin/roles` | 72.4 | 158 | 2/3 | sí |
| `/admin/seguridad` | 72.4 | 263 | 2/3 | sí |
| `/admin/taxonomia-sst` | 72.4 | 309 | 2/3 | sí |
| `/admin/usuarios` | 82 | 128 | 2/3 | sí |
| `/combustibles` | 94 | 128 | 2/3 | sí |
| `/combustibles/cuadratura → /combustibles/cuadratura/mandante` | 72.4 | 209 | 2/3 | sí |
| `/flota/indicadores` | 90 | 128 | 2/3 | sí |
| `/flota/monitoreo` | 72.4 | 128 | 2/3 | sí |
| `/flota/traslados` | 72.4 | 154 | 2/3 | sí |
| `/mantencion/configuracion → /mantencion/pautas` | 84 | 128 | 2/3 | sí |
| `/mantencion/dispositivos` | 72.4 | 263 | 2/3 | sí |
| `/mantencion/ot → /mantencion/ot?estado=solicitada` | 72.4 | 235 | 2/3 | sí |
| `/mantencion/pautas` | 84 | 128 | 2/3 | sí |
| `/mantencion/registros → /mantencion/registros?revision=pendiente` | 72.4 | 243 | 2/3 | sí |
| `/mantencion/repuestos` | 84 | 128 | 2/3 | sí |
| `/prevencion/constancias` | 72.4 | 263 | 2/3 | sí |
| `/prevencion/faenas` | 72.4 | 263 | 2/3 | sí |
| `/prevencion/incidentes/reportar` | 72.4 | 263 | 2/3 | sí |
| `/prevencion/pdtp` | 72.4 | 128 | 2/3 | sí |
| `/prevencion/pdtp/aprobaciones` | 72.4 | 263 | 2/3 | sí |
| `/prevencion/privacidad` | 72.4 | 263 | 2/3 | sí |
| `/ti/bajas` | 72.4 | 144 | 2/3 | sí |

## Resto de las rutas (descripción completa o sin descripción)

| Ruta | Banner (px) | Ancho desc. (px) | Líneas | Recortada |
|---|---:|---:|---:|---|
| `/admin` | 72.4 | 263 | 2/2 | no |
| `/admin/auditoria` | 72 | 263 | 1/1 | no |
| `/admin/configuracion` | 72 | 263 | 1/1 | no |
| `/admin/correo-smtp` | 72.4 | 263 | 2/2 | no |
| `/admin/epps → /admin/productos/familias` | 72.4 | 263 | 2/2 | no |
| `/admin/equipos` | 72 | 128 | 1/1 | no |
| `/admin/faenas` | 76 | 128 | 2/2 | no |
| `/admin/plantillas` | 72.4 | 263 | 2/2 | no |
| `/admin/proveedores` | 140 | 128 | 2/2 | no |
| `/admin/trabajadores` | 140 | 128 | 2/2 | no |
| `/analitica` | 72.4 | 281 | 2/2 | no |
| `/aprobaciones` | 72 | 432 | 1/1 | no |
| `/bodega` | 72.4 | 213 | 2/2 | no |
| `/bodega/guias` | 72.4 | 432 | 2/2 | no |
| `/combustibles/ajustes → /combustibles/ajustes/mandantes` | 72 | 305 | 1/1 | no |
| `/combustibles/cargas` | 94 | 128 | 2/2 | no |
| `/combustibles/consumo → /combustibles/consumo/rendimiento/camiones` | 72.4 | 209 | 2/2 | no |
| `/combustibles/pagos → /combustibles/pagos?desde=2026-08-01&hasta=2026-08-31` | 94 | 128 | 2/2 | no |
| `/combustibles/revisar → /combustibles/revisar?desde=2026-08-01&hasta=2026-08-31` | 72.4 | 362 | 2/2 | no |
| `/compras` | 72.4 | 256 | 2/2 | no |
| `/dashboard` | 72 | 432 | 1/1 | no |
| `/entregas` | 72 | 371 | 1/1 | no |
| `/facturacion/facturas` | 72.4 | 358 | 2/2 | no |
| `/flota/conductores` | 72.4 | 128 | 2/2 | no |
| `/flota/turnos` | 72.4 | 245 | 2/2 | no |
| `/pendientes` | 72 | 432 | 1/1 | no |
| `/prevencion/capacitacion` | 72 | None | None/None | no |
| `/prevencion/cgrd` | 72.4 | 263 | 2/2 | no |
| `/prevencion/documentacion` | 160 | 128 | 2/2 | no |
| `/prevencion/inspecciones` | 72.4 | 241 | 2/2 | no |
| `/prevencion/inspecciones/plantillas` | 72 | 358 | 1/1 | no |
| `/prevencion/inspecciones/programacion` | 72 | 373 | 1/1 | no |
| `/prevencion/inspecciones/seguimiento` | 72 | 358 | 1/1 | no |
| `/prevencion/pdtp/acciones` | 72.4 | 416 | 2/2 | no |
| `/prevencion/pdtp/aplicabilidad` | 72.4 | 263 | 2/2 | no |
| `/prevencion/pdtp/cobertura` | 72.4 | 263 | 2/2 | no |
| `/prevencion/pdtp/obligaciones` | 72.4 | 312 | 2/2 | no |
| `/prevencion/ppa` | 72 | 403 | 1/1 | no |
| `/recepcion` | 72.4 | 432 | 2/2 | no |
| `/reportes` | 72 | 281 | 1/1 | no |
| `/seguimiento` | 72.4 | 432 | 2/2 | no |
| `/solicitudes` | 72 | 324 | 1/1 | no |
| `/soporte` | 72.4 | 386 | 2/2 | no |
| `/ti` | 72 | 432 | 1/1 | no |
| `/ti/accesos` | 72.4 | 432 | 2/2 | no |
| `/ti/activos` | 72.4 | 253 | 2/2 | no |
| `/ti/apps` | 72.4 | 263 | 2/2 | no |
| `/ti/garantias` | 72.4 | 263 | 2/2 | no |
| `/ti/integraciones` | 72.4 | 263 | 2/2 | no |
| `/ti/reportes` | 72.4 | 432 | 2/2 | no |
| `/ti/tickets` | 72 | 368 | 1/1 | no |
