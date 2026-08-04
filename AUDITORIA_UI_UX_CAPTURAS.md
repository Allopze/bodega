# Auditoría UI/UX integral basada en capturas

**Producto:** Chome — Plataforma de gestión operacional

**Fecha de auditoría:** 2 de agosto de 2026

**Evidencia revisada:** `audit/screenshots/2026-08-01-playwright/` y `audit/screenshots/2026-08-02-playwright/`

**Alcance:** escritorio, móvil, vistas base, modales, selects, menús, pestañas, hover y comparación histórica

**Naturaleza del informe:** auditoría visual y plan de implementación; ejecución iniciada el 2 de agosto de 2026. El registro de cada pasada queda en la sección 21.

## 1. Resumen ejecutivo

Chome presenta una base visual profesional, sobria y reconocible. El shell, los títulos, los breadcrumbs, la paleta contenida, las tarjetas, la mayoría de los formularios y el flujo Solicitud → Aprobación → Compra → Recepción → Entrega transmiten orden y confianza. No se recomienda un rediseño total: el mayor valor está en corregir contratos responsive inconsistentes, simplificar pantallas densas, cerrar rutas/estados sin salida y estandarizar feedback, microcopy y seguridad de interacción.

La auditoría incluyó **todas las 2.177 imágenes PNG disponibles**: 742 del lote 2026-08-01 y 1.435 del lote 2026-08-02. Se reconciliaron manifiestos, archivos físicos, rutas, viewports, duplicados y estados interactivos antes de establecer la nota. El lote vigente declara 174 rutas y 1.352 resultados: 348 vistas base y 1.004 estados interactivos. La revisión física encontró 2.029 hashes únicos; 242 archivos pertenecen a 94 grupos de duplicados exactos.

La conclusión principal no es “la interfaz se ve mal”. Al contrario, **el sistema visual está más maduro que algunos flujos y que su contrato móvil**. Las fricciones de mayor impacto son:

1. Dos accesos especializados, Repuestos y Servicios, abren el formulario con `EPP` seleccionado; esto puede clasificar mal una solicitud.
2. Varias tablas siguen siendo esencialmente de escritorio: en móvil recortan columnas, acciones o mensajes, aunque el manifiesto no detecte overflow de página.
3. Prevención tiene una arquitectura amplia: el sidebar trunca nombres y varios listados/detalles no cuentan con evidencia válida.
4. Dashboard, Flota, Respaldos y varias pantallas de Prevención priorizan tarjetas KPI repetidas o ceros sobre el trabajo real.
5. Pendientes, TAE administrativo, Reportes y algunos módulos preventivos concentran demasiados controles u objetivos antes de la tarea principal.
6. PPA público es claro pero excesivamente largo; TAE público informa éxito o error, pero no sostiene bien la repetición ni la recuperación.
7. Roles, permisos, folios y catálogos exponen slugs o términos internos a usuarios administrativos.

Existe además una limitación severa de la evidencia: **al menos 63 interacciones móviles actuales terminaron en otra ruta** y 20 grupos de rutas de negocio muestran el 404 personalizado en al menos un viewport. Quince de esos grupos preventivos persisten en ambos lotes y viewports. Esto bloquea la certificación visual de los flujos afectados, pero no permite concluir automáticamente que producción esté rota: puede ser fixture, autorización, lookup o ruta. El informe separa esta deuda de evidencia de los defectos confirmados del producto.

**Nota global ponderada: 6,4/10.** La aplicación es usable y visualmente competente, pero conserva problemas importantes en responsive, tablas, densidad operativa, recuperación y cobertura de estados. El veredicto es **No recomendable para producción sin corregir problemas importantes**, entendido como cierre de calidad integral —especialmente móvil y de Prevención—, no como afirmación de que todos los módulos sean inoperables.

### Método y calidad de evidencia

| Indicador | Resultado |
|---|---:|
| PNG físicos revisados | 2.177 |
| Lote histórico 2026-08-01 | 742 |
| Lote vigente 2026-08-02 | 1.435 |
| Rutas vigentes inventariadas | 174 |
| Resultados vigentes en manifest | 1.352 |
| Vistas base vigentes | 348 |
| Estados interactivos vigentes | 1.004 |
| Hashes únicos en ambos lotes | 2.029 |
| Archivos dentro de grupos duplicados | 242 |
| PNG vigentes huérfanos del manifest | 94 |
| Referencias vigentes duplicadas | 11 |
| Interacciones móviles vigentes confirmadas fuera de ruta | 63 |
| Grupos de rutas de negocio con 404 visual | 20 |
| Errores de cliente declarados por el manifest vigente | 0 |
| Overflow horizontal de página declarado por el manifest | 0 |

El manifest sólo mide desbordamiento exterior. Una tabla puede vivir dentro de un contenedor con `overflow` y seguir cortando contenido sin que el documento completo desborde; por eso la inspección visual prevalece para el hallazgo responsive. El 2026-08-02 añade `/prevencion/pdtp/actividades` y `/prevencion/pdtp/programas`. De 733 nombres compartidos entre lotes, sólo 45 son idénticos por hash: la comparación histórica se usó como referencia, no como sustituto de la inspección vigente.

## 2. Inventario de pantallas

Las capturas relacionadas se agrupan cuando representan la misma tarea en desktop, móvil y estados interactivos. Las rutas exactas quedan incluidas para no ocultar cobertura.

Salvo indicación de fecha, los nombres citados pertenecen a `audit/screenshots/2026-08-02-playwright/`. La notación `desktop/mobile-<nombre>.png` significa el par exacto `desktop-<nombre>.png` y `mobile-<nombre>.png`; `...` o `*` identifica explícitamente una familia de estados relacionados, no una captura adicional inventada.

### 2.1 Acceso, operaciones, terreno y soporte — 52 rutas

| ID | Pantalla o módulo | Propósito aparente | Usuario objetivo | Acción principal | Observaciones iniciales |
|---|---|---|---|---|---|
| SCR-CORE-01 | `/`, `/login`, `/registro`, `/recuperar`, `/recuperar/capture-reset-token` | Acceso, alta inicial y recuperación | Usuario nuevo o existente | Entrar, registrarse o recuperar | Foco claro, contenido legible y salidas coherentes. |
| SCR-CORE-02 | `/ruta-inexistente-auditoria`, `/app-ruta-inexistente-auditoria`, `/forbidden` | Recuperación ante ruta o permiso inválido | Cualquier usuario | Volver a un lugar válido | 403/404 genéricos explican y ofrecen salidas; conservar. |
| SCR-CORE-03 | `/dashboard`, `/perfil` | Inicio operativo y cuenta | Usuario autenticado | Resolver pendientes o editar perfil | Dashboard vigente funciona; densidad y duplicación de métricas reducen eficiencia móvil. |
| SCR-CORE-04 | `/pendientes`, `?quick=overdue`, `?q=sin-resultado-auditoria` | Cola transversal de trabajo | Operador/supervisor | Filtrar y resolver una tarea | Demasiados controles antes de la primera tarea en móvil. |
| SCR-CORE-05 | `/solicitudes`, `/solicitudes/nueva`, `/solicitudes/req-audit-1` | Crear y seguir requerimientos | Solicitante/supervisor | Crear, revisar o cancelar | Flujo y tracker claros; buena prevención en cancelación. |
| SCR-CORE-06 | `/aprobaciones` | Revisar requerimientos | Aprobador | Aprobar o devolver | Estado y urgencia legibles; interacción móvil contaminada en una captura. |
| SCR-CORE-07 | `/compras`, `/compras/nueva`, `/compras/po-audit-1`, tabs `facturacion` y `avance`, `/print` | Crear y seguir órdenes de compra | Compras/supervisor | Crear OC, seguir o imprimir | Buen resumen preventivo; tabs móviles se parten y previews requieren tratamiento documental. |
| SCR-CORE-08 | `/recepcion`, `/recepcion/nueva?oc=...`, `/recepcion/rec-audit-1` | Registrar recepción | Bodega/recepción | Recibir parcial o total | Contexto, leyenda y estados ayudan a principiantes. |
| SCR-CORE-09 | `/bodega`, `/entregas`, `/entregas/del-audit-1/print` | Stock y entrega nominal | Bodeguero | Registrar movimiento/entrega | Modelo operativo consistente; documento móvil se encoge. |
| SCR-CORE-10 | `/trazabilidad`, `/trazabilidad/req-item-audit-1`, `/trazabilidad/trabajador/worker-audit-1` | Kardex e historial EPP | Bodega/Prevención | Consultar trazabilidad | Detalle comprensible; historial del trabajador comprimido en móvil. |
| SCR-CORE-11 | `/reportes`, `/analitica` | Resumen, brechas y exportación Excel | Supervisor/gerencia | Consultar o exportar | Empty states útiles; cuatro exportes dominan el inicio de Reportes. |
| SCR-CORE-12 | `/flota`, `/flota/fuel-veh-audit-1`, `/mantenciones` | Vehículos, costo y mantenimiento | Flota/supervisor | Consultar activo o crear mantención | Cuatro KPI y filtros entierran el listado móvil. |
| SCR-CORE-13 | `/repuestos`, `/repuestos/nueva`, `/repuestos/rep-audit-1` | Solicitudes de repuestos | Operador/compras | Crear solicitud | El alta carga EPP en vez de Repuestos: error confirmado. |
| SCR-CORE-14 | `/servicios`, `/servicios/nueva`, `/servicios/srv-audit-1` | Solicitudes de servicios | Operador/compras | Crear solicitud | El alta carga EPP en vez de Servicios: error confirmado. |
| SCR-CORE-15 | `/ppa`, `/ppa/result/capture-ppa-token` | Evaluación preventiva pública | Trabajador en terreno | Completar y confirmar PPA | Lenguaje claro y buen resultado; recorrido muy largo. |
| SCR-CORE-16 | `/tae`, `/tae/access/capture-tae-token`, `/tae/resultado/capture-tae-result-token` | Registro público TAE | Operador en terreno | Preparar dispositivo o registrar carga | Error sin CTA; éxito sin acción de repetición. |
| SCR-CORE-17 | `/soporte`, `/soporte/nuevo`, `/soporte/sop-audit-1` | Reportar y seguir incidencias | Usuario autenticado | Crear/seguir ticket | Lista y alta correctas; detalle muestra 404 visual con HTTP 200. |

### 2.2 Combustibles — 25 rutas

| ID | Pantalla o módulo | Propósito aparente | Usuario objetivo | Acción principal | Observaciones iniciales |
|---|---|---|---|---|---|
| SCR-COMB-01 | `/combustibles` | Centro de control | Operador/supervisor | Registrar o revisar | Buena síntesis; una acción móvil queda sólo como icono. |
| SCR-COMB-02 | `/combustibles/nueva` | Carga manual | Operador | Registrar carga | Formulario claro pero largo; select móvil no tiene evidencia válida. |
| SCR-COMB-03 | `/combustibles/fuel-audit-1` | Detalle y auditoría de carga | Supervisor | Revisar/corregir | Legible y contextual. |
| SCR-COMB-04 | `/combustibles/reportes` | Reportes por periodo | Supervisor | Comparar/exportar | Base clara; tabs móviles capturados fuera de ruta. |
| SCR-COMB-05 | `/combustibles/vehiculos`, `/combustibles/proveedores-combustible` | Compatibilidad con catálogos canónicos | Administrador | Ir al catálogo | Redirects coherentes; no deben divergir del catálogo único. |
| SCR-COMB-06 | `/combustibles/cuenta-corriente`, `/cc-audit-1` | Saldo y pagos a proveedor | Finanzas/supervisor | Conciliar o pagar | Detalle especialmente claro; tabla móvil densa. |
| SCR-COMB-07 | `/combustibles/facturas` | Facturación y gasto | Finanzas | Revisar facturas | Gráficos/filtros desplazan los registros en móvil. |
| SCR-COMB-08 | `/combustibles/importar` | Importar TCT/log | Operador experto | Cargar, mapear, ejecutar | Complejo pero segmentado. |
| SCR-COMB-09 | `/combustibles/importar/fuel-import-audit-1` | Detalle de lote | Operador experto | Revisar resultado | 404 en ambos lotes/viewports. |
| SCR-COMB-10 | `/combustibles/importar/operaciones/fuel-op-audit-1` | Trazabilidad de operación importada | Auditor | Revisar operación | 404 en ambos lotes/viewports. |
| SCR-COMB-11 | `/combustibles/tae` | Control TAE | Supervisor/operador | Analizar, crear QR o importar | Mezcla demasiados objetivos y trunca acciones en móvil. |
| SCR-COMB-12 | `/combustibles/tae/tae-audit-1` | Validación de lectura | Supervisor | Corregir/anular | Buen detalle y buena justificación de corrección. |
| SCR-COMB-13 | `/combustibles/tae/importar`, `/historial` | Importar y consultar lotes TAE | Operador experto | Importar/revisar | Flujo claro; vacío de historial poco orientador. |
| SCR-COMB-14 | `/combustibles/tae/importar/tae-import-audit-1` | Detalle de lote TAE | Operador experto | Revisar resultado | 404 en ambos lotes/viewports. |
| SCR-COMB-15 | `/combustibles/tae/conciliacion` | Contrastar TAE/TCT | Supervisor | Conciliar | Explicación de dominio especialmente útil. |
| SCR-COMB-16 | `/combustibles/analisis` | Rendimiento por equipo | Supervisor | Analizar | Controles comprensibles y vacío orientador. |
| SCR-COMB-17 | `/combustibles/anomalias`, `/reglas` | Casos y reglas | Supervisor | Revisar/configurar | Estado base correcto; selects móviles inválidos y vacío mejorable. |
| SCR-COMB-18 | `/combustibles/bitacora` | Log unificado | Auditor/supervisor | Filtrar/exportar | Muro de controles y tabla móvil deficiente. |
| SCR-COMB-19 | `/combustibles/bitacora/historial/sst/entity-audit-1` | Historial de entidad | Auditor | Seguir cambios | Redirige a lista; no preserva entidad. |
| SCR-COMB-20 | `/combustibles/ciclo` | Ciclo físico | Operador | Registrar/controlar | Claro, con vacío y CTA adecuados. |
| SCR-COMB-21 | `/combustibles/sellos` | Movimientos de sellos | Operador/auditor | Consultar | Filtros largos y tabla recortada en móvil. |

### 2.3 Prevención — 65 rutas

| ID | Pantalla o módulo | Propósito aparente | Usuario objetivo | Acción principal | Observaciones iniciales |
|---|---|---|---|---|---|
| SCR-PREV-01 | `/prevencion`, `/nueva`, `/sst-audit-1`, `/trabajador/worker-audit-1`, `/campanas`, `/evaluaciones`, `/indicadores`, `/indicadores-material-ambiental` | Entrada SST, evaluaciones y métricas | Prevencionista/supervisor | Evaluar, consultar o corregir datos | Buen shell; sidebar largo, tablas móviles y estados “No calculable”. |
| SCR-PREV-02 | `/prevencion/pdtp`, `/prog-audit-1`, `/editar`, `/ejecucion/exec-audit-1`, `/reporte`, `/acciones`, `/actividades`, `/programas`, `/aplicabilidad`, `/obligaciones`, `/plantillas`, `/nuevo`, `/aprobaciones`, `/cobertura` | Programa preventivo anual | Prevencionista/jefatura | Crear, ejecutar, aprobar y revisar | Amplio y útil; ejecución sin fixture y Actividades abre en error. |
| SCR-PREV-03 | `/prevencion/capa`, `/capa/capa-audit-1` | Acciones correctivas | Prevencionista/responsable | Gestionar CAPA | Lista visible; detalle no auditable y muro de ceros. |
| SCR-PREV-04 | `/prevencion/incidentes`, `/reportar`, `/importar`, `/inc-audit-1`, `/procedimiento` | Reporte e investigación | Trabajador/Prevención | Reportar/investigar | Banner de conectividad útil; tres rutas de continuidad muestran 404. |
| SCR-PREV-05 | `/prevencion/miper`, `/controles/risk-control-audit-1` | Matriz de riesgos | Prevencionista | Gestionar versión/control | Explicación de prerrequisito buena; detalle sin fixture. |
| SCR-PREV-06 | `/prevencion/requisitos-legales`, `/legal-requirement-audit-1` | Cumplimiento legal | Prevencionista/jefatura | Revisar obligación | Lista visible; detalle sin fixture. |
| SCR-PREV-07 | `/prevencion/privacidad/auditoria`, `/solicitudes`, `/privacy-request-audit-1` | Privacidad y solicitudes | Encargado/admin | Revisar/crear solicitud | Tabla móvil recortada; detalle redirige al listado. |
| SCR-PREV-08 | `/prevencion/capacitacion`, `/catalogo`, `/competencias`, `/brechas`, `/trsess-audit-1` | Formación y competencias | Prevencionista/RR.HH. | Programar/cerrar brecha | Buen modelo; sesión sin fixture y modales largos. |
| SCR-PREV-09 | `/prevencion/permisos`, `/permit-audit-1`, `/inspecciones`, `/inspecciones/catalogo`, `/insp-audit-1` | Permisos e inspecciones | Prevencionista/supervisor | Crear/revisar | Tablas móviles; detalles sin fixture. |
| SCR-PREV-10 | `/prevencion/cphs`, `/comite-audit-1`, `/higiene`, `/grupos/grupo-audit-1`, `/programas/programa-audit-1` | Comités e higiene ocupacional | Prevencionista/CPHS | Gestionar programa | Vacíos útiles; tres detalles no auditables. |
| SCR-PREV-11 | `/prevencion/emergencias`, `/plan-audit-1`, `/gestion-cambio`, `/cambio-audit-1` | Planes y cambios | Prevencionista/jefatura | Crear/revisar | Modales largos y detalles sin fixture. |
| SCR-PREV-12 | `/prevencion/epp-preventivo` | Cobertura preventiva EPP | Prevencionista | Filtrar/revisar | Select móvil capturado fuera de ruta. |
| SCR-PREV-13 | `/prevencion/documentacion`, `/doc-audit-1`, `/nuevo`, `/papelera`, `/revisiones`, `/vencimientos`, `/regularizacion` | Biblioteca documental | Prevencionista | Subir/revisar/regularizar | Varias rutas redirigen a biblioteca; estados móviles contaminados. |
| SCR-PREV-14 | `/sst/sst-audit-1/print` | Acta SST imprimible | Prevencionista/trabajador | Revisar/descargar | A4 consistente; preview móvil ilegible. |
| SCR-PREV-15 | `/prevencion/ppa`, `/ppa/ppa-audit-1` | Gestión interna PPA | Prevencionista | Revisar PPA | Vistas base visibles; tabs móviles capturados fuera de ruta. |

### 2.4 Administración — 32 rutas

| ID | Pantalla o módulo | Propósito aparente | Usuario objetivo | Acción principal | Observaciones iniciales |
|---|---|---|---|---|---|
| SCR-ADM-01 | `/admin` | Hub administrativo | Administrador | Elegir configuración | Agrupación por tareas y descripciones muy buena. |
| SCR-ADM-02 | `/admin/auditoria` | Log de cambios | Auditor/admin | Consultar evento | Adaptación móvil ejemplar con tarjetas. |
| SCR-ADM-03 | `/admin/catalogos-productos` | Unidades y atributos | Administrador | Mantener catálogo | Tabla declara preferencia por escritorio. |
| SCR-ADM-04 | `/admin/centros-costo` | Centros de costo | Administrador | Crear/editar | Patrón simple y consistente. |
| SCR-ADM-05 | `/admin/configuracion` | Configuración global | Administrador | Guardar ajustes | Formulario largo; dirty-state no visible. |
| SCR-ADM-06 | `/admin/correo-smtp` | Servicio de correo | Administrador | Habilitar/probar | Estado visual contradictorio: habilitado, proveedor no configurado. |
| SCR-ADM-07 | `/admin/faenas` | Faenas | Administrador | Crear/editar | Buen patrón de tarjetas móviles. |
| SCR-ADM-08 | `/admin/flota-catalogos` | Hub de flota | Administrador | Elegir catálogo | IA clara; mezcla hub con parámetros persistentes. |
| SCR-ADM-09 | `/admin/flota-catalogos/vehiculos` | Vehículos | Administrador/flota | Mantener | Buen móvil; targets compactos. |
| SCR-ADM-10 | `/admin/flota-catalogos/tipos-equipo` | Tipos de equipo | Administrador | Mantener | Tabla horizontal densa. |
| SCR-ADM-11 | `/admin/flota-catalogos/productos-combustible` | Productos combustible | Administrador | Mantener | CRUD comprensible. |
| SCR-ADM-12 | `/admin/flota-catalogos/estanques-combustible` | Estanques | Administrador | Crear | Vacío contextual y CTA adecuados. |
| SCR-ADM-13 | `/admin/flota-catalogos/proveedores-combustible` | Proveedores combustible | Administrador | Mantener | Canonicalización coherente. |
| SCR-ADM-14 | `/admin/folios` | Secuencias documentales | Administrador | Corregir folio | Salvaguarda visible; microcopy técnica. |
| SCR-ADM-15 | `/admin/notificaciones` | Retención y registro | Administrador | Revisar/purgar | Tabla móvil de escritorio; salvaguardas no verificables. |
| SCR-ADM-16 | `/admin/parametros-operativos` | Límites y retenciones | Administrador | Guardar valores | Demasiadas tarjetas de un campo; guardado lejano. |
| SCR-ADM-17 | `/admin/pdtp-catalogos` | Catálogos PDTP | Administrador SST | Mantener | Expone identificadores internos. |
| SCR-ADM-18 | `/admin/plantillas` | Plantillas de correo | Administrador | Restaurar/editar | Vacío explica, pero CTA no resuelve directamente. |
| SCR-ADM-19 | `/admin/productos`, `/admin/epps` | Catálogo y familias EPP | Administrador/bodega | Mantener/importar | Productos adapta bien; EPP usa tabla móvil deficiente. |
| SCR-ADM-20 | `/admin/productos/nuevo`, `/prod-audit-1` | Alta/edición de producto | Administrador | Guardar | Claro en móvil; demasiado ancho en escritorio. |
| SCR-ADM-21 | `/admin/productos/importar/batch-audit-1` | Detalle de importación | Administrador | Revisar lote | 404 en ambos lotes/viewports. |
| SCR-ADM-22 | `/admin/proveedores` | Proveedores | Administrador/compras | Mantener | Buen patrón de tarjetas móviles. |
| SCR-ADM-23 | `/admin/roles` | Roles y alcance | Administrador de acceso | Configurar rol | Slugs crudos y tabla desktop-only. |
| SCR-ADM-24 | `/admin/modulos` | Activación de módulos | Administrador | Activar/desactivar | Cambio de gran alcance inmediato; confirmación no capturada. |
| SCR-ADM-25 | `/admin/seguridad` | Bloqueos/diagnóstico | Administrador | Revisar/purgar | Tabla desktop-only; seguridad posterior no visible. |
| SCR-ADM-26 | `/admin/suplencias` | Reemplazos temporales | Administrador | Crear suplencia | Empty state ejemplar y CTA directa. |
| SCR-ADM-27 | `/admin/taxonomia-sst` | Categorías SST | Administrador SST | Mantener/sembrar | Tabla móvil limitada; “Sembrar” es técnico. |
| SCR-ADM-28 | `/admin/trabajadores` | Personal y tallas | Administrador/Prevención | Mantener | Buena adaptación móvil y ajuste al dominio. |
| SCR-ADM-29 | `/admin/usuarios` | Acceso, roles y permisos | Administrador | Crear/invitar | Alta carga cognitiva; footer fijo bien resuelto. |
| SCR-ADM-30 | `/admin/backups` | Salud de respaldos | Administrador | Configurar/ejecutar | Seis KPI y semántica contradictoria en estado sin ejecuciones. |

## 3. Fortalezas

1. **Sistema visual cohesivo.** Blanco, grises, verde y acentos contenidos generan una apariencia empresarial seria. Los bordes, radios, tipografía y sombras no compiten con el contenido.
2. **Orientación de alto nivel consistente.** Sidebar, título, breadcrumb, contexto de faena y acciones de cabecera permiten reconocer el módulo en la mayoría de las vistas válidas.
3. **Buen flujo transaccional principal.** Solicitudes, aprobaciones, compras, recepción, bodega y entrega usan estados, resúmenes y cantidades parciales de forma coherente.
4. **Prevención de error destacable al crear OC.** `desktop-compras-nueva-modal-auto-crear-oc-0-tems-.png` muestra botón deshabilitado, “0 ítems” y requisitos “Proveedor/Ítems faltan”.
5. **Cancelación bien protegida.** `desktop-repuestos-detalle-modal-auto-cancelar-solicitud.png` pide motivo, explica irreversibilidad, diferencia el CTA destructivo y muestra foco visible.
6. **Buenas ayudas para usuarios principiantes.** Recepción explica sus estados; conciliación TAE/TCT aclara que compara documentos diferentes; varios prerrequisitos PDTP explican por qué la acción está bloqueada.
7. **Casos móviles bien resueltos que deben ser estándar.** Auditoría, faenas, trabajadores, usuarios, productos, proveedores y vehículos convierten listados en tarjetas legibles.
8. **Estados vacíos ejemplares.** Ciclo físico, suplencias, estanques, campañas, MIPER y analítica explican qué significa la ausencia y ofrecen una acción real.
9. **PPA público comunica seguridad.** `mobile-ppa-result.png` informa “Puede iniciar el trabajo de forma segura”, identifica la tarea y ofrece “Realizar otro PPA”.
10. **Incidentes considera conectividad.** `mobile-prevencion-incidentes-reportar.png` anticipa sincronización/conectividad antes de una operación crítica; este patrón debe conservarse y validarse técnicamente.
11. **Corrección TAE trazable.** El modal de corregir lectura solicita valor, motivo y evidencia, reduciendo cambios opacos.
12. **Mejora histórica visible.** El dashboard del 01-08 mostraba “Error al cargar el panel”; el 02-08 se captura poblado y operativo. Se considera una mejora resuelta, no un defecto vigente.

## 4. Nota global

**6,4/10 — usable con problemas importantes.**

La nota es ponderada; no es el promedio simple de estética. Los pesos priorizan completar tareas, prevenir errores, operar en móvil y acceder al contenido.

| Categoría | Peso | Nota | Aporte |
|---|---:|---:|---:|
| Arquitectura de información | 6 % | 6,3 | 0,38 |
| Navegación | 6 % | 6,2 | 0,37 |
| Claridad de los flujos | 9 % | 6,4 | 0,58 |
| Jerarquía visual | 5 % | 6,8 | 0,34 |
| Consistencia | 5 % | 6,9 | 0,35 |
| Diseño visual | 4 % | 7,6 | 0,30 |
| Legibilidad | 5 % | 6,5 | 0,33 |
| Formularios | 7 % | 6,7 | 0,47 |
| Tablas y listados | 8 % | 5,6 | 0,45 |
| Feedback y estados | 7 % | 6,4 | 0,45 |
| Prevención de errores | 8 % | 7,1 | 0,57 |
| Accesibilidad | 8 % | 5,8 | 0,46 |
| Diseño responsive | 8 % | 5,6 | 0,45 |
| Microcopy | 4 % | 6,5 | 0,26 |
| Eficiencia de uso | 6 % | 5,9 | 0,35 |
| Calidad percibida | 4 % | 7,2 | 0,29 |
| **Total** | **100 %** |  | **6,39 → 6,4** |

## 5. Notas por categoría

| Categoría | Nota | Justificación basada en evidencia |
|---|---:|---|
| Arquitectura de información | 6,3/10 | Los hubs y el flujo de compra son previsibles; Prevención se vuelve extensa, existen rutas nominales que redirigen y TAE concentra objetivos heterogéneos. |
| Navegación | 6,2/10 | Activos y breadcrumbs funcionan; el sidebar preventivo trunca, algunas tabs se parten y ciertos detalles vuelven a listas sin preservar entidad. |
| Claridad de los flujos | 6,4/10 | El proceso transaccional central es claro; Repuestos/Servicios pierden intención y varios detalles/recuperaciones no pueden completarse. |
| Jerarquía visual | 6,8/10 | Títulos y CTA suelen dominar correctamente; muros de KPI, exportes y filtros desplazan la tarea en móvil. |
| Consistencia | 6,9/10 | El lenguaje visual es estable; hay contratos divergentes para tablas, vacíos, fechas, acciones por icono y estados de salud. |
| Diseño visual | 7,6/10 | Sobrio, equilibrado y profesional. La deuda principal no es decorativa, sino funcional y responsive. |
| Legibilidad | 6,5/10 | El cuerpo es generalmente legible; metadatos pequeños, siglas, códigos partidos, tablas y A4 encogidos degradan la lectura. |
| Formularios | 6,7/10 | Etiquetas y agrupación básica son buenas; PPA, permisos y parámetros son largos y faltan pruebas de dirty-state, teclado y conservación. |
| Tablas y listados | 5,6/10 | Desktop es competente; móvil alterna tarjetas correctas con tablas recortadas o explícitamente “pensadas para escritorio”. |
| Feedback y estados | 6,4/10 | Hay buenos vacíos, errores y éxitos; TAE, PDTP Actividades, “No calculable”, SMTP y respaldos no siempre dan una salida o semántica fiable. |
| Prevención de errores | 7,1/10 | Crear OC y cancelar están bien protegidos; el default EPP y los switches administrativos de alto impacto reducen la nota. |
| Accesibilidad | 5,8/10 | Foco visible y controles grandes aparecen en casos; reflow, iconos, contraste exacto, teclado, lector de pantalla y zoom no están certificados. |
| Diseño responsive | 5,6/10 | Existen excelentes tarjetas móviles, pero tablas, tabs, KPI, overlays y documentos siguen fallando en pantallas pequeñas. |
| Microcopy | 6,5/10 | Predominan verbos y español comprensible; slugs, códigos internos, siglas y dos controles “Prioridad” generan fricción. |
| Eficiencia de uso | 5,9/10 | Los expertos disponen de rutas directas; en móvil el scroll y los controles previos a la tarea son excesivos en módulos relevantes. |
| Calidad percibida | 7,2/10 | El aspecto genera confianza; 404 de negocio, estados contradictorios y evidencia contaminada impiden una percepción plenamente sólida. |

## 6. Veredicto de preparación para producción

### No recomendable para producción sin corregir problemas importantes

Este veredicto se refiere a la **preparación integral y multidispositivo**. No significa que todos los flujos estén inutilizables: el núcleo de solicitudes/compras/recepción y muchas superficies administrativas son funcionales y visualmente maduras. Antes de declarar cierre productivo deben resolverse, como mínimo:

- clasificación correcta de Repuestos y Servicios;
- cobertura válida de los 20 grupos de rutas que hoy terminan visualmente en 404;
- contrato móvil para tablas y listados operativos;
- recuperación de TAE y error de Actividades PDTP;
- semántica operativa de correo y respaldos;
- validación de acciones administrativas de alto impacto;
- pruebas de teclado, zoom, lectores de pantalla, conectividad y estados no capturados.

No se confirmó visualmente una pérdida de datos, una operación destructiva sin diálogo ni un bloqueo global de toda la app. Esos aspectos tampoco quedan certificados: requieren inspección de código y pruebas vivas.

## 7. Problemas críticos

| Código | Estado | Problema | Alcance | Decisión inmediata |
|---|---|---|---|---|
| EVID-001 | Confirmado en evidencia | 63 interacciones móviles vigentes muestran otra ruta bajo un nombre incorrecto | Captura/regresión visual | P0: aislar navegación y recapturar antes de usar esas imágenes como prueba. |
| EVID-002 | Bloqueo de auditoría; causa de producto no confirmada | 20 grupos de rutas de negocio muestran 404 visual; 15 preventivos persisten en ambos lotes/viewports | Importaciones, Prevención y Soporte | P0: crear fixtures válidos y diferenciar 404 esperado de detalle operativo. |
| FORM-CORE-001 | Defecto de producto confirmado | Repuestos y Servicios inicializan “Tipo de solicitud: EPP” | Dos altas de uso operativo | P1 inmediato: corregir default, payload y resumen; validar solicitudes existentes. |
| RESP-TABLE-001 | Defecto visual confirmado | Tablas esconden columnas/acciones en móvil | Admin, Combustibles y Prevención | P1: adoptar representación móvil común antes de cierre responsive. |

No se asigna P0 de producto a los 404 sin comprobar el fixture y el lookup: hacerlo violaría la separación entre evidencia confirmada y causa inferida. Sí son P0 para la **validez de la auditoría**.

## 8. Hallazgos completos por pantalla

**Leyenda de certeza:** Confirmado = visible o reconciliado en captura/manifest; Riesgo probable = la captura muestra el riesgo, pero el comportamiento exige prueba; Información insuficiente = no hay estado válido para evaluarlo. La severidad describe impacto en el usuario; la prioridad también considera certeza y dependencia.

### 8.1 Matriz de evaluación individual

Los IDs son los del inventario. Cuando varias pantallas comparten exactamente el mismo patrón se consolidan en una fila; ninguna ruta inventariada queda fuera. “Conservar” significa que no se observó un problema visual relevante en el estado disponible, no que el comportamiento invisible esté certificado.

| ID | Problema o control observado | Evidencia visual | Impacto | Severidad | Recomendación |
|---|---|---|---|---|---|
| SCR-CORE-01–02 | Acceso y errores genéricos claros | `desktop/mobile-login.png`, `...forbidden.png`, `...not-found.png` | Recuperación comprensible | — | Conservar foco, copy y salidas; validar teclado/sesión. |
| SCR-CORE-03 | KPI duplicados y cola tardía móvil | `desktop/mobile-dashboard.png` | Scroll y prioridad diluida | Alta | Aplicar DASH-001. |
| SCR-CORE-04 | Muro de filtros y dos “Prioridad” | `mobile-pendientes.png` | Ensayo/error | Alta | Aplicar FILTER-001. |
| SCR-CORE-05–06 | Tracker, resumen y acciones claros | Solicitudes/Aprobaciones base | Buena continuidad | — | Conservar; recapturar select inválido. |
| SCR-CORE-07 | Tabs partidas y A4 encogido | `mobile-compras-detalle.png`, `mobile-compras-print.png` | Menor encontrabilidad/lectura | Media–alta | RESP-TAB-001 y A11Y-PRINT-001. |
| SCR-CORE-08–09 | Estados/leyenda operativa claros; comprobante móvil débil | Recepción/Entrega | Aprendizaje bueno; documento difícil | Media en print | Conservar flujo y separar preview/PDF. |
| SCR-CORE-10 | Tabla de trabajador comprimida | `mobile-trazabilidad-trabajador.png` | Asociación lenta | Media | TABLE-TRAZA-001. |
| SCR-CORE-11 | Cuatro exportes antes del resumen | `mobile-reportes.png` | Contenido retrasado | Media–alta | UI-REPORT-001. |
| SCR-CORE-12 | Cuatro KPI+filtros antes de vehículos | `mobile-flota.png` | Ineficiencia frecuente | Media | TASK-UI-006. |
| SCR-CORE-13–14 | Tipo EPP bajo entradas especializadas | Repuestos/Servicios nueva | Clasificación errónea | Alta | FORM-CORE-001. |
| SCR-CORE-15 | PPA extenso sin progreso | `mobile-ppa-form.png` | Fatiga/omisión | Media–alta | FORM-PPA-001. |
| SCR-CORE-16 | Error TAE sin salida y éxito sin repetición | `mobile-tae-access.png`, `...resultado.png` | Bloqueo/tiempo | Alta | TAE-ERR-001 y TAE-FLOW-002. |
| SCR-CORE-17 | Detalle Soporte con 404 visual | `desktop/mobile-soporte-detalle.png` | Seguimiento no auditable | Alta | EVID-002 y recovery contextual. |
| SCR-COMB-01 | Acción móvil sólo icono | `mobile-combustibles.png` | Baja descubribilidad | Media | Label/menú y target 44 px. |
| SCR-COMB-02 | Form largo; estado select inválido | `desktop/mobile-combustibles-nueva.png` | Carga y cobertura parcial | Media | Ancho form y recaptura. |
| SCR-COMB-03–06 | Detalles/canonicalización claros | Carga, reportes base, CC | Modelo comprensible | — | Conservar; no duplicar catálogos. |
| SCR-COMB-07 | Gráficos/filtros antes de facturas | `mobile-combustibles-facturas.png` | Registros tardíos | Media | DATA-VIZ-001. |
| SCR-COMB-08 | Importador segmentado | `desktop/mobile-combustibles-importar.png` | Complejidad controlada | — | Conservar stepper; completar detalles. |
| SCR-COMB-09–10 | Detalles 404 | archivos `...importar-detalle...` | Sin trazabilidad | Alta | EVID-002. |
| SCR-COMB-11 | Control TAE sobrecargado | `desktop/mobile-combustibles-tae.png` | Objetivo ambiguo | Alta | UX-IA-TAE-001. |
| SCR-COMB-12–13 | Corrección e importación base claras | TAE detalle/importar | Buena trazabilidad local | — | Conservar; mejorar vacío historial. |
| SCR-COMB-14 | Detalle lote TAE 404 | `desktop/mobile-combustibles-tae-importar-detalle.png` | Sin cierre | Alta | EVID-002. |
| SCR-COMB-15–16 | Conciliación/Análisis explicativos | Capturas base | Buena comprensión | — | Conservar lenguaje contextual. |
| SCR-COMB-17 | Reglas vacías y selects inválidos | Anomalías/Reglas | Sin siguiente paso/cobertura | Media | Empty state + recaptura. |
| SCR-COMB-18 | Filtros y tabla densos | `mobile-combustibles-bitacora.png` | Scroll bidimensional | Alta | RESP-TABLE-001 y regla filtros. |
| SCR-COMB-19 | Historial vuelve a lista | `desktop/mobile-combustibles-bitacora-historial.png` | Pérdida de entidad | Alta | Canonicalizar o implementar timeline. |
| SCR-COMB-20 | Vacío y CTA correctos | `mobile-combustibles-ciclo.png` | Orientación positiva | — | Conservar como referencia. |
| SCR-COMB-21 | Tabla/filtros recortados | `mobile-combustibles-sellos.png` | Datos ocultos | Alta | RESP-TABLE-001. |
| SCR-PREV-01 | Sidebar, tablas y “No calculable” | Prevención/Evaluaciones/Indicadores | Navegación/dato no accionable | Alta | UX-NAV-001, RESP-TABLE-001, DATA-IND-001. |
| SCR-PREV-02 | Actividades en error; ejecución 404 | `...pdtp-actividades.png`, `...ejecucion.png` | Bloqueo de programa | Alta | PDTP-STATE-001 y EVID-002. |
| SCR-PREV-03–06 | Listas visibles, detalles 404 | CAPA/Incidentes/MIPER/Legales | Flujos sin cierre | Crítica QA | EVID-002; mantener buenos prerrequisitos. |
| SCR-PREV-07–10 | Tablas/redirects/detalles sin fixture | Privacidad a Higiene | Acciones/datos no auditables | Alta | ResponsiveDataList + fixtures canónicos. |
| SCR-PREV-11 | Altas largas y detalles 404 | Emergencias/Cambio | Fricción y cobertura incompleta | Alta | Footer persistente + EVID-002. |
| SCR-PREV-12 | Base visible; select contaminado | EPP preventivo | Interacción no auditada | Alta QA | Recapturar. |
| SCR-PREV-13 | Biblioteca válida; cuatro rutas redirigen | Documentación | IA nominal confusa | Alta | Canonicalizar vistas/rutas. |
| SCR-PREV-14 | A4 móvil ilegible | `mobile-sst-print.png` | No puede revisarse en terreno | Alta | A11Y-PRINT-001. |
| SCR-PREV-15 | Base válida; tabs contaminados | PPA interno | Interacción no auditada | Alta QA | Recapturar y validar tablist. |
| SCR-ADM-01–02 | Hub y auditoría móvil excelentes | `mobile-admin.png`, `...auditoria.png` | Encontrabilidad/lectura positivas | — | Conservar como patrones. |
| SCR-ADM-03 | Tabla desktop-only | `mobile-admin-catalogos-productos.png` | Trabajo móvil limitado | Alta | RESP-TABLE-001. |
| SCR-ADM-04–05 | CRUD claro; formulario largo | Centros/Configuración | Riesgo de cambios no guardados | Media | Ancho form + dirty-state. |
| SCR-ADM-06 | Habilitado/no configurado | `mobile-admin-correo-smtp.png` | Falsa confianza | Alta | SYS-ADMIN-001. |
| SCR-ADM-07–13 | Hubs/tarjetas móviles coherentes | Faenas y flota catálogos | Buena eficiencia | —/Media targets | Conservar; auditar hitboxes. |
| SCR-ADM-14 | Códigos internos | `mobile-admin-folios.png` | Barrera de aprendizaje | Media | MICRO-001. |
| SCR-ADM-15–16 | Tabla desktop y cards de un field | Notificaciones/Parámetros | Densidad/guardado lejano | Media–alta | ResponsiveDataList y footer fijo. |
| SCR-ADM-17–18 | ID interno y vacío indirecto | PDTP catálogos/Plantillas | Error/ruta sin salida | Media | Generar ID + CTA directo. |
| SCR-ADM-19 | Productos bien; EPP desktop-only | `mobile-admin-productos.png`, `...epps.png` | Inconsistencia | Alta | Llevar EPP al patrón de Productos. |
| SCR-ADM-20 | Form desktop demasiado ancho | Producto alta/detalle | Escaneo lento | Media | FORM-LAYOUT-001. |
| SCR-ADM-21 | Detalle importación 404 | `desktop/mobile-admin-productos-importar.png` | Sin trazabilidad | Alta | EVID-002. |
| SCR-ADM-22 | Proveedores adapta bien | `mobile-admin-proveedores.png` | Patrón positivo | — | Conservar. |
| SCR-ADM-23 | Slugs y tabla desktop | `mobile-admin-roles.png` | Error de acceso/aprendizaje | Alta | FORM-ADMIN-001. |
| SCR-ADM-24–25 | Cambios/purgas de alto impacto no demostrados | Módulos/Seguridad | Riesgo operacional | Alta probable | SAFE-ADMIN-001 + matriz de estados. |
| SCR-ADM-26 | Suplencias vacío con CTA | `mobile-admin-suplencias.png` | Orientación positiva | — | Conservar como referencia. |
| SCR-ADM-27 | “Sembrar” y tabla limitada | Taxonomía | Tecnicismo/recorte | Media | MICRO-001 + ResponsiveDataList. |
| SCR-ADM-28 | Trabajadores adapta bien | `mobile-admin-trabajadores.png` | Patrón positivo | —/Riesgo privacidad | Conservar cards; aplicar PRIV-001. |
| SCR-ADM-29 | Alta de usuario extensa | `mobile-admin-usuarios-modal-auto-nuevo-usuario.png` | Permisos incorrectos | Alta | FORM-ADMIN-001. |
| SCR-ADM-30 | Seis KPI y estados contradictorios | `mobile-admin-backups.png` | Falsa seguridad | Alta | DASH-ADMIN-001. |

### 8.2 Fichas completas de hallazgos

### [EVID-001] Interacciones móviles atribuidas a otra ruta

- **Pantalla o módulo:** Captura automatizada transversal; especialmente Prevención, Combustibles, Analítica, Solicitudes, Aprobaciones, Trazabilidad, Mantenciones, Repuestos y Servicios.
- **Categoría:** Integridad de evidencia.
- **Severidad:** Crítica para auditoría; no atribuible como defecto del producto.
- **Frecuencia:** Recurrente.
- **Prioridad:** P0.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** 63 resultados vigentes confirmados. Ejemplo: `mobile-combustibles-nueva-select-seleccionar.png` solicita `/combustibles/nueva` y termina en `/compras/po-audit-1`; 40 casos preventivos terminan en Compras, Entregas o Solicitudes; 12 casos core actuales hacen lo mismo.
- **Problema:** El automatismo sigue interactuando tras abandonar la ruta y etiqueta el PNG con la pantalla original.
- **Impacto en el usuario:** No prueba un daño al usuario final; sí puede ocultar regresiones, producir falsos hallazgos y dejar 20+ interacciones sin auditar.
- **Principio de UI/UX afectado:** Validez, trazabilidad y reproducibilidad de investigación.
- **Recomendación concreta:** Reiniciar contexto antes de cada ruta, comprobar `pathname` antes/después de cada interacción y abortar con `capture-invalid` ante una URL no permitida.
- **Criterio de aceptación:** Cero `finalUrl` fuera de allowlist; cada desviación registra selector, URL y causa; una desviación no dispara acciones posteriores; dos corridas consecutivas limpias.
- **Dependencias o riesgos:** Harness Playwright, selectores semánticos, redirects canónicos y fixtures.

### [EVID-002] Veinte grupos de detalle no tienen evidencia operativa válida

- **Pantalla o módulo:** 15 detalles de Prevención; importaciones de Combustibles/TCT/TAE; importación de Productos; detalle de Soporte.
- **Categoría:** Cobertura de flujo y estados de error.
- **Severidad:** Crítica como bloqueo de auditoría; alta si el defecto reproduce con un registro real.
- **Frecuencia:** Recurrente en ambos lotes.
- **Prioridad:** P0 para cobertura; P1 producto hasta confirmar causa.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** `desktop/mobile-prevencion-incidentes-procedimiento.png`, `...pdtp-ejecucion.png`, `...capa-detalle.png`, `desktop/mobile-combustibles-importar-detalle.png`, `...tae-importar-detalle.png`, `desktop/mobile-admin-productos-importar.png` y `desktop/mobile-soporte-detalle.png` muestran “Recurso no encontrado”. El procedimiento de incidentes devuelve HTTP 404; Soporte muestra contenido 404 con HTTP 200.
- **Problema:** No es posible revisar detalle, edición, historial, acciones, seguimiento o cierre.
- **Impacto en el usuario:** Si reproduce en registros reales, interrumpe tareas operativas y de cumplimiento; si es sólo fixture, impide certificar esos flujos.
- **Principio de UI/UX afectado:** Continuidad, visibilidad de estado y recuperación contextual.
- **Recomendación concreta:** Sembrar un ID válido por entidad y conservar un caso 404 explícito separado. Para un registro inexistente, volver al listado específico con el ID y una acción contextual.
- **Criterio de aceptación:** Cada ruta de negocio tiene captura desktop/móvil válida y al menos un estado operativo; el caso inexistente usa status coherente y retorno contextual; pruebas cubren válido, eliminado y sin permiso.
- **Dependencias o riesgos:** Seed, scopes de faena, permisos, consultas y canonicalización.

### [EVID-003] Rutas, huérfanos y estados globales inflan la cobertura nominal

- **Pantalla o módulo:** Documentación, edición PDTP, privacidad, historial Bitácora y pipeline global.
- **Categoría:** Arquitectura de información y calidad de pruebas.
- **Severidad:** Alta para confiabilidad; media para producto.
- **Frecuencia:** Recurrente.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Bajo–medio.
- **Evidencia:** 94 PNG vigentes no aparecen en `results`; 11 referencias repiten screenshot; 66 PNG preventivos redirigen internamente; 18 de Bitácora muestran la lista en vez del historial. Menús de usuario/notificaciones se repiten cientos de veces como si fueran estados propios de cada ruta.
- **Problema:** Cantidad de capturas no equivale a cobertura de tareas. Algunas rutas nominales son aliases o redirects sin declarar.
- **Impacto en el usuario:** Para producto, enlaces guardados pueden perder contexto; para QA, se sobreestima cobertura y se dificulta detectar qué falta.
- **Principio de UI/UX afectado:** Ubicación predecible, consistencia y economía de prueba.
- **Recomendación concreta:** Declarar rutas canónicas/redirects en manifest; capturar overlays globales una vez por breakpoint; manifestar todo PNG o eliminarlo del resultado.
- **Criterio de aceptación:** Cero huérfanos/referencias duplicadas; toda ruta declara `canonical`, `redirectExpected` o `view`; historial preserva entidad/filtros o deja de anunciarse como detalle.
- **Dependencias o riesgos:** Compatibilidad con enlaces antiguos y cobertura de shell.

### [FORM-CORE-001] Repuestos y Servicios se abren como solicitudes EPP

- **Pantalla o módulo:** `/repuestos/nueva`, `/servicios/nueva`.
- **Categoría:** Formularios y prevención de errores.
- **Severidad:** Alta.
- **Frecuencia:** Recurrente en dos entradas.
- **Prioridad:** P1 inmediato.
- **Esfuerzo estimado:** Bajo–medio.
- **Evidencia:** `desktop/mobile-repuestos-nueva.png` y `desktop/mobile-servicios-nueva.png`. Aunque la URL final conserva `?tipo=repuestos` o `?tipo=servicios`, el selector muestra `EPP`; ambas capturas móviles son idénticas por hash.
- **Problema:** El formulario reemplaza la intención de la ruta con un valor por defecto incorrecto.
- **Impacto en el usuario:** Puede crear solicitudes mal clasificadas, enviarlas a la revisión equivocada o exigir una corrección que el usuario puede no advertir.
- **Principio de UI/UX afectado:** Continuidad de contexto, defaults seguros y prevención de errores.
- **Recomendación concreta:** Inicializar tipo desde un query validado, reflejarlo en selector, campos y resumen; fallback explícito ante valor inválido.
- **Criterio de aceptación:** `tipo=repuestos` muestra/envía Repuestos; `tipo=servicios` muestra/envía Servicios; el resumen coincide y sólo cambia por una acción deliberada; prueba desktop/móvil del payload.
- **Dependencias o riesgos:** Enum, Server Action, borradores y solicitudes ya creadas desde esos accesos.

### [RESP-TABLE-001] Las tablas no tienen un contrato móvil común

- **Pantalla o módulo:** Roles, Seguridad, Notificaciones, EPP, Catálogos, Taxonomía, Bitácora, Sellos, Evaluaciones, Incidentes, Aplicabilidad, Permisos, Privacidad y Brechas.
- **Categoría:** Responsive, tablas y accesibilidad.
- **Severidad:** Alta.
- **Frecuencia:** Global/recurrente.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Alto.
- **Evidencia:** `mobile-admin-roles.png`, `mobile-admin-seguridad.png`, `mobile-combustibles-sellos.png`, `mobile-prevencion-evaluaciones.png`, `mobile-prevencion-privacidad-auditoria.png` y `mobile-prevencion-pdtp-aplicabilidad.png`. Algunas declaran “Pensada para escritorio”; otras cortan encabezados, valores o CTA a la derecha.
- **Problema:** Algunas entidades usan tarjetas móviles correctas y otras encogen una tabla o dependen de scroll interno sin affordance.
- **Impacto en el usuario:** Datos/acciones parecen inexistentes, la comparación requiere scroll bidimensional y aumentan errores táctiles.
- **Principio de UI/UX afectado:** Reflow, consistencia y adecuación al dispositivo.
- **Recomendación concreta:** Crear un contrato `ResponsiveDataList`: tabla desde 768 px y tarjetas/description list en móvil con 3–5 campos esenciales y “Ver detalle”. Reservar scroll para matrices genuinas, con columna clave fija e indicador.
- **Criterio de aceptación:** En 320 y 390 px se ven identificación, estado y acción sin recorte; no aparece “mejor desde computador”; orden, filtro y paginación siguen disponibles; reflow cumple [WCAG 2.2 SC 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
- **Dependencias o riesgos:** Definir campos esenciales por dominio sin perder eficiencia desktop.

### [UX-NAV-001] El sidebar de Prevención es largo y trunca opciones

- **Pantalla o módulo:** Shell de Prevención desktop.
- **Categoría:** Arquitectura de información y navegación.
- **Severidad:** Alta.
- **Frecuencia:** Global en Prevención.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** `desktop-prevencion.png`, `desktop-prevencion-pdtp.png`, `desktop-prevencion-documentacion.png`: “Programa de tr…”, “Incidentes y d…”, “Capacitación y…”, “Inspecciones y…”. Los hijos PDTP prolongan la lista bajo el viewport.
- **Problema:** Varias etiquetas comparten el mismo prefijo visible y exigen recordar qué opción truncada corresponde a cada función.
- **Impacto en el usuario:** Búsqueda más lenta y errores de navegación, especialmente en usuarios principiantes.
- **Principio de UI/UX afectado:** Reconocimiento sobre recuerdo y orientación.
- **Recomendación concreta:** Mantener agrupamiento, pero usar etiquetas breves inequívocas, ancho útil suficiente, tooltip/focus label accesible y scroll propio estable; mostrar activo y ancestros.
- **Criterio de aceptación:** Cada opción se identifica a 1280 px; activa y padre permanecen visibles; tooltip funciona con mouse, foco y tacto; no reduce el lienzo por debajo de su ancho operativo.
- **Dependencias o riesgos:** Equilibrio entre ancho de sidebar y zona principal; validar con vocabulario real.

### [DASH-001] Dashboard repite estados y retrasa el trabajo en móvil

- **Pantalla o módulo:** `/dashboard`.
- **Categoría:** Jerarquía, dashboard y eficiencia.
- **Severidad:** Alta.
- **Frecuencia:** Recurrente dentro de la pantalla.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** `desktop-dashboard.png` repite críticos/vencidos/sin asignar/aprobaciones en KPI, chips de cola y “Requiere atención”; `mobile-dashboard.png` dedica varias tarjetas verticales antes de la cola. El lote anterior era más compacto en móvil.
- **Problema:** Una misma dimensión aparece en dos o tres representaciones y compite con la lista accionable.
- **Impacto en el usuario:** Aumenta scroll, diluye la prioridad y puede dar la impresión de más problemas de los que existen.
- **Principio de UI/UX afectado:** Una dimensión = una representación, jerarquía y test de cinco segundos.
- **Recomendación concreta:** Usar máximo cuatro métricas accionables, convertir secundarios en tira compacta y hacer de la cola la superficie dominante; un clic en métrica filtra la misma cola.
- **Criterio de aceptación:** No se repite un conteo en tile, alerta y chip; a 390×844 aparece la primera tarea o estado vacío; cada KPI tiene periodo, unidad y acción.
- **Dependencias o riesgos:** Mantener lectura gerencial sin penalizar al operador.

### [FILTER-001] Pendientes presenta un muro de filtros y controles ambiguos

- **Pantalla o módulo:** `/pendientes` y variante vencida.
- **Categoría:** Filtros, microcopy y eficiencia.
- **Severidad:** Alta.
- **Frecuencia:** Recurrente.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Bajo–medio.
- **Evidencia:** `mobile-pendientes.png`: búsqueda + “Buscar”, siete chips de estado, “Todas las prioridades”, “Prioridad”, módulo, faena y “Más filtros” antes de la lista.
- **Problema:** Hay más de seis controles primarios y dos etiquetas de prioridad cuyo efecto no se distingue visualmente.
- **Impacto en el usuario:** Ensayo/error, pérdida de tiempo y primera tarea fuera del viewport.
- **Principio de UI/UX afectado:** Divulgación progresiva, claridad de etiquetas y reducción de carga.
- **Recomendación concreta:** Dejar búsqueda, estado, faena y orden visibles; mover secundarios a “Más filtros (N)”; si el segundo control ordena, llamarlo “Ordenar por prioridad”; chips activos removibles.
- **Criterio de aceptación:** Máximo seis controles primarios; ninguna dimensión duplicada; filtros activos visibles/removibles y persistentes al volver; primera tarea visible en 390×844.
- **Dependencias o riesgos:** Confirmar frecuencia real de cada filtro y persistencia de URL.

### [TAE-ERR-001] El error de preparación TAE no ofrece recuperación

- **Pantalla o módulo:** `/tae/access/capture-tae-token`.
- **Categoría:** Error, feedback y uso en terreno.
- **Severidad:** Alta.
- **Frecuencia:** Aislada pero bloqueante.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Bajo–medio.
- **Evidencia:** `desktop/mobile-tae-access.png`: “No se pudo preparar este dispositivo. Habilita el almacenamiento…” sin botón de reintento, pasos, soporte ni alternativa.
- **Problema:** Informa una causa general, pero deja al trabajador fuera del flujo.
- **Impacto en el usuario:** El operador debe adivinar cómo cambiar permisos o abandonar la operación.
- **Principio de UI/UX afectado:** Recuperación ante errores, control del usuario y ayuda contextual.
- **Recomendación concreta:** Añadir “Reintentar”, instrucciones breves por causa detectada, alternativa de navegador/dispositivo y contacto de soporte; diferenciar storage bloqueado, privado y token expirado.
- **Criterio de aceptación:** Existe recuperación ejecutable sin recarga manual; la causa no se sobreafirma; funciona a 320 px y teclado; cada error registra un código de soporte.
- **Dependencias o riesgos:** Detección técnica de causa y comportamiento offline.

### [TAE-FLOW-002] El resultado TAE no facilita la operación repetitiva

- **Pantalla o módulo:** `/tae/resultado/capture-tae-result-token`.
- **Categoría:** Cierre de flujo y eficiencia.
- **Severidad:** Media–alta.
- **Frecuencia:** Recurrente para operadores de terreno.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Bajo.
- **Evidencia:** `desktop/mobile-tae-resultado.png` comunica validación y `85,5 L`, pero no muestra “Registrar otra carga”, “Volver a escanear” ni retorno al punto TAE.
- **Problema:** El éxito confirma el evento, pero no conecta con la siguiente repetición natural.
- **Impacto en el usuario:** Obliga a usar atrás, reabrir QR o pedir instrucciones, elevando tiempo por carga.
- **Principio de UI/UX afectado:** Cierre de tarea y siguiente acción explícita.
- **Recomendación concreta:** CTA primario “Registrar otra carga” y secundario “Ver comprobante/Finalizar”, conservando el punto autorizado cuando corresponda.
- **Criterio de aceptación:** Desde éxito se inicia otra captura en un toque; no se duplica la carga anterior; expiración/autorización se comunica antes de reusar.
- **Dependencias o riesgos:** Seguridad del token y prevención de duplicados.

### [FORM-PPA-001] PPA exige un recorrido muy largo sin progreso visible

- **Pantalla o módulo:** `/ppa`.
- **Categoría:** Formularios, carga cognitiva y terreno.
- **Severidad:** Media–alta.
- **Frecuencia:** Recurrente.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** `mobile-ppa-form.png` ocupa aproximadamente cinco viewports: identificación, tarea, dos decisiones, ocho checks, cuatro textareas, decisión final y CTA. `desktop-ppa-form.png` conserva la misma secuencia larga.
- **Problema:** No se muestra progreso, resumen de campos pendientes ni acción persistente; cuatro textareas críticas aparecen aunque la criticidad todavía no está contextualizada visualmente.
- **Impacto en el usuario:** Mayor abandono, omisiones y fatiga, especialmente en terreno o con poca experiencia digital.
- **Principio de UI/UX afectado:** Visibilidad de progreso, carga de memoria y divulgación progresiva.
- **Recomendación concreta:** Mantener la lógica de seguridad en 3 secciones progresivas o una página con índice/progreso sticky; revelar requisitos críticos según tarea y preservar respuestas.
- **Criterio de aceptación:** Usuario conoce sección y porcentaje; errores enfocan el campo; volver no borra; la decisión final mantiene todo el contexto; flujo completo funciona offline.
- **Dependencias o riesgos:** Fragmentar no debe ocultar relaciones de seguridad; validar con prevencionistas y trabajadores.

### [PDTP-STATE-001] Actividades PDTP abre en error sin salida

- **Pantalla o módulo:** `/prevencion/pdtp/actividades`.
- **Categoría:** Estado de error y flujo.
- **Severidad:** Alta.
- **Frecuencia:** Aislada en una función principal.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** `desktop/mobile-prevencion-pdtp-actividades.png`: “El programa no contiene la hoja seleccionada”; selector “Hoja” vacío y sin CTA operativo.
- **Problema:** El error identifica una inconsistencia, pero no permite elegir una hoja válida ni corregir el programa.
- **Impacto en el usuario:** Bloquea consulta/ejecución de actividades y obliga a buscar manualmente otra superficie.
- **Principio de UI/UX afectado:** Recuperación, ayuda contextual y siguiente acción.
- **Recomendación concreta:** Seleccionar una hoja válida por defecto; si no existe, explicar requisito, programa y responsable, con “Gestionar programa” o “Volver a Programas”.
- **Criterio de aceptación:** Programa válido abre una hoja; programa incompleto muestra causa, responsable y CTA con contexto/año preservados.
- **Dependencias o riesgos:** Contrato de Base PDTP y permisos de catálogo.

### [DATA-IND-001] “No calculable” no explica qué dato falta

- **Pantalla o módulo:** `/prevencion/indicadores`.
- **Categoría:** Dashboard, feedback y datos.
- **Severidad:** Alta.
- **Frecuencia:** Recurrente.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** `desktop/mobile-prevencion-indicadores.png`: varios KPI repiten “No calculable” sin señalar denominador, periodo ni responsable.
- **Problema:** El estado no se convierte en una tarea corregible.
- **Impacto en el usuario:** No se puede cerrar el periodo ni confiar en el indicador; se incrementa soporte y búsqueda manual.
- **Principio de UI/UX afectado:** Información accionable y diagnóstico de error.
- **Recomendación concreta:** Sustituir por mensajes específicos: “Faltan HH de julio”, “Falta dotación promedio” o “Faltan días perdidos”, con CTA a Denominadores.
- **Criterio de aceptación:** Cada KPI identifica campo, periodo y responsable; CTA abre el control exacto; al guardar se recalcula y confirma.
- **Dependencias o riesgos:** Contrato del motor canónico y permisos de edición.

### [FORM-ADMIN-001] Alta de usuario expone permisos antes de resolver rol y alcance

- **Pantalla o módulo:** `/admin/usuarios`, `/admin/roles`.
- **Categoría:** Formularios, seguridad y microcopy.
- **Severidad:** Alta.
- **Frecuencia:** Recurrente.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Medio–alto.
- **Evidencia:** `desktop/mobile-admin-usuarios-modal-auto-nuevo-usuario.png`: datos, asociación, vigencia, roles y lista extensa de permisos como `admin:audit_log`; `mobile-admin-roles.png` muestra slugs como `jefa_chome`.
- **Problema:** Rol, alcance y excepciones compiten en un único momento; el usuario debe interpretar claves internas.
- **Impacto en el usuario:** Riesgo de acceso excesivo, contradictorio o incompleto.
- **Principio de UI/UX afectado:** Defaults seguros, reconocimiento y minimización de errores.
- **Recomendación concreta:** Flujo rol primero → faenas/alcance → resumen → excepciones avanzadas colapsadas; mostrar diferencias contra el rol.
- **Criterio de aceptación:** Alta estándar se completa sin ver claves; toda excepción enumera permiso agregado/retirado y exige revisión final; resumen expresa acceso en lenguaje de negocio.
- **Dependencias o riesgos:** Compatibilidad RBAC y usuarios con overrides existentes.

### [SAFE-ADMIN-001] Cambios globales de módulos no muestran salvaguarda

- **Pantalla o módulo:** `/admin/modulos`.
- **Categoría:** Prevención de errores y seguridad de interacción.
- **Severidad:** Alta como riesgo probable.
- **Frecuencia:** Recurrente.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** `mobile-admin-modulos.png` avisa “Los cambios surten efecto inmediato en la navegación” junto a switches de módulos/submódulos. Ninguna captura demuestra confirmación, dependencias o deshacer.
- **Problema:** La consecuencia es amplia y el control parece inmediato.
- **Impacto en el usuario:** Un toque accidental puede ocultar procesos a múltiples perfiles.
- **Principio de UI/UX afectado:** Reversibilidad, control y prevención de acciones de alto impacto.
- **Recomendación concreta:** Confirmar con módulo, hijos y usuarios afectados; bloquear dependencias inválidas; ofrecer undo temporal y auditoría.
- **Criterio de aceptación:** Desactivar exige confirmación contextual; no quedan hijos activos bajo padre inactivo; toast permite deshacer; actor/hora quedan registrados.
- **Dependencias o riesgos:** Debe validarse comportamiento actual en código y reglas de dependencia.

### [SYS-ADMIN-001] Correo parece activo aunque el proveedor no está configurado

- **Pantalla o módulo:** `/admin/correo-smtp`.
- **Categoría:** Estado del sistema y confianza.
- **Severidad:** Alta.
- **Frecuencia:** Aislada con alcance global.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** `mobile-admin-correo-smtp.png`: “Enviar correos del sistema” aparece marcado; “Resend” figura “No configurado” y solicita `RESEND_API_KEY`.
- **Problema:** La intención habilitada y la capacidad real se comunican como estados separados y contradictorios.
- **Impacto en el usuario:** El administrador puede creer que invitaciones/notificaciones están saliendo cuando no existe canal operativo.
- **Principio de UI/UX afectado:** Correspondencia con estado real y confianza.
- **Recomendación concreta:** Estado agregado “Suspendido: proveedor no configurado”; deshabilitar semánticamente el envío efectivo; habilitar prueba tras configurar.
- **Criterio de aceptación:** Nunca se muestra “activo” sin proveedor saludable; prueba registra fecha/destinatario/resultado; fallo da una corrección concreta.
- **Dependencias o riesgos:** Confirmar que el checkbox expresa intención y no salud antes de cambiar etiquetas.

### [DASH-ADMIN-001] Respaldos convierte ausencia de evidencia en éxito

- **Pantalla o módulo:** `/admin/backups`.
- **Categoría:** Dashboard, estados y seguridad operacional.
- **Severidad:** Alta.
- **Frecuencia:** Aislada.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Bajo–medio.
- **Evidencia:** `mobile-admin-backups.png`: seis KPI; “Último fallido — Sin fallos” aparece verde pese a “Sin respaldos”, mientras “Respaldos (7 días) — 0 ejecutados” aparece rojo.
- **Problema:** “Nunca ejecutado” se interpreta simultáneamente como saludable y crítico.
- **Impacto en el usuario:** Falsa confianza sobre recuperabilidad y prioridad confusa.
- **Principio de UI/UX afectado:** Integridad semántica de métricas y estados vacíos.
- **Recomendación concreta:** Estado principal “Nunca se ha ejecutado un respaldo”, máximo tres datos de decisión y CTA “Configurar y respaldar”; verde sólo con ejecución exitosa verificable.
- **Criterio de aceptación:** Sin respaldo nunca produce verde; fecha, destino, edad y resultado de última ejecución son inequívocos; máximo cuatro KPI accionables.
- **Dependencias o riesgos:** Monitorización real, política de retención y restauración.

### [MICRO-001] Slugs, siglas y términos técnicos invaden la interfaz

- **Pantalla o módulo:** Roles, usuarios, PDTP, Folios, Taxonomía y Prevención transversal.
- **Categoría:** Microcopy, legibilidad y aprendizaje.
- **Severidad:** Media–alta.
- **Frecuencia:** Global/recurrente.
- **Prioridad:** P1 para acceso; P2 resto.
- **Esfuerzo estimado:** Bajo–medio.
- **Evidencia:** `mobile-admin-pdtp-catalogos-modal-auto-nuevo-responsable.png` usa `rol_rbac`; `mobile-admin-folios.png` muestra `next_document_code`; `mobile-admin-taxonomia-sst.png` usa “Sembrar”; Prevención usa MIPER, PDTP, CAPA, PPA, LOTO y HH sin expansión estable.
- **Problema:** El usuario debe conocer implementación o siglas antes de aprender la tarea.
- **Impacto en el usuario:** Más errores, capacitación y percepción de fragilidad.
- **Principio de UI/UX afectado:** Hablar el lenguaje del usuario y reconocimiento.
- **Recomendación concreta:** Generar IDs; mover claves a avanzado; “Cargar categorías base”; expandir sigla en primera aparición/tooltip accesible.
- **Criterio de aceptación:** Tarea estándar no exige escribir/interpretar slugs; toda sigla se explica al primer uso; ayudas incluyen ejemplo real.
- **Dependencias o riesgos:** Mantener claves internas estables y acordar glosario de dominio.

### [UI-CONS-001] Fechas, horas y unidades usan formatos inconsistentes

- **Pantalla o módulo:** Dashboard, evaluaciones, PPA, trazabilidad y detalles operativos.
- **Categoría:** Consistencia y legibilidad.
- **Severidad:** Media.
- **Frecuencia:** Recurrente.
- **Prioridad:** P2.
- **Esfuerzo estimado:** Bajo.
- **Evidencia:** `desktop-dashboard.png` usa `02-08-2026 00:53`; `mobile-prevencion-detalle.png` muestra `09/06/2026`; PPA combina fecha con `8:00 a.m.`; `mobile-trazabilidad-trabajador.png` muestra “2 unidad”.
- **Problema:** Una misma dimensión cambia de separador, hora y pluralización.
- **Impacto en el usuario:** Comparación más lenta y riesgo de interpretar fecha/hora de forma distinta.
- **Principio de UI/UX afectado:** Consistencia y reducción de ambigüedad.
- **Recomendación concreta:** Estándar visible `dd-MM-yyyy`, `HH:mm` o formato textual cuando ayude; pluralización/unidades centralizadas; zona horaria cuando sea relevante.
- **Criterio de aceptación:** Misma fecha se representa igual en todos los módulos; pruebas cubren fecha, fecha/hora, moneda, litros y singular/plural.
- **Dependencias o riesgos:** Impresos legales pueden requerir formato propio claramente documentado.

### [EMPTY-001] Los estados vacíos no ofrecen una salida uniforme

- **Pantalla o módulo:** EPP, historial TAE, reglas de anomalías, plantillas y varios módulos preventivos.
- **Categoría:** Estados vacíos y orientación.
- **Severidad:** Media.
- **Frecuencia:** Recurrente.
- **Prioridad:** P2.
- **Esfuerzo estimado:** Bajo.
- **Evidencia:** `mobile-admin-epps.png` sólo dice “Sin resultados”; `mobile-combustibles-tae-importar-historial.png` muestra “0 lotes”; Plantillas explica restauración pero lleva a “Revisar configuración”. En contraste, Ciclo, Suplencias y MIPER sí dan CTA útil.
- **Problema:** El patrón oscila entre informativo/accionable y una ausencia sin siguiente paso.
- **Impacto en el usuario:** Rutas sin salida y más soporte.
- **Principio de UI/UX afectado:** Orientación y ayuda contextual.
- **Recomendación concreta:** Adoptar patrón: significado en lenguaje de usuario + cómo poblar + CTA real o razón de no ofrecerlo.
- **Criterio de aceptación:** Todo vacío incluye esos tres elementos; CTA respeta permisos y vuelve con contexto; búsquedas sin resultado permiten limpiar filtros.
- **Dependencias o riesgos:** No mostrar acciones no autorizadas como si estuvieran disponibles.

### [UX-IA-TAE-001] Control TAE mezcla captura, analítica y mantenimiento

- **Pantalla o módulo:** `/combustibles/tae`.
- **Categoría:** Arquitectura de pantalla y jerarquía.
- **Severidad:** Alta.
- **Frecuencia:** Recurrente dentro de la pantalla.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Medio–alto.
- **Evidencia:** `desktop/mobile-combustibles-tae.png`: conciliación, importación, exportación, cuatro métricas, gráficos, generación QR, filtros y registros; “Exportar Ex…” aparece truncado en móvil.
- **Problema:** No existe un objetivo dominante en cinco segundos.
- **Impacto en el usuario:** El principiante debe interpretar varias tareas antes de actuar; el experto recorre contenido no necesario.
- **Principio de UI/UX afectado:** Foco y divulgación progresiva.
- **Recomendación concreta:** Página como resumen/control; “Crear punto TAE” abre Sheet/página; importación/conciliación/exportación van a “Más acciones”; gráficos secundarios plegables.
- **Criterio de aceptación:** A 390×844 se ven contexto, una acción primaria, máximo cuatro métricas y comienzo de registros; ninguna etiqueta se trunca.
- **Dependencias o riesgos:** Preservar accesos directos para operadores frecuentes.

### [UI-REPORT-001] Cuatro exportes monopolizan Reportes

- **Pantalla o módulo:** `/reportes`.
- **Categoría:** Acciones y jerarquía.
- **Severidad:** Media–alta.
- **Frecuencia:** Recurrente.
- **Prioridad:** P2.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** `desktop-reportes.png` envuelve acciones en TopBar; `mobile-reportes.png` muestra cuatro botones antes de cualquier métrica. “Exportar ítems sin OC” usa naranja de señal.
- **Problema:** Acciones equivalentes compiten con el propósito informativo y el color confunde acción con pendiente.
- **Impacto en el usuario:** Retrasa comprensión y obliga a comparar etiquetas similares antes de ver datos.
- **Principio de UI/UX afectado:** Prioridad, divulgación progresiva y color semántico.
- **Recomendación concreta:** Un botón “Exportar” con diálogo de cuatro opciones, descripción y filtros; recordar última opción.
- **Criterio de aceptación:** Header no envuelve a 1280/1440/1920; métricas aparecen primero en móvil; los cuatro resultados siguen siendo `.xlsx`.
- **Dependencias o riesgos:** Añade un clic; compensar con memoria de preferencia.

### [DATA-VIZ-001] Gráficos móviles ofrecen poco contexto accionable

- **Pantalla o módulo:** Combustibles Reportes, Facturas y TAE.
- **Categoría:** Visualización y legibilidad.
- **Severidad:** Media.
- **Frecuencia:** Recurrente.
- **Prioridad:** P2.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** `mobile-combustibles-reportes.png`, `mobile-combustibles-facturas.png`, `mobile-combustibles-tae.png`: ejes/ticks pequeños, paneles altos y registros desplazados; Reportes muestra una serie de un solo punto con bajo valor analítico.
- **Problema:** El marco del gráfico recibe más espacio que la conclusión; precio usa naranja reservado en otras superficies para atención.
- **Impacto en el usuario:** Lectura lenta, baja utilidad en terreno y ambigüedad semántica.
- **Principio de UI/UX afectado:** Integridad de visualización, jerarquía y no depender del color.
- **Recomendación concreta:** Resumen textual, periodo/unidad visibles, una unidad por eje, estado alternativo para un solo punto y paleta de charts documentada.
- **Criterio de aceptación:** Cada gráfico responde una pregunta; valor clave existe como texto; labels no se solapan; series se distinguen por más que color; datos accionables aparecen antes.
- **Dependencias o riesgos:** Validar con datasets vacíos, un punto y alta densidad.

### [RESP-TAB-001] Tabs de OC e Indicadores pierden cohesión en móvil

- **Pantalla o módulo:** Detalle OC e Indicadores SST.
- **Categoría:** Navegación local y responsive.
- **Severidad:** Media–alta.
- **Frecuencia:** Recurrente.
- **Prioridad:** P2.
- **Esfuerzo estimado:** Bajo–medio.
- **Evidencia:** `mobile-compras-detalle-facturacion.png`: “Historial 4” queda sola en segunda fila; `mobile-prevencion-indicadores-tab-datos-del-sistema-anterior.png` trunca el label y algunos estados colocan título bajo el header sticky.
- **Problema:** Una tab parece separada y tabs largos dejan de ser identificables.
- **Impacto en el usuario:** Baja encontrabilidad y pérdida de orientación al cambiar de vista.
- **Principio de UI/UX afectado:** Agrupación, estado activo y reflow.
- **Recomendación concreta:** Tablist horizontal con affordance/auto-scroll o grid 2×2 estable; corregir offset y restauración de scroll.
- **Criterio de aceptación:** Todas las tabs pertenecen visualmente al mismo control a 320–430 px; activo y contador visibles; ningún título queda oculto al 200 %.
- **Dependencias o riesgos:** Parte del offset podría ser harness; validar en navegador real.

### [TABLE-TRAZA-001] Historial EPP comprime código, fecha y unidades

- **Pantalla o módulo:** `/trazabilidad/trabajador/worker-audit-1`.
- **Categoría:** Tabla y legibilidad.
- **Severidad:** Media.
- **Frecuencia:** Aislada.
- **Prioridad:** P2.
- **Esfuerzo estimado:** Bajo.
- **Evidencia:** `mobile-trazabilidad-trabajador.png`: `ENT-2026-0001` se parte en tres líneas, cuatro columnas estrechas y “2 unidad”.
- **Problema:** Se conserva estructura desktop cuando ya no permite leer una fila como unidad.
- **Impacto en el usuario:** Asociación lenta o errónea entre producto, fecha y cantidad.
- **Principio de UI/UX afectado:** Proximidad, legibilidad y adaptación.
- **Recomendación concreta:** Tarjeta/description list por entrega o dos columnas primarias con detalle expandible; pluralización correcta.
- **Criterio de aceptación:** Código, fecha, producto y cantidad se leen a 320 px con cuerpo base; relación inequívoca y acceso a comprobante.
- **Dependencias o riesgos:** Conservar orden y paginación para historiales largos.

### [A11Y-PRINT-001] Documentos A4 se vuelven ilegibles en móvil

- **Pantalla o módulo:** Print SST, OC y entrega.
- **Categoría:** Responsive, legibilidad y documentos.
- **Severidad:** Alta para revisión en terreno.
- **Frecuencia:** Recurrente.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** `mobile-sst-print.png`, `mobile-compras-print.png`, `mobile-entregas-print.png`: hoja completa encogida a 390 px; SST deja unos 190 px útiles de contenido y texto ilegible.
- **Problema:** La previsualización intenta encajar una hoja densa completa en el viewport.
- **Impacto en el usuario:** No puede revisar información antes de descargar, imprimir o firmar.
- **Principio de UI/UX afectado:** Legibilidad, zoom/reflow y equivalencia móvil.
- **Recomendación concreta:** Vista resumen HTML con “Abrir documento”/“Descargar PDF”; si existe preview, zoom/paneo explícito y controles accesibles.
- **Criterio de aceptación:** Información esencial legible sin zoom del navegador; acciones 44×44; PDF A4 se valida como artefacto independiente.
- **Dependencias o riesgos:** La captura no prueba que el PDF descargado sea ilegible; probar preview y archivo por separado.

### [A11Y-TOUCH-001] Acciones compactas por icono tienen bajo reconocimiento táctil

- **Pantalla o módulo:** Usuarios, trabajadores, productos, proveedores, faenas y vehículos.
- **Categoría:** Accesibilidad y prevención de error.
- **Severidad:** Media, alta en eliminar/desactivar.
- **Frecuencia:** Recurrente.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** `mobile-admin-usuarios.png`, `mobile-admin-productos.png`, `mobile-admin-flota-vehiculos.png`: lápiz, switch y papelera pequeños/próximos; el hitbox no es medible desde PNG.
- **Problema:** La función depende del icono y el área visual no hace evidente un target cómodo.
- **Impacto en el usuario:** Pulsación errónea o baja descubribilidad, especialmente en terreno o con destreza reducida.
- **Principio de UI/UX afectado:** Target size, nombre accesible y prevención de errores.
- **Recomendación concreta:** Hitbox 44×44 de producto en móvil, 8 px de separación, label/tooltip y aislamiento de acciones destructivas. WCAG AA exige al menos 24×24 CSS px salvo excepciones; Chome debe conservar su estándar superior de 44 px. Véase [WCAG 2.2 SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
- **Criterio de aceptación:** DOM confirma 44×44; nombre accesible, foco visible y operación por teclado; destruir no queda adyacente sin separación/confirmación.
- **Dependencias o riesgos:** Inspección de código requerida para conocer hitbox real.

### [PRIV-001] RUT completos aparecen en listados y selectores amplios

- **Pantalla o módulo:** Evaluaciones, trabajador, PPA y selección de trabajadores.
- **Categoría:** Privacidad por diseño.
- **Severidad:** Alta como riesgo; cumplimiento no confirmado.
- **Frecuencia:** Recurrente.
- **Prioridad:** P1.
- **Esfuerzo estimado:** Bajo–medio.
- **Evidencia:** `mobile-prevencion-evaluaciones.png`, `mobile-prevencion-detalle.png`, `mobile-prevencion-trabajador-detalle.png`, `desktop-prevencion-nueva-select-busca-y-selecciona-trabaj.png`.
- **Problema:** Nombre y RUT se muestran completos incluso en vistas de lista o despliegues susceptibles de proyección/captura.
- **Impacto en el usuario:** Exposición accidental de datos personales.
- **Principio de UI/UX afectado:** Minimización y privacidad por defecto.
- **Recomendación concreta:** Matriz rol/vista; enmascarar en listados no privilegiados y conservar completo sólo donde la tarea lo requiera.
- **Criterio de aceptación:** Necesidad de cada exposición documentada; listados enmascaran según rol; exportes, logs y screenshots aplican la misma regla.
- **Dependencias o riesgos:** Validación legal/operacional; no ocultar un identificador indispensable para seguridad.

### [FORM-LAYOUT-001] Formularios anchos o largos pierden proximidad y estado

- **Pantalla o módulo:** Carga manual, producto nuevo/detalle, configuración, parámetros y modales preventivos.
- **Categoría:** Formularios y responsive.
- **Severidad:** Media.
- **Frecuencia:** Recurrente.
- **Prioridad:** P2.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** `desktop-combustibles-nueva.png`, `desktop-admin-productos-nuevo.png` estiran campos; `mobile-admin-parametros-operativos.png` apila muchas tarjetas; varios modales preventivos no muestran CTA final en el viewport capturado.
- **Problema:** Etiqueta/valor se separan en escritorio y Guardar queda lejos en móvil; dirty-state y teclado no pueden verificarse.
- **Impacto en el usuario:** Escaneo lento, abandono o pérdida de cambios.
- **Principio de UI/UX afectado:** Proximidad, visibilidad de estado y control.
- **Recomendación concreta:** Ancho `form` 640–896 px, grupos por objetivo, footer persistente “Cambios sin guardar / Guardar”, valores preservados tras error.
- **Criterio de aceptación:** Etiqueta/control próximos; CTA accesible con teclado virtual/zoom 200 %; abandonar con cambios permite conservar/descartar; error no borra datos.
- **Dependencias o riesgos:** Dirty-state no es visible en capturas y requiere prueba funcional.

### [UI-NOTIF-001] Notificaciones usa popover de escritorio en móvil

- **Pantalla o módulo:** Shell móvil.
- **Categoría:** Overlay, navegación y accesibilidad.
- **Severidad:** Media.
- **Frecuencia:** Global.
- **Prioridad:** P2.
- **Esfuerzo estimado:** Medio.
- **Evidencia:** estados `mobile-admin-*-modal-auto-1.png`: panel de aproximadamente 330 px cubre título/acciones; no se observa cierre ni “Ver todas”.
- **Problema:** El popover ocupa casi todo el viewport sin adoptar patrón móvil.
- **Impacto en el usuario:** Pérdida de contexto y cierre/historial poco descubribles.
- **Principio de UI/UX afectado:** Adecuación responsive, foco y control.
- **Recomendación concreta:** Sheet móvil con título, cierre explícito, “Marcar todas leídas”, “Ver todas”, focus trap y restauración; conservar popover desktop.
- **Criterio de aceptación:** Cierre visible y Escape; foco no queda oculto —alineado con [WCAG 2.2 SC 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)—; cada notificación abre su recurso; historial accesible.
- **Dependencias o riesgos:** La semántica ARIA actual requiere código; evitar duplicar dos componentes con comportamiento divergente.

## 9. Problemas sistémicos

### 9.1 Dos contratos responsive incompatibles — confirmado

Catálogos modernos convierten filas en tarjetas móviles; otras pantallas conservan tablas desktop, muestran avisos “Pensada para escritorio” o recortan contenido. La inconsistencia obliga al usuario a reaprender cómo ver acciones y detalles. Solución: un contrato compartido con tabla densa para expertos en desktop y resumen accionable en móvil, no una tabla universalmente simplificada.

### 9.2 Cobertura nominal distinta de cobertura de tareas — confirmado

El set es amplio, pero overlays globales, redirects, huérfanos, duplicados y 404 consumen muchas imágenes. La métrica de calidad debe ser “flujos válidos × estados relevantes × viewports”, no cantidad de PNG.

### 9.3 Jerarquía dominada por tarjetas y controles — confirmado

Dashboard, Flota, Respaldos, TAE y varios módulos preventivos usan demasiados KPI o ceros. Reportes y Pendientes colocan acciones/filtros antes del contenido. El compromiso adecuado es conservar resumen gerencial, pero compactarlo en móvil y hacer cada métrica accionable.

### 9.4 Estado vacío, cero y error no forman un lenguaje único — confirmado

MIPER, Ciclo y Suplencias son buenos; EPP e historial TAE son mínimos; Backups usa verde sin evidencia; Indicadores repite “No calculable”; PDTP Actividades y TAE error carecen de recuperación. Se necesita un sistema de estados con causa, impacto, siguiente acción y soporte.

### 9.5 La IA de Prevención creció más rápido que la navegación — confirmado

El módulo cubre PDTP, CAPA, incidentes, MIPER, privacidad, capacitación, permisos, inspecciones, CPHS, higiene, emergencias, cambio y documentación. El hub móvil funciona mejor como catálogo; el sidebar desktop trunca. Se recomienda mejorar agrupación/etiquetas y canonicalización incremental, no un rediseño total.

### 9.6 Vocabulario de implementación visible — confirmado

Slugs, `rol_rbac`, `next_document_code`, “Sembrar” y siglas sin expansión elevan la barrera para usuarios con baja alfabetización digital. La interfaz debe mostrar lenguaje de negocio y reservar códigos a una sección avanzada o copiable.

### 9.7 Acciones sensibles no están sistemáticamente demostradas — riesgo probable

Las capturas muestran buenas protecciones al cancelar y crear OC, pero no prueban confirmación, loading, doble envío o undo al desactivar módulos, eliminar, purgar o ejecutar acciones masivas. No se acusa una falla donde no hay evidencia; se exige una matriz de validación.

### 9.8 Accesibilidad visual razonable, accesibilidad real no certificada — información insuficiente

Se ven controles grandes, texto de estado y algunos focos. PNG no confirma orden DOM, names, roles, live regions, focus trap, contraste calculado, reduced motion ni lector de pantalla. Los contrastes deben verificarse contra [WCAG 2.2 AA: 4,5:1 para texto normal y 3:1 para texto grande](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), además de [3:1 para límites/estados visuales de componentes](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

### 9.9 Contexto de terreno tratado de forma desigual — confirmado/riesgo

PPA e Incidentes consideran offline; TAE falla por storage sin salida; documentos se encogen; formularios largos y tablas dificultan uso con una mano. Hay que validar teclado virtual, glare, conectividad, reintento, idempotencia y cola offline.

### 9.10 Rendimiento percibido sin evidencia suficiente — información insuficiente

No hay capturas confiables de skeleton, operación en proceso, red lenta o layout shift. Pantallas con muchas tarjetas/gráficos podrían sentirse pesadas, pero eso requiere medición. El plan incluye estados y métricas sin afirmar un problema de rendimiento real.

## 10. Análisis de flujos

| Flujo | Flujo actual inferido | Problemas detectados | Flujo mejorado propuesto | Reducción estimada | Riesgos de implementación |
|---|---|---|---|---:|---|
| Solicitud → aprobación → OC → recepción → entrega | Crear solicitud → aprobar/devolver → agrupar OC → facturación/avance → recibir → entregar | Tipo incorrecto en Repuestos/Servicios; tabs OC quebradas; prints móviles | Conservar pasos; fijar intención en entrada, resumen persistente y tabs cohesivas | 0 pasos; elimina 1 corrección frecuente | No alterar reglas ni trazabilidad existentes. |
| Pendientes | Buscar/filtrar → elegir tarea → resolver → volver | 10+ controles; dos “Prioridad”; contexto/persistencia no probados | 4 filtros primarios + Más filtros (N), chips removibles y retorno con estado | 2–4 interacciones por consulta repetida | Identificar filtros realmente frecuentes. |
| Bodega → entrega → trazabilidad | Stock → movimiento/entrega → comprobante → Kardex/trabajador | Historial móvil comprimido; documento encogido | Tarjeta móvil por entrega, comprobante accesible y retorno con entidad | 0 pasos; menor lectura | Mantener comparación y paginación expertas. |
| Importación Combustibles | Seleccionar fuente → cargar/mapear → ejecutar → historial → detalle | Tres detalles 404; coverage inválida | Stepper con resumen, errores por fila y detalle válido | 0–1 clic; cierra el flujo | Fixture vs lookup debe resolverse primero. |
| TAE administrativo | Resumen → crear QR/capturar → validar/corregir → bitácora/conciliar | Demasiados objetivos; acciones truncadas | Resumen con CTA único; creación en Sheet; analítica secundaria; trazabilidad separada | 1 decisión visible menos | Preservar atajos para expertos. |
| TAE público | Preparar dispositivo → registrar → resultado | Error sin recuperación; éxito sin repetir | Diagnóstico → Reintentar/alternativa → registro idempotente → Repetir/Finalizar | Ahorra navegación manual | Seguridad de token y duplicados. |
| PPA público | Identificación → evaluación → controles → desarrollo crítico → autorización → resultado | Cinco viewports; sin progreso; carga cognitiva | 3 secciones o índice sticky, condicionales y preservación offline | No necesariamente menos campos; 30–50 % menos carga visible | No fragmentar contexto de seguridad. |
| PDTP | Programa → detalle → actividades/aplicabilidad/acciones/aprobación/reporte | Actividades en error; ejecución 404; reselección de año/faena | Persistir contexto, resolver hoja antes de entrar, CTA a prerequisito | 2–3 reselecciones por pantalla | Contrato de Base y permisos. |
| Incidente → CAPA | Reportar → detalle/investigar → procedimiento → acción → cierre | Reporte visible; detalle/procedimiento/CAPA sin fixture | Borrador offline → folio → investigación → CAPA vinculada → verificación/cierre | No estimable hasta tener detalle | Idempotencia, evidencia legal y scopes. |
| Indicadores SST | Elegir periodo/faena → ver KPI → denominadores → recalcular | “No calculable” sin dato faltante; tabs recortadas | KPI enlaza al denominador exacto y retorna recalculado | 2–4 clics de diagnóstico | Motor canónico y bloqueo de cierre. |
| Usuarios y acceso | Crear usuario → elegir roles/faenas/permisos → confirmar | Demasiadas decisiones y claves crudas | Rol → alcance → resumen → excepciones avanzadas | 1–2 bloques cognitivos | Migrar overrides sin perder control. |
| Administración operativa | SMTP/backups/módulos/folios | Estados contradictorios; alto impacto no demostrado | Panel de salud, prerequisitos, confirmación, undo y auditoría | 1–2 clics de diagnóstico | Cambios globales requieren rollback. |

Las reducciones son hipótesis de diseño; deben medirse con tareas reales. No se prometen reducciones en flujos cuyo detalle sólo mostró 404.

## 11. Matriz de priorización

| Código | Hallazgo | Certeza | Severidad | Frecuencia | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|
| EVID-001 | Interacciones capturadas fuera de ruta | Confirmado | Crítica QA | Recurrente | Medio | P0 |
| EVID-002 | 20 grupos sin detalle operativo válido | Confirmado como evidencia | Crítica QA / Alta producto | Recurrente | Medio | P0 QA / P1 producto |
| EVID-003 | Redirects, huérfanos y overlays inflan cobertura | Confirmado | Alta QA | Global | Bajo–medio | P1 |
| FORM-CORE-001 | Repuestos/Servicios cargan EPP | Confirmado | Alta | Recurrente | Bajo–medio | P1 |
| RESP-TABLE-001 | Tablas sin contrato móvil | Confirmado | Alta | Global | Alto | P1 |
| UX-NAV-001 | Sidebar Prevención truncado | Confirmado | Alta | Global módulo | Medio | P1 |
| DASH-001 | Dashboard duplica estados | Confirmado | Alta | Recurrente | Medio | P1 |
| FILTER-001 | Muro de filtros Pendientes | Confirmado | Alta | Recurrente | Bajo–medio | P1 |
| TAE-ERR-001 | Error TAE sin recuperación | Confirmado | Alta | Aislada bloqueante | Bajo–medio | P1 |
| TAE-FLOW-002 | Éxito TAE sin repetir | Confirmado | Media–alta | Recurrente | Bajo | P1 |
| FORM-PPA-001 | PPA largo sin progreso | Confirmado | Media–alta | Recurrente | Medio | P1 |
| PDTP-STATE-001 | Actividades sin recuperación | Confirmado | Alta | Aislada principal | Medio | P1 |
| DATA-IND-001 | KPI no identifica dato faltante | Confirmado | Alta | Recurrente | Medio | P1 |
| FORM-ADMIN-001 | Permisos demasiado pronto | Confirmado | Alta | Recurrente | Medio–alto | P1 |
| SAFE-ADMIN-001 | Módulos sin salvaguarda visible | Riesgo probable | Alta | Recurrente | Medio | P1 |
| SYS-ADMIN-001 | Correo activo/no configurado | Confirmado visual | Alta | Aislada global | Medio | P1 |
| DASH-ADMIN-001 | Backups comunica falso éxito | Confirmado | Alta | Aislada | Bajo–medio | P1 |
| MICRO-001 | Lenguaje interno y siglas | Confirmado | Media–alta | Global | Bajo–medio | P1/P2 |
| UI-CONS-001 | Formatos de fecha/unidad inconsistentes | Confirmado | Media | Recurrente | Bajo | P2 |
| EMPTY-001 | Vacíos sin salida uniforme | Confirmado | Media | Recurrente | Bajo | P2 |
| UX-IA-TAE-001 | TAE mezcla objetivos | Confirmado | Alta | Recurrente | Medio–alto | P1 |
| UI-REPORT-001 | Cuatro exportes dominan Reportes | Confirmado | Media–alta | Recurrente | Medio | P2 |
| DATA-VIZ-001 | Gráficos móviles poco accionables | Confirmado | Media | Recurrente | Medio | P2 |
| RESP-TAB-001 | Tabs partidas/truncadas | Confirmado | Media–alta | Recurrente | Bajo–medio | P2 |
| TABLE-TRAZA-001 | Historial EPP comprimido | Confirmado | Media | Aislada | Bajo | P2 |
| A11Y-PRINT-001 | A4 ilegible en móvil | Confirmado preview | Alta | Recurrente | Medio | P1 |
| A11Y-TOUCH-001 | Acciones por icono compactas | Riesgo probable | Media/Alta | Recurrente | Medio | P1 |
| PRIV-001 | RUT completos en listados | Riesgo confirmado visual | Alta | Recurrente | Bajo–medio | P1 |
| FORM-LAYOUT-001 | Formularios anchos/largos | Confirmado + riesgo | Media | Recurrente | Medio | P2 |
| UI-NOTIF-001 | Popover desktop en móvil | Confirmado visual | Media | Global | Medio | P2 |

## 12. Quick wins

| Quick win | Impacto | Esfuerzo | Criterio inmediato |
|---|---|---|---|
| Inicializar Repuestos/Servicios desde query | Evita clasificación errónea | Bajo | Selector, resumen y payload coinciden. |
| Añadir Reintentar/Soporte en TAE error | Recupera flujo bloqueado | Bajo | CTA ejecutable y causa útil. |
| Añadir “Registrar otra carga” al éxito TAE | Acelera repetición | Bajo | Nueva captura en un toque, sin duplicado. |
| Renombrar segundo control de Pendientes | Elimina ambigüedad | Bajo | “Ordenar por prioridad” o dimensión real. |
| Normalizar fecha/hora/unidades | Mejora comparación | Bajo | Un formatter compartido visible. |
| Reemplazar “Sembrar” por “Cargar categorías base” | Reduce tecnicismo | Bajo | Lenguaje de negocio. |
| Ocultar slugs bajo “Avanzado” | Reduce error administrativo | Bajo | Flujo estándar sin claves internas. |
| CTA específico en PDTP Actividades | Evita callejón sin salida | Bajo | Gestionar programa/volver con contexto. |
| Mensaje específico en KPI “No calculable” | Convierte dato en tarea | Bajo–medio | Campo/periodo/CTA visibles. |
| Vacíos de EPP/TAE con CTA | Reduce rutas muertas | Bajo | Significado + acción real. |
| Compactar KPI móviles en Flota/Dashboard | Acerca trabajo | Bajo–medio | Lista visible en primer viewport. |
| Agrupar cuatro exportes en un diálogo | Limpia header | Medio | Un CTA y cuatro Excel disponibles. |
| Etiquetas completas en acciones móviles | Mejora descubribilidad | Bajo | Sin truncamiento a 320 px. |
| Tooltip/focus label para sidebar truncado | Mejora reconocimiento | Bajo | Mouse, foco y tacto. |
| Fallar capturas ante `finalUrl` inesperada | Protege evidencia futura | Medio | Cero falsos positivos de ruta. |

## 13. Plan de mejora por fases

### Fase 0: Correcciones críticas

| Acción | Problema que resuelve | Prioridad | Esfuerzo | Dependencias | Resultado esperado |
|---|---|---:|---:|---|---|
| Aislar capturas y recapturar 63 estados | EVID-001 | P0 | Medio | Harness/fixtures | Evidencia trazable y utilizable. |
| Sembrar y probar 20 detalles válidos | EVID-002 | P0 QA | Medio–alto | DB, RBAC, scopes | Flujos completos auditables. |
| Corregir tipo Repuestos/Servicios | FORM-CORE-001 | P1 inmediato | Bajo–medio | Enum/actions | Cero solicitudes mal clasificadas. |
| Corregir/reencauzar PDTP Actividades | PDTP-STATE-001 | P1 | Medio | Base PDTP | Actividades accesibles o error recuperable. |
| Dar recuperación a TAE | TAE-ERR-001 | P1 | Bajo–medio | Detección/token | Operador puede continuar. |

### Fase 1: Fundamentos del sistema

| Acción | Problema que resuelve | Prioridad | Esfuerzo | Dependencias | Resultado esperado |
|---|---|---:|---:|---|---|
| Contrato `ResponsiveDataList` | RESP-TABLE-001 | P1 | Alto | Definición de campos | Consistencia móvil sin perder desktop. |
| Matriz de estados Empty/Error/Loading/Success | EMPTY-001 y feedback | P1 | Medio | DS/copy | Causa y siguiente acción uniformes. |
| Formalizar tipografía, spacing, paleta, borde y focus | Inconsistencias visuales/A11Y | P1 | Medio | Tokens y contraste | Reglas reutilizables y verificables. |
| Unificar Button, Field, DatePicker y controles | Formularios/acciones | P1 | Medio–alto | Componentes compartidos | Misma jerarquía, validación y target. |
| Glosario y formatters | MICRO-001, UI-CONS-001 | P1/P2 | Medio | Dominio/i18n | Terminología y datos coherentes. |
| Regla máxima de KPI/filtros | DASH-001, FILTER-001 | P1 | Medio | Analítica producto | Jerarquía consistente. |
| Jerarquía de acciones y peligro | SAFE-ADMIN-001 | P1 | Medio | Permisos/auditoría | Acciones predecibles y seguras. |
| Canonicalizar rutas/redirects | EVID-003 | P1 | Medio | Compatibilidad | IA y manifest coherentes. |

### Fase 2: Mejora de flujos prioritarios

| Acción | Problema que resuelve | Prioridad | Esfuerzo | Dependencias | Resultado esperado |
|---|---|---:|---:|---|---|
| Rediseño incremental de Pendientes | FILTER-001 | P1 | Medio | URL/persistencia | Menos controles y retorno preservado. |
| Simplificar Control TAE | UX-IA-TAE-001 | P1 | Medio–alto | Roles/analítica | Objetivo primario inequívoco. |
| Progreso/condicionales PPA | FORM-PPA-001 | P1 | Medio–alto | Reglas SST/offline | Menor carga sin perder seguridad. |
| Rol primero en Usuarios | FORM-ADMIN-001 | P1 | Medio–alto | RBAC | Defaults seguros y revisión clara. |
| Acción desde KPI no calculable | DATA-IND-001 | P1 | Medio | Motor indicador | Corrección directa. |
| Reordenar Dashboard/Flota/Reportes | DASH-001, UI-REPORT-001 | P1/P2 | Medio | Priorización | Trabajo visible antes que resumen. |
| Reconciliar SMTP/Backups | SYS/DASH-ADMIN-001 | P1 | Medio | Salud backend | Estado operativo veraz. |

### Fase 3: Accesibilidad y responsive

| Acción | Problema que resuelve | Prioridad | Esfuerzo | Dependencias | Resultado esperado |
|---|---|---:|---:|---|---|
| Migrar tablas prioritarias a tarjetas móviles | RESP-TABLE-001 | P1 | Alto | Diseño por entidad | Sin datos/acciones cortados. |
| Targets 44 px y names accesibles | A11Y-TOUCH-001 | P1 | Medio | Componentes UI | Menos errores táctiles. |
| Vista HTML/zoom para documentos | A11Y-PRINT-001 | P1 | Medio | Rutas print/PDF | Revisión móvil legible. |
| Teclado, foco, live regions y dialogs | Riesgos A11Y | P1 | Alto | Auditoría código | WCAG AA verificable. |
| Reflow/zoom/breakpoints | Responsive global | P1 | Alto | Suite visual | 320 px, 200/400 %, tablet sin pérdida. |
| Política de RUT visible | PRIV-001 | P1 | Medio | Legal/RBAC | Minimización por rol. |

### Fase 4: Refinamiento visual

| Acción | Problema que resuelve | Prioridad | Esfuerzo | Dependencias | Resultado esperado |
|---|---|---:|---:|---|---|
| Afinar tabs, overlays y formularios | RESP-TAB/UI-NOTIF/FORM-LAYOUT | P2 | Medio | Fundamentos | Ritmo y foco consistentes. |
| Normalizar gráficos y paleta de datos | DATA-VIZ-001 | P2 | Medio | Datasets reales | Lectura clara y semántica estable. |
| Unificar vacíos y ayudas | EMPTY-001 | P2 | Bajo–medio | Microcopy | Próxima acción siempre clara. |
| Pulir alineación/iconografía/focus | Calidad percibida | P2/P3 | Medio | A11Y completa | Refinamiento sin ocultar función. |
| Motion discreto con reduced-motion | Feedback percibido | P3 | Medio | DS | Cambios comprensibles, no decorativos. |

### Fase 5: Validación

| Acción | Problema que resuelve | Prioridad | Esfuerzo | Dependencias | Resultado esperado |
|---|---|---:|---:|---|---|
| Pruebas de usabilidad por rol | Valida prioridades | P1 | Medio | Prototipos/datos | Evidencia de éxito y tiempo. |
| Auditoría WCAG automatizada + manual | Cierra accesibilidad | P1 | Alto | Fase 3 | Informe AA con excepciones. |
| Recaptura canónica before/after | Compara visualmente | P1 | Medio | EVID-001/002 | Manifest limpio y diferencias útiles. |
| Prueba E2E de flujos completos | Cierra estados | P1 | Alto | Fixtures | Éxito, error, permisos y recovery. |
| Medición de rendimiento percibido | Valida riesgo | P2 | Medio | Observabilidad | LCP/INP/CLS + duración operacional. |
| Revisión final go/no-go | Cierra release | P1 | Bajo | Gates anteriores | Veredicto sustentado. |

## 14. Plan técnico de implementación

### [TASK-UI-001] Hacer determinista el pipeline de capturas

- **Objetivo:** Garantizar que cada PNG representa la ruta y el control declarados.
- **Descripción:** Aislar estado/navegación por ruta, verificar URL y reconciliar manifest/archivos.
- **Pantallas afectadas:** Todas; recaptura prioritaria de los 63 estados actuales inválidos.
- **Componentes afectados:** Capturador Playwright, inventario de rutas, manifest, fixtures.
- **Cambios requeridos:** Allowlist de pathname/query por ruta; abortar ante desvío; capturar overlays globales una vez; registrar selector, requested/final URL, estado y hash; cero huérfanos.
- **Reglas visuales:** Nombre de archivo, ruta, viewport y estado deben ser legibles en artefactos/manifest; no simular cobertura con duplicados.
- **Reglas de interacción:** Cada caso comienza en contexto limpio y falla rápido ante navegación no permitida.
- **Estados que deben diseñarse:** `capture-ok`, `capture-invalid`, `expected-redirect`, `expected-404`, `fixture-missing`.
- **Responsive:** Ejecutar 390×844 y desktop; añadir 320×568, 768 y 1366×768 al gate selectivo.
- **Accesibilidad:** Capturas de foco/teclado separadas de hover; no asumir equivalencia.
- **Criterios de aceptación:** Dos corridas consecutivas sin URL inesperada, huérfanos, referencias repetidas ni archivos faltantes; 63 casos regenerados.
- **Prioridad:** P0.
- **Esfuerzo:** Medio.
- **Dependencias:** Seeds, auth, redirects canónicos.
- **Riesgos:** Una allowlist demasiado rígida puede rechazar navegación legítima; versionarla por ruta.
- **Evidencia requerida:** Manifest diff, lista de casos recapturados, resumen cero-invalid y muestras desktop/móvil.

### [TASK-UI-002] Crear fixtures válidos para todos los detalles operativos

- **Objetivo:** Auditar y probar cierre de flujo, no sólo 404.
- **Descripción:** Sembrar una entidad válida para los 20 grupos y conservar un ID inexistente independiente.
- **Pantallas afectadas:** Detalles de Prevención, importaciones Combustibles/TAE/Productos y Soporte.
- **Componentes afectados:** Seed de captura, loaders de detalle, NotFound contextual, enlaces de listados.
- **Cambios requeridos:** IDs y relaciones/scope válidos; status HTTP coherente; retorno específico; prueba lista→detalle.
- **Reglas visuales:** Error contextual identifica entidad/ID sin exponer datos; vista válida conserva jerarquía del módulo.
- **Reglas de interacción:** La fila abre su detalle; volver restaura lista; ID inválido ofrece recuperación específica.
- **Estados que deben diseñarse:** válido, eliminado, sin permiso, no encontrado, carga y error recuperable.
- **Responsive:** Estado válido y error en 390/desktop; detalle priorizado en móvil.
- **Accesibilidad:** Título de error anunciado; foco en mensaje; enlace de retorno descriptivo.
- **Criterios de aceptación:** Cada grupo abre contenido operativo en dos viewports; 404 esperado queda identificado; Soporte no renderiza 404 con status 200.
- **Prioridad:** P0 QA / P1 producto.
- **Esfuerzo:** Medio–alto.
- **Dependencias:** DB, scopes de faena, RBAC y datos relacionados.
- **Riesgos:** Un seed demasiado privilegiado puede ocultar fallas de scope; probar varios roles.
- **Evidencia requerida:** E2E de cada familia, manifest limpio y capturas de válido/error.

### [TASK-UI-003] Preservar el tipo de solicitud desde Repuestos y Servicios

- **Objetivo:** Evitar clasificación incorrecta.
- **Descripción:** Resolver y validar `tipo` antes de construir el formulario y el payload.
- **Pantallas afectadas:** `/repuestos/nueva`, `/servicios/nueva`, `/solicitudes/nueva`.
- **Componentes afectados:** Formulario de solicitud, selector de tipo, resumen, Server Action/validación.
- **Cambios requeridos:** Default desde query; fallback explícito; campos dependientes y resumen sincronizados.
- **Reglas visuales:** Tipo visible y consistente en selector, ayuda y resumen; error de query no queda silencioso.
- **Reglas de interacción:** Inicializar una sola vez desde query; cambiar tipo requiere selección deliberada y actualiza campos dependientes.
- **Estados que deben diseñarse:** tipo válido, inválido, cambio deliberado, error y borrador restaurado.
- **Responsive:** Mismo valor y feedback en móvil/desktop.
- **Accesibilidad:** Cambio de campos dependientes anunciado; label persistente.
- **Criterios de aceptación:** Repuestos y Servicios muestran/envían su tipo; pruebas verifican payload y UI; ninguna mutación silenciosa a EPP.
- **Prioridad:** P1 inmediato.
- **Esfuerzo:** Bajo–medio.
- **Dependencias:** Enum y reglas de campos por tipo.
- **Riesgos:** Enlaces/borradores históricos pueden contener valores legacy; migrar o advertir.
- **Evidencia requerida:** Tests unitarios/E2E, capturas de ambos tipos y registro creado verificado.

### [TASK-UI-004] Implementar `ResponsiveDataList`

- **Objetivo:** Unificar tablas y tarjetas según dispositivo.
- **Descripción:** Componente/patrón con tabla densa desktop y resumen móvil configurable.
- **Pantallas afectadas:** Todas las listadas en RESP-TABLE-001 y TABLE-TRAZA-001.
- **Componentes afectados:** `DataTable`, renderer móvil, paginación, acciones de fila, empty state.
- **Cambios requeridos:** 3–5 campos esenciales, estado y CTA; tabla desde 768 px; scroll sólo para matrices con affordance/columna fija.
- **Reglas visuales:** Identidad, estado y acción dominan la tarjeta; desktop conserva alineación numérica y headers.
- **Reglas de interacción:** Orden, selección, paginación y filtros persisten al cambiar de representación.
- **Estados que deben diseñarse:** carga, vacío, sin resultado, error, seleccionado, acción pendiente y permisos.
- **Responsive:** 320/390/768/1024; sin datos esenciales cortados; densidad desktop preservada.
- **Accesibilidad:** Semántica tabla en desktop, listas/encabezados correctos en móvil, foco y nombre de acciones.
- **Criterios de aceptación:** Cero aviso “pensada para escritorio”; identificación/estado/acción visibles; teclado/zoom 200 % sin pérdida.
- **Prioridad:** P1.
- **Esfuerzo:** Alto.
- **Dependencias:** Priorización de campos por dominio.
- **Riesgos:** Resumir en exceso puede ocultar datos expertos; validar campos por tarea.
- **Evidencia requerida:** Story/fixture de alta densidad, screenshots por breakpoint y pruebas axe/teclado.

### [TASK-UI-005] Reestructurar navegación de Prevención sin cambiar su identidad

- **Objetivo:** Mejorar encontrabilidad manteniendo módulos existentes.
- **Descripción:** Revisar agrupaciones, etiquetas y canonicalización; no reconstruir la app.
- **Pantallas afectadas:** Sidebar y hub `/prevencion`; rutas redirigidas de PDTP, documentación y privacidad.
- **Componentes afectados:** Sidebar, nav registry, active matcher, tooltip, hub móvil.
- **Cambios requeridos:** Labels breves inequívocos, grupos por tarea, scroll estable, ancestros visibles, rutas canónicas explícitas.
- **Reglas visuales:** Label completo o inequívoco, activo/ancestro visibles y jerarquía de grupos consistente.
- **Reglas de interacción:** Scroll de sidebar no mueve contenido; foco/tooltip revela nombre; móvil usa catálogo/Sheet.
- **Estados que deben diseñarse:** activo, padre activo, colapsado, sin permiso, tooltip/foco.
- **Responsive:** Sidebar desktop; catálogo/sheet móvil; acceso a todos los módulos a 320 px.
- **Accesibilidad:** Navegación por teclado, `aria-current`, labels completos accesibles.
- **Criterios de aceptación:** Ninguna opción indistinguible a 1280; activo/ancestro visible; redirects declarados y sin rutas fantasma.
- **Prioridad:** P1.
- **Esfuerzo:** Medio.
- **Dependencias:** Vocabulario de negocio y enlaces guardados.
- **Riesgos:** Aumentar sidebar reduce lienzo; probar 1280 y preservar enlaces antiguos.
- **Evidencia requerida:** Tree test, capturas 1280/1920/390 y tests active-route/RBAC.

### [TASK-UI-006] Compactar métricas y filtros antes del trabajo

- **Objetivo:** Superar el test de cinco segundos en móvil y escritorio pequeño.
- **Descripción:** Aplicar máximo cuatro KPI accionables y 4–6 filtros primarios.
- **Pantallas afectadas:** Dashboard, Flota, Pendientes, Backups, CAPA, Incidentes, Capacitación, Permisos, Higiene y Emergencias.
- **Componentes afectados:** `KpiCard`, tira de métricas, barra de filtros, chips, `MoreFilters`.
- **Cambios requeridos:** Eliminar duplicados, compactar secundarios, CTA en cero/vacío, filtro activo removible y persistente.
- **Reglas visuales:** Máximo cuatro tiles y seis filtros primarios; la lista/CTA aparece antes que secundarios.
- **Reglas de interacción:** KPI filtra/navega; chips se remueven; “Más filtros (N)” refleja activos.
- **Estados que deben diseñarse:** datos, cero, no calculable, vacío, filtrado, sin resultados.
- **Responsive:** Primer registro/CTA visible a 390×844; desktop 1366×768 sin muro.
- **Accesibilidad:** KPI accionable como control con nombre/estado; chips removibles por teclado.
- **Criterios de aceptación:** Máximo cuatro tiles; máximo seis filtros visibles; una métrica no aparece tres veces; estado cero conduce a acción.
- **Prioridad:** P1.
- **Esfuerzo:** Medio.
- **Dependencias:** Priorización de métricas y analítica de uso.
- **Riesgos:** Ocultar un filtro frecuente añade fricción; basarse en telemetría/usuarios.
- **Evidencia requerida:** Before/after, prueba de cinco segundos y conteo DOM automatizado.

### [TASK-UI-007] Hacer progresivo y recuperable el PPA público

- **Objetivo:** Reducir carga sin debilitar el control de seguridad.
- **Descripción:** Organizar el formulario en secciones/progreso y activar campos críticos según tarea.
- **Pantallas afectadas:** `/ppa` y resultado.
- **Componentes afectados:** Form PPA, selección de tarea, validación, persistencia offline, progress indicator.
- **Cambios requeridos:** Tres secciones o índice sticky; pendientes; errores con foco; respuestas preservadas; CTA final contextual.
- **Reglas visuales:** Progreso y sección siempre visibles; sólo campos relevantes; resumen de pendientes claro.
- **Reglas de interacción:** Avanzar valida sin borrar; volver preserva; offline/online no duplica.
- **Estados que deben diseñarse:** borrador, offline, sincronizando, error, incompleto, autorizado/no autorizado, expirado.
- **Responsive:** Una mano, teclado virtual, 320×568 y orientación horizontal.
- **Accesibilidad:** Fieldsets/legends, error summary, live region y orden lógico.
- **Criterios de aceptación:** Progreso visible; volver no borra; error enfoca; condicionales correctos; flujo offline→sync probado.
- **Prioridad:** P1.
- **Esfuerzo:** Medio–alto.
- **Dependencias:** Reglas SST y validación con usuarios.
- **Riesgos:** Dividir puede ocultar contexto crítico; mantener resumen global y probar comprensión.
- **Evidencia requerida:** Test con prevencionistas/trabajadores, E2E offline y capturas por sección.

### [TASK-UI-008] Completar recuperación y repetición del TAE público

- **Objetivo:** Evitar callejones sin salida en terreno.
- **Descripción:** Diagnóstico accionable en acceso y siguiente acción en éxito.
- **Pantallas afectadas:** `/tae/access/...`, `/tae/resultado/...`, `/tae`.
- **Componentes afectados:** Storage bootstrap, error state, result state, token lifecycle.
- **Cambios requeridos:** Reintentar, instrucciones/alternativa, soporte, “Registrar otra carga”, Finalizar y prevención de duplicados.
- **Reglas visuales:** Una causa, un CTA primario y alternativa secundaria; éxito muestra volumen/estado y siguiente paso.
- **Reglas de interacción:** Reintento/repetición son idempotentes; token inválido no reutiliza datos anteriores.
- **Estados que deben diseñarse:** storage bloqueado, privado, token expirado, offline, enviando, duplicado, éxito.
- **Responsive:** CTA principal visible a 320/390; uso con una mano.
- **Accesibilidad:** Error anunciado, foco en CTA, instrucciones no sólo por color.
- **Criterios de aceptación:** Toda causa conocida tiene recuperación; éxito repite en un toque; reintento es idempotente.
- **Prioridad:** P1.
- **Esfuerzo:** Medio.
- **Dependencias:** Seguridad de token y API idempotente.
- **Riesgos:** Reusar autorización puede ampliar acceso; definir expiración y punto autorizado.
- **Evidencia requerida:** E2E por causa, prueba en Safari/Chrome móvil y video de recuperación.

### [TASK-UI-009] Convertir errores PDTP/Indicadores en tareas accionables

- **Objetivo:** Permitir que el usuario corrija prerequisitos desde el punto de fallo.
- **Descripción:** Resolver hoja por defecto y enlazar KPI al dato faltante.
- **Pantallas afectadas:** PDTP Actividades, Nuevo/Obligaciones, Indicadores/Denominadores.
- **Componentes afectados:** Selector de programa/hoja, error state, KPI, deep links.
- **Cambios requeridos:** Causa, periodo, responsable y CTA; conservar año/faena/programa; recalcular al volver.
- **Reglas visuales:** Estado fallido nombra el dato exacto y destaca una sola acción correctiva.
- **Reglas de interacción:** Deep link abre el campo correcto y retorna al KPI/actividad con contexto.
- **Estados que deben diseñarse:** programa válido/incompleto, hoja ausente, dato faltante, recalculando, cerrado.
- **Responsive:** CTA y causa visibles sin scroll excesivo.
- **Accesibilidad:** Anuncio de recalculo y foco/restauración tras retorno.
- **Criterios de aceptación:** Ningún “No calculable” genérico; programa incompleto tiene salida; contexto persiste.
- **Prioridad:** P1.
- **Esfuerzo:** Medio.
- **Dependencias:** Base PDTP y motor de indicadores.
- **Riesgos:** Contexto stale al volver; revalidar programa/periodo antes de recalcular.
- **Evidencia requerida:** E2E de corrección ida/vuelta y capturas antes/después.

### [TASK-UI-010] Diseñar acceso administrativo “rol primero”

- **Objetivo:** Reducir errores de permisos.
- **Descripción:** Separar rol, alcance y excepciones con resumen final.
- **Pantallas afectadas:** Usuarios y Roles.
- **Componentes afectados:** Drawer de usuario, role selector, worksite scope, permission diff.
- **Cambios requeridos:** Defaults por rol; excepciones colapsadas; lenguaje de negocio; revisión de agregado/retirado.
- **Reglas visuales:** Secuencia y resumen expresan acceso por rol/faena; claves internas fuera del flujo estándar.
- **Reglas de interacción:** Rol aplica defaults; excepción muestra diff; combinación inválida se bloquea con causa.
- **Estados que deben diseñarse:** rol sin alcance, conflicto, permiso heredado/directo, vigente/expirado, guardando/error.
- **Responsive:** Footer persistente, secciones plegables y teclado virtual.
- **Accesibilidad:** Grupos/leyendas, descripción de estado de selección y resumen navegable.
- **Criterios de aceptación:** Flujo estándar sin claves; overrides explícitos; no se crea combinación inválida; permisos resultantes verificables.
- **Prioridad:** P1.
- **Esfuerzo:** Medio–alto.
- **Dependencias:** RBAC, scopes y migración de overrides.
- **Riesgos:** Herencia/override complejos pueden mostrarse mal; validar contra permisos efectivos.
- **Evidencia requerida:** Matriz de permisos, tests por rol y sesión de usabilidad admin.

### [TASK-UI-011] Unificar salud de correo, respaldos y módulos

- **Objetivo:** Comunicar capacidad real y proteger cambios globales.
- **Descripción:** Derivar estado agregado de backend y añadir confirmación/undo/auditoría.
- **Pantallas afectadas:** Correo SMTP, Backups, Módulos, Seguridad/Notificaciones.
- **Componentes afectados:** Health status, KPI, switch, ConfirmDialog, toast, audit log.
- **Cambios requeridos:** “Nunca ejecutado” neutral/alerta; “Suspendido” si falta proveedor; impacto antes de desactivar; undo.
- **Reglas visuales:** Verde sólo para salud demostrada; degradado/no configurado tienen texto, icono y acción.
- **Reglas de interacción:** Cambio amplio confirma impacto; operación bloquea doble envío; undo sólo si rollback real.
- **Estados que deben diseñarse:** saludable, degradado, no configurado, nunca ejecutado, en proceso, fallido, rollback.
- **Responsive:** Resumen y acción correctiva visibles a 390 px.
- **Accesibilidad:** Estado con texto/icono; confirmación con foco y descripción; live region para operación.
- **Criterios de aceptación:** Verde sólo con evidencia positiva; cambio global exige contexto; estado y backend coinciden.
- **Prioridad:** P1.
- **Esfuerzo:** Medio–alto.
- **Dependencias:** Health endpoints, auditoría y rollback.
- **Riesgos:** Un “Deshacer” aparente sin rollback transaccional empeora seguridad; no mostrarlo hasta garantizarlo.
- **Evidencia requerida:** Tests de state mapping, acción/undo y screenshots de cada estado.

### [TASK-UI-012] Centralizar microcopy, fechas y unidades

- **Objetivo:** Hablar el lenguaje del usuario de forma consistente.
- **Descripción:** Glosario, labels de enums, formatters y pluralización compartidos.
- **Pantallas afectadas:** Transversal.
- **Componentes afectados:** Badges, date/time, money, units, tooltips y formularios admin.
- **Cambios requeridos:** Ocultar slugs; expandir siglas; formato único; ejemplos reales; estado crudo nunca visible.
- **Reglas visuales:** Labels de negocio, formato alineado y truncamiento con expansión accesible.
- **Reglas de interacción:** Tooltip funciona con foco/tacto; valores avanzados pueden copiarse sin contaminar flujo normal.
- **Estados que deben diseñarse:** valor ausente, desconocido, legacy y timezone.
- **Responsive:** Evitar truncar verbo/label; abreviación sólo con expansión accesible.
- **Accesibilidad:** Tooltips accesibles por foco; texto no depende de hover.
- **Criterios de aceptación:** Búsqueda estática sin enums/slugs visibles no autorizados; snapshots de formatos; plural correcto.
- **Prioridad:** P1/P2.
- **Esfuerzo:** Medio.
- **Dependencias:** Glosario de negocio e i18n.
- **Riesgos:** Renombrar sin glosario puede crear sinónimos; centralizar y versionar copy.
- **Evidencia requerida:** Catálogo de copy y tests de formatters/componentes.

### [TASK-UI-013] Separar vista móvil de documento y artefacto A4

- **Objetivo:** Hacer revisables los comprobantes en móvil sin degradar el PDF.
- **Descripción:** Resumen HTML y viewer/document actions explícitas.
- **Pantallas afectadas:** SST print, OC print, entrega print.
- **Componentes afectados:** Print layout, mobile document viewer, download/open controls.
- **Cambios requeridos:** Resumen de datos clave; abrir/descargar; zoom/pan si hay preview; A4 independiente.
- **Reglas visuales:** Resumen móvil usa cuerpo legible; preview se presenta como documento, no como contenido reflow.
- **Reglas de interacción:** Abrir/descargar muestran progreso/error; zoom/pan tienen controles explícitos.
- **Estados que deben diseñarse:** preparando, listo, error, sin archivo, descargando.
- **Responsive:** 320/390/tablet; acciones 44 px; no encoger texto A4 como única vista.
- **Accesibilidad:** Título/estructura HTML, nombre del archivo, progreso anunciado.
- **Criterios de aceptación:** Datos esenciales legibles; PDF conserva A4; teclado/lector opera acciones; sin layout shift severo.
- **Prioridad:** P1.
- **Esfuerzo:** Medio.
- **Dependencias:** Pipeline de impresión/PDF.
- **Riesgos:** Cambiar preview puede afectar impresión legal; validar artefacto A4 por separado.
- **Evidencia requerida:** Screenshots móvil, PDFs parseados/visuales y pruebas de descarga.

### [TASK-UI-014] Estandarizar overlays, tabs y acciones táctiles

- **Objetivo:** Evitar controles truncados, ocultos o difíciles de cerrar.
- **Descripción:** Sheet móvil para notificaciones, tablist adaptativa y targets comunes.
- **Pantallas afectadas:** Shell, detalle OC, Indicadores y catálogos móviles.
- **Componentes afectados:** NotificationsPopover/Sheet, Tabs, IconButton, destructive actions.
- **Cambios requeridos:** Sheet en móvil; scroll/grid de tabs; hitbox 44 px; labels/tooltip; foco restaurado.
- **Reglas visuales:** Tabs conservan grupo/activo; Sheet tiene título/cierre/footer; peligro separado.
- **Reglas de interacción:** Escape/cierre/restauración; auto-scroll a tab activo; icon buttons con name/hitbox.
- **Estados que deben diseñarse:** abierto/cerrado, tab activo, unread, loading, destructive pending.
- **Responsive:** 320–430 y zoom 200 % sin title oculto.
- **Accesibilidad:** Dialog/tab semantics, Escape, focus trap, `aria-current/selected` y names.
- **Criterios de aceptación:** Ninguna tab huérfana; overlay cerrable; iconos operables/nominados; foco no oculto.
- **Prioridad:** P1/P2.
- **Esfuerzo:** Medio.
- **Dependencias:** Componentes UI compartidos.
- **Riesgos:** Dos implementaciones de overlay pueden divergir; compartir lógica y probar breakpoints.
- **Evidencia requerida:** Tests Testing Library/axe, video teclado y screenshots.

### [TASK-UI-015] Normalizar visualización de datos y exportes

- **Objetivo:** Mostrar primero la conclusión y conservar exportación completa.
- **Descripción:** Unificar entrada “Exportar”, resúmenes textuales y contrato de gráficos.
- **Pantallas afectadas:** Reportes, Combustibles Reportes/Facturas/TAE.
- **Componentes afectados:** ExportDialog, chart wrappers, axes/legend, empty/single-point state.
- **Cambios requeridos:** Un CTA; `.xlsx`; unidad/periodo; una escala por eje; paleta documentada; texto alternativo.
- **Reglas visuales:** Conclusión antes del gráfico; ejes/leyenda legibles; color no es el único canal.
- **Reglas de interacción:** ExportDialog recuerda opción/filtros; gráfico secundario puede plegarse sin perder resumen.
- **Estados que deben diseñarse:** sin datos, un punto, carga, error, exportando/listo.
- **Responsive:** Gráfico plegable/secundario; labels sin solapar a 320 px.
- **Accesibilidad:** Resumen/tablas equivalentes, leyenda no sólo color.
- **Criterios de aceptación:** Header no envuelve; cada gráfico responde una pregunta; cuatro exportes siguen disponibles en Excel.
- **Prioridad:** P2.
- **Esfuerzo:** Medio.
- **Dependencias:** Datos reales y formato de exportación.
- **Riesgos:** Agrupar exportes añade un clic; medir frecuencia y recordar preferencia.
- **Evidencia requerida:** Fixtures 0/1/muchos puntos, archivos XLSX y capturas responsivas.

### [TASK-UI-016] Crear matriz transversal de estados y accesibilidad

- **Objetivo:** Cerrar lo que las capturas estáticas no pueden verificar.
- **Descripción:** Suite de estados, teclado, zoom, screen reader y conectividad por flujo crítico.
- **Pantallas afectadas:** Transversal; prioridad Solicitudes, OC, Recepción, PPA, TAE, Incidentes, PDTP y Admin.
- **Componentes afectados:** Buttons/forms/dialogs/toasts/loading/error/session/permission/offline.
- **Cambios requeridos:** Loading, success, error recuperable, double-submit guard, dirty-state, session expired, no permission, offline y retry.
- **Reglas visuales:** Todos los estados usan jerarquía/copy/semántica común y evitan layout shift.
- **Reglas de interacción:** Destino de foco y recuperación definidos; operación crítica idempotente; sesión preserva borrador seguro.
- **Estados que deben diseñarse:** Todos los anteriores, con copy y destino de foco.
- **Responsive:** 320, 390, 768, 1366, 1920; zoom 200/400 %.
- **Accesibilidad:** WCAG 2.2 AA manual+automática, VoiceOver/NVDA/TalkBack según plataforma.
- **Criterios de aceptación:** Matriz completa sin celdas “no probado”; cero crítico axe; flujo completo por teclado; foco lógico; estado anunciado.
- **Prioridad:** P1.
- **Esfuerzo:** Alto.
- **Dependencias:** Fixtures, CI navegador y usuarios de prueba.
- **Riesgos:** Suite extensa/flaky puede perder confianza; priorizar flujos P1 y estabilizar fixtures.
- **Evidencia requerida:** Reporte WCAG, videos de teclado/SR, resultados CI y matriz firmada.

### [TASK-UI-017] Aplicar minimización de datos personales por rol

- **Objetivo:** Reducir exposición innecesaria de RUT.
- **Descripción:** Definir y aplicar matriz de visibilidad en lista, selector, detalle, exporte y captura.
- **Pantallas afectadas:** Evaluaciones, trabajadores, PPA y selectores de persona.
- **Componentes afectados:** Person label, tables/cards, combobox, exports, audit screenshots.
- **Cambios requeridos:** Enmascarado por defecto; completo sólo por necesidad/rol; copy que diferencie personas sin exponer más.
- **Reglas visuales:** Enmascarado consistente y suficiente contexto no sensible para distinguir personas.
- **Reglas de interacción:** Revelado completo sólo con permiso/tarea; exporte y captura heredan la misma política.
- **Estados que deben diseñarse:** autorizado, enmascarado, sin permiso y exporte restringido.
- **Responsive:** El enmascarado no debe producir identificadores ambiguos en lista estrecha.
- **Accesibilidad:** Nombre legible; no depender sólo de los dígitos ocultos.
- **Criterios de aceptación:** Matriz aprobada; listados no privilegiados enmascaran; detalle autorizado conserva dato cuando es necesario; exportes respetan regla.
- **Prioridad:** P1.
- **Esfuerzo:** Medio.
- **Dependencias:** Legal, privacidad, RBAC y operación SST.
- **Riesgos:** Enmascarado puede causar homónimos; acordar identificador alternativo seguro.
- **Evidencia requerida:** Tests por rol, capturas, revisión legal y muestra de exporte.

## 15. Sistema de diseño recomendado

La propuesta **no crea una nueva identidad**. Formaliza lo que ya funciona —neutros, verde, tipografía y superficies limpias— y corrige divergencias funcionales.

### 15.1 Tipografía

| Token | Tamaño/alto sugerido | Uso |
|---|---|---|
| Display | 36/40, semibold | Sólo hitos o portada, no dashboards rutinarios |
| H1 | 28/34 desktop; 22/28 móvil | Título de página vía `PageHeader` |
| H2 | 22/28 | Sección principal |
| H3 | 17/24, semibold | Tarjeta/panel |
| Body | 15/22 | Formularios, instrucciones y terreno |
| Compact | 13/18 | Tablas densas desktop |
| Meta | 12/16 | Fecha, origen, auditoría secundaria |
| Micro | 11/14 | Sólo encabezados uppercase no críticos; nunca error/acción |

- Conservar las familias actuales; no añadir otra fuente.
- Números comparables con tabulares cuando la fuente lo permita.
- Siglas expandidas en primera aparición; códigos en mono sólo como dato copiable.
- Texto normal con contraste mínimo 4,5:1; tamaño grande 3:1.

### 15.2 Espaciado, contenedores y densidad

- Escala: **4, 8, 12, 16, 24, 32, 48, 64 px**.
- Unidad base 8 px; 4 px sólo para ajuste interno.
- Page gaps: 24 desktop, 16 móvil. Field gaps: 16; label→control: 6–8.
- Máximo cuatro KPI; secundarios en tira de 12–13 px, no más tarjetas.
- Máximo 4–6 filtros primarios; resto en “Más filtros (N)”.
- Densidad `comfortable` en móvil/formularios y `compact` en tablas desktop; la preferencia no reduce targets.

### 15.3 Radios, bordes y sombras

| Elemento | Regla |
|---|---|
| Input/button compact | 8–10 px |
| Card/panel | 16 px |
| Sheet/dialog | 16–20 px según borde visible |
| Pill/badge | radio completo |
| Borde | 1 px neutral; 2 px sólo selección/foco/error relevante |
| Superficie estática | sin sombra o `shadow-xs` |
| Flotante | una sombra suave + borde; no sombras anidadas |
| Modal | sombra de overlay; fondo con contraste suficiente |

Evitar tarjetas dentro de tarjetas cuando agrupación, borde superior o espacio resuelvan la jerarquía.

### 15.4 Paleta funcional

- **Canvas/surface/border/text:** conservar neutros blancos/grises actuales.
- **Primary:** verde esmeralda actual para acción principal y selección.
- **Success:** verde, siempre con icono/texto; no usar si sólo hay ausencia de fallo.
- **Pending/attention:** naranja de señal sólo para trabajo pendiente o llamado de atención.
- **Warning:** ámbar con texto de causa y acción.
- **Error/destructive:** rojo con verbo específico y confirmación.
- **Info:** azul o neutral diferenciado; no competir con primary.
- **Charts:** paleta propia documentada, con patrones/labels y sin reutilizar naranja de pendiente de forma ambigua.
- Ningún estado depende sólo del color; badges incluyen label/icono.

### 15.5 Botones y acciones

| Jerarquía | Apariencia | Regla |
|---|---|---|
| Primario | fondo verde | Uno por región/tarea; verbo+objeto |
| Secundario | outline neutral | Alternativa segura |
| Terciario | ghost/text | Baja frecuencia/contextual |
| Destructivo | rojo | Separado, confirmación y motivo cuando aplique |
| Icon button | icono + nombre accesible | 44×44 móvil; tooltip/focus label |

- Altura móvil mínima de producto: 44 px; desktop 36–40 sin reducir hitbox crítico.
- Loading conserva ancho, bloquea doble envío y anuncia operación.
- Disabled explica requisito cuando impide una tarea, no sólo baja opacidad.
- Evitar “Aceptar/Procesar”; usar “Crear orden”, “Registrar recepción”, “Desactivar módulo”.

### 15.6 Campos y controles

- Inputs/selectores: altura 44 móvil, 38–40 desktop; label persistente; placeholder como ejemplo, no label.
- `Field` común con helper, error y requerido; error junto al campo + resumen al enviar.
- Select/combobox largo: búsqueda, opción elegida, check y “Sin resultados” con salida.
- Textarea: altura por tarea, contador sólo cuando exista límite.
- Checkbox/radio: área de fila completa clicable; group legend.
- Switch: sólo estado inmediato binario; acción amplia requiere ConfirmDialog/undo.
- DatePicker común; fechas localizadas por formatter central.
- Dirty-state visible y confirmación al abandonar formularios largos.

### 15.7 Tablas y listados

- Desktop: headers visibles, números a la derecha, texto a la izquierda, acciones consistentes, primera columna estable cuando sea necesario.
- Móvil: `ResponsiveDataList` con identidad, estado, 2–3 metadatos y acción; detalle expandible/Sheet.
- Scroll horizontal sólo para matrices, con gradiente/label “Desliza para ver más”, teclado y primera columna fija.
- Orden/filtro/paginación no se pierden al cambiar de representación.
- Empty state dentro del contexto, no una fila “Sin resultados” aislada.
- Menú de tres puntos sólo cuando hay 3+ acciones de baja frecuencia; acción principal visible.

### 15.8 Tarjetas, KPI y gráficos

- Card agrupa una unidad de decisión; no envolver cada field por defecto.
- KPI: label, valor, unidad/periodo, estado y acción; cero se interpreta, no se celebra.
- Un clic en KPI filtra/navega; si no cambia una decisión, usar tira textual.
- Un gráfico = una pregunta; una unidad por eje o doble eje claramente rotulado.
- Estado 0/1 punto usa resumen alternativo si una curva no añade información.
- Datos clave disponibles también como texto/tabla accesible.

### 15.9 Modales, drawers y overlays

- Dialog para decisión focal; Sheet para formularios largos/contexto móvil.
- Título y cierre persistentes; footer persistente cuando el cuerpo hace scroll.
- Foco inicial útil, trap, Escape, restauración al trigger y background inert.
- Confirmación destructiva: objeto, consecuencia, reversibilidad, motivo cuando aplica.
- Notificaciones: popover desktop, Sheet móvil con “Ver todas”.

### 15.10 Badges, alertas, toasts y tooltips

- Badge siempre label español, no enum crudo; icono opcional.
- Alert inline para condiciones persistentes; toast para resultado temporal; no duplicar el mismo mensaje.
- Toast de éxito: qué se guardó + acción siguiente/undo si corresponde.
- Error: causa conocida, qué se conservó y cómo recuperar; incluir ID de soporte cuando sea útil.
- Tooltip sólo para información secundaria; nunca requisito exclusivo para completar.

### 15.11 Paginación, skeleton, carga, vacío y error

- Paginación conserva filtros/scroll y anuncia rango/total.
- Skeleton replica estructura estable, respeta reduced-motion y evita layout shift.
- Operación en proceso muestra verbo (“Importando 32 de 140”), bloqueo idempotente y salida segura cuando corresponda.
- Vacío: significado + cómo poblar + CTA.
- Sin resultados: filtros activos + “Limpiar filtros”.
- Error: causa + impacto + reintento/alternativa.
- Sin permiso: qué permiso/rol falta y rutas seguras, sin filtrar datos sensibles.
- Sesión expirada: preservar borrador cuando sea seguro y volver al mismo punto.

### 15.12 Focus visible y motion

- Ring de 2 px con offset 2 px y contraste no-textual ≥3:1.
- Foco nunca totalmente oculto por header/footer sticky.
- Transición 120–200 ms para cambio de estado; no animar decoración continua.
- Respetar `prefers-reduced-motion`; skeleton sin shimmer obligatorio.

### 15.13 Breakpoints y anchos máximos

| Escenario | Ancho a validar | Regla |
|---|---:|---|
| Móvil mínimo | 320 px | Reflow y targets completos |
| Móvil de referencia | 390 px | Captura/regresión principal |
| Tablet | 768 px | Punto de cambio list/table revisado por pantalla |
| Desktop pequeño | 1024/1280/1366 px | Sidebar + contenido sin truncar |
| Desktop amplio | 1920 px | Evitar campos/líneas excesivamente anchos |

- `form`: máximo 896 px.
- `workbench`: máximo 1408 px.
- `wide`: máximo 1760 px.
- `full`: sólo tablas/matrices que realmente lo necesitan.

## 16. Pruebas recomendadas

| Caso | Perfil/condición | Tarea | Éxito verificable |
|---|---|---|---|
| Primer uso | Usuario nuevo | Encontrar y crear solicitud | ≥90 % sin ayuda; identifica dónde está y siguiente paso. |
| Usuario frecuente | Operador experto | Resolver 5 Pendientes | Filtros/estado persistentes; tiempo reduce vs baseline. |
| Poca experiencia digital | Trabajador | Completar PPA | Entiende siglas, progreso y autorización sin facilitador. |
| Teclado | Admin | Crear usuario y cerrar dialog | Todo operable; foco visible/lógico/restaurado. |
| Zoom 200 % | Baja visión | Indicadores y formulario | Sin pérdida ni scroll bidimensional innecesario. |
| Zoom 400 %/320 CSS px | Baja visión | Tabla prioritaria | Cumple reflow; identidad/estado/acción disponibles. |
| Móvil 320×568 | Terreno | TAE error→retry→éxito | CTA visible, idempotente, una mano. |
| Móvil 390×844 | Terreno | Repuestos/Servicios | Tipo correcto, resumen y envío. |
| Tablet 768 | Supervisor | PDTP/tabla | Cambio de representación sin perder controles. |
| Desktop pequeño 1366×768 | Oficina | Prevención | Sidebar legible; tarea visible sin muro KPI. |
| Tabla muchas columnas | Experto | Roles/Privacidad/Bitácora | Campos esenciales + detalle; scroll evidente si procede. |
| Tabla sin datos | Principiante | EPP/Historial TAE | Explica ausencia y CTA/limpiar. |
| Formulario con errores | Cualquier | PPA/usuario/producto | Resumen, foco, valor conservado y mensaje específico. |
| Conectividad lenta | Terreno | Reportar incidente | Loading/progreso, sin doble envío, borrador conservado. |
| Operación en proceso | Admin | Importar lote | Contador/progreso, navegación segura y estado persistente. |
| Operación fallida | Operador | Importar/guardar | Causa, filas afectadas, reintento y datos conservados. |
| Cambios sin guardar | Admin | Editar configuración y salir | Confirmación conservar/descartar/cancelar. |
| Acción destructiva | Admin/supervisor | Desactivar módulo/cancelar/purgar | Impacto, objeto y undo/confirmación; auditado. |
| Sesión expirada | Usuario | Enviar form largo | Reautentica y recupera borrador seguro. |
| Sin permisos | Rol restringido | Abrir detalle/acción | Mensaje contextual sin filtrar datos; salida útil. |
| Offline | Terreno | PPA/incidente/TAE | Estado explícito, cola idempotente y sync confirmado. |
| Flujo end-to-end | Roles reales | Solicitud→entrega | Códigos/estado/cantidades preservados; recovery en cada fase. |
| Lector de pantalla | NVDA/VoiceOver/TalkBack | Navegar shell, tabla y dialog | Nombres/roles/estados anunciados en orden lógico. |
| Contraste/daltonismo | Variantes | Leer badges/gráficos | Cumple AA y no depende de color. |
| Documento | Móvil + desktop | Revisar y descargar SST/OC | Resumen legible; PDF A4 correcto; progreso/error accesible. |
| Pipeline visual | QA | Recapturar rutas | Cero finalUrl inesperada, huérfanos o duplicados. |

## 17. Métricas de éxito

Primero se debe medir una línea base con los flujos actuales. Los objetivos siguientes son iniciales y deben ajustarse según criticidad y muestra.

| Métrica | Cambio relacionado | Cómo medir | Objetivo inicial |
|---|---|---|---|
| Éxito de tarea | Todos los P1 | Prueba moderada/no moderada por rol | ≥95 % en flujos críticos |
| Éxito al primer intento | PPA, TAE, usuarios | Eventos + test usuario | +20 puntos porcentuales vs baseline |
| Tiempo por tarea | Pendientes, TAE, Reportes | Mediana inicio→éxito | −25 % |
| Clics/taps por tarea | Pendientes, exportes, Indicadores | Analítica de secuencia | −20 %, sin ocultar seguridad |
| Solicitudes mal tipadas | FORM-CORE-001 | Tipo esperado vs creado | 0 desde accesos especializados |
| Error de formulario | PPA/usuario/config | Envíos fallidos por campo | −30 % |
| Abandono de formulario | PPA/importaciones | Inicio sin éxito/borrador | −30 % |
| Doble envío | Estados transaccionales | IDs/eventos duplicados | 0 |
| Recuperación de error | TAE/PDTP/import | Error→éxito sin soporte | ≥80 % |
| Uso de atrás no planificado | Flujos sin siguiente CTA | Secuencia back tras éxito/error | −40 % |
| Persistencia de contexto | Filtros/PDTP | Retorno con estado intacto | ≥95 % |
| Tiempo hasta primera tarea visible | Dashboard/Flota/Pendientes | Telemetría viewport/scroll | ≤1 viewport móvil |
| Soporte por “no encuentro/no puedo” | IA/microcopy | Clasificación de tickets | −30 % en 60 días |
| Estados “No calculable” resueltos | Indicadores | KPI→CTA→dato completo | ≥80 % dentro del periodo |
| Ejecución/edad de backup visible | Backups | Usuarios que identifican estado | ≥95 % en test de comprensión |
| SUS | Global | Encuesta posterior a tareas | ≥80 y +10 vs baseline |
| WCAG | TASK-UI-016 | Auditoría AA | 0 fallas A/AA críticas; excepciones documentadas |
| Reflow | ResponsiveDataList | Suite 320/zoom | 100 % pantallas P1 sin pérdida |
| Cobertura visual válida | TASK-UI-001/002 | Manifest + filesystem | 100 % rutas, 0 inválidas/huérfanas |
| Calidad percibida/confianza | Salud/errores | Escala 1–7 tras escenarios | ≥6/7 |
| Rendimiento percibido | Skeleton/loading | LCP/INP/CLS + encuesta | Core Web Vitals “good” y −20 % espera percibida |

## 18. Riesgos y dependencias

| Riesgo/dependencia | Consecuencia | Mitigación |
|---|---|---|
| Confundir fixture inválido con bug productivo | Trabajo equivocado o falso cierre | Reproducir con registro real, permisos y status antes de asignar causa. |
| RBAC y scope por faena | Pantalla válida para admin pero 404/sin acceso para otro rol | Fixtures por rol/faena y pruebas de no filtración. |
| Simplificar demasiado tablas desktop | Expertos pierden comparación/velocidad | Doble representación: tabla densa desktop, resumen móvil. |
| Fragmentar PPA | Se oculta contexto de seguridad | Prototipo con prevencionistas; mantener resumen/progreso global. |
| Canonicalizar rutas | Romper bookmarks/enlaces históricos | Redirects explícitos, telemetría y periodo de compatibilidad. |
| Ocultar RUT sin criterio operacional | Dificultar identificación segura | Matriz legal/rol/tarea y alternativa inequívoca. |
| Cambiar salud de SMTP/backup | UI puede contradecir backend | Estado derivado de health real, no de flags aislados. |
| Undo de módulos | Estado complejo o irreversible | Diseñar transacción/rollback antes del toast; no prometer undo falso. |
| Offline/idempotencia | Duplicados o pérdida de reporte | IDs de operación, cola persistente y reconciliación visible. |
| Gráficos con datos atípicos | Solapamiento o conclusiones engañosas | Fixtures 0/1/muchos/outlier y resumen textual. |
| Componentes compartidos | Cambio global genera regresiones | Migración por familias, feature flag/story fixtures y regresión visual. |
| No contar con telemetría baseline | No se demuestra mejora | Instrumentar eventos mínimos antes del cambio. |
| Diseño versus cumplimiento documental | Preview móvil mejora pero PDF legal se degrada | Separar viewer HTML y artefacto A4; validar ambos. |
| “Más filtros” oculta controles expertos | Más clics en tareas frecuentes | Analítica de frecuencia, recordar expansión y atajos desktop. |
| Paleta semántica/chart | Colores existentes cambian significado | Inventario de tokens y migración documentada, no reemplazo ad hoc. |
| Capturas de datos personales | Evidencia de QA expone RUT | Datos sintéticos/enmascarados y política de retención de capturas. |

Dependencias transversales:

- Product owner y usuarios de Compras, Bodega, Flota, Prevención y Administración.
- Glosario de negocio y decisiones legales/privacidad.
- Fixtures representativos, permisos y scopes de faena.
- Componentes compartidos de shell, tablas, formularios, estados, toasts y dialogs.
- Observabilidad de operación, auditoría y estado de servicios.
- Suite E2E/visual estable antes de usar capturas como gate.

## 19. Información faltante

Las siguientes conclusiones **no pueden confirmarse sólo con capturas** y deben permanecer abiertas:

1. Contraste calculado de cada combinación de tokens, especialmente texto gris, borde de inputs y gráficos.
2. Orden DOM, landmarks, encabezados, labels, names/descriptions y anuncios `aria-live`.
3. Navegación completa por teclado, focus trap, Escape y restauración del foco.
4. Área interactiva real de icon buttons/switches; el PNG sólo muestra su forma visual.
5. Reflow a 320 px, zoom 200/400 %, tablet, landscape y escritorio 1280/1366.
6. Comportamiento con teclado virtual y safe areas móviles.
7. Loading, skeleton, operación en proceso, progreso, red lenta y layout shift.
8. Conservación de datos tras error, dirty-state, autosave, borradores y abandono.
9. Protección contra doble envío, idempotencia y concurrencia.
10. Confirmaciones/undo reales de módulos, purgas, eliminaciones y acciones masivas.
11. Sesión expirada, usuario sin permisos y cambio de permiso durante una tarea.
12. Funcionamiento offline real, cola y sincronización posterior de PPA/Incidentes/TAE.
13. Validez productiva de los 20 grupos con 404; la auditoría confirma el contenido capturado, no su causa.
14. Persistencia de filtros, tab, scroll, año, faena y programa al volver.
15. Rendimiento real: LCP, INP, CLS, peso de gráficos/tablas y consumo en dispositivos modestos.
16. Artefacto descargado PDF/Excel; la preview no prueba el archivo final.
17. Compatibilidad cross-browser, lector de pantalla y sistema operativo.
18. Casos con grandes volúmenes, textos largos, nombres duplicados, monedas/unidades extremas y datos reales.
19. Métricas de uso, tasa de error, soporte, abandono y SUS actuales.
20. Necesidad legal/operacional exacta de mostrar RUT completo por rol.
21. Percepción de usuarios reales con baja alfabetización digital y trabajo en terreno.
22. Paridad entre el ambiente sembrado de capturas y producción.

Escenarios faltantes que deben añadirse al próximo set de evidencia:

- un flujo completo válido de cada familia hoy 404;
- carga, éxito, error recuperable y sin permisos;
- tabla vacía, alta densidad y texto largo;
- móvil 320×568, tablet 768, desktop 1366×768 y zoom 200 %;
- teclado/foco, screen reader y reduced-motion;
- offline→online y sesión expirada;
- cambios sin guardar y acción destructiva confirmada/cancelada;
- preview y archivo final de documentos;
- cada rol principal con su scope real.

## 20. Conclusión

Chome no necesita abandonar su lenguaje visual. La identidad actual es una fortaleza: sobria, consistente y suficientemente profesional para una aplicación empresarial. El mayor retorno vendrá de **alinear la interacción y el responsive con esa calidad visual**.

El orden recomendado es estricto: primero reparar la evidencia y los defaults que pueden producir decisiones equivocadas; después establecer contratos comunes de tabla, estado, filtro y acción; luego simplificar PPA, TAE, Pendientes, Dashboard y administración de accesos; finalmente cerrar accesibilidad, responsive y refinamiento con pruebas reales.

La meta no es reducir información a cualquier costo. En escritorio, Chome atiende usuarios expertos que necesitan densidad y comparación. En móvil y terreno, debe priorizar identidad, estado, acción y recuperación. Una misma fuente de datos puede tener dos representaciones sin convertirse en dos productos.

Con los P0/P1 corregidos, fixtures válidos, pruebas WCAG/responsive y evidencia limpia, la interfaz puede avanzar razonablemente desde **6,4/10** hacia una franja de **8,0–8,5/10** sin un rediseño completo. Hasta entonces, el producto es funcional y visualmente competente, pero no debe declararse plenamente listo para producción multidispositivo.

## 21. Registro de ejecución

### Pasada 1 — contratos de entrada y evidencia reproducible

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** cerrar la causa confirmada de clasificación incorrecta y evitar que una interacción de captura se presente como evidencia de una ruta distinta.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-001 | Implementada, pendiente de recaptura aislada | `scripts/capture-all-routes.ts` ahora declara una allowlist exacta de `pathname + query` por ruta, incluidos redirects canónicos. Cada control interactivo vuelve a cargar la ruta declarada antes de actuar, valida la URL posterior y corta la familia con `capture-invalid` si sale de la allowlist. Los aliases que sólo redirigen quedan como resultado verificable en manifest, sin emitir un PNG duplicado del destino canónico. El manifest incorpora estado (`capture-ok`, `capture-invalid`, `expected-redirect`, `expected-404`, `fixture-missing`), selector, URL final y SHA-256 de cada PNG. También reconcilia resultados contra archivos, referencias repetidas, huérfanos y hashes duplicados, y falla el proceso si alguno existe. | `scripts/capture-all-routes.test.ts`: allowlists de Repuestos, Servicios y catálogo canónico; la prueba rechaza explícitamente el desvío a Compras. |
| TASK-UI-003 / FORM-CORE-001 | Implementada, pendiente de E2E real | `lib/request-types.ts` resuelve el tipo inicial sólo si es conocido y permitido. `/solicitudes/nueva` consume `?tipo=` como API de request-time, entrega el tipo al formulario y muestra una alerta si el enlace es inválido o no está permitido. `RequestForm` y `useRequestForm` conservan ese valor al inicializar selector, resumen y primer ítem, incluido `servicio` para Servicios. Los redirects `/repuestos/nueva` y `/servicios/nueva` quedan declarados y verificados en el pipeline. | Tests unitarios para Repuestos, Servicios, valor inválido/no autorizado y array de query; test de formulario para tipo inicial y alerta. |

#### Verificación ejecutada

- `npx vitest run lib/__tests__/request-type-permissions.test.ts app/(app)/solicitudes/request-form.test.tsx scripts/capture-all-routes.test.ts`: **26 pruebas, 3 archivos, todo verde**.
- `npx tsc --noEmit`: **verde**.
- ESLint dirigido a los archivos de la pasada: **verde, sin warnings**.
- `npx react-doctor@latest --verbose --scope changed`: no señaló archivos modificados en esta pasada, pero la rama completa frente a `main` mantiene **1 error de dependencia** (`pdfjs-dist@6.1.200`, supply-chain score) y **4 warnings de rendimiento** en Dashboard. Se registran como deuda preexistente de la rama, sin ampliar esta pasada a una refactorización ajena. El score que informa la herramienta es 49/100; no equivale a un regression score de estos cambios.

#### Lo que falta después de la pasada 1

La siguiente lista es deliberadamente exhaustiva para el plan de esta auditoría. “Pendiente operativo” no implica que el código esté incorrecto: señala que no se ejecutó la prueba o coordinación necesaria.

| Pendiente | Estado al cierre de la pasada 1 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación | Pendiente operativo | Ejecutar dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, con `CAPTURE_ALLOW_DESTRUCTIVE_RESET=true`, sin otro Playwright/E2E usando esa base; revisar manifest sin `capture-invalid`, huérfanos, referencias o hashes duplicados. No se ejecutó en esta pasada porque había un `test-server` E2E ajeno activo y el capturador resetea la base de forma destructiva. |
| TASK-UI-002 | No iniciado | Sembrar fixtures válidos por familia y scope para los 20 detalles hoy 404; probar válido, eliminado, sin permiso y retorno contextual. Corregir Soporte para que un 404 use HTTP 404, no contenido 404 con 200. |
| TASK-UI-003, certificación | Pendiente operativo | E2E desktop y móvil desde `/repuestos/nueva` y `/servicios/nueva`, verificando selector, primer ítem, resumen y payload/registro creado. Revisar solicitudes históricas potencialmente mal tipadas antes de cualquier corrección de datos. |
| Build de producción de la pasada | Pendiente operativo | Ejecutar `npm run build` cuando no haya un `test-server` Playwright ni otro `next-server` compartiendo el checkout. No se inició para no alterar artefactos `.next` de una ejecución E2E ajena. |
| React Doctor de rama | Pendiente separado, no introducido aquí | Decidir si se actualiza/acepta `pdfjs-dist@6.1.200` tras revisión de seguridad y atender los cuatro diagnósticos de Dashboard en una pasada dedicada; no mezclarlo con la corrección de solicitudes/capturas. |
| TASK-UI-004 | No iniciado | Definir `ResponsiveDataList`, campos esenciales por dominio y migrar Roles, Seguridad, Notificaciones, EPP, Catálogos, Taxonomía, Bitácora, Sellos, Prevención y trazabilidad. Validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | Simplificar labels/agrupación de Prevención, declarar rutas canónicas y redirects, y validar navegación activa, RBAC, 1280/1920 y móvil. |
| TASK-UI-006 | No iniciado | Compactar Dashboard, Flota, Pendientes, Backups y módulos preventivos a máximo cuatro KPI y 4–6 filtros primarios; medir que la primera tarea/CTA sea visible. |
| TASK-UI-007 | No iniciado | Rediseñar PPA por progreso/secciones y probar preservación, validación, foco, offline y sincronización idempotente con Prevención. |
| TASK-UI-008 | No iniciado | Añadir recuperación accionable y repetición segura a TAE, con pruebas de storage, token expirado, offline, duplicado y Safari/Chrome móvil. |
| TASK-UI-009 | No iniciado | Hacer accionables los errores de Actividades PDTP y “No calculable”, preservando período, faena y programa en ida/vuelta. |
| TASK-UI-010 | No iniciado | Reordenar Usuarios/Roles como “rol primero”, con scopes, excepciones, diff de permisos y matriz RBAC verificable. |
| TASK-UI-011 | No iniciado | Derivar salud de SMTP, respaldos y módulos desde backend real; confirmar cambios amplios y no prometer undo sin rollback. |
| TASK-UI-012 | No iniciado | Centralizar glosario, labels de enum, fechas, horas, unidades y pluralización; retirar slugs/tecnicismos del flujo estándar. |
| TASK-UI-013 | No iniciado | Separar resumen HTML móvil de los documentos A4, mantener el PDF como artefacto independiente y validar descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil para notificaciones, tablist adaptativa, targets de 44 px y foco/restauración en overlays. |
| TASK-UI-015 | No iniciado | Unificar entrada de exportación Excel, resumen textual y contrato accesible de gráficos, incluidos fixtures de 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Construir matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos para los flujos P1. |
| TASK-UI-017 | No iniciado | Acordar matriz legal/operacional de exposición de RUT y aplicarla por rol a listas, selectores, detalle, exportación y capturas. |
| Fase 5 completa | No iniciada | Pruebas de usabilidad por rol, WCAG automática y manual, E2E de flujos completos, recaptura canónica, rendimiento percibido y veredicto go/no-go. |
| Riesgos e información faltante de las secciones 18–19 | Abiertos | Persisten todos salvo la validez de URL ahora instrumentada: contraste exacto, teclado, lectores, touch targets, reflow, offline, idempotencia, dirty-state, permisos, documentos descargados, rendimiento, volumen, cross-browser, métricas de uso y validación legal de RUT requieren pruebas vivas o decisiones de negocio. |

**Veredicto tras la pasada 1:** se corrigieron los dos contratos de código más inmediatos, pero no hay recaptura limpia ni fixtures operativos completos. Se mantiene el veredicto de la sección 6: **no declarar cierre productivo multidispositivo** hasta completar los pendientes anteriores.

### Pasada 2 — fixtures operativos de importación y soporte

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** sustituir cinco IDs de auditoría que producían 404 visual por entidades relacionadas y con estados suficientes para revisar una tarea real.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / Combustibles | Implementada para 3 de los 20 grupos, pendiente de recaptura aislada | El seed de `scripts/capture-all-routes.ts` ahora crea `fuel-import-audit-1` con dos consumos (uno asociado y una patente pendiente), `fuel-op-audit-1` con una faena/patente sin equivalencia, y `tae-import-audit-1` con carga histórica observada más una fila rechazada trazable. Cada lote conserva período, totales, importador, relaciones y datos crudos que las páginas de detalle consultan. | El inventario de fixtures nombra los tres escenarios y el test exige las tres rutas de detalle y su cobertura declarada. |
| TASK-UI-002 / Productos EPP | Implementada para 1 de los 20 grupos, pendiente de recaptura aislada | Se creó `batch-audit-1` con una fila EPP normalizada, coincidencia con producto existente, razones de match y decisión pendiente. La ruta `/admin/productos/importar/batch-audit-1` deja de depender de un lote inexistente y puede mostrar la mesa de revisión. | El test de inventario exige la ruta y el fixture `lote EPP pendiente de revisión`. |
| TASK-UI-002 / Soporte | Implementada para 1 de los 20 grupos, pendiente de recaptura aislada | Se agregaron `sop-audit-1` en progreso, con página de origen y nota interna de gestión, y `sop-audit-2` resuelto. Esto permite revisar el detalle y que el listado tenga estados distintos. | El test de inventario exige `/soporte/sop-audit-1` y el fixture con nota de gestión. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`: **verde, sin warnings**.
- `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó el seed ni Playwright contra una base compartida: el capturador resetea la base y sigue habiendo procesos `test-server`/`next-server` ajenos activos. Por ello, estas cinco rutas están implementadas y verificadas estáticamente, pero todavía no certificadas en runtime desktop/móvil.

#### Lo que falta después de la pasada 2

| Pendiente | Estado al cierre de la pasada 2 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas en `CAPTURE_DATABASE_URL` exclusiva, sin otro Playwright/E2E; manifest sin `capture-invalid`, huérfanos, referencias duplicadas ni hashes duplicados. |
| TASK-UI-002, cinco fixtures recién creados | Pendiente operativo | Ejecutar captura aislada de Combustibles, Administración y Soporte en desktop/móvil; comprobar relaciones, scopes, controles de asociación y que Soporte inexistente responda HTTP 404, no una página 404 con 200. |
| TASK-UI-002, 15 grupos de Prevención | No iniciado | Sembrar y probar: ejecución PDTP; CAPA; Incidentes y procedimiento; control MIPER; requisito legal; solicitud de privacidad; sesión de capacitación; permiso; inspección; comité CPHS; grupo y programa de higiene; plan de emergencia; gestión de cambio; documento. Para cada grupo: válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, verificando selector, primer ítem, resumen y payload/registro; evaluar solicitudes históricas antes de corregir datos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando el checkout no esté siendo usado por `test-server` ni otro `next-server`. |
| React Doctor de la rama | Pendiente separado, no introducido por estas pasadas | Revisar `pdfjs-dist@6.1.200` y los cuatro avisos de rendimiento de Dashboard en una pasada dedicada; no mezclar con los fixes de captura. |
| TASK-UI-004 | No iniciado | Definir y migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | Simplificar IA/canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención a decisiones/CTA visibles. |
| TASK-UI-007 | No iniciado | Progreso y condicionales PPA con preservación, foco, offline e idempotencia. |
| TASK-UI-008 | No iniciado | Recuperación y repetición segura de TAE: storage, token, offline, duplicado y navegadores móviles. |
| TASK-UI-009 | No iniciado | Recuperación accionable de Actividades PDTP y KPI “No calculable”, preservando año/faena/programa. |
| TASK-UI-010 | No iniciado | Flujo de usuarios/roles con rol primero, scopes, excepciones y diff de permisos. |
| TASK-UI-011 | No iniciado | Salud real de SMTP/backups/módulos, confirmación y rollback verificable de cambios globales. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización; ocultar tecnicismos del flujo estándar. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y artefacto PDF A4 independiente, con descarga/error comprobados. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración en overlays. |
| TASK-UI-015 | No iniciado | Entrada única de exportación Excel, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos en flujos P1. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, datos de volumen, cross-browser, telemetría, privacidad y paridad de seed con producción. |

**Veredicto tras la pasada 2:** cinco de los veinte grupos sin detalle operativo ya tienen seed relacional y contratos de inventario. No se debe declararlos cerrados hasta que una recaptura aislada confirme HTTP, RBAC/scope y contenido en ambos viewports; los quince grupos de Prevención y los restantes frentes P1 siguen abiertos.

### Pasada 3 — recuperación y repetición segura del TAE público

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** cerrar los callejones sin salida confirmados en la preparación del QR TAE y en el resultado de una carga, sin reusar payload ni evitar la validación de autorización.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-008 / TAE-ERR-001 | Implementada, pendiente de E2E de causas y móviles reales | `TaeAccessActivation` clasifica la respuesta 404, rate limit 429, fallo de almacenamiento local y fallo de red. Cada estado entrega causa prudente, siguiente paso, código de soporte, alerta accesible y botón `Reintentar` focalizado. El reintento aborta una preparación anterior y vuelve a leer el mismo QR, por lo que no crea cargas ni reutiliza datos. | Pruebas de componente cubren QR no disponible, foco en recuperación, reintento exitoso y almacenamiento bloqueado. |
| TASK-UI-008 / TAE-FLOW-002 | Implementada, pendiente de E2E de navegador | El resultado de una carga ahora muestra `Registrar otra carga`, que abre un formulario nuevo en `/tae`; esa ruta vuelve a validar el token guardado ante el servidor y no lleva valores ni `clientSubmissionId` de la carga anterior. La salida secundaria `Finalizar en este dispositivo` borra la configuración y token de acceso locales antes de volver a la pantalla QR. | Prueba de componente comprueba el enlace al formulario nuevo y el borrado de acceso; el E2E existente fue ampliado para usar el CTA real antes de crear su segunda carga offline. |

#### Verificación ejecutada

- `npx vitest run app/(public)/tae/access/[accessToken]/access-activation.test.tsx app/(public)/tae/resultado/[token]/tae-result-actions.test.tsx`: **4 pruebas verdes**.
- ESLint dirigido a los cinco archivos TAE y `e2e/tae-public-flow.spec.ts`: **verde, sin warnings**.
- `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: ningún diagnóstico en los archivos TAE de esta pasada. La rama completa conserva el error conocido de supply-chain de `pdfjs-dist@6.1.200` y cuatro avisos de rendimiento de Dashboard; no se mezclaron con este flujo.
- El E2E TAE modificado no se ejecutó porque continúa activo un `test-server`/`next-server` ajeno que comparte checkout. Tampoco se ejecutó build ni recaptura destructiva.

#### Lo que falta después de la pasada 3

| Pendiente | Estado al cierre de la pasada 3 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, cinco fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración y Soporte en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 15 grupos Prevención | No iniciado | Sembrar y probar ejecución PDTP; CAPA; Incidentes/procedimiento; MIPER; requisito legal; privacidad; capacitación; permiso; inspección; CPHS; higiene grupo/programa; emergencia; cambio; documento. Cada uno requiere válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-009 | No iniciado | Recuperación de Actividades PDTP y KPI “No calculable”, preservando año/faena/programa. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 3:** el TAE ya ofrece recuperación ejecutable y un siguiente paso seguro en código. Aún no hay evidencia de navegador móvil, E2E modificado ni manejo acordado de cola offline en dispositivos compartidos, por lo que el cierre operativo de TASK-UI-008 sigue pendiente.

### Pasada 4 — recuperación contextual para Actividades PDTP

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** eliminar el callejón sin salida de `/prevencion/pdtp/actividades` cuando un programa no dispone de una hoja utilizable, sin perder programa, faena, período, vista ni filtro al corregirlo.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-009 / PDTP-STATE-001 | Implementada en código; pendiente de E2E/captura | El visor no monta ya un selector de hoja vacío. Si el programa no tiene hojas, explica el prerrequisito y muestra un CTA único: quien puede gestionar abre el editor; el resto vuelve a Programas del mismo año. Si la hoja no es visible, nombra la hoja y el programa en lugar del error genérico. | `PdtpActivitiesPage` conserva el estado de consulta en un enlace generado y cubierto por prueba unitaria. |
| TASK-UI-009 / retorno correctivo | Implementada en código; pendiente de prueba navegador | `buildPdtpActivitiesHref` conserva `programa`, `hoja`, `faena`, `vista`, `anio`, `estado`, `mes` y `semana`. El editor recibe `volver`, acepta sólo la ruta interna exacta de Actividades PDTP y expone `Volver a actividades` en el header. Así no hay redirección abierta ni pérdida de contexto tras corregir la hoja. | Pruebas rechazan destinos externos y rutas internas distintas. |
| TASK-UI-009 / DATA-IND-001 | Control existente confirmado y ahora cubierto por componente; pendiente de E2E | `CanonicalIndicatorsDashboard` ya sustituye la repetición de “No calculable” por un aviso que identifica meses sin HH, explica las tasas afectadas y abre el denominador del primer mes pendiente para una faena gestionable. La vista total pide elegir la faena, pues el dato se administra por faena y mes. | Prueba de componente comprueba la explicación, que el CTA abre el primer mes sin HH y que no se ofrece edición a un rol sin gestión. |

#### Verificación ejecutada

- `npx vitest run app/(app)/prevencion/pdtp/pdtp-context.test.ts app/(app)/prevencion/indicadores/canonical-indicators-dashboard.test.tsx`: **8 pruebas verdes**; dos añadidas cubren la recuperación de HH del indicador y se preservó la prueba previa de valores no calculables, privacidad de grupos pequeños y drill-down.
- ESLint dirigido a `pdtp-context`, su prueba, Actividades y el editor: **verde, sin warnings**.
- `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: ningún diagnóstico en los archivos PDTP de esta pasada. Persisten el error conocido de supply-chain de `pdfjs-dist@6.1.200` y cuatro avisos de rendimiento de Dashboard; no se mezclaron con esta corrección.
- No se ejecutaron E2E, build ni recaptura: sigue activo un `test-server`/`next-server` ajeno que comparte el checkout, y el capturador resetea la base de datos.

#### Lo que falta después de la pasada 4

| Pendiente | Estado al cierre de la pasada 4 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, cinco fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración y Soporte en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 15 grupos Prevención | No iniciado | Sembrar y probar ejecución PDTP; CAPA; Incidentes/procedimiento; MIPER; requisito legal; privacidad; capacitación; permiso; inspección; CPHS; higiene grupo/programa; emergencia; cambio; documento. Cada uno requiere válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 4:** Actividades PDTP deja de fallar de forma muda y ya devuelve desde el editor al mismo contexto de trabajo. La recuperación no está certificada aún en navegador ni en ambos viewports; la recuperación de Indicadores está presente en código, pero requiere sus pruebas por rol y de recálculo antes de cerrar TASK-UI-009.

### Pasada 5 — fixture relacional para detalle CAPA

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** reemplazar el detalle CAPA que antes dependía de un ID inexistente por un caso de auditoría real y trazable.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / detalle CAPA | Fixture implementado; pendiente de captura aislada | El seed de capturas ahora crea `capa-audit-1` en la faena autorizada, con responsable, causa, acción en progreso, evidencia fotográfica, transición de `pending` a `in_progress` y seguimiento 60 %. El detalle tiene así las relaciones que consulta `getCapaActionBundle`, en vez de depender de un placeholder 404. | El fixture queda declarado en `getCaptureSeedCoverage` y la prueba de inventario exige su nombre. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó `prepareDatabase` ni Playwright: el flujo de captura destruye y recrea el esquema, y continúa activo un `test-server`/`next-server` ajeno sobre el checkout. Por ello la inserción queda verificada por contrato estático, no aún por migración/HTTP/render real.

#### Lo que falta después de la pasada 5

| Pendiente | Estado al cierre de la pasada 5 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, seis fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración, Soporte y CAPA en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 14 grupos de Prevención / 15 variantes de ruta | No iniciado | Sembrar y probar ejecución PDTP; Incidentes y procedimiento; MIPER; requisito legal; privacidad; capacitación; permiso; inspección; CPHS; higiene grupo/programa; emergencia; cambio y documento. Para cada uno: válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 5:** seis de los veinte detalles inicialmente sin fixture operativo tienen ahora IDs y contratos relacionales en el capturador. CAPA no se declara cerrado hasta ejecutar una captura aislada que confirme migración, RBAC/scope, HTTP y render en ambos viewports; los catorce grupos preventivos restantes siguen pendientes.

### Pasada 6 — fixture relacional para requisito legal

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** sustituir el detalle de requisito legal sin objeto por un requisito publicable y una decisión visible de aplicabilidad en la faena.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / detalle requisito legal | Fixture implementado; pendiente de captura aislada | El seed crea `legal-requirement-audit-1` publicado, con revisión y aprobación segregadas, vigencia, fuente, artículo, evidencia y frecuencia. Añade la aplicabilidad `legal-applicability-audit-1` para la faena autorizada, con responsable, fundamento, evidencia, fecha y cumplimiento parcial. El detalle puede cargar ahora la relación que muestra al usuario, no sólo el requisito. | La prueba de inventario exige ruta e ítem de cobertura. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó migración/seed/Playwright contra la instalación compartida, por el reset destructivo del capturador y el `test-server`/`next-server` ajeno activo. La certificación runtime de este fixture queda pendiente.

#### Lo que falta después de la pasada 6

| Pendiente | Estado al cierre de la pasada 6 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, siete fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración, Soporte, CAPA y requisito legal en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 13 grupos de Prevención / 14 variantes de ruta | No iniciado | Sembrar y probar ejecución PDTP; Incidentes y procedimiento; MIPER; privacidad; capacitación; permiso; inspección; CPHS; higiene grupo/programa; emergencia; cambio y documento. Para cada uno: válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 6:** siete de los veinte detalles inicialmente 404 disponen ya de fixture relacional. El requisito legal se considera listo para validar, no certificado: faltan inserción real tras migraciones, respuesta HTTP, aislamiento por scope/RBAC y render de ambos viewports; quedan trece grupos preventivos por sembrar.

### Pasada 7 — fixture con scope para solicitud de privacidad

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** hacer auditable la vista de una solicitud ARCO sin falsear su control de alcance por faena.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / detalle de privacidad | Fixture implementado; pendiente de captura aislada | El seed crea `privacy-request-audit-1` en proceso, con solicitud de acceso, identidad verificada, responsable, plazo y el trabajador `worker-audit-1` dentro de la faena permitida. `getPreventionPrivacyRequestWorkbench` resuelve al titular y valida su scope, por lo que la ruta deja de depender de un ID huérfano que redirige silenciosamente a la lista. | La prueba de inventario exige ruta e ítem de cobertura del caso. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó migración/seed/Playwright contra la instalación compartida, por el reset destructivo del capturador y el `test-server`/`next-server` ajeno activo. La certificación runtime de este fixture queda pendiente.

#### Lo que falta después de la pasada 7

| Pendiente | Estado al cierre de la pasada 7 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, ocho fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración, Soporte, CAPA, requisito legal y privacidad en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 12 grupos de Prevención / 13 variantes de ruta | No iniciado | Sembrar y probar ejecución PDTP; Incidentes y procedimiento; MIPER; capacitación; permiso; inspección; CPHS; higiene grupo/programa; emergencia; cambio y documento. Para cada uno: válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 7:** ocho de los veinte detalles inicialmente sin fixture operativo tienen ahora IDs y relaciones suficientes para la consulta. La solicitud de privacidad no se declara cerrada hasta comprobar en una base aislada que conserva la minimización de datos y responde según RBAC/scope; quedan doce grupos preventivos por sembrar.

### Pasada 8 — fixture completo para sesión de capacitación

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** dar a la ruta de sesión de capacitación un curso, contenido y asistencia coherentes, en vez de un ID sin cadena formativa.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / detalle de capacitación | Fixture implementado; pendiente de captura aislada | El seed crea curso `trcourse-audit-1`, versión publicada `2026.1`, sesión cerrada `trsess-audit-1` y dos asistencias aprobadas en la faena autorizada. Incluye duración, modalidad, relator, contenido, evaluación y evidencia, por lo que `getTrainingSessionDetail` puede realizar todos sus joins y mostrar el denominador de asistentes. | La prueba de inventario exige ruta e ítem de cobertura. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó migración/seed/Playwright contra la instalación compartida, por el reset destructivo del capturador y el `test-server`/`next-server` ajeno activo. La certificación runtime de este fixture queda pendiente.

#### Lo que falta después de la pasada 8

| Pendiente | Estado al cierre de la pasada 8 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, nueve fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración, Soporte, CAPA, requisito legal, privacidad y capacitación en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 11 grupos de Prevención / 12 variantes de ruta | No iniciado | Sembrar y probar ejecución PDTP; Incidentes y procedimiento; MIPER; permiso; inspección; CPHS; higiene grupo/programa; emergencia; cambio y documento. Para cada uno: válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 8:** nueve de los veinte detalles inicialmente sin fixture operativo tienen ya entidades y relaciones de dominio, y la sesión de capacitación puede validar curso, contenido y asistentes. Aún falta ejecutarla en una base aislada con RBAC/scope y ambos viewports; quedan once grupos preventivos por sembrar.

### Pasada 9 — fixture de gestión de cambio enlazado a CAPA

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** hacer que el detalle de Gestión de Cambio represente una evaluación real, con una medida correctiva rastreable, en vez de un ID vacío.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / detalle de Gestión de Cambio | Fixture implementado; pendiente de captura aislada | El seed crea `cambio-audit-1` en evaluación para la faena autorizada y las seis dimensiones requeridas (`risk`, `permit`, `training`, `document`, `miper`, `emergency`). La dimensión de riesgo exige y enlaza `capa-audit-1`; las demás expresan su impacto real. El detalle puede calcular completitud y mostrar la medida, sin falsear una aprobación. | La prueba de inventario exige ruta e ítem de cobertura. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó migración/seed/Playwright contra la instalación compartida, por el reset destructivo del capturador y el `test-server`/`next-server` ajeno activo. La certificación runtime de este fixture queda pendiente.

#### Lo que falta después de la pasada 9

| Pendiente | Estado al cierre de la pasada 9 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, diez fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración, Soporte, CAPA, requisito legal, privacidad, capacitación y Gestión de Cambio en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 10 grupos de Prevención / 11 variantes de ruta | No iniciado | Sembrar y probar ejecución PDTP; Incidentes y procedimiento; MIPER; permiso; inspección; CPHS; higiene grupo/programa; emergencia y documento. Para cada uno: válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 9:** diez de los veinte detalles inicialmente sin fixture operativo cuentan ya con datos y relaciones de dominio. Gestión de Cambio queda preparada para validar, no certificada: falta inserción posterior a migraciones, aislamiento RBAC/scope y render en ambos viewports; permanecen diez grupos preventivos por sembrar.

### Pasada 10 — fixture integral para plan de emergencia

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** hacer que el detalle de emergencia tenga una respuesta operativa completa y no una cabecera sin contexto.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / detalle de Emergencias | Fixture implementado; pendiente de captura aislada | El seed crea `plan-audit-1` con escenario de incendio, dos roles con titular/reemplazo, recurso inspeccionable, contacto externo, simulacro ejecutado y participantes. El simulacro queda `needs_improvement` y enlazado a `capa-audit-1`, por lo que la pantalla conserva la relación entre aprendizaje y corrección. | La prueba de inventario exige ruta e ítem de cobertura. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó migración/seed/Playwright contra la instalación compartida, por el reset destructivo del capturador y el `test-server`/`next-server` ajeno activo. La certificación runtime de este fixture queda pendiente.

#### Lo que falta después de la pasada 10

| Pendiente | Estado al cierre de la pasada 10 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, once fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración, Soporte, CAPA, requisito legal, privacidad, capacitación, Gestión de Cambio y Emergencias en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 9 grupos de Prevención / 10 variantes de ruta | No iniciado | Sembrar y probar ejecución PDTP; Incidentes y procedimiento; MIPER; permiso; inspección; CPHS; higiene grupo/programa y documento. Para cada uno: válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 10:** once de los veinte detalles inicialmente sin fixture operativo incluyen ya relaciones de dominio necesarias para renderizar. El plan de emergencia no está certificado hasta validar sus FK, scope, respuesta HTTP y ambos viewports en una base de captura aislada; quedan nueve grupos preventivos por sembrar.

### Pasada 11 — fixture operativo para permiso de trabajo

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** hacer que el detalle del permiso represente una autorización activa, con sus barreras de seguridad y no sólo una cabecera de permiso.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / detalle de Permiso | Fixture implementado; pendiente de captura aislada | El seed crea tipo LOTO y `permit-audit-1` activo dentro del scope, con cuadrilla que acusa recibo, dos controles verificados, aislamiento eléctrico aplicado y energía cero, medición de O₂ vigente y AST con controles. El detalle puede ejecutar todos sus joins y mostrar barreras reales. | La prueba de inventario exige ruta e ítem de cobertura. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó migración/seed/Playwright contra la instalación compartida, por el reset destructivo del capturador y el `test-server`/`next-server` ajeno activo. La certificación runtime de este fixture queda pendiente.

#### Lo que falta después de la pasada 11

| Pendiente | Estado al cierre de la pasada 11 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, doce fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración, Soporte, CAPA, requisito legal, privacidad, capacitación, Gestión de Cambio, Emergencias y Permisos en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 8 grupos de Prevención / 9 variantes de ruta | No iniciado | Sembrar y probar ejecución PDTP; Incidentes y procedimiento; MIPER; inspección; CPHS; higiene grupo/programa y documento. Para cada uno: válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 11:** doce de los veinte detalles inicialmente sin fixture operativo poseen ya datos relacionales para renderizar información de negocio. Permisos queda preparado para la prueba aislada, no certificado: faltan migración/seed real, RBAC/scope, HTTP y ambos viewports; persisten ocho grupos preventivos por sembrar.

### Pasada 12 — fixture de comité CPHS con acta y acuerdo

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** sustituir el detalle de comité sin entidad por un comité cuya composición, cadencia y acuerdos sean verificables.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / detalle de CPHS | Fixture implementado; pendiente de captura aislada | El seed crea `comite-audit-1` activo con representantes titular de empresa y trabajadores, reunión ordinaria cerrada, asistencia nominativa y acuerdo `capa_linked` a `capa-audit-1`. Así `getCommitteeStatus` puede calcular paridad, cadencia y número de integrantes desde datos reales. | La prueba de inventario exige ruta e ítem de cobertura. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó migración/seed/Playwright contra la instalación compartida, por el reset destructivo del capturador y el `test-server`/`next-server` ajeno activo. La certificación runtime de este fixture queda pendiente.

#### Lo que falta después de la pasada 12

| Pendiente | Estado al cierre de la pasada 12 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, trece fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración, Soporte, CAPA, requisito legal, privacidad, capacitación, Gestión de Cambio, Emergencias, Permisos y CPHS en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 7 grupos de Prevención / 8 variantes de ruta | No iniciado | Sembrar y probar ejecución PDTP; Incidentes y procedimiento; MIPER; inspección; higiene grupo/programa y documento. Para cada uno: válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 12:** trece de los veinte detalles inicialmente sin fixture operativo contienen ya entidades y relaciones suficientes para las rutas de detalle. CPHS queda listo para certificar, no cerrado: faltan migración/seed aislado, RBAC/scope, HTTP y render en ambos viewports; siguen abiertos siete grupos preventivos.

### Pasada 13 — fixtures enlazados de higiene industrial

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** hacer utilizables las dos rutas de Higiene sin separar artificialmente exposición y vigilancia.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / detalles de Higiene | Fixtures implementados; pendiente de captura aislada | El seed crea el agente de ruido, GES `grupo-audit-1`, dos miembros y medición de 81 dB(A) sobre nivel de acción. Crea también `programa-audit-1` PREXOR con dos matrículas derivadas del mismo GES. Así ambos detalles muestran datos compatibles: exposición, decisión de vigilancia y seguimiento de personas. | La prueba de inventario exige ambas rutas e ítems de cobertura. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó migración/seed/Playwright contra la instalación compartida, por el reset destructivo del capturador y el `test-server`/`next-server` ajeno activo. La certificación runtime de estos fixtures queda pendiente.

#### Lo que falta después de la pasada 13

| Pendiente | Estado al cierre de la pasada 13 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, quince fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración, Soporte y los diez grupos preventivos ya sembrados en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 5 grupos de Prevención / 6 variantes de ruta | No iniciado | Sembrar y probar ejecución PDTP; Incidentes y procedimiento; MIPER; inspección y documento. Para cada uno: válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 13:** quince de los veinte detalles inicialmente sin fixture operativo tienen ya relaciones de dominio y los dos detalles de Higiene comparten una realidad consistente. Aún no existe prueba de migración, RBAC/scope, HTTP ni render aislado; quedan cinco grupos preventivos y seis rutas de detalle por sembrar.

### Pasada 14 — fixture documental con versión, distribución y acuse

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** convertir el detalle documental en una evidencia de gestión documental completa, en lugar de una cabecera que sólo evita la redirección a la biblioteca.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / detalle de Documentación | Fixture implementado; pendiente de captura aislada | El seed crea categoría y tipo documental, `doc-audit-1` vigente en el scope de la faena y su versión PDF vigente. Incluye vínculo al plan de emergencia, distribución con acuse digital y los eventos de creación, aprobación y distribución. El visor puede consultar versión actual, trazabilidad y comunicación sin depender de valores sueltos. | La prueba de inventario exige ruta e ítem de cobertura; las relaciones están declaradas contra sus tablas y claves foráneas reales. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó migración/seed/Playwright contra la instalación compartida, por el reset destructivo del capturador y el `test-server`/`next-server` ajeno activo. La certificación runtime de este fixture queda pendiente.

#### Lo que falta después de la pasada 14

| Pendiente | Estado al cierre de la pasada 14 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, dieciséis fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración, Soporte y los once grupos preventivos ya sembrados en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 4 grupos de Prevención / 5 variantes de ruta | No iniciado | Sembrar y probar ejecución PDTP; Incidentes y procedimiento; MIPER e inspección. Para cada uno: válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 14:** dieciséis de los veinte detalles inicialmente sin fixture operativo tienen ya datos relacionales. Documentación aporta una versión publicada y una distribución con acuse, pero todavía no hay prueba de migración, RBAC/scope, HTTP ni render aislado. Quedan cuatro grupos preventivos y cinco rutas de detalle por sembrar.

### Pasada 15 — fixture MIPER publicado de extremo a extremo

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** hacer auditable el detalle de control MIPER con la jerarquía publicada que su consulta exige.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / detalle MIPER | Fixture implementado; pendiente de captura aislada | El seed crea metodología, proceso, tarea y cargo; publica `risk-matrix-audit-1` con evidencia de consulta y después crea el peligro eléctrico y `risk-control-audit-1` crítico, verificado y efectivo. La ruta puede resolver la cadena de joins y el estado de la matriz publicado, no una fila de control huérfana. | La prueba de inventario exige ruta e ítem de cobertura; la inserción respeta los estados y restricciones de la matriz y del control. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó migración/seed/Playwright contra la instalación compartida, por el reset destructivo del capturador y el `test-server`/`next-server` ajeno activo. La certificación runtime de este fixture queda pendiente.

#### Lo que falta después de la pasada 15

| Pendiente | Estado al cierre de la pasada 15 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, diecisiete fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración, Soporte y los doce grupos preventivos ya sembrados en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 3 grupos de Prevención / 4 variantes de ruta | No iniciado | Sembrar y probar ejecución PDTP; Incidentes y procedimiento; e inspección. Para cada uno: válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 15:** diecisiete de los veinte detalles inicialmente sin fixture operativo tienen datos relacionales completos. MIPER queda preparado desde la metodología hasta el control crítico, sin certificación aún de migración, RBAC/scope, HTTP o render aislado. Quedan tres grupos preventivos y cuatro rutas de detalle por sembrar.

### Pasada 16 — incidente investigable y corrección de ruta inexistente

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** respaldar el detalle de Incidentes con una investigación real y eliminar la falsa expectativa de que existe una segunda página de procedimiento.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / detalle de Incidente | Fixture implementado; pendiente de captura aislada | El seed crea `inc-audit-1` en investigación con persona involucrada, DIAT enviada, investigación ICAM, evidencia, historia, declaración firmada, difusión One Page, seguimiento y difusión RE-20 confirmada. El panel de flujo y el panel RE-20 comparten la ficha canónica y ya no dependen de estados vacíos. | La prueba de inventario exige ruta e ítem de cobertura; las inserciones usan las restricciones y enumeraciones reales de Incidentes. |
| TASK-UI-001 / inventario de Incidentes | Corregido en código; pendiente de certificar runtime | Se verificó que no existe `app/(app)/prevencion/incidentes/[id]/procedimiento/page.tsx`: el flujo de investigación RE-20 está incorporado en `/prevencion/incidentes/[id]`. El target obsoleto ahora espera 404 y no produce PNG duplicado; se retiró su muestra dinámica. | El inventario estático exige explícitamente `expectedStatus: 404` y `captureView: false`, evitando que una 404 se clasifique como fixture faltante. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó migración/seed/Playwright contra la instalación compartida, por el reset destructivo del capturador y el `test-server`/`next-server` ajeno activo. La certificación runtime de este fixture y de la 404 esperada queda pendiente.

#### Lo que falta después de la pasada 16

| Pendiente | Estado al cierre de la pasada 16 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, dieciocho fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración, Soporte y los trece grupos preventivos ya sembrados en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, 2 grupos de Prevención / 2 variantes de ruta | No iniciado | Sembrar y probar ejecución PDTP e inspección. Para cada uno: válido, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 16:** dieciocho de los veinte detalles inicialmente sin fixture operativo tienen datos relacionales. El detalle de Incidentes contiene ahora el flujo de investigación y RE-20; la ruta `/procedimiento` no es una pantalla pendiente sino una 404 explícitamente clasificada. Sólo quedan ejecución PDTP e inspección por sembrar; persiste la certificación runtime de todo el conjunto.

### Pasada 17 — fixture de inspección revisada con hallazgo trazable

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** preparar una inspección cuyo detalle valide definición, respuestas, cumplimiento, hallazgo y trazabilidad CAPA, no una tabla sin filas.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / detalle de Inspección | Fixture implementado; pendiente de captura aislada | El seed crea plantilla LOTO aprobada con checklist versionado, `insp-audit-1` revisada, tres respuestas con 67 % de cumplimiento y un hallazgo alto enlazado a `capa-audit-1`. Conserva asignación, ejecución, revisión y la bitácora del run. | La prueba de inventario exige ruta e ítem de cobertura; la plantilla y el run respetan sus restricciones de aprobación, conteos y estados. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó migración/seed/Playwright contra la instalación compartida, por el reset destructivo del capturador y el `test-server`/`next-server` ajeno activo. La certificación runtime de este fixture queda pendiente.

#### Lo que falta después de la pasada 17

| Pendiente | Estado al cierre de la pasada 17 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, diecinueve fixtures creados | Pendiente operativo | Captura aislada de Combustibles, Administración, Soporte y los catorce grupos preventivos ya sembrados en desktop/móvil, incluyendo relaciones, scope, asociación y status HTTP 404 para Soporte inexistente. |
| TASK-UI-002, ejecución PDTP | No iniciado | Sembrar y probar el registro `exec-audit-1`: actividad, programa, aprobación, evidencia, scope, inexistente/eliminado, sin permiso y retorno contextual. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 17:** diecinueve de los veinte detalles inicialmente sin fixture operativo tienen datos relacionales. Inspección cubre la cadena plantilla-respuesta-hallazgo-CAPA y queda a la espera de certificación runtime. Sólo falta la ejecución PDTP para completar la preparación estática de los detalles inicialmente descubiertos.

### Pasada 18 — ejecución PDTP aprobada con verificación y acción

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** completar el último detalle inicialmente sin fixture, conservando el vínculo entre programa, actividad, evidencia, checklist por sujeto y plan de acción.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / ejecución PDTP | Fixture implementado; pendiente de captura aislada | El seed incorpora la actividad 63 y su programación, checklist LOTO activo, `exec-audit-1` aprobado con evidencia y una instancia por trabajadora. Incluye una respuesta conforme, una no conforme y el plan de acción con seguimiento, enlazado a la CAPA existente. | La prueba de inventario exige la ruta y el ítem de cobertura; las filas respetan programa, actividad, período, estados, claves únicas y relaciones reales del detalle. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts`: **5 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- Regresión consolidada: `npx vitest run` sobre los siete archivos focalizados de capturas, Solicitudes, PDTP, Indicadores y TAE: **39 pruebas verdes**; `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó migración/seed/Playwright contra la instalación compartida, por el reset destructivo del capturador y el `test-server`/`next-server` ajeno activo. La certificación runtime de este fixture queda pendiente.

#### Lo que falta después de la pasada 18

| Pendiente | Estado al cierre de la pasada 18 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar migración/seed y captura aisladas de los veinte detalles, en desktop y móvil. Validar relaciones, RBAC/scope, asociación, 404 para ID inexistente y retorno contextual por cada grupo; la preparación estática no es certificación de render. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| TASK-UI-004 | No iniciado | Definir/migrar `ResponsiveDataList`; validar 320/390/768/1024 y zoom 200 %. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 18:** los veinte detalles inicialmente sin fixture operativo disponen ahora de preparación estática relacional. Este hito elimina la ausencia de fixtures, no certifica ninguno de los renders: aún falta ejecutar el capturador en una base exclusiva, comprobar HTTP/RBAC/scope y revisar las vistas desktop y móvil, además del resto de tareas del plan.

### Pasada 19 — contrato móvil `ResponsiveDataList` y primeras migraciones

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** sustituir el mensaje de “pensada para escritorio” por datos y acciones operables en móvil, sin degradar las tablas completas de escritorio.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-004 / RESP-TABLE-001 | Contrato implementado | Se incorporaron `ResponsiveDataListCard` y `ResponsiveDataListField`. Cada tarjeta conserva identidad, estado, hasta cuatro datos con etiqueta y acciones táctiles en un único bloque; `DataTable` ya ocultaba la tabla bajo `md` cuando recibe `renderMobileCard`, por lo que escritorio conserva sus columnas y móvil no depende de scroll horizontal. | Prueba unitaria del contrato comprueba título, descripción, estado, dato etiquetado y acción. |
| TASK-UI-004 / Roles | Migrado; pendiente de inspección visual | `/admin/roles` presenta etiqueta, alcance, slug/protección, cantidad de permisos y botón **Editar** en móvil. Se retiró `DesktopOnlyTableNotice`. | La acción usa `Button size="sm"`, cuyo mínimo móvil es 44 px. |
| TASK-UI-004 / Seguridad | Migrado; pendiente de inspección visual | `/admin/seguridad/rate-limits` presenta clave, bloqueo, fallos, intentos correctos, actualización y **Liberar** por cada fila en móvil. Se retiró el aviso de escritorio. | La acción conserva el `form` y Server Action existentes; no se modificó su semántica. |
| TASK-UI-004 / Notificaciones | Migrado; pendiente de inspección visual | `/admin/notificaciones` muestra título, cuerpo, estado, tipo, usuario/correo y fecha en móvil, en lugar de la tabla desplazable. | No se inventó una acción de detalle: la superficie actual es de consulta y purga global. |
| TASK-UI-004 / Taxonomía SST | Migrado; pendiente de inspección visual | Las listas de categorías y tipos de documento muestran enlaces, estado, código/orden o confidencialidad/vigencia, y acciones **Editar** y **Desactivar/Reactivar** en móvil. | Las dos acciones reutilizan los formularios y Server Actions actuales. |

#### Verificación ejecutada

- `npx vitest run components/ui/responsive-data-list.test.tsx components/__tests__/data-table.test.tsx`: **2 archivos y 11 pruebas verdes**.
- `npx eslint` sobre los seis archivos de la pasada, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: conserva el mismo conjunto ya registrado: un error de cadena de suministro de `pdfjs-dist@6.1.200` y cuatro advertencias de rendimiento en archivos del Dashboard. No señala ninguno de los archivos de esta pasada; no se aceptó ni ocultó el riesgo.
- No se ejecutó captura Playwright ni inspección por viewport: el capturador restablece datos y la certificación debe ocurrir sobre una `CAPTURE_DATABASE_URL` exclusiva, sin los procesos compartidos del checkout.

#### Lo que falta después de la pasada 19

| Pendiente | Estado al cierre de la pasada 19 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar migración/seed y captura aisladas de los veinte detalles, en desktop y móvil. Validar relaciones, RBAC/scope, asociación, 404 para ID inexistente y retorno contextual por cada grupo; la preparación estática no es certificación de render. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, migración de listas restantes | Parcial | Aún no tienen `renderMobileCard`: catálogos de productos, familias EPP, folios, catálogos PDTP, ambos historiales de importación de Combustibles, brechas de capacitación, emergencias, gestión de cambio, incidentes y permisos de trabajo. Persisten cinco usos de `DesktopOnlyTableNotice` en catálogos, EPP, folios y ambos historiales de importación. |
| TASK-UI-004, certificación visual | Pendiente operativo | Inspeccionar tarjetas y transiciones tabla/tarjeta a 320, 390, 768 y 1024 px, con zoom 200 %, teclado y reflow. Confirmar que filtros, paginación, identidad, estado y acción caben sin clipping. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 19:** existe un contrato móvil verificable y cinco tablas administrativas ya no expulsan al usuario al escritorio. La cobertura es deliberadamente parcial: faltan once listas de producción por migrar y falta evidencia visual real de los breakpoints; por eso TASK-UI-004 no se considera cerrada.

### Pasada 20 — listas preventivas operables en móvil

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** aplicar el contrato móvil al conjunto de listas preventivas donde el estado, el riesgo y el acceso inmediato al detalle condicionan decisiones en terreno.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-004 / Incidentes | Migrado; pendiente de inspección visual | La tarjeta muestra código, tipo, estado, faena, empresa, ocurrencia, gravedad, ubicación y **Ver incidente**. | El enlace y CTA conservan la ruta canónica del detalle. |
| TASK-UI-004 / Permisos de trabajo | Migrado; pendiente de inspección visual | La tarjeta muestra código/tarea, estado, tipo, faena/lugar, ventana, acuses, LOTO y **Ver permiso**. | Los cinco campos de decisión cubren habilitación, lugar, tiempo, cuadrilla y aislamiento. |
| TASK-UI-004 / Emergencias | Migrado; pendiente de inspección visual | Planes muestran estado, faena, escenarios, organigrama, simulacros y **Ver plan**. Simulacros muestran estado, escenario, programación y resultado sin inventar un detalle que no existe. | Ambas tablas alternan por `renderMobileCard`; la paginación de planes no se cambió. |
| TASK-UI-004 / Gestión del cambio | Migrado; pendiente de inspección visual | La tarjeta muestra solicitud, estado, faena, tipo, nivel de riesgo, dimensiones y **Ver cambio**. | La acción usa el detalle de cambio existente. |
| TASK-UI-004 / Brechas de competencia | Migrado; pendiente de inspección visual | La tarjeta muestra trabajador, cargo, exigibilidad, curso, tipo, vencimiento, fundamento y **Ver competencia**. | El CTA reutiliza el filtro de trabajadora/or de la pantalla de competencias. |

#### Verificación ejecutada

- `npx vitest run components/ui/responsive-data-list.test.tsx components/__tests__/data-table.test.tsx`: **2 archivos y 11 pruebas verdes**.
- `npx eslint` sobre el contrato y los cinco componentes preventivos, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: sigue en **49/100**, con el mismo error `pdfjs-dist@6.1.200` y las mismas cuatro advertencias del Dashboard; ningún hallazgo apunta a esta pasada.
- Falta comprobación humana y Playwright a 320/390/768/1024 px; no se lanzó la captura compartida por su reset de datos.

#### Lo que falta después de la pasada 20

| Pendiente | Estado al cierre de la pasada 20 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar migración/seed y captura aisladas de los veinte detalles, en desktop y móvil. Validar relaciones, RBAC/scope, asociación, 404 para ID inexistente y retorno contextual por cada grupo; la preparación estática no es certificación de render. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, seis componentes restantes | Parcial | Faltan `catalog-list`, `epp-family-list`, `sequence-list`, `catalog-tabs` de PDTP y los dos historiales de importación de Combustibles. Cinco todavía usan `DesktopOnlyTableNotice`: todos salvo `catalog-tabs` de PDTP. |
| TASK-UI-004, certificación visual | Pendiente operativo | Inspeccionar tarjetas y transiciones tabla/tarjeta a 320, 390, 768 y 1024 px, con zoom 200 %, teclado y reflow. Confirmar que filtros, paginación, identidad, estado y acción caben sin clipping. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 20:** once listas productivas ya tienen una alternativa móvil con estados y acciones reales. Quedan seis componentes por migrar y la certificación visual completa del patrón; por ello la prioridad RESP-TABLE-001 sigue abierta.

### Pasada 21 — cobertura de código completa para listas responsivas

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** retirar la última dependencia productiva del aviso “pensada para escritorio” y completar una alternativa móvil para cada consumidor de `DataTable`.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-004 / Catálogos de productos | Migrado; pendiente de inspección visual | Unidades y atributos reutilizables muestran identidad, estado, datos relevantes y acciones **Editar** / **Desactivar/Reactivar** táctiles. | Conservan los mismos Sheets y Server Actions que la tabla. |
| TASK-UI-004 / Familias EPP | Migrado; pendiente de inspección visual | El móvil muestra familia, tipo, marca/modelo, categoría, certificación y variantes activas. | La superficie no exponía edición ni detalle antes; no se creó una acción ficticia. |
| TASK-UI-004 / Folios | Migrado; pendiente de inspección visual | Cada secuencia muestra próximo código, prefijo, año, folio, actualización y **Corregir**. | La corrección conserva la confirmación reforzada ya existente. |
| TASK-UI-004 / Catálogos PDTP | Migrado; pendiente de inspección visual | Responsables, hojas y programas muestran estado, alcance y acciones de edición/activación o enlace de programa en móvil. Además, `ProgramTable` fue extraído a ámbito de módulo para impedir un remonte por definición anidada. | React Doctor deja de señalar el componente anidado. |
| TASK-UI-004 / Historiales Combustibles | Migrado; pendiente de inspección visual | Los lotes de combustible y log operacional presentan archivo, período, estado, errores, volúmenes, monto, responsable y **Ver lote**. | Los filtros estructurados y enlaces de detalle existentes se conservan. |
| TASK-UI-004 / inventario de consumidores | Código completo | La búsqueda estática deja sólo `components/__tests__/data-table.test.tsx` sin `renderMobileCard`; todos los consumidores productivos bajo `app/` tienen representación móvil. No quedan usos productivos de `DesktopOnlyTableNotice`. | `rg` posterior a la migración confirma ambos puntos. |

#### Verificación ejecutada

- `npx vitest run components/ui/responsive-data-list.test.tsx components/__tests__/data-table.test.tsx`: **2 archivos y 11 pruebas verdes**.
- `npx eslint` sobre el contrato y los seis componentes, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgos en los archivos responsivos. Tras extraer `ProgramTable` queda el conjunto ya conocido: un error de revisión/aceptación de `pdfjs-dist@6.1.200` y cuatro advertencias de rendimiento del Dashboard.
- No se ejecutó captura ni inspección de navegador: falta un entorno de captura exclusivo y la revisión humana de breakpoints.

#### Lo que falta después de la pasada 21

| Pendiente | Estado al cierre de la pasada 21 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar migración/seed y captura aisladas de los veinte detalles, en desktop y móvil. Validar relaciones, RBAC/scope, asociación, 404 para ID inexistente y retorno contextual por cada grupo; la preparación estática no es certificación de render. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar todos los estados de tarjeta y transiciones tabla/tarjeta a 320, 390, 768 y 1024 px, con zoom 200 %, teclado, foco, lector de pantalla y reflow. Confirmar filtros, paginación, identidad, estado y acción sin clipping. |
| TASK-UI-005 | No iniciado | IA y canonicalización de Prevención, navegación activa, RBAC y layouts 1280/1920/móvil. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 21:** la implementación de RESP-TABLE-001 está completa en código: todas las tablas de producción poseen tarjeta móvil y las de escritorio conservan su capacidad completa. La prioridad no está cerrada porque falta prueba visual, responsive y asistiva real; no se confunde cobertura estática con certificación de UX.

### Pasada 22 — navegación preventiva por tarea y rutas canónicas

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** mejorar encontrabilidad en Prevención sin reemplazar la identidad, rutas existentes ni permisos del módulo.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-005 / etiquetas y grupos | Implementado; pendiente de inspección visual | El registro navega por tareas: `Planificación`, `Gestión en terreno`, `Preparación y gobernanza`, `Información y cumplimiento` e `Indicadores`. Se acortaron nombres antes truncables a, por ejemplo, **Matriz de riesgos**, **Programa preventivo**, **Incidentes**, **Capacitación**, **Inspecciones**, **Documentos SST** e **Indicadores SST**. Los hijos PDTP se redujeron a términos inequívocos. | Los `href` y permisos preexistentes no cambian; el test de árbol actualiza y verifica los nuevos labels. |
| TASK-UI-005 / rutas sin dueño | Implementado; pendiente de E2E | Se añadieron destinos canónicos para **Campañas preventivas** y **Privacidad**. Privacidad tiene landing propia que muestra sólo Solicitudes de derechos y/o Auditoría de accesos según permiso, y sus breadcrumbs ya no la presentan como Documentación. | Prueba de navegación comprueba que Privacidad no activa Evaluaciones, que el hijo visible respeta `prevention:privacy:manage_requests` y que Campañas aparece con su permiso. |
| TASK-UI-005 / activo y scroll | Implementado; pendiente de inspección visual | El contenedor de navegación desktop/móvil se marca como panel de scroll y `AreaItems` desplaza únicamente ese panel para mantener a la fila activa dentro del viewport al entrar en una ruta profunda. | La lógica conserva `aria-current`, el ancestro expandido y no ejecuta scroll si no hay elemento activo. |
| TASK-UI-005 / regresión de composición | Corregido | En la pasada anterior se extrajo `ProgramTable` de `CatalogTabs`, evitando la definición anidada que React Doctor había indicado. | React Doctor vuelve al conjunto estable de cinco hallazgos externos a estas pasadas. |

#### Verificación ejecutada

- `npx vitest run lib/__tests__/navigation.test.ts`: **14 pruebas verdes**, incluyendo RBAC, destinos canónicos y active-route de Privacidad.
- `npx eslint` sobre manifests, componentes de navegación, página/breadcrumbs de Privacidad y prueba; `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgos de los archivos de navegación. Se mantienen un error de aceptación/revisión de `pdfjs-dist@6.1.200` y cuatro avisos de rendimiento del Dashboard.
- No se ejecutó captura visual a 1280/1920/390 ni prueba de teclado/tacto: el cambio es cobertura de código y árbol, no certificación final de IA.

#### Lo que falta después de la pasada 22

| Pendiente | Estado al cierre de la pasada 22 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar migración/seed y captura aisladas de los veinte detalles, en desktop y móvil. Validar relaciones, RBAC/scope, asociación, 404 para ID inexistente y retorno contextual por cada grupo; la preparación estática no es certificación de render. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar todos los estados de tarjeta y transiciones tabla/tarjeta a 320, 390, 768 y 1024 px, con zoom 200 %, teclado, foco, lector de pantalla y reflow. Confirmar filtros, paginación, identidad, estado y acción sin clipping. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar que ninguna etiqueta resulta indistinguible, que foco y tooltip/label comunican el destino, que el activo/ancestro se mantiene visible al navegar y que Privacidad/Campañas no exponen rutas prohibidas. Revisar las rutas restantes redirigidas antes de declarar canonicalización completa. |
| TASK-UI-006 | No iniciado | Compactar KPI/filtros de Dashboard, Flota, Pendientes, Backups y Prevención. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 22:** Prevención conserva sus módulos y enlaces, pero ya los presenta con vocabulario breve, grupos por tarea y dos rutas antes sin dueño. Falta certificar el comportamiento visual y por rol, así que UX-NAV-001 queda parcialmente resuelto, no cerrado.

### Pasada 23 — filtros progresivos y no ambiguos en Pendientes

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** acercar la primera tarea de `/pendientes` y eliminar el segundo control ambiguo “Prioridad”, preservando el contrato de filtros por URL.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-006 / FILTER-001 | Implementado; pendiente de interacción visual | Se dejaron visibles búsqueda, cuatro vistas rápidas (Todas, Críticas, Vencidas, Mis tareas), faena y **Ordenar por**. Módulo, prioridad exacta, estado y las vistas secundarias (Hoy, Bloqueadas, Sin asignar) pasan a `Más filtros`. | La vista rápida y el filtro exacto de prioridad se distinguen; el orden ya no compite con el label “Prioridad”. |
| TASK-UI-006 / filtros activos | Implementado; pendiente de interacción visual | Se usan `FilterToolbar` y chips removibles para búsqueda, vista rápida, faena, módulo, prioridad y estado; el contador de `Más filtros` cuenta sólo los tres filtros avanzados. | Cada chip llama a la misma actualización de URL que el control original; limpiar vuelve a `pathname` sin query. |
| TASK-UI-006 / continuidad | Conservado | No se cambió la consulta, cursor, orden SQL, tarjeta móvil ni el CTA de la cola. Los filtros siguen restableciendo cursor con `update`. | Lint y TypeScript validan las claves y labels derivados de URL. |

#### Verificación ejecutada

- `npx eslint app/(app)/pendientes/work-queue-workbench.tsx`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgos en Pendientes; se mantienen el error de aceptación/revisión de `pdfjs-dist@6.1.200` y cuatro avisos de rendimiento del Dashboard.
- No había prueba focalizada existente para el workbench y no se añadió una superficial. Quedan pendientes E2E de URL/chips/Sheet y la inspección a 390×844; no se ejecutó Playwright compartido por el reset de datos del capturador.

#### Lo que falta después de la pasada 23

| Pendiente | Estado al cierre de la pasada 23 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar migración/seed y captura aisladas de los veinte detalles, en desktop y móvil. Validar relaciones, RBAC/scope, asociación, 404 para ID inexistente y retorno contextual por cada grupo; la preparación estática no es certificación de render. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar todos los estados de tarjeta y transiciones tabla/tarjeta a 320, 390, 768 y 1024 px, con zoom 200 %, teclado, foco, lector de pantalla y reflow. Confirmar filtros, paginación, identidad, estado y acción sin clipping. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar que ninguna etiqueta resulta indistinguible, que foco y tooltip/label comunican el destino, que el activo/ancestro se mantiene visible al navegar y que Privacidad/Campañas no exponen rutas prohibidas. Revisar las rutas restantes redirigidas antes de declarar canonicalización completa. |
| TASK-UI-006, validación de Pendientes | Implementación parcial | E2E de búsqueda, vistas rápidas, Sheet, chips removibles, limpiar, URL/cursor y retorno; inspección 390×844 para comprobar primera tarea visible. Extender la regla de cuatro KPI/filtros a Dashboard, Flota, Backups, CAPA, Capacitación, Permisos, Higiene y Emergencias. |
| TASK-UI-007 | No iniciado | Progreso PPA, condicionales, preservación, foco, offline e idempotencia. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; evaluar en una pasada dedicada los cuatro avisos de Dashboard. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 23:** Pendientes ya no presenta siete vistas rápidas y dos “Prioridad” en el primer bloque. Su implementación conserva URL y cursor, pero FILTER-001 requiere todavía evidencia E2E y a 390 px; TASK-UI-006 permanece parcial por los demás módulos de métricas/filtros.

### Pasada 24 — PPA público progresivo, condicional y recuperable

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** reducir la carga visible del PPA sin debilitar las reglas de detención, la conservación de respuestas ni el guardado offline existente.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-007 / progreso | Implementado; pendiente de E2E visual | El formulario público se divide en tres pasos: **Persona y tarea**, **Riesgos y controles** y **Decisión final**. El indicador es sticky, anuncia paso actual y permite volver a pasos ya completados sin borrar estado. | El estado continúa en `usePpaForm`; el cambio de sección no remonta ni recrea sus respuestas. |
| TASK-UI-007 / validación de avance | Implementado; pendiente de E2E | Antes de avanzar valida faena, identificación y tarea; luego exige respuestas de cambio/peligro, su descripción condicionada y los controles mínimos `EPP` y `Herramientas`. El error se anuncia con `role="alert"` y mueve el foco al control pertinente. | El submit, `evaluatePpa`, confirmación de detención y schema final siguen intactos. |
| TASK-UI-007 / condicionales | Implementado; pendiente de E2E | Las cuatro preguntas abiertas de Para, Piensa y Actúa se muestran sólo cuando el tipo de tarea es crítico. Para esas tareas se validan antes de pasar a la decisión final. | Usa `isTareaCritica` y `PPA_REQUIRED_CONTROLS` del dominio, no condiciones duplicadas en UI. |
| TASK-UI-007 / operación en terreno | Conservado | El footer sticky ofrece **Volver**, **Continuar** o **Enviar PPA/Guardar offline** según sección y conectividad. La cola offline, su confirmación inline, el reset “Realizar otro PPA” y el diálogo de trabajo detenido permanecen sin cambios. | Las pruebas de acción y evaluación siguen verdes. |

#### Verificación ejecutada

- `npx vitest run lib/ppa/__tests__/evaluation.test.ts lib/__tests__/ppa-actions.test.ts`: **2 archivos y 22 pruebas verdes**.
- `npx eslint` sobre formulario/hook, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**. Conserva el error `pdfjs-dist@6.1.200` y los cuatro avisos del Dashboard; añade el aviso de mantenibilidad de que `PpaFormInner` supera 300 líneas. No se suprime: la fragmentación debe ejecutarse después de cubrir la interacción crítica con pruebas de componente/E2E.
- No se ejecutó navegador, teclado físico, offline real ni Playwright: faltan fixture y entorno aislado para certificar 320×568, retorno, foco y sincronización.

#### Lo que falta después de la pasada 24

| Pendiente | Estado al cierre de la pasada 24 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar migración/seed y captura aisladas de los veinte detalles, en desktop y móvil. Validar relaciones, RBAC/scope, asociación, 404 para ID inexistente y retorno contextual por cada grupo; la preparación estática no es certificación de render. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar todos los estados de tarjeta y transiciones tabla/tarjeta a 320, 390, 768 y 1024 px, con zoom 200 %, teclado, foco, lector de pantalla y reflow. Confirmar filtros, paginación, identidad, estado y acción sin clipping. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar que ninguna etiqueta resulta indistinguible, que foco y tooltip/label comunican el destino, que el activo/ancestro se mantiene visible al navegar y que Privacidad/Campañas no exponen rutas prohibidas. Revisar las rutas restantes redirigidas antes de declarar canonicalización completa. |
| TASK-UI-006, validación de Pendientes | Implementación parcial | E2E de búsqueda, vistas rápidas, Sheet, chips removibles, limpiar, URL/cursor y retorno; inspección 390×844 para comprobar primera tarea visible. Extender la regla de cuatro KPI/filtros a Dashboard, Flota, Backups, CAPA, Capacitación, Permisos, Higiene y Emergencias. |
| TASK-UI-007, certificación PPA y refactor | Implementación parcial | Prueba de componente para pasos, validación/foco, condicional crítico, vuelta sin pérdida y submit. E2E offline→sync, 320×568, teclado virtual y orientación horizontal. Tras esa cobertura, dividir `PpaFormInner` sin cambiar reglas. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; resolver el tamaño de `PpaFormInner` con cobertura de interacción; evaluar los cuatro avisos de Dashboard. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 24:** PPA ya no obliga a leer toda la evaluación antes de comenzar. La progresión, las condiciones de tarea crítica, las reglas de detención y el guardado offline están presentes en código, pero no se consideran certificados hasta probar interacción, foco, offline y reanudación en el dispositivo objetivo.

### Pasada 25 — Contrato E2E de la progresión PPA

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** convertir la nueva secuencia de tres pasos en un contrato de pruebas, para que los flujos PPA existentes no intenten interactuar con controles que ya no están montados y para dejar explícita la evidencia que aún requiere navegador aislado.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-007 / helper de formulario | Implementado; pendiente de ejecución real | `fillManualPpaForm` ahora completa identificación y tarea, avanza, completa riesgos y controles mínimos, vuelve a avanzar y recién responde la decisión. | Los 37 escenarios offline y de coexistencia que lo comparten conservan su intención: reciben el formulario ya en el paso 3 y pueden comprobar `Guardar offline`. |
| TASK-UI-007 / flujo autenticado | Implementado; pendiente de ejecución real | `startForm` y `checkRequiredControls` de `ppa-flow.spec.ts` avanzan entre secciones; los cuatro escenarios de envío y revisión vuelven a ejercitar el resultado, no el antiguo formulario plano. | Las interacciones de cambio/peligro, controles y decisión quedan en el paso donde se renderizan. |
| TASK-UI-007 / regresión de progreso | Implementado; pendiente de ejecución real | Se añadió un E2E que selecciona una tarea crítica, comprueba las preguntas Para, Piensa y Actúa, vuelve a Persona y tarea sin perder nombre, verifica el foco en la primera respuesta pendiente y llega a Decisión final tras completarlas. | Cubre progreso, condicional crítico, retención al volver y foco de bloqueo; no simula aún teclado virtual ni orientación. |

#### Verificación ejecutada

- `npx eslint e2e/helpers.ts e2e/ppa-flow.spec.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx playwright test e2e/ppa-flow.spec.ts e2e/ppa-offline.spec.ts e2e/tae-ppa-coexistence.spec.ts --list`: **40 escenarios detectados**, incluidos el nuevo progreso, 30 de PPA offline y 3 de coexistencia PPA/TAE.
- No se ejecutaron esos 40 escenarios: hay procesos `next-server` y `test-server` vivos sobre el checkout y la configuración E2E prepara datos. Enumerar no muta ni certifica navegador; la corrida debe hacerse con servidor y base exclusivos.

#### Lo que falta después de la pasada 25

| Pendiente | Estado al cierre de la pasada 25 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar migración/seed y captura aisladas de los veinte detalles, en desktop y móvil. Validar relaciones, RBAC/scope, asociación, 404 para ID inexistente y retorno contextual por cada grupo; la preparación estática no es certificación de render. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar todos los estados de tarjeta y transiciones tabla/tarjeta a 320, 390, 768 y 1024 px, con zoom 200 %, teclado, foco, lector de pantalla y reflow. Confirmar filtros, paginación, identidad, estado y acción sin clipping. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar que ninguna etiqueta resulta indistinguible, que foco y tooltip/label comunican el destino, que el activo/ancestro se mantiene visible al navegar y que Privacidad/Campañas no exponen rutas prohibidas. Revisar las rutas restantes redirigidas antes de declarar canonicalización completa. |
| TASK-UI-006, validación de Pendientes | Implementación parcial | E2E de búsqueda, vistas rápidas, Sheet, chips removibles, limpiar, URL/cursor y retorno; inspección 390×844 para comprobar primera tarea visible. Extender la regla de cuatro KPI/filtros a Dashboard, Flota, Backups, CAPA, Capacitación, Permisos, Higiene y Emergencias. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios listados en servidor/base aislados; añadir revisión manual de 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Tras esa cobertura, dividir `PpaFormInner` sin cambiar reglas. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011 | No iniciado | Salud real SMTP/backups/módulos, confirmación y rollback verificable. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; cubrir y fragmentar `PpaFormInner`; evaluar los cuatro avisos de Dashboard. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 25:** el rediseño PPA ya no deja una suite de regresión incompatible: los recorridos conocidos esperan y cruzan cada paso. Aún no hay evidencia de navegador ejecutado ni de dispositivo móvil real, por lo que la certificación de interacción/offline sigue abierta.

### Pasada 26 — Respaldos: salud observable, sin verde ficticio

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** corregir la contradicción del panel de respaldos —“Sin fallos” en verde junto a “0 ejecutados”— y reducir el resumen a decisiones que cambian la operación.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-006 / DASH-ADMIN-001, densidad | Implementado; pendiente de inspección visual | Se sustituyeron seis KPI por tres estados: **Estado de respaldos**, **Cobertura reciente** y **Destino remoto**. Tamaño e historial permanecen disponibles en el listado, sin competir con la decisión de recuperabilidad. | `buildBackupStatusCards` devuelve exactamente tres tarjetas. |
| TASK-UI-011 / ausencia de evidencia | Implementado | Sin registros, el estado principal dice **“Nunca se ha ejecutado un respaldo”** y es de alerta; cobertura también falla y una comprobación de Drive fallida queda en advertencia, nunca como “rclone no instalado” inferido desde un error. | La prueba cubre cero registros y Drive no verificable: ninguna tarjeta queda verde. |
| TASK-UI-011 / salud positiva | Implementado | Sólo se muestra éxito de destino si Drive es alcanzable y la cuenta de servicio existe y es válida; la cobertura cuenta exclusivamente ejecuciones `success` de los últimos siete días, no filas iniciadas/fallidas. | `BackupStats` añade `successfulBackupsLast7Days`; la prueba cubre éxito con respaldo y destino reales. |
| TASK-UI-011 / siguiente acción y seguridad | Implementado; pendiente de navegador | Al no haber copia, una alerta explica el riesgo y enlaza a **Revisar configuración**. `Respaldar ahora` conserva `useActionState`, anuncia su resultado con `role="status"` y exige confirmación que informa duración, historial y el límite de no equivaler a una restauración. | No se añadió un undo ficticio: una copia manual no tiene rollback seguro. |

#### Verificación ejecutada

- `npx vitest run app/(app)/admin/backups/backup-health.test.ts`: **2 pruebas verdes**; valida ausencia de respaldo sin verde, máximo tres tarjetas y éxito sólo con evidencia positiva.
- `npx eslint` de los seis archivos modificados y `lib/services/backups.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo en Backups. Se mantienen fuera de esta pasada el riesgo de dependencia `pdfjs-dist`, cuatro avisos de Dashboard y el tamaño de `PpaFormInner`.
- No se ejecutó un respaldo manual, conectividad Drive ni restauración: son acciones operacionales contra infraestructura y datos reales, no una prueba que deba dispararse desde esta pasada de interfaz.

#### Lo que falta después de la pasada 26

| Pendiente | Estado al cierre de la pasada 26 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar migración/seed y captura aisladas de los veinte detalles, en desktop y móvil. Validar relaciones, RBAC/scope, asociación, 404 para ID inexistente y retorno contextual por cada grupo; la preparación estática no es certificación de render. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar todos los estados de tarjeta y transiciones tabla/tarjeta a 320, 390, 768 y 1024 px, con zoom 200 %, teclado, foco, lector de pantalla y reflow. Confirmar filtros, paginación, identidad, estado y acción sin clipping. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar que ninguna etiqueta resulta indistinguible, que foco y tooltip/label comunican el destino, que el activo/ancestro se mantiene visible al navegar y que Privacidad/Campañas no exponen rutas prohibidas. Revisar las rutas restantes redirigidas antes de declarar canonicalización completa. |
| TASK-UI-006, extensión de densidad | Implementación parcial | Pendientes y Backups están corregidos; aplicar y validar la regla de cuatro KPI/filtros a Dashboard, Flota, CAPA, Capacitación, Permisos, Higiene y Emergencias. Validar E2E, 390×844 y teclado de Pendientes. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios listados en servidor/base aislados; añadir revisión manual de 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Tras esa cobertura, dividir `PpaFormInner` sin cambiar reglas. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011, SMTP y módulos | Parcial | Backups comunica estado veraz y confirma ejecución; falta derivar estado agregado de SMTP y módulos, confirmar impacto de cambios globales y probar respaldo, destino y restauración reales con evidencia de auditoría. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; cubrir y fragmentar `PpaFormInner`; evaluar los cuatro avisos de Dashboard. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 26:** el panel ya comunica una condición sin respaldo como riesgo operativo y no como éxito por ausencia de errores. La salud de infraestructura y recuperabilidad final permanecen abiertas hasta ejecutar, verificar y restaurar una copia en un entorno autorizado.

### Pasada 27 — Correo: intención, capacidad y prueba auditada

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** hacer que el estado de correo describa la capacidad real conocida —proveedor e interruptor— sin convertir una clave presente en salud demostrada, y proteger el cambio global.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-011 / estado agregado SMTP | Implementado; pendiente de operación real | La pantalla antepone un estado único: **Suspendido: proveedor no configurado**, **Suspendido: envíos globales desactivados** o **Configurado: prueba de envío pendiente**. Una `RESEND_API_KEY` presente ya no se pinta como entrega confirmada. | Pruebas de componente cubren proveedor ausente, proveedor configurado e interruptor global apagado. |
| TASK-UI-011 / control global | Implementado; pendiente de navegador | `Enviar correos del sistema` sigue usando `useActionState` y el guard del backend; al guardar pide confirmación con el alcance concreto de invitaciones, notificaciones y recuperación. Cancelar restaura el valor no guardado. | No se reemplazó el form action ni se eliminó su mejora progresiva. |
| TASK-UI-011 / prueba y trazabilidad | Implementado | Cada prueba de Resend registra actor, destinatario, resultado y timestamp en `audit_log` como `smtp_delivery_test`. Si Resend devuelve error o lanza una excepción, se registra un resultado fallido. Si falla la auditoría, el usuario recibe un mensaje explícito y no un falso éxito. | Pruebas de acción cubren éxito, error y excepción del proveedor con auditoría. |
| TASK-UI-011 / límites de la señal | Declarado | Una prueba satisfactoria significa que Resend aceptó la solicitud, no que el destinatario leyó el correo ni que existe salud histórica persistida en el panel. | No se hizo envío real ni se prometió entrega/restauración inexistente. |

#### Verificación ejecutada

- `npx vitest run app/(app)/admin/correo-smtp/smtp-form.test.tsx lib/__tests__/admin-config-smtp-templates.test.ts lib/__tests__/smtp-settings.test.ts`: **3 archivos y 29 pruebas verdes**.
- `npx eslint` de formulario, acciones y pruebas, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin diagnóstico nuevo en Correo. Se mantienen el riesgo de dependencia `pdfjs-dist`, cuatro avisos de Dashboard y la mantenibilidad de `PpaFormInner`.
- No se ejecutó `testResendAction` contra Resend ni se modificó el interruptor en una base operacional. Eso requeriría autorización sobre el destinatario y entorno real.

#### Lo que falta después de la pasada 27

| Pendiente | Estado al cierre de la pasada 27 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar migración/seed y captura aisladas de los veinte detalles, en desktop y móvil. Validar relaciones, RBAC/scope, asociación, 404 para ID inexistente y retorno contextual por cada grupo; la preparación estática no es certificación de render. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar todos los estados de tarjeta y transiciones tabla/tarjeta a 320, 390, 768 y 1024 px, con zoom 200 %, teclado, foco, lector de pantalla y reflow. Confirmar filtros, paginación, identidad, estado y acción sin clipping. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar que ninguna etiqueta resulta indistinguible, que foco y tooltip/label comunican el destino, que el activo/ancestro se mantiene visible al navegar y que Privacidad/Campañas no exponen rutas prohibidas. Revisar las rutas restantes redirigidas antes de declarar canonicalización completa. |
| TASK-UI-006, extensión de densidad | Implementación parcial | Pendientes y Backups están corregidos; aplicar y validar la regla de cuatro KPI/filtros a Dashboard, Flota, CAPA, Capacitación, Permisos, Higiene y Emergencias. Validar E2E, 390×844 y teclado de Pendientes. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios listados en servidor/base aislados; añadir revisión manual de 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Tras esa cobertura, dividir `PpaFormInner` sin cambiar reglas. |
| TASK-UI-008, certificación restante | Pendiente operativo | Ejecutar el E2E TAE ampliado, cubrir 429 y red/offline desde la activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir la política para cargas offline pendientes al finalizar una sesión en dispositivo compartido antes de prometer borrado completo de datos locales. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir la hoja y volver con año, faena, período, vista y filtro intactos. Capturar desktop/móvil y comprobar foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol la alerta de HH faltantes, CTA al mes correcto, guardado, recálculo, vista total y retorno al indicador; confirmar responsable operativo cuando el usuario no puede gestionar el denominador. |
| TASK-UI-010 | No iniciado | Usuarios/Roles: rol primero, scopes, excepciones y diff verificable. |
| TASK-UI-011, módulos y operación | Parcial | Backups y SMTP comunican estado más veraz, confirman cambios y registran pruebas; falta salud agregada de módulos, vista de última prueba SMTP, y ejecutar/resguardar/restaurar evidencias operacionales autorizadas. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar mediante revisión explícita `pdfjs-dist@6.1.200`; cubrir y fragmentar `PpaFormInner`; evaluar los cuatro avisos de Dashboard. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 27:** Correo ya no confunde intención, proveedor y entrega. El sistema conserva el guard de backend, confirma el cambio masivo y deja trazabilidad de las pruebas; verificar Resend, destinatario y salud persistida sigue siendo trabajo operacional pendiente.

### Pasada 28 — Administración por rol, alcance y revisión legible

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** reducir errores de asignación en Usuarios e Invitaciones haciendo visible la secuencia de decisión: rol base, faenas, datos de la persona, excepciones y revisión final; alinear el editor de Roles con ese lenguaje operativo.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-010 / fuente de verdad de alcance | Implementado | Se creó `lib/auth/role-scope.ts`. La misma lista de roles que exige faena ahora alimenta la validación de Server Actions y la UI; no hay dos listas que puedan divergir. | `role-scope.test.ts` cubre rol de faena y administrador global. La validación transaccional existente permanece en create/update/invite. |
| TASK-UI-010 / alta y edición de usuario | Implementado; pendiente de E2E | El Sheet sigue el orden **1. Rol y acceso base → 2. Faenas y alcance → Datos de la persona → Excepciones → 3. Revisión del acceso**. La revisión resume roles, faena principal, permisos heredados y excepciones con etiquetas de negocio. | Sin rol, o con un rol de faena sin faena, el botón queda deshabilitado y expone la causa antes de enviar; no sustituye al guard del servidor. |
| TASK-UI-010 / invitación | Implementado; pendiente de E2E | `Invitar usuario` reutiliza los selectores, la regla de alcance y la revisión del alta directa. Se eliminó la duplicación de componentes y la etiqueta anidada que contenía un botón. | La casilla de cada faena tiene nombre accesible `Seleccionar [faena] ([código])`; el control de faena principal queda fuera de su label. |
| TASK-UI-010 / excepciones y lectura | Implementado | Los permisos directos quedan cerrados en **Excepciones de permisos (N)**, aclaran que el rol conserva el acceso habitual y dejan de mostrar la clave técnica a la derecha. | La prueba confirma descripción operativa y ausencia de `reports:view`; el resumen final nombra la excepción sin exponer el identificador. |
| TASK-UI-010 / Roles | Implementado; pendiente de E2E | El editor ordena perfil, alcance y permisos; muestra contador de permisos aplicados por defecto, corrige `Quuitar todos`, privilegia la descripción del permiso y lleva filas táctiles de al menos 44 px en móvil. | El identificador interno sigue explícito sólo en la definición administrativa del rol; no se expone en el flujo estándar de asignación de usuarios. |
| TASK-UI-010 / consistencia React | Implementado | `UserForm` se remonta por usuario editado en la lista y las excepciones se controlan como estado local, evitando restablecimientos por efectos. Los Server Actions se importan directamente, no por el barrel de acciones. | React Doctor deja de informar la búsqueda lineal, el reset de estado, el ajuste posterior ni el atributo DOM inválido introducidos durante esta pasada. |

#### Verificación ejecutada

- `npx vitest run app/(app)/admin/usuarios/user-form.test.tsx lib/auth/role-scope.test.ts`: **2 archivos y 8 pruebas verdes**; cubren rol seleccionado, excepciones legibles, bloqueo sin rol y desbloqueo sólo después de asignar una faena al rol que la exige.
- `npx eslint` sobre los archivos de Usuarios, Roles y alcance modificados, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgos en esta pasada. Permanecen fuera del alcance el riesgo de cadena de suministro de `pdfjs-dist@6.1.200`, carga eager de Recharts, dos optimizaciones de Dashboard y la fragmentación de `PpaFormInner`.
- No se ejecutó navegador, captura ni E2E: los procesos compartidos `next-server`/`test-server` y el reset de datos del capturador impiden que una corrida sobre este checkout sea evidencia aislada.

#### Lo que falta después de la pasada 28

| Pendiente | Estado al cierre de la pasada 28 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros procesos Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar migración/seed y captura aisladas de los veinte detalles, en desktop y móvil. Validar relaciones, RBAC/scope, asociación, 404 para ID inexistente y retorno contextual por cada grupo; la preparación estática no es certificación de render. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones tabla/tarjeta a 320, 390, 768 y 1024 px, con zoom 200 %, teclado, foco, lector de pantalla y reflow. Confirmar filtros, paginación, identidad, estado y acción sin clipping. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión de densidad | Implementación parcial | Pendientes y Backups están corregidos; aplicar y validar la regla de cuatro KPI/filtros a Dashboard, Flota, CAPA, Capacitación, Permisos, Higiene y Emergencias. Validar E2E, 390×844 y teclado de Pendientes. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios listados en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Tras esa cobertura, dividir `PpaFormInner` sin cambiar reglas. |
| TASK-UI-008, certificación TAE | Pendiente operativo | Ejecutar E2E ampliado, cubrir 429 y red/offline desde activación, verificar 320/390 con teclado y Safari/Chrome móvil. Definir política de cargas offline al finalizar sesión en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: abrir editor, crear/corregir hoja y volver con año, faena, período, vista y filtro intactos; capturar desktop/móvil y foco/lectura del estado. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; confirmar responsable cuando el usuario no puede gestionar el denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar: rol global, rol de faena sin/con una y varias faenas, cambio de principal, excepción agregada/removida y rechazo de POST manipulado. Revisar 320/390, tabulación, lector de pantalla y persistencia/retorno. |
| TASK-UI-011, módulos y operación | Parcial | Backups y SMTP comunican estado más veraz, confirman cambios y registran pruebas; falta salud agregada de módulos, vista de última prueba SMTP, y ejecutar/resguardar/restaurar evidencias operacionales autorizadas. |
| TASK-UI-012 | No iniciado | Glosario y formatters de labels, fechas, horas, unidades y pluralización. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar explícitamente `pdfjs-dist@6.1.200`; cargar Recharts bajo demanda, corregir las dos optimizaciones de Dashboard y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 28:** la asignación estándar ya no presenta roles, scopes y permisos directos como decisiones equivalentes. El rol establece el acceso por defecto, la faena lo acota, las excepciones se aíslan y una revisión legible bloquea combinaciones incompletas antes del envío. Falta certificarlo en navegador aislado y continuar con los ítems P1/P2 no iniciados.

### Pasada 29 — Contrato compartido de fecha, cantidad y tamaño

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** consolidar el formato visible `dd-MM-aaaa`, `HH:mm`, cantidades con unidades concordantes y tamaños de archivo, aplicándolo primero a los casos que la auditoría confirmó como inconsistentes.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-012 / utilidades compartidas | Implementado | `lib/utils.ts` ya concentraba fecha, fecha/hora Chile, moneda y cantidad. Se añadió `formatFileSize`, que conserva separador decimal chileno y distingue un archivo vacío (`0 B`) de un tamaño ausente (`—`). | Las pruebas cubren bytes, KB, MB, valor nulo e inválido. |
| TASK-UI-012 / fechas | Implementado en las superficies tocadas | El formato de SST pasa de `dd/MM/aaaa` a `dd-MM-aaaa`; Soporte, CAPA, PPA y listas de documentación ahora delegan a `formatDate`/`formatDateTime` en vez de crear `toLocaleString`, cortar ISO o usar un formato local distinto. | `formatDate` sigue preservando fecha calendario y `formatDateTime` fija la hora de Chile y `00:00` en medianoche. |
| TASK-UI-012 / unidad singular/plural | Implementado | El historial de EPP del trabajador ya no concatena cantidad y unidad: usa `formatQty`. Así `1 unidad` y `2 unidades` concuerdan, conservando abreviaturas de catálogo desconocidas sin inventar plural. | El caso visual confirmado “2 unidad” queda cubierto por los casos unitarios de cantidad. |
| TASK-UI-012 / documentación | Implementado | Dos filas de explorador y el historial de versiones reutilizan las funciones compartidas para fecha y tamaño de archivo; se eliminaron tres implementaciones locales. | Sin corte de ISO expuesto en esas vistas; el formato puede probarse sin montar la pantalla. |

#### Verificación ejecutada

- `npx vitest run lib/__tests__/utils.test.ts lib/__tests__/formatting.test.ts lib/sst/__tests__/date.test.ts`: **3 archivos y 71 pruebas verdes**.
- `npx eslint` de utilidades, pruebas y las siete superficies modificadas, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Siguen separados `pdfjs-dist@6.1.200`, Recharts, dos optimizaciones del Dashboard y la fragmentación de `PpaFormInner`.
- No se hizo reemplazo masivo de nombres de enum, slugs ni siglas: sin un glosario aprobado eso podría crear sinónimos o alterar claves de dominio. Tampoco se certificó visualmente el cambio en navegador aislado.

#### Lo que falta después de la pasada 29

| Pendiente | Estado al cierre de la pasada 29 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión de densidad | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard, Flota, CAPA, Capacitación, Permisos, Higiene y Emergencias; validar Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar y versionar glosario de PDTP, MIPER, CAPA, PPA, LOTO y HH; convertir enums/slugs restantes a labels de negocio, documentar formatos legales propios y ejecutar búsqueda estática/snapshots por cada dominio. |
| TASK-UI-013 | No iniciado | Viewer HTML móvil y PDF A4 independiente, incluida descarga/error. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar explícitamente `pdfjs-dist@6.1.200`; cargar Recharts bajo demanda, corregir las dos optimizaciones del Dashboard y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 29:** los formatos compartidos ya evitan las discrepancias de fecha, hora, archivo y plural que aparecían en las superficies corregidas. La centralización total todavía requiere un glosario de negocio acordado y adopción dirigida por dominio; no se debe sustituir masivamente copy o claves hasta contar con ese contrato.

### Pasada 30 — Lectura móvil separada de Acta SST y Orden de Compra

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** evitar que el A4 sea la única superficie de lectura en teléfono, sin cambiar el artefacto legal ni su PDF.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-013 / patrón móvil | Implementado para SST y OC; pendiente para Entregas | Se creó `MobileDocumentSummary`: una superficie HTML con título, contexto y campos clave. A 760 px o menos se muestra este resumen y se oculta la hoja A4; en impresión se hace lo contrario. | El PDF sigue usando la hoja A4 con `@media print`, por lo que no se cambia su contenido, tamaño ni pipeline. |
| TASK-UI-013 / Acta SST | Implementado; pendiente de navegador | Móvil entrega resultado, porcentaje, estado, trabajador, faena y fecha, con aviso explícito de que el PDF es el documento completo. | El resumen usa datos del mismo `ActaData`; no recrea ni infiere resultados. |
| TASK-UI-013 / Orden de Compra | Implementado; pendiente de navegador | Móvil entrega proveedor, ítems, faena, forma de pago, emisión y totales; conserva la barra sticky con descarga PDF y retorno. | Las acciones tienen target mínimo de 44 px en móvil. |
| TASK-UI-013 / error de descarga SST | Implementado | La descarga SST deja de fallar en silencio: comunica error y permite reintentar, en paridad con la OC. | El mensaje es `role="status"`; no finge que el PDF se generó. |
| TASK-UI-013 / Entregas | Pendiente | El comprobante de entrega aún sólo posee la hoja de impresión y no cuenta con endpoint PDF equivalente; no se añadió un enlace de descarga ficticio. | Requiere construir/verificar el artefacto PDF y su autorización antes de aplicar el mismo patrón. |

#### Verificación ejecutada

- `npx vitest run components/print/mobile-document-summary.test.tsx`: **1 archivo y 1 prueba verde**; confirma semántica de resumen, aviso de lectura y campo clave.
- `npx eslint` sobre resumen, páginas, triggers y estilos modificados, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Persisten los seis hallazgos externos de `pdfjs-dist`, Dashboard y `PpaFormInner`.
- No se generó PDF ni se abrió el navegador: faltan ruta aislada, descarga real, captura 320/390 y comparación visual del PDF A4.

#### Lo que falta después de la pasada 30

| Pendiente | Estado al cierre de la pasada 30 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión de densidad | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard, Flota, CAPA, Capacitación, Permisos, Higiene y Emergencias; validar Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, extensión y certificación | Implementación parcial | Aplicar resumen y endpoint PDF real a Entregas; probar descarga, error, foco, 320/390 y PDF A4 de Acta/OC/Entrega en navegador aislado. |
| TASK-UI-014 | No iniciado | Sheet móvil de notificaciones, tabs adaptativas, targets 44 px y foco/restauración. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar explícitamente `pdfjs-dist@6.1.200`; cargar Recharts bajo demanda, corregir las dos optimizaciones del Dashboard y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 30:** Acta SST y Orden de Compra dejan de reducir su A4 a una superficie ilegible en móvil y conservan un camino explícito al PDF. Entregas, las descargas reales y la comprobación visual/PDF quedan pendientes; por ello TASK-UI-013 sigue parcial.

### Pasada 31 — Notificaciones en Sheet y tabs continuas

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** reemplazar el popover estrecho de notificaciones en teléfono por una superficie modal operable, y evitar que las pestañas de OC se separen visualmente.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-014 / notificaciones | Implementado; pendiente de navegador | Escritorio conserva el popover. Móvil abre el mismo contenido en un `Sheet` con título, foco modal, cierre, lectura individual, “Marcar todas leídas” y cierre al seguir una notificación. | La lista, loading y vacío se comparten entre ambas presentaciones, sin bifurcar estado ni mutaciones. |
| TASK-UI-014 / targets | Implementado | El disparador, la acción masiva y las filas de notificación tienen mínimo 44 px en móvil. `SheetCloseButton` adopta el mismo mínimo móvil a nivel compartido. | No se hizo crecer los controles de escritorio: a partir de `sm` conserva su tamaño compacto. |
| TASK-UI-014 / tabs OC | Implementado; pendiente de navegador | `TabsList` admite desborde horizontal y el detalle OC elimina `flex-wrap`; Ítems, Facturación, Avance e Historial permanecen en un único control desplazable. | Conserva el estado Radix, URL `?tab=` y los contadores existentes. |

#### Verificación ejecutada

- `npx vitest run components/layout/notification-bell.test.tsx components/print/mobile-document-summary.test.tsx`: **2 archivos y 2 pruebas verdes**. La nueva prueba abre la Sheet, verifica nombre accesible, contenido y acción masiva.
- `npx eslint` de notificaciones, Sheet, Tabs y detalle OC, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Siguen los seis hallazgos externos de `pdfjs-dist`, Dashboard y `PpaFormInner`.
- Falta inspección en 320/390 y zoom 200 %, Escape/foco restaurado en dispositivo real, gesto de scroll horizontal y la confirmación con lector de pantalla.

#### Lo que falta después de la pasada 31

| Pendiente | Estado al cierre de la pasada 31 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión de densidad | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard, Flota, CAPA, Capacitación, Permisos, Higiene y Emergencias; validar Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, extensión y certificación | Implementación parcial | Aplicar resumen y endpoint PDF real a Entregas; probar descarga, error, foco, 320/390 y PDF A4 de Acta/OC/Entrega en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015 | No iniciado | Exportación Excel unificada, resúmenes accesibles de gráficos y fixtures 0/1/muchos puntos. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar explícitamente `pdfjs-dist@6.1.200`; cargar Recharts bajo demanda, corregir las dos optimizaciones del Dashboard y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 31:** las notificaciones dejan de depender de un popover de escritorio en teléfono y las tabs del detalle OC se mantienen como una elección única. Falta demostrarlo con el viewport, teclado y lector de pantalla objetivo; la estandarización de las demás tablists sigue pendiente.

### Pasada 32 — Una entrada para exportaciones de Reportes

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** reducir cuatro controles de exportación competidores a una única acción de página, sin alterar filtros ni contratos Excel.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-015 / entrada de exportación | Implementado; pendiente de navegador | `/reportes` reemplaza los cuatro botones del header por **Exportar Excel**. El menú pide elegir Ítems sin OC, Gasto por faena, OC cerradas sin factura u OC por estado. | Los cuatro tipos, filtros de estado/faena y endpoint existente permanecen en `ExportDialog`. |
| TASK-UI-015 / composición de diálogos | Implementado | `ExportDialog` ahora informa apertura/cierre opcionalmente; al elegir un informe el menú se cierra antes de abrir el diálogo de filtros, evitando dos superficies activas. | No se duplicó generación de URL ni la descarga `.xlsx`. |
| TASK-UI-015 / contrato de UX | Implementado | La entrada es una acción de página en `PageHeader.actions`, y las cuatro alternativas conservan nombre explícito. | Prueba de componente comprueba un CTA y los cuatro items de menú. |

#### Verificación ejecutada

- `npx vitest run app/(app)/reportes/reports-export-menu.test.tsx components/layout/notification-bell.test.tsx components/print/mobile-document-summary.test.tsx`: **3 archivos y 3 pruebas verdes**.
- `npx eslint` de Reportes y `ExportDialog`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Se mantienen los seis hallazgos externos de `pdfjs-dist`, Dashboard y `PpaFormInner`.
- No se descargó un Excel ni se inspeccionaron los gráficos en navegador. Faltan fixture vacío/un punto/muchos puntos, resumen textual por gráfico y verificación de los XLSX generados.

#### Lo que falta después de la pasada 32

| Pendiente | Estado al cierre de la pasada 32 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión de densidad | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard, Flota, CAPA, Capacitación, Permisos, Higiene y Emergencias; validar Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, extensión y certificación | Implementación parcial | Aplicar resumen y endpoint PDF real a Entregas; probar descarga, error, foco, 320/390 y PDF A4 de Acta/OC/Entrega en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, gráficos y archivos | Implementación parcial | Añadir resumen textual/tabla equivalente, unidad/período y estado de un punto a cada gráfico; fixtures 0/1/muchos puntos y validación del XLSX descargado. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar explícitamente `pdfjs-dist@6.1.200`; cargar Recharts bajo demanda, corregir las dos optimizaciones del Dashboard y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 32:** Reportes ya tiene una única entrada de exportación y no pierde ninguno de los cuatro Excel. La lectura accesible de gráficos y la certificación de archivos quedan pendientes; por eso TASK-UI-015 sigue parcial.

### Pasada 33 — Lectura equivalente de gráficos de combustible

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** asegurar que una conclusión del gráfico, su período, unidades y datos equivalentes se puedan leer sin interpretar barras, áreas, color ni tooltip; cubrir en código los estados de cero, uno y muchos puntos.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-015 / alternativa no visual | Implementado; pendiente de navegador | Se creó `ChartDataSummary`: cada gráfico de Facturas y Reportes de combustible ahora expone una **Lectura rápida**, período explícito, CLP/litros y una tabla equivalente desplegable. | La conclusión identifica ausencia, único registro o el grupo que concentra el mayor gasto; no exige leer el color, eje o tooltip. |
| TASK-UI-015 / fidelidad de barras | Implementado | Las tablas de producto, faena, vehículo y proveedor reciben el mismo límite de ocho filas del `CategoryBarChart`. Si existen más grupos, declaran cuántos visibles de cuántos totales hay. | Facturas ya entrega esos grupos en orden descendente por gasto; la tabla no presenta como equivalentes filas que el gráfico no dibuja. |
| TASK-UI-015 / período y unidades | Implementado | Facturas usa el período realmente presente en los resultados; Reportes construye el texto desde sus filtros desde/hasta. Cada alternativa nombra pesos chilenos y litros. | El formato monetario, de fecha y de cantidad continúa delegando en las utilidades compartidas. |
| TASK-UI-015 / estados de datos | Implementado en componente | Vacío comunica que no hay datos con los filtros aplicados; un punto nombra el único registro y sus dos magnitudes; muchos puntos sintetiza el mayor gasto. | La prueba cubre los tres estados y confirma que un gráfico truncado y su tabla muestran las mismas ocho categorías. |

#### Verificación ejecutada

- `npx vitest run app/(app)/combustibles/chart-data-summary.test.tsx`: **1 archivo y 3 pruebas verdes** (vacío, un punto y muchos puntos/truncamiento).
- `npx eslint` de los archivos tocados, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Persisten los seis diagnósticos ya conocidos de `pdfjs-dist`, Dashboard y `PpaFormInner`.
- Falta inspección con lector de pantalla y navegador real: estas pruebas validan el contrato textual y la semántica de tabla, no layout, orden de foco, SVG ni tooltip.

#### Lo que falta después de la pasada 33

| Pendiente | Estado al cierre de la pasada 33 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión de densidad | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard, Flota, CAPA, Capacitación, Permisos, Higiene y Emergencias; validar Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, extensión y certificación | Implementación parcial | Aplicar resumen y endpoint PDF real a Entregas; probar descarga, error, foco, 320/390 y PDF A4 de Acta/OC/Entrega en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y su contenido/formato. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar explícitamente `pdfjs-dist@6.1.200`; cargar Recharts bajo demanda, corregir las dos optimizaciones del Dashboard y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 33:** los gráficos de combustible ya comunican una conclusión operativa y datos equivalentes sin depender del SVG. Se corrigió también la posible divergencia entre un top de ocho barras y su tabla. La certificación visual, de asistencia y de los archivos Excel sigue siendo necesaria, por lo que TASK-UI-015 permanece parcial.

### Pasada 34 — Comprobante de Entrega legible y descargable en móvil

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** cerrar la asimetría de Entregas respecto de Acta SST y OC: que el comprobante no se reduzca como una hoja A4 en teléfono y que exista una descarga PDF A4 protegida, explícita y recuperable ante error.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-013 / resumen móvil de Entregas | Implementado; pendiente de navegador | `/entregas/[id]/print` incorpora `MobileDocumentSummary` con destinatario, faena, fecha, quien entrega, tipo, cada EPP entregado y devoluciones si existen. A 760 px se oculta la hoja A4 y se muestra esta lectura HTML; al imprimir ocurre lo contrario. | El resumen se deriva de la misma entrega, productos y unidades que el comprobante. No modifica el documento legal ni inventa valores faltantes. |
| TASK-UI-013 / PDF A4 de Entregas | Implementado; pendiente de descarga real | Se añadió `/entregas/[id]/print/pdf`, Route Handler Node dinámico. Vuelve a exigir `deliveries:view`, comprueba que existe faena y aplica `canAccessWorksite` antes de abrir el pool de Chromium; reenvía la cookie únicamente al render de la ruta print. | Responde `403` sin permiso, `404` para entrega inexistente/fuera de alcance y PDF con `Content-Disposition: attachment` y `Cache-Control: no-store` para el caso autorizado. |
| TASK-UI-013 / acciones y error | Implementado | La barra sticky ofrece **Descargar PDF** y **Volver a entregas**, ambos con target móvil de 44 px. Si falla `fetch`, la causa queda en `role=status` y el usuario puede volver a intentar. | La prueba fuerza `503`, confirma mensaje recuperable y enlace de retorno; no se finge una descarga correcta. |
| TASK-UI-013 / documento fuente | Implementado | El comprobante previo permanece como el único `<main>` A4, con sus datos generales, ítems, devoluciones, firmas y fecha de generación. Sus estilos se extrajeron y acotaron a `.delivery-sheet` para no contaminar barra ni resumen. | Se conserva `@page` A4 y el PDF renderiza esa misma ruta, no una segunda plantilla divergente. |
| Calidad de implementación | Implementado | Se eliminó la nueva cadena `map().filter()` que detectó React Doctor al preparar IDs de producto/devoluciones; se usa una sola pasada por ítems donde corresponde. | React Doctor vuelve al baseline de seis hallazgos ajenos a esta pasada. |

#### Verificación ejecutada

- `npx vitest run app/(print)/entregas/[id]/print/print-trigger.test.tsx components/print/mobile-document-summary.test.tsx`: **2 archivos y 2 pruebas verdes**.
- `npx eslint` de página, estilos, trigger y Route Handler de Entregas; `npx tsc --noEmit` y `git diff --check`: **verdes**.
- Se consultó la guía local y vigente de Next.js para Route Handlers/dynamic params antes de añadir el endpoint; la ruta espera `params` y se declara `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Se mantienen los seis diagnósticos externos de `pdfjs-dist`, Dashboard y `PpaFormInner`.
- No se inició Chromium, no se descargó un PDF ni se inspeccionó el viewport: esas verificaciones requieren el runtime aislado del plan.

#### Lo que falta después de la pasada 34

| Pendiente | Estado al cierre de la pasada 34 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión de densidad | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard, Flota, CAPA, Capacitación, Permisos, Higiene y Emergencias; validar Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y su contenido/formato. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Matriz legal/operacional de RUT por rol para listas, selectores, detalle, exportación y capturas. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar explícitamente `pdfjs-dist@6.1.200`; cargar Recharts bajo demanda, corregir las dos optimizaciones del Dashboard y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 34:** el comprobante de Entrega ya entrega una lectura útil en teléfono y una descarga PDF A4 con las mismas barreras de permiso y alcance que su vista. Falta recorrer la descarga y los tres documentos reales en un navegador aislado; por eso TASK-UI-013 queda implementado en código, pero no certificado operacionalmente.

### Pasada 35 — Estados operacionales legibles en Flota

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** dejar de mostrar identificadores técnicos de estado operacional en una superficie de trabajo frecuente, y conservar una salida honesta para registros legacy que no encajan en el catálogo actual.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-012 / fuente de labels | Implementado | `formatFuelVehicleStatus` concentra `operativo`, `mantencion` y `fuera_servicio` en etiquetas de negocio: Operativo, En mantención y Fuera de servicio. | Un valor vacío comunica “Sin estado operacional”; un valor legacy desconocido comunica “Estado operacional no reconocido”, sin exponer el enum crudo. |
| TASK-UI-012 / Flota | Implementado; pendiente de navegador | La lista de Flota, su filtro, chips activos y detalle de vehículo consumen el formatter compartido. El catálogo de vehículos de Combustibles usa la misma función, cerrando la divergencia entre ambos accesos al mismo dato. | Un vehículo inactivo continúa indicando “Inactivo”, que es su estado de catálogo y no un estado operativo falsamente traducido. |
| TASK-UI-012 / historial | Implementado | El historial de estado del detalle ya no mantiene su propio ternario; utiliza la misma fuente de verdad incluso para un estado no reconocido. | Se elimina otra posibilidad de que filtros, tabla y detalle nombren distinto la misma condición. |

#### Verificación ejecutada

- `npx vitest run lib/combustibles/vehicle-types.test.ts`: **1 archivo y 3 pruebas verdes**, incluidos estado conocido, legacy y ausente.
- `npx eslint` de formatter, prueba, lista, filtros, detalle y catálogo; `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Persisten los seis diagnósticos externos de `pdfjs-dist`, Dashboard y `PpaFormInner`.
- Falta confirmar las etiquetas, chips y texto largo a 320/390 y con lector de pantalla; la prueba asegura el contrato de copy, no su percepción en navegador.

#### Lo que falta después de la pasada 35

| Pendiente | Estado al cierre de la pasada 35 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión de densidad | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard, Flota, CAPA, Capacitación, Permisos, Higiene y Emergencias; validar Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y su contenido/formato. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar explícitamente `pdfjs-dist@6.1.200`; cargar Recharts bajo demanda, corregir las dos optimizaciones del Dashboard y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 35:** la misma condición operacional ya se nombra de forma consistente en el catálogo, filtros, chips, lista e historial de Flota, sin convertir un dato legacy desconocido en una certeza falsa. El glosario transversal y su revisión por dominio siguen pendientes; por eso TASK-UI-012 continúa parcial.

### Pasada 36 — Densidad de Flota: indicadores de apoyo, no cuatro tarjetas

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** retirar la altura y el peso visual de cuatro KPI que no inician ninguna acción; conservar su lectura como contexto compacto antes de alertas, filtros y la lista de vehículos.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-006 / densidad de Flota | Implementado; pendiente de navegador | Los cuatro números existentes (vehículos activos, costo operacional, litros registrados y mantenciones) dejan de ser cuatro `Card` independientes y pasan a `SummaryBar`, la tira editorial compartida para métricas secundarias. | No se alteran consultas, valores, permisos ni filtros; se elimina el componente local de KPI que sólo repetía la tarjeta. |
| TASK-UI-006 / jerarquía de decisión | Implementado | La página conserva cuatro valores, pero los declara como resumen —no como botones que prometen filtrar/navegar—. Las alertas de vencimiento siguen inmediatamente después y los filtros/lista reciben más espacio vertical. | El cambio aplica exactamente la excepción del estándar: número que no cambia una decisión va en tira compacta, no en tarjeta accionable. |

#### Verificación ejecutada

- `npx eslint app/(app)/flota/page.tsx`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Se mantienen los seis diagnósticos externos de `pdfjs-dist`, Dashboard y `PpaFormInner`.
- No se validó el primer viewport de Flota a 390×844 ni el contraste/reflow de `SummaryBar`; queda en la certificación visual indicada abajo.

#### Lo que falta después de la pasada 36

| Pendiente | Estado al cierre de la pasada 36 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión y certificación | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard, CAPA, Capacitación, Permisos, Higiene y Emergencias; validar Flota/Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y su contenido/formato. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar explícitamente `pdfjs-dist@6.1.200`; cargar Recharts bajo demanda, corregir las dos optimizaciones del Dashboard y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 36:** Flota ya no antepone cuatro cajas que no conducen a decisión. El resumen conserva contexto y entrega más pantalla al vencimiento y trabajo real. La extensión a los demás dominios y la certificación de viewport siguen pendientes, por lo que TASK-UI-006 continúa parcial.

### Pasada 37 — Fecha, hora y unidad consistentes en el detalle de Flota

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** eliminar el último formateo local de fechas/horas y cantidades que persistía en el detalle de vehículo, para que la información contractual y operacional se lea con el mismo idioma que las demás superficies corregidas.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-012 / fechas de vehículo | Implementado; pendiente de navegador | Próximo vencimiento, SOAP, revisión técnica, permiso de circulación, seguro y fecha de mantención pasan por `formatDate`. | Ya no se expone ISO crudo ni una fecha dependiente del locale del navegador en esos facts. |
| TASK-UI-012 / historial operativo | Implementado | Inicio y cierre del intervalo operacional pasan por `formatDateTime`, con zona y formato compartidos de Chile. | Se elimina `new Date(...).toLocaleString("es-CL")`, que podía discrepar entre servidor/navegador. |
| TASK-UI-012 / capacidad | Implementado | La capacidad de estanque usa `formatQty`, por lo que aplica separador y unidad desde la utilidad común. | Valor nulo conserva “Sin información”; no se intenta inventar una capacidad. |

#### Verificación ejecutada

- `npx vitest run lib/__tests__/utils.test.ts lib/sst/__tests__/date.test.ts`: **2 archivos y 69 pruebas verdes**.
- `npx eslint app/(app)/flota/[id]/page.tsx`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Persisten los seis diagnósticos externos de `pdfjs-dist`, Dashboard y `PpaFormInner`.
- Falta revisar el detalle en navegador, 320/390, lector de pantalla y datos reales de vencimiento; los tests prueban los formatters, no la ruta con fixture.

#### Lo que falta después de la pasada 37

| Pendiente | Estado al cierre de la pasada 37 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión y certificación | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard, CAPA, Capacitación, Permisos, Higiene y Emergencias; validar Flota/Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y su contenido/formato. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Pendiente separado | Resolver o aceptar explícitamente `pdfjs-dist@6.1.200`; cargar Recharts bajo demanda, corregir las dos optimizaciones del Dashboard y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 37:** el detalle de Flota ya no mezcla ISO, locale del navegador y formatters del sistema para fechas, horas y capacidad. El contrato visual queda ampliado, pero la adopción transversal y la certificación con datos reales continúan pendientes; TASK-UI-012 sigue parcial.

### Pasada 38 — Deuda de rendimiento mecánica del Dashboard

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** resolver los tres avisos de bajo riesgo de React Doctor que no requerían cambiar la interfaz, para evitar trabajo lineal innecesario al ordenar los dominios y recrear un formatter internacional en cada llamada.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| Diagnóstico React / permisos | Implementado | `orderDashboardDomains` crea un `Set` una vez y lo reutiliza al decidir dinero, visibilidad y orden. La función pública conserva la misma firma para sus consumidores. | Se eliminó la búsqueda lineal repetida por permiso sin cambiar las secciones visibles ni su orden. |
| Diagnóstico React / iteraciones | Implementado | El orden deja de construir primero un array con `map` y luego otro con `filter`; recorre la lista de prioridad una sola vez y agrega sólo dominios visibles. | Las ocho pruebas existentes preservan perfiles, orden, visibilidad y anclas. |
| Diagnóstico React / `Intl` | Implementado | El formatter para “hoy en Chile” se instancia una vez a nivel de módulo, no dentro de cada llamada. | Mantiene `en-CA`, zona `America/Santiago` y el mismo texto ISO-calendario. |

#### Verificación ejecutada

- `npx vitest run app/(app)/dashboard/dashboard-domains.test.ts`: **1 archivo y 8 pruebas verdes**.
- `npx eslint` de ambos archivos Dashboard, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: sigue en **49/100**, pero baja de **seis a tres** hallazgos: `pdfjs-dist`, carga eager de Recharts y tamaño de `PpaFormInner`. No se suprimió ningún diagnóstico.

#### Lo que falta después de la pasada 38

| Pendiente | Estado al cierre de la pasada 38 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión y certificación | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard, CAPA, Capacitación, Permisos, Higiene y Emergencias; validar Flota/Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y su contenido/formato. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; cargar Recharts bajo demanda y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 38:** el Dashboard conserva exactamente sus decisiones de visibilidad y prioridad con menos recorrido repetido y sin reconstruir el formato de fecha. Quedan los tres hallazgos que sí requieren una decisión de dependencia o una refactorización/carga de componente; no se consideran cerrados por esta mejora mecánica.

### Pasada 39 — CAPA: métricas que realmente filtran y cuatro KPI visibles

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** reparar los accesos rápidos CAPA que parecían filtros pero no alteraban la lista, y aplicar el límite de cuatro indicadores sin perder la investigación de registros pendientes de conciliación.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-006 / filtros CAPA | Implementado; pendiente de navegador | Se detectó que `quickFilter` nunca participaba en `filtered`: las tarjetas cambiaban `aria-pressed` pero las filas no. Ahora cada vista se persiste como `vista` en URL, reinicia página y se interpreta en el servidor antes de consulta/paginación. | Abiertas, vencidas, pendiente de verificación, detener tarea y por conciliar cuentan/aplican las mismas condiciones de estado que declaran sus métricas. |
| TASK-UI-006 / alcance completo | Implementado | `listCapaActionsPage` agrega la condición elegida al `WHERE` y calcula el `total` bajo esa misma condición; no se limita a ocultar filas dentro de los 50 registros de la página actual. | La vista valida el valor de URL contra un conjunto cerrado antes de pasarlo al servicio. |
| TASK-UI-006 / densidad | Implementado | La fila conserva cuatro KPI primarios: detener tarea, abiertas, vencidas y por verificar. “Por conciliar” pasa a `Más filtros (1)` cuando está activo, con botón, contador y chip removible. | `Limpiar filtros` ahora elimina también la vista rápida, corrigiendo el estado residual anterior. |
| TASK-UI-006 / conteo veraz | Implementado | El resumen de servicio añade `immediateStop` por scope, de modo que la primera métrica no depende de los 50 registros visibles. La fecha de vencimiento usa la fecha calendario de Chile en cliente y servidor. | Se preserva la semántica existente: verificada sigue en abiertas, pero no en vencidas; cerrada/cancelada no aparece como urgente. |

#### Verificación ejecutada

- `npx vitest run lib/prevention/capa-list-filters.test.ts`: **1 archivo y 3 pruebas verdes** para abierta, vencida, por conciliar, detener tarea, cerrada y verificada.
- `npx vitest --config vitest.pglite.config.ts run lib/__tests__/prevention-capa-list.test.ts`: **1 archivo y 1 prueba verde** contra PGlite migrada; comprueba scope, total previo a paginación, cuatro vistas rápidas y los cinco conteos del resumen. El fixture fuera de alcance no entra en filas ni métricas.
- `npx eslint` del módulo de filtros, servicio, página y lista CAPA; `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo; se mantienen los tres diagnósticos pendientes de `pdfjs-dist`, Recharts y `PpaFormInner`.
- Falta verificar la interacción URL/Sheet/paginación, conteos con datos reales y viewport móvil en el runtime aislado.

#### Lo que falta después de la pasada 39

| Pendiente | Estado al cierre de la pasada 39 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión y certificación | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard, Capacitación, Permisos, Higiene y Emergencias; validar CAPA, Flota y Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y su contenido/formato. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; cargar Recharts bajo demanda y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 39:** CAPA deja de simular filtros. Las métricas y el filtro adicional reducen realmente el conjunto completo bajo el scope autorizado, conservan URL y paginación correctas, y no exceden cuatro KPI visibles. Falta demostrarlo en navegador y extender el patrón a los dominios restantes; TASK-UI-006 sigue parcial.

### Pasada 40 — Permisos: KPI suspendidos correcto y vistas persistentes

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** corregir el KPI de Permisos que se presentaba como filtro de suspendidos pero apuntaba a “todos”, y hacer que las cuatro vistas rápidas sobrevivan recarga, compartición de URL y eliminación por chip.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-006 / Permisos suspendidos | Implementado; pendiente de navegador | Se encontró que la tarjeta **Suspendidos** llevaba por error la clave `all`: al pulsarla no reducía la lista. La vista `suspended` ahora tiene predicado propio y muestra solamente permisos detenidos por desviación o vencimiento. | La prueba cubre que un permiso suspendido coincide con esa vista y no se confunde con activa, pendiente o LOTO. |
| TASK-UI-006 / vistas persistentes | Implementado | Activa, esperando aprobación, con energías bloqueadas y suspendida pasan de estado local a `vista` en la URL. Un valor desconocido se descarta con fallback seguro a todos. | El filtro sigue aplicándose sobre los permisos ya cargados dentro del alcance autorizado; la pantalla no pagina su listado en servidor. |
| TASK-UI-006 / filtros activos | Implementado | La vista se expone como chip **Vista** removible y `Limpiar filtros`/“Ver todos” limpian la URL completa. Los cuatro KPI mantienen `aria-pressed` y alternan su propia vista. | Se conserva el filtro estructurado de Estado para consulta exacta y Faena para alcance operativo. |

#### Verificación ejecutada

- `npx vitest run lib/prevention/permit-list-filters.test.ts`: **1 archivo y 2 pruebas verdes** para predicados de las cuatro vistas y rechazo de URL desconocida.
- `npx eslint` del módulo de filtros, su prueba y `work-permit-list.tsx`; `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Continúan `pdfjs-dist`, import estático que el analizador atribuye a Recharts en Dashboard y el tamaño de `PpaFormInner`.
- Falta inspección de URL, chips, teclado y primer viewport de Permisos en el runtime aislado; no se declaró como cobertura visual.

#### Lo que falta después de la pasada 40

| Pendiente | Estado al cierre de la pasada 40 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión y certificación | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard, Capacitación, Higiene y Emergencias; validar CAPA, Permisos, Flota y Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y su contenido/formato. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; investigar la detección de Recharts pese al wrapper dinámico y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 40:** Permisos deja de ofrecer una falsa vista de suspendidos y las métricas rápidas recuperan continuidad mediante URL y chips. El filtrado sigue siendo local porque el listado completo autorizado se carga sin paginación; falta validarlo visualmente y completar Dashboard, Capacitación, Higiene y Emergencias para cerrar la extensión de TASK-UI-006.

### Pasada 41 — Capacitación: vistas URL legibles y recuperables

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** completar el contrato de las vistas rápidas de sesiones de capacitación, que ya escribían `vista` en URL pero no declaraban la vista activa como filtro removible ni validaban valores ajenos al conjunto permitido.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-006 / vistas de capacitación | Implementado; pendiente de navegador | Se extrae el contrato de vistas a un módulo: todas, sesiones planificadas y acuses pendientes. La URL se valida y un valor como `blocking_gaps` o uno desconocido vuelve de forma segura a todas las sesiones. | No se trata una ruta de Brechas como si filtrara sesiones: su KPI conserva navegación propia a la lista de brechas. |
| TASK-UI-006 / chip activo | Implementado | Cuando una métrica filtra las sesiones, `FilterToolbar` ahora muestra el chip removible **Vista** con nombre de negocio. “Ver todas” y limpiar filtros eliminan también esa condición. | Estado, tipo, faena y la vista aparecen bajo el mismo contrato de filtros activos. |
| TASK-UI-006 / predicados | Implementado | “Planificadas” usa el estado de sesión y “Acuses pendientes” sólo incluye asistentes cuyo acuse es menor que la asistencia. | Una sesión planificada sin asistentes no entra por error en acuses pendientes; una sesión firmada completamente tampoco. |

#### Verificación ejecutada

- `npx vitest run lib/prevention/training-list-filters.test.ts`: **1 archivo y 2 pruebas verdes** para ambas vistas y URL inválida.
- `npx eslint` del módulo, su prueba y `training-session-list.tsx`; `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Permanecen `pdfjs-dist`, Recharts/Dashboard y `PpaFormInner`.
- No se comprobó la vista de tarjeta, foco, URL compartida ni la primera sesión a 390×844; el listado sigue trayendo el conjunto autorizado completo y filtra en memoria, por lo que no se afirma paginación en servidor.

#### Lo que falta después de la pasada 41

| Pendiente | Estado al cierre de la pasada 41 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión y certificación | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard, Higiene y Emergencias; validar CAPA, Permisos, Capacitación, Flota y Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y su contenido/formato. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; investigar la detección de Recharts pese al wrapper dinámico y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 41:** las dos métricas filtrantes de Capacitación ya describen un estado persistente, legible y removible, mientras Brechas y Catálogo continúan siendo destinos distintos. Falta inspección en navegador y completar Dashboard, Higiene y Emergencias antes de declarar extendida la regla de densidad de TASK-UI-006.

### Pasada 42 — Higiene: KPI que llevan al grupo o programa responsable

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** convertir los cuatro números de Higiene, antes puramente informativos, en vistas operativas con continuidad de pestaña y URL, sin mezclar la nómina anonimizada con filtros de identificación.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-006 / métricas accionables | Implementado; pendiente de navegador | GES bajo vigilancia, sobre el límite y sin límite declarado llevan a Grupos con el predicado correspondiente. Programas con vencidos lleva a Vigilancia y conserva sólo programas con al menos un control vencido. | El último KPI cambió de contar controles a contar **programas con vencidos**, por lo que su número coincide con las filas resultantes. |
| TASK-UI-006 / continuidad | Implementado | Pestaña y vista viven en URL, se validan contra conjuntos cerrados y los pares imposibles se degradan a “sin filtro”. Un clic sobre la métrica activa la desactiva. | Un enlace compartido puede reconstruir Grupos, Vigilancia o Panel anonimizado sin intentar combinar una vista de grupos con una tabla de programas. |
| TASK-UI-006 / control de filtros | Implementado | Se incorpora `FilterToolbar` con chip removible **Vista** y limpiar preserva la pestaña elegida, eliminando sólo el criterio que restringe filas. Las pestañas al cambiar borran la vista incompatible. | La tabla anonimizada permanece como presentación agregada separada y no recibe filtros que podrían confundir su propósito de privacidad. |
| TASK-UI-014 / tabs | Implementado en código | Las tres pestañas usan ahora semántica `tablist`/`tab` y selección accesible, además de no perder estado en recarga. | Falta comprobar flechas, foco y lector de pantalla en navegador. |

#### Verificación ejecutada

- `npx vitest run lib/prevention/hygiene-dashboard-filters.test.ts`: **1 archivo y 2 pruebas verdes** para cada predicado, vencidos y valores URL inválidos.
- `npx eslint` del módulo, su prueba y `hygiene-dashboard.tsx`; `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Persisten `pdfjs-dist`, Recharts/Dashboard y `PpaFormInner`.
- Pendiente de certificar la URL, tarjetas/tablas en 320/390, foco del tablist, chip y lectura con datos reales en el runtime aislado.

#### Lo que falta después de la pasada 42

| Pendiente | Estado al cierre de la pasada 42 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión y certificación | Implementación parcial | Extender la regla de cuatro KPI/filtros a Dashboard y Emergencias; validar CAPA, Permisos, Capacitación, Higiene, Flota y Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y su contenido/formato. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; investigar la detección de Recharts pese al wrapper dinámico y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 42:** Higiene deja de usar números mudos: cada métrica abre la vista que explica el indicador, sin afirmar una equivalencia falsa entre controles y programas. Queda validar el comportamiento visual y cubrir Dashboard y Emergencias para concluir la extensión de TASK-UI-006.

### Pasada 43 — Emergencias: KPI completos por scope y filtros antes de paginar

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** hacer accionables los KPI de planes y simulacros sin reducir sus conteos al lote actual de 50 planes, preservando el aislamiento por faena y la distinción entre listas de planes y simulacros.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-006 / conteos Emergencias | Implementado | `getEmergencyDashboardCounts` calcula planes aprobados, en preparación, simulacros realizados y que requieren mejora bajo el scope completo. Las cuatro métricas ya no dependen de la página actual ni del máximo de 300 simulacros visibles. | Los tabs muestran también totales completos de Planes y Simulacros, no el tamaño del array cargado. |
| TASK-UI-006 / filtro servidor | Implementado | La vista `approved`/`draft` se incorpora al `WHERE` de `listEmergencyPlansPage`, comparte condición con `total` y se aplica antes de limit/offset. `completed`/`needs_improvement` se incorpora al `WHERE` de simulacros. | Cada métrica selecciona su tab y URL (`tab`, `vista`); sólo permite combinaciones coherentes entre entidad y predicado. |
| TASK-UI-006 / interacción | Implementado | Métricas son botones `aria-pressed`; `FilterToolbar` ofrece chip **Vista** removible y limpiar mantiene la pestaña. Las pestañas pasan a semántica `tablist`/`tab` y limpian una vista incompatible al cambiar de entidad. | No se usa una lista de planes para representar resultados de simulacros ni viceversa. |
| Scope y paginación | Implementado y probado | Se añadió prueba PGlite con dos faenas permitidas y una externa. La restricción de negocio de un solo plan activo por faena se mantiene en el fixture. | La prueba demuestra que conteos, filtro de aprobado, filtro de requiere mejora, `total` y filas excluyen la tercera faena antes de paginar. |

#### Verificación ejecutada

- `npx vitest run lib/prevention/emergency-list-filters.test.ts`: **1 archivo y 2 pruebas verdes** para URL/tab compatibles.
- `npx vitest --config vitest.pglite.config.ts run lib/__tests__/prevention-emergency-list.test.ts`: **1 archivo y 1 prueba verde** contra base migrada, scope multi-faena y filtros SQL.
- `npx eslint` de filtros, servicio, página, lista, prueba PGlite y registro de PGlite; `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Persisten `pdfjs-dist`, Recharts/Dashboard y `PpaFormInner`.
- No se inspeccionó teclado, foco/restauración, chip ni recaptura de 390×844 en runtime aislado.

#### Lo que falta después de la pasada 43

| Pendiente | Estado al cierre de la pasada 43 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, extensión y certificación | Implementación parcial | Implementar la regla de cuatro KPI/filtros en Dashboard y validar CAPA, Permisos, Capacitación, Higiene, Emergencias, Flota y Pendientes en E2E, 390×844 y teclado. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y su contenido/formato. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; investigar la detección de Recharts pese al wrapper dinámico y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 43:** Emergencias conserva sus KPI en todo el alcance y hace que cada uno limite la lista correcta antes de paginar. Dashboard es el último módulo de la extensión de densidad aún sin implementar; toda la extensión sigue pendiente de certificación visual y de interacción.

### Pasada 44 — Dashboard: máximo de cuatro KPI también por dominio

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** completar la regla de densidad en las secciones internas del Dashboard. El centro de control ya usaba cuatro ranuras, pero Prevención, Flota y Control preventivo en terreno aún podían abrir con cinco o siete tarjetas.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-006 / contrato de dominio | Implementado | `DomainSection` admite una franja secundaria explícita bajo la cuadrícula de KPI. La cuadrícula permanece reservada para un máximo de cuatro decisiones; los secundarios ya no se ocultan ni se convierten en una quinta fila de tarjetas. | La franja usa `SummaryBar`, el componente compartido de métricas de contexto. |
| TASK-UI-006 / Prevención | Implementado | Cumplimiento legal pasa a tira editorial enlazada. PDTP, Incidentes, CAPA y Riesgos críticos conservan la fila primaria cuando están autorizados. | Aun sin permiso de Riesgos, no se rellena con una tarjeta distinta sólo para alcanzar cuatro. |
| TASK-UI-006 / Flota | Implementado | Brecha TAE versus facturado pasa a resumen enlazado a Conciliación TAE; costo, deuda autorizada, documentos y mantención permanecen en la fila primaria. | El valor no se pierde y declara cuántos registros quedan por revisar. |
| TASK-UI-006 / Control en terreno | Implementado | Permisos activos, acuerdos CPHS abiertos y gestión del cambio abierta se consolidan en `SummaryBar`. La cuadrícula queda con inspecciones, hallazgos críticos, simulacros por mejorar y mediciones sobre límite. | Se mantienen todos los enlaces de drill-down y las señales sólo se usan en acuerdos/cambios abiertos. |

#### Verificación ejecutada

- `npx vitest run app/(app)/dashboard/dashboard-metrics-slots.test.ts app/(app)/dashboard/dashboard-domains.test.ts app/(app)/dashboard/dashboard-control-center.test.tsx`: **3 archivos y 35 pruebas verdes**. Confirman las cuatro ranuras de cabecera, prioridad por permisos, ausencia de duplicados y funcionamiento del control central.
- `npx eslint` de las secciones y shell de dominio, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin hallazgo nuevo. Persisten `pdfjs-dist`, Recharts/Dashboard y `PpaFormInner`.
- Falta inspección visual de cada perfil en 390×844, primer CTA/tarea, navegación de `SummaryBar`, teclado y lector de pantalla. Los tests prueban selección de datos y contratos de control, no el viewport final.

#### Lo que falta después de la pasada 44

| Pendiente | Estado al cierre de la pasada 44 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, certificación | Implementación de código completa | Recorrer Dashboard, Flota, Pendientes, Backups, CAPA, Capacitación, Permisos, Higiene y Emergencias en E2E, 390×844 y teclado; comprobar que sólo cuatro KPI primarios aparecen y que cada uno filtra/navega correctamente. |
| TASK-UI-007, ejecución y certificación PPA | Implementación parcial | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Después, dividir `PpaFormInner` con cobertura. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y su contenido/formato. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; investigar la detección de Recharts pese al wrapper dinámico y cubrir/fragmentar `PpaFormInner`. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 44:** la extensión de código de TASK-UI-006 queda completa: ni el centro de control ni los dominios del Dashboard exceden cuatro tarjetas KPI, y los valores secundarios mantienen enlace y contexto en una tira compacta. La certificación visual, de interacción y de accesibilidad sigue pendiente, por lo que la tarea no se declara cerrada operacionalmente.

### Pasada 45 — PPA: composición del formulario sin cambiar su contrato de seguridad

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** terminar el refactor que seguía pendiente para el PPA progresivo, reduciendo el tamaño de su contenedor sin duplicar reglas de validación, detención ni guardado offline.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-007 / composición | Implementado; pendiente de navegador | `PpaFormInner` queda en 207 líneas y conserva sólo el flujo: estado de los tres pasos, validación antes de avanzar, foco del error, footer, confirmación de detención y conexión con `usePpaForm`. | La pantalla de resultado offline, la cola, el reset por remount y el submit siguen en sus componentes/hook previos; no se movieron ni reescribieron sus reglas. |
| TASK-UI-007 / primer paso | Implementado | `PpaIdentityStep` encapsula identificación por RUT o manual, faena, permiso elegible y tarea. Cambiar la faena sigue limpiando el permiso mediante el setter del hook. | Todos los `id`, etiquetas, errores y focos usados por el contrato de avance (`rutSearch`, `worksite`, `wname`, `tipo`) se conservan. |
| TASK-UI-007 / riesgos y decisión | Implementado | `PpaRiskControlsStep` concentra cambio, peligro, controles y preguntas críticas; `PpaDecisionStep` conserva la última respuesta y su aviso de riesgo. | La condición de tarea crítica y `PPA_REQUIRED_CONTROLS` permanecen en el contenedor, única fuente de las reglas que impiden avanzar. |
| React Doctor / tamaño | Resuelto en este alcance | La advertencia anterior por `PpaFormInner` superior a 300 líneas desaparece tras extraer las tres secciones sin crear estado nuevo en ellas. | El archivo contenedor mide 207 líneas y el módulo de secciones 289; TypeScript valida los contratos de props. |

#### Verificación ejecutada

- `npx eslint app/(public)/ppa/ppa-form.tsx app/(public)/ppa/ppa-form-steps.tsx`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx playwright test e2e/ppa-flow.spec.ts e2e/ppa-offline.spec.ts e2e/tae-ppa-coexistence.spec.ts --list`: **40 escenarios detectados**. Incluye progreso, detención, guardado offline, sincronización, RUT, cache y coexistencia de los service workers PPA/TAE.
- `npx react-doctor@latest --verbose --scope changed`: **49/100** y tres diagnósticos. Continúan `pdfjs-dist@6.1.200` y el import que el analizador atribuye a Recharts. La advertencia de tamaño del PPA desapareció; ahora el analizador señala el `preventDefault` de un flujo que necesariamente decide entre avanzar, mostrar confirmación o encolar offline. Es una limitación real de mejora progresiva sin JavaScript, no un cambio introducido en esta pasada: una alternativa con Server Action necesitaría un diseño separado que preserve validación de pasos, confirmación de detención y cola IndexedDB.
- No se ejecutaron los escenarios contra el checkout compartido ni se afirmó cobertura visual: siguen requiriendo servidor y base aislados.

#### Lo que falta después de la pasada 45

| Pendiente | Estado al cierre de la pasada 45 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, certificación | Implementación de código completa | Recorrer Dashboard, Flota, Pendientes, Backups, CAPA, Capacitación, Permisos, Higiene y Emergencias en E2E, 390×844 y teclado; comprobar que sólo cuatro KPI primarios aparecen y que cada uno filtra/navega correctamente. |
| TASK-UI-007, ejecución y certificación PPA | Código de flujo y refactor completos; pendiente operativo | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Decidir además si la operación exige un fallback sin JavaScript y, de ser así, diseñar su Server Action sin degradar la cola offline ni la confirmación de detención. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y su contenido/formato. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; investigar la detección de Recharts pese al wrapper dinámico; decidir si el PPA público requiere un fallback sin JavaScript y, si corresponde, implementar y probar el recorrido alternativo. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 45:** el PPA ya tiene su flujo de tres pasos desacoplado de la presentación de sus secciones, sin dispersar las reglas que protegen la detención y el guardado offline. La deuda estructural del componente queda cerrada; faltan la ejecución real de sus 40 escenarios, evaluación en dispositivo y una decisión explícita sobre la mejora progresiva sin JavaScript.

### Pasada 46 — Combustibles: carga diferida coherente para análisis y operaciones

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** hacer que los gráficos pesados restantes de Análisis de rendimiento y Operaciones sigan el mismo contrato de carga diferida ya usado por los gráficos principales de Combustibles, manteniendo datos, escala, alternativa textual y altura visibles.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-015 / carga de análisis | Implementado; pendiente de navegador | `PerformanceGroupChart` e `HistogramChart` se importan desde un wrapper cliente `analysis-charts-lazy.tsx` con `next/dynamic`, export nombrado y `ssr: false`. | Recharts deja de ser una dependencia estática de la ruta de análisis; las props de grupos, drill-down, bins, media y unidad conservan tipos explícitos. |
| TASK-UI-015 / carga de operaciones | Implementado; pendiente de navegador | Los dos scatterplots y la evolución por equipo pasan a `operations-charts-lazy.tsx`, por lo que la página de Combustibles ya no importa esos módulos Recharts directamente. | Las rutas de datos, el límite de series y las `ChartErrorBoundary` de la página permanecen sin cambio. |
| TASK-UI-015 / estado de carga | Implementado | Ambos wrappers muestran skeleton semántico con `role="status"`, texto para lector y la misma altura final (72 u 80) para evitar layout shift. | No reemplazan estados vacíos: al cargar el módulo, cada gráfico conserva su propio mensaje de “sin datos”. |
| React Doctor / Dashboard | Investigado; pendiente de build | La alerta de `dashboard-charts.tsx` no prueba carga inicial: `dashboard-domain-charts.tsx` ya usa imports nombrados dentro de `dynamic()` con `ssr: false`. | Falta comprobar el artefacto de producción cuando el checkout quede libre; no se suprime la regla ni se afirma una métrica de bundle sin ese artefacto. |

#### Verificación ejecutada

- Se consultó la documentación actual de Next.js y la guía local de lazy loading: `ssr: false` se mantiene dentro de wrappers cliente y las rutas de `import()` son literales y de nivel de módulo.
- `npx eslint` de los cuatro archivos modificados, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx vitest run app/(app)/combustibles/consumption-charts.test.tsx app/(app)/combustibles/fuel-charts.test.tsx`: **2 archivos y 4 pruebas verdes** para los contratos de los gráficos que se siguen cargando por export nombrado.
- `npx playwright test e2e/combustibles.spec.ts --list`: **10 escenarios detectados** para dashboard, importación, catálogos, facturas y reportes; no se ejecutaron contra el runtime compartido.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, mismos tres diagnósticos: `pdfjs-dist`, el análisis estático de Recharts en Dashboard y el `preventDefault` del PPA. Los nuevos wrappers no agregan importación pesada eager detectada.

#### Lo que falta después de la pasada 46

| Pendiente | Estado al cierre de la pasada 46 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, certificación | Implementación de código completa | Recorrer Dashboard, Flota, Pendientes, Backups, CAPA, Capacitación, Permisos, Higiene y Emergencias en E2E, 390×844 y teclado; comprobar que sólo cuatro KPI primarios aparecen y que cada uno filtra/navega correctamente. |
| TASK-UI-007, ejecución y certificación PPA | Código de flujo y refactor completos; pendiente operativo | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Decidir además si la operación exige un fallback sin JavaScript y, de ser así, diseñar su Server Action sin degradar la cola offline ni la confirmación de detención. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar los nuevos skeletons, alternativas con teclado/lector en 320/390 y zoom; verificar SVG/tooltip, los cuatro Excel descargados y el artefacto de bundle de producción. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout; usar su manifest para confirmar que Recharts no vuelve al bundle inicial de las rutas diferidas. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; contrastar en artefacto de build la alerta estática de Recharts; decidir si el PPA público requiere un fallback sin JavaScript y, si corresponde, implementar y probar el recorrido alternativo. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 46:** los gráficos de Combustibles que faltaban se incorporan a la misma estrategia de carga diferida que el resto de la superficie, con un estado de carga accesible y sin salto de geometría. El comportamiento de datos permanece bajo sus tests; faltan medición del bundle, ejecución de navegador y verificación de exportes antes de cerrar TASK-UI-015.

### Pasada 47 — Combustibles: conclusión y tabla equivalente antes del gráfico

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** hacer que la conclusión, el período y una alternativa de lectura no dependan del SVG, priorizándolos antes de los gráficos de categorías del panel y de Reportes.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-015 / lectura antes del gráfico | Implementado; pendiente de navegador | `ChartDataSummary` se presenta antes de las barras de tipo de equipo, faena y proveedor en el panel de Combustibles, y antes de evolución mensual, productos y las categorías de Reportes. | La lectura rápida nombra el grupo líder, monto y litros; no obliga a inferirlo por posición o color. |
| TASK-UI-015 / equivalencia de datos | Implementado | Cada resumen conserva una tabla plegable con exactamente las ocho filas que usa `CategoryBarChart`, más período, unidades y conteo cuando corresponde. | Al existir una novena fila, el resumen declara explícitamente cuántas quedaron fuera de la visualización, en vez de sugerir un total incompleto. |
| TASK-UI-012 / fecha de la superficie tocada | Implementado | El encabezado de tendencia del panel deja de mostrar ISO crudo y reutiliza `formatDate` para el período. | La misma etiqueta formateada alimenta los resúmenes de gráfico del panel. |
| TASK-UI-015 / composición reutilizable | Implementado | `ChartDataSummary` acepta una clase de contenedor para situarse antes o después del SVG sin duplicar conclusión, tabla ni reglas de ocho filas. | Las ubicaciones anteriores continúan tipadas y sin cambiar el contenido de su tabla. |

#### Verificación ejecutada

- `npx eslint` de `chart-data-summary.tsx`, panel de Combustibles y Reportes; `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx vitest run app/(app)/combustibles/chart-data-summary.test.tsx app/(app)/combustibles/consumption-charts.test.tsx app/(app)/combustibles/fuel-charts.test.tsx`: **3 archivos y 7 pruebas verdes**. Cubren vacío, punto único, límite de ocho filas, selección y paleta de gráficos existentes.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin diagnóstico nuevo: siguen `pdfjs-dist`, el falso positivo pendiente de validar contra build para Recharts/Dashboard y el recorrido PPA sin JavaScript.
- Falta inspección a 320/390, teclado, lector y SVG/tooltip; las pruebas no representan el layout real ni descargan los Excel.

#### Lo que falta después de la pasada 47

| Pendiente | Estado al cierre de la pasada 47 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, certificación | Implementación de código completa | Recorrer Dashboard, Flota, Pendientes, Backups, CAPA, Capacitación, Permisos, Higiene y Emergencias en E2E, 390×844 y teclado; comprobar que sólo cuatro KPI primarios aparecen y que cada uno filtra/navega correctamente. |
| TASK-UI-007, ejecución y certificación PPA | Código de flujo y refactor completos; pendiente operativo | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Decidir además si la operación exige un fallback sin JavaScript y, de ser así, diseñar su Server Action sin degradar la cola offline ni la confirmación de detención. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar skeletons y resúmenes en 320/390, teclado/lector/zoom, SVG/tooltip, los cuatro Excel descargados y el artefacto de bundle de producción. |
| TASK-UI-016 | No iniciado | Matriz de estados, teclado, zoom, lector de pantalla, sesión, offline, doble envío y permisos. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout; usar su manifest para confirmar que Recharts no vuelve al bundle inicial de las rutas diferidas. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; contrastar en artefacto de build la alerta estática de Recharts; decidir si el PPA público requiere un fallback sin JavaScript y, si corresponde, implementar y probar el recorrido alternativo. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 47:** las barras de categorías dejan de ser el único lugar donde se puede comprender el resultado: la conclusión, unidades y tabla equivalente llegan antes y funcionan sin depender del color. Aún se debe certificar en navegador y comprobar los cuatro artefactos Excel para declarar cerrado TASK-UI-015.

### Pasada 48 — Matriz ejecutable de accesibilidad para superficies críticas

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** convertir parte de UI-016 en contratos de navegador concretos para las superficies recién modificadas y el PPA, sin confundir el listado de pruebas con una ejecución certificada.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-016 / alcance Axe | Implementado; pendiente de ejecución | La auditoría automática incorpora Combustibles, Reportes de Combustibles, Análisis de rendimiento, PPA interno, CAPA y Emergencias; PPA público se audita sin sesión en una suite separada. | Los recorridos autenticados reutilizan `login`; el PPA público conserva su condición real de acceso sin login. |
| TASK-UI-016 / WCAG | Implementado; pendiente de ejecución | Las dos auditorías Axe pasan a incluir `wcag22aa`, además de 2.0/2.1 AA ya presentes. | `color-contrast` continúa excluido de Axe porque requiere su revisión específica; no se interpreta como aprobación de contraste. |
| TASK-UI-016 / teclado | Implementado; pendiente de ejecución | El barrido de foco añade Combustibles, Reportes, CAPA y Emergencias, y hay un contrato explícito: la tabla equivalente de Reportes se abre con Enter desde el elemento `summary`. | No depende de que haya datos de producción: el resumen existe incluso en estado vacío y su `<details>` es operable con teclado. |
| TASK-UI-015 / alternativa de datos | Cubierto por contrato; pendiente de ejecución | La interacción de la tabla equivalente pasa de ser sólo markup a un escenario Playwright identificable. | Su éxito real aún necesita navegador, sesión y fixture aislados. |

#### Verificación ejecutada

- `npx eslint e2e/accessibility.spec.ts e2e/keyboard-navigation.spec.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx playwright test e2e/accessibility.spec.ts e2e/keyboard-navigation.spec.ts --list`: **52 escenarios detectados**. Incluye 33 Axe (uno público PPA) y los contratos de foco, skip link, trap, Escape y tabla equivalente.
- No se ejecutó Playwright contra el checkout compartido: esta pasada instala cobertura, no afirma cero violaciones, foco visible ni navegación real.

#### Lo que falta después de la pasada 48

| Pendiente | Estado al cierre de la pasada 48 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Pendiente operativo | Dos recapturas completas sobre una `CAPTURE_DATABASE_URL` exclusiva, sin otros Playwright/E2E; manifest sin URL inválida, huérfanos, referencias ni hashes duplicados, e Incidentes/procedimiento registrado como 404 esperada sin PNG. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Migración/seed y captura aisladas de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, certificación | Implementación de código completa | Recorrer Dashboard, Flota, Pendientes, Backups, CAPA, Capacitación, Permisos, Higiene y Emergencias en E2E, 390×844 y teclado; comprobar que sólo cuatro KPI primarios aparecen y que cada uno filtra/navega correctamente. |
| TASK-UI-007, ejecución y certificación PPA | Código de flujo y refactor completos; pendiente operativo | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Decidir además si la operación exige un fallback sin JavaScript y, de ser así, diseñar su Server Action sin degradar la cola offline ni la confirmación de detención. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar skeletons y resúmenes en 320/390, teclado/lector/zoom, SVG/tooltip, los cuatro Excel descargados y el artefacto de bundle de producción. |
| TASK-UI-016, ejecución de matriz | Cobertura inicial implementada; pendiente operativo | Ejecutar los 52 escenarios con fixtures aislados, añadir estados de loading/error/sesión/offline/doble envío por flujo crítico, contrastar color manualmente y registrar resultados por viewport, navegador y lector. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout; usar su manifest para confirmar que Recharts no vuelve al bundle inicial de las rutas diferidas. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; contrastar en artefacto de build la alerta estática de Recharts; decidir si el PPA público requiere un fallback sin JavaScript y, si corresponde, implementar y probar el recorrido alternativo. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 48:** UI-016 ya no empieza desde una lista abstracta: 52 contratos de navegador nombran rutas y comportamientos verificables, incluidos PPA público y la alternativa de datos de Combustibles. Ninguno ha sido ejecutado en ambiente aislado todavía, por lo que no hay certificación WCAG ni de teclado declarada.

### Pasada 49 — Capturas: consentimiento explícito antes de cualquier reset

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** cerrar una brecha de seguridad del harness P0: el capturador declaraba una base exclusiva obligatoria, pero todavía podía inferir una desde `DATABASE_URL` y habilitar por sí mismo su reset destructivo.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-001 / aislamiento de base | Implementado | `requireCaptureDatabaseUrl` exige `CAPTURE_DATABASE_URL` explícita y no deriva ninguna URL desde `DATABASE_URL`. El error indica que debe ser una base desechable aislada. | La resolución ocurre al inicio de `main`, antes de limpiar una salida filtrada o preparar Postgres. |
| TASK-UI-001 / consentimiento destructivo | Implementado | El capturador deja de escribir `CAPTURE_ALLOW_DESTRUCTIVE_RESET=true` en su propio entorno y valida ambos parámetros con `assertSafeDestructiveDatabase`. | Una base sin marcador desechable, host inseguro o flag ausente sigue siendo rechazada por la misma guardia compartida. |
| TASK-UI-001 / regresión | Implementado | Se añaden pruebas para ausencia de URL, ausencia del flag y para demostrar que `DATABASE_URL` jamás es fallback. | La URL explícita `postgres:///bodega_capture` con flag explícito es el único caso de prueba aceptado. |

#### Verificación ejecutada

- `npx vitest run scripts/capture-all-routes.test.ts lib/__tests__/destructive-database-guard.test.ts`: **2 archivos y 18 pruebas verdes**.
- `npx eslint scripts/capture-all-routes.ts scripts/capture-all-routes.test.ts`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó el capturador: no se proporcionó una `CAPTURE_DATABASE_URL` desechable explícita y no corresponde inferirla ni resetear una base compartida.

#### Lo que falta después de la pasada 49

| Pendiente | Estado al cierre de la pasada 49 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Código de aislamiento reforzado; pendiente operativo | Declarar `CAPTURE_DATABASE_URL` y `CAPTURE_ALLOW_DESTRUCTIVE_RESET=true` para una base exclusiva; ejecutar dos recapturas sin otros Playwright/E2E y obtener manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar el seed/captura aislado de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, certificación | Implementación de código completa | Recorrer Dashboard, Flota, Pendientes, Backups, CAPA, Capacitación, Permisos, Higiene y Emergencias en E2E, 390×844 y teclado; comprobar que sólo cuatro KPI primarios aparecen y que cada uno filtra/navega correctamente. |
| TASK-UI-007, ejecución y certificación PPA | Código de flujo y refactor completos; pendiente operativo | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Decidir además si la operación exige un fallback sin JavaScript y, de ser así, diseñar su Server Action sin degradar la cola offline ni la confirmación de detención. |
| TASK-UI-008, certificación TAE | Pendiente operativo | E2E ampliado, 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | Acordar/versionar glosario; convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar skeletons y resúmenes en 320/390, teclado/lector/zoom, SVG/tooltip, los cuatro Excel descargados y el artefacto de bundle de producción. |
| TASK-UI-016, ejecución de matriz | Cobertura inicial implementada; pendiente operativo | Ejecutar los 52 escenarios con fixtures aislados, añadir estados de loading/error/sesión/offline/doble envío por flujo crítico, contrastar color manualmente y registrar resultados por viewport, navegador y lector. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout; usar su manifest para confirmar que Recharts no vuelve al bundle inicial de las rutas diferidas. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; contrastar en artefacto de build la alerta estática de Recharts; decidir si el PPA público requiere un fallback sin JavaScript y, si corresponde, implementar y probar el recorrido alternativo. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 49:** el harness ya no puede convertir un valor implícito en una operación destructiva. La recaptura sigue pendiente, pero ahora sólo puede iniciarse con una base de captura nombrada y consentimiento explícito, que es la condición mínima para que sus resultados tengan valor de evidencia.

### Pasada 50 — TAE: fecha y hora consistentes en el ciclo completo

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** eliminar la presentación dependiente del navegador de fecha y hora en las superficies TAE tocadas por el flujo de carga, revisión, evidencia y exportación, manteniendo una convención visible y localizada.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-012 / detalle TAE | Implementado | El detalle de carga, su historial de estados y las referencias a la carga anterior/siguiente dejan de llamar `toLocaleString("es-CL")` en la vista y usan `formatDateTime`. | La misma convención se aplica a fecha de carga, creación y cambios de estado, sin delegar el formato en el navegador. |
| TASK-UI-012 / lista e importación | Implementado | La tabla principal de TAE y el historial de lotes de importación presentan `loadedAt`/`createdAt` mediante `formatDateTime`. | Las fechas de listado no quedan en un formato distinto del detalle. |
| TASK-UI-012 / evidencia y cola pública | Implementado | La miniatura de evidencia muestra `capturedAt` con el formateador compartido; la cola offline pública muestra la creación de cada carga fallida con la misma regla. | El usuario conserva contexto temporal comprensible tanto al revisar una evidencia como al recuperar un envío pendiente. |
| TASK-UI-012 / exportación Excel | Implementado | La acción de exportación transforma `loadedAt` con `formatDateTime` antes de entregar la celda de Excel. | La descarga deja de contener el valor crudo o una representación distinta de la UI para esa columna. |

#### Verificación ejecutada

- `npx eslint` sobre las seis superficies TAE modificadas, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx vitest run lib/__tests__/utils.test.ts lib/sst/__tests__/date.test.ts 'app/(public)/tae/access/[accessToken]/access-activation.test.tsx' 'app/(public)/tae/resultado/[token]/tae-result-actions.test.tsx'`: **4 archivos y 73 pruebas verdes**. Cubre los utilitarios de fecha, reglas SST relacionadas y los recorridos públicos TAE disponibles en test de componentes/acciones.
- `npx playwright test e2e/tae-public-flow.spec.ts e2e/tae-history-import.spec.ts e2e/tae-reconciliation.spec.ts --list`: **3 escenarios detectados**: importación histórica de 971 filas con evidencia/bloqueo de duplicado, recorrido QR público online y offline→sync, y conciliación Copec/TCT con XLSX.
- `npx react-doctor@latest --verbose --scope changed`: **49/100**, sin diagnóstico nuevo. Persisten la revisión de cadena de suministro de `pdfjs-dist@6.1.200`, la alerta de importación estática de Recharts que sólo se puede contrastar en el artefacto de producción y la decisión pendiente sobre fallback PPA sin JavaScript.
- No se ejecutaron E2E ni capturas: `CAPTURE_DATABASE_URL` sigue sin declarar y hay procesos `next-server`/Playwright usando el checkout. No se infirió una base ni se interfirió con esas ejecuciones compartidas.

#### Lo que falta después de la pasada 50

| Pendiente | Estado al cierre de la pasada 50 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Código de aislamiento reforzado; pendiente operativo | Declarar `CAPTURE_DATABASE_URL` y `CAPTURE_ALLOW_DESTRUCTIVE_RESET=true` para una base exclusiva; ejecutar dos recapturas sin otros Playwright/E2E y obtener manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar el seed/captura aislado de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, certificación | Implementación de código completa | Recorrer Dashboard, Flota, Pendientes, Backups, CAPA, Capacitación, Permisos, Higiene y Emergencias en E2E, 390×844 y teclado; comprobar que sólo cuatro KPI primarios aparecen y que cada uno filtra/navega correctamente. |
| TASK-UI-007, ejecución y certificación PPA | Código de flujo y refactor completos; pendiente operativo | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Decidir además si la operación exige un fallback sin JavaScript y, de ser así, diseñar su Server Action sin degradar la cola offline ni la confirmación de detención. |
| TASK-UI-008, certificación TAE | Formato de fecha/hora normalizado; pendiente operativo | Ejecutar los 3 escenarios TAE en servidor/base aislados; cubrir 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido y abrir los XLSX resultantes. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | La fecha/hora TAE quedó normalizada; resta acordar/versionar glosario, convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto; migrar otras tabs partidas que sigan usando wrap. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar skeletons y resúmenes en 320/390, teclado/lector/zoom, SVG/tooltip, los cuatro Excel descargados y el artefacto de bundle de producción. |
| TASK-UI-016, ejecución de matriz | Cobertura inicial implementada; pendiente operativo | Ejecutar los 52 escenarios con fixtures aislados, añadir estados de loading/error/sesión/offline/doble envío por flujo crítico, contrastar color manualmente y registrar resultados por viewport, navegador y lector. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout; usar su manifest para confirmar que Recharts no vuelve al bundle inicial de las rutas diferidas. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; contrastar en artefacto de build la alerta estática de Recharts; decidir si el PPA público requiere un fallback sin JavaScript y, si corresponde, implementar y probar el recorrido alternativo. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 50:** las fechas TAE de carga, evidencia, seguimiento, importación, cola offline y exportación ya usan una sola convención de fecha y hora. Esto reduce ambigüedad de lectura entre vistas y descargas, pero no certifica el flujo móvil/offline ni sustituye el glosario semántico pendiente de TASK-UI-012.

### Pasada 51 — Tabs: pestaña activa siempre alcanzable

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** cerrar la parte reutilizable de TASK-UI-014 que seguía dependiendo de cada pantalla: una tablist desplazable no basta si la pestaña que acaba de activarse puede quedar fuera del área visible.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-014 / auto-scroll de tabs | Implementado | `TabsList` identifica la pestaña con `aria-selected="true"` y solicita `scrollIntoView` con bloque y eje horizontal `nearest` al montar, al cambiar atributos Radix y tras interacciones de clic o teclado. | Las pantallas que ya usan la primitive no requieren implementar esta lógica en cada tablist, incluidas las que superan el ancho móvil. |
| TASK-UI-014 / contrato accesible | Implementado | La detección se apoya en `aria-selected`, el estado de selección que expone el control tab, y observa además `data-state` como compatibilidad de presentación. | El comportamiento no busca texto ni orden de pestaña, y mantiene la semántica de Radix para lector y teclado. |
| TASK-UI-014 / retroalimentación táctil | Implementado | `TabsTrigger` reemplaza la escala activa por un cambio de superficie, coherente con la regla de movimiento del sistema, que reserva la escala de presión para `Button`. | No hay salto geométrico al pulsar ni se modifica altura, hitbox móvil o foco existente. |
| TASK-UI-014 / regresión | Implementado | Se agrega una prueba de `TabsList` que verifica la revelación de la pestaña inicial y al seleccionar una pestaña posterior. | La aserción permite las notificaciones legítimas del observer y prueba el efecto observable, no una cantidad interna de llamadas. |

#### Verificación ejecutada

- `npx vitest run components/ui/tabs.test.tsx`: **1 archivo y 1 prueba verde**.
- `npx eslint components/ui/tabs.tsx components/ui/tabs.test.tsx`, `npx tsc --noEmit` y `git diff --check`: **verdes**, sin advertencias de hooks.
- `npx react-doctor@latest --verbose --scope changed` fue ejecutado después del cambio. No generó un diagnóstico atribuible a la primitive durante esta pasada; las decisiones pendientes ya registradas para `pdfjs-dist`, bundle de Recharts y fallback PPA se mantienen abiertas hasta contar con evidencia específica de producción/negocio.
- Falta comprobación física a 320/390 y zoom 200 %, incluidos gesto horizontal, flechas, Escape cuando corresponda y lector de pantalla. La prueba de DOM no sustituye esa certificación.

#### Lo que falta después de la pasada 51

| Pendiente | Estado al cierre de la pasada 51 | Dependencia o siguiente evidencia |
|---|---|---|
| TASK-UI-001, certificación del harness | Código de aislamiento reforzado; pendiente operativo | Declarar `CAPTURE_DATABASE_URL` y `CAPTURE_ALLOW_DESTRUCTIVE_RESET=true` para una base exclusiva; ejecutar dos recapturas sin otros Playwright/E2E y obtener manifest sin URL inválida, huérfanos, referencias ni hashes duplicados. |
| TASK-UI-002, veinte fixtures preparados | Pendiente operativo | Ejecutar el seed/captura aislado de los veinte detalles, en desktop y móvil; validar relaciones, RBAC/scope, 404 de ID inexistente y retorno contextual por grupo. |
| TASK-UI-003 / FORM-CORE-001, certificación | Pendiente operativo | E2E desktop/móvil desde Repuestos y Servicios, validando selector, ítem, resumen y payload/registro; revisar datos históricos antes de migrarlos. |
| TASK-UI-004, certificación visual y de accesibilidad | Código completo; pendiente operativo | Inspeccionar tarjetas y transiciones a 320, 390, 768 y 1024 px, zoom 200 %, teclado, foco, lector de pantalla y reflow. |
| TASK-UI-005, certificación de navegación | Implementación parcial | Capturar 1280, 1920 y 390 por rol; comprobar etiquetas, foco, destino, ancestro activo y rutas prohibidas/redirigidas restantes. |
| TASK-UI-006, certificación | Implementación de código completa | Recorrer Dashboard, Flota, Pendientes, Backups, CAPA, Capacitación, Permisos, Higiene y Emergencias en E2E, 390×844 y teclado; comprobar que sólo cuatro KPI primarios aparecen y que cada uno filtra/navega correctamente. |
| TASK-UI-007, ejecución y certificación PPA | Código de flujo y refactor completos; pendiente operativo | Ejecutar los 40 escenarios en servidor/base aislados; revisar 320×568, teclado virtual, horizontal, lector de pantalla y offline→sync. Decidir además si la operación exige un fallback sin JavaScript y, de ser así, diseñar su Server Action sin degradar la cola offline ni la confirmación de detención. |
| TASK-UI-008, certificación TAE | Formato de fecha/hora normalizado; pendiente operativo | Ejecutar los 3 escenarios TAE en servidor/base aislados; cubrir 429 y red/offline desde activación, 320/390 con teclado y Safari/Chrome móvil; decidir retención de cargas locales en dispositivo compartido y abrir los XLSX resultantes. |
| TASK-UI-009, certificación de retorno PDTP | Pendiente operativo | E2E de programa sin hoja y hoja inválida: crear/corregir y volver preservando año, faena, período, vista y filtro; capturar desktop/móvil y foco. |
| TASK-UI-009 / DATA-IND-001, certificación de KPI | Pendiente operativo | Probar por rol HH faltantes, CTA al mes correcto, guardado, recálculo, total y retorno; definir responsable cuando no puede gestionar denominador. |
| TASK-UI-010, certificación | Código implementado; pendiente operativo | E2E de crear, editar e invitar con rol global/de faena, principal, excepciones y POST manipulado; revisar 320/390, tabulación, lector y retorno. |
| TASK-UI-011, módulos y operación | Parcial | Falta salud agregada de módulos, última prueba SMTP, y ejecutar/resguardar/restaurar evidencia operacional autorizada. |
| TASK-UI-012, extensión semántica | Implementación parcial | La fecha/hora TAE quedó normalizada; resta acordar/versionar glosario, convertir enums/slugs restantes a labels, documentar formatos legales propios y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013, certificación | Código implementado; pendiente operativo | Descargar y abrir PDF de Acta/OC/Entrega; forzar error de cada endpoint, revisar 320/390, foco, teclado y A4 de los tres documentos en navegador aislado. |
| TASK-UI-014, certificación transversal | Código de tabs y overlays implementado; pendiente operativo | Revisar Sheet de notificaciones y tablists largos en 320/390, zoom 200 %, Escape, foco/restauración, screen reader y tacto, incluido que la tab activa se revele al usar flechas y al cargar una selección no inicial. |
| TASK-UI-015, certificación de gráficos y archivos | Implementación parcial | Inspeccionar skeletons y resúmenes en 320/390, teclado/lector/zoom, SVG/tooltip, los cuatro Excel descargados y el artefacto de bundle de producción. |
| TASK-UI-016, ejecución de matriz | Cobertura inicial implementada; pendiente operativo | Ejecutar los 52 escenarios con fixtures aislados, añadir estados de loading/error/sesión/offline/doble envío por flujo crítico, contrastar color manualmente y registrar resultados por viewport, navegador y lector. |
| TASK-UI-017 | No iniciado | Definir y aprobar matriz legal/operacional de RUT por rol, tarea y exportación antes de implementar enmascarado; luego probar listas, selectores, detalle, exportación y capturas sin crear homónimos peligrosos. |
| Build de producción | Pendiente operativo | Ejecutar `npm run build` cuando ningún `test-server` ni `next-server` use el checkout; usar su manifest para confirmar que Recharts no vuelve al bundle inicial de las rutas diferidas. |
| React Doctor de rama | Implementación parcial | Revisar/aceptar explícitamente `pdfjs-dist@6.1.200`; contrastar en artefacto de build la alerta estática de Recharts; decidir si el PPA público requiere un fallback sin JavaScript y, si corresponde, implementar y probar el recorrido alternativo. |
| Fase 5 y riesgos de secciones 18–19 | Abiertos | Usabilidad por rol, WCAG manual/automática, reflow, touch targets, lectores, rendimiento, documentos descargados, volumen, cross-browser, telemetría, privacidad y paridad seed/producción. |

**Veredicto tras la pasada 51:** las tablists de Chome tienen ahora una garantía común de visibilidad de la selección, sin depender de que cada ruta recuerde el scroll horizontal. La certificación de interacción y reflow en navegador sigue siendo necesaria antes de cerrar TASK-UI-014.

### Pasada 52 — Vencimientos PDTP y MIPER sin ISO crudo

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** continuar TASK-UI-012 en dos superficies preventivas donde una fecha calendario legal/operacional se mostraba como `YYYY-MM-DD`, pese a existir un formateador compartido que conserva ese tipo de fecha sin desplazarlo de zona.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-012 / reloj PDTP | Implementado | La insignia “Vence” del panel de cobertura PDTP usa `formatDate(item.dueAt)`. | Una fecha calendario como `2026-08-14` se lee `14-08-2026` sin convertirse a instante ni cambiar de día. |
| TASK-UI-012 / revisiones MIPER | Implementado | El vencimiento de cada revisión MIPER usa el mismo `formatDate`, manteniendo sin cambios la comparación interna que decide si está vencida. | La semántica de prioridad se conserva; sólo se transforma la representación visible. |
| TASK-UI-012 / regresión de formato | Implementado | La suite de cobertura PDTP ahora construye una obligación pendiente y exige “Vence 14-08-2026”. | Evita volver a exponer el ISO en una superficie crítica de seguimiento. |

#### Verificación ejecutada

- `npx vitest run app/(app)/prevencion/pdtp/cobertura/pdtp-coverage-workbench.test.tsx lib/__tests__/utils.test.ts`: **2 archivos y 50 pruebas verdes**.
- `npx eslint` de ambos workbenches y de la prueba, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó navegador: esta pasada modifica formato visible, pero sigue requiriendo la certificación responsive, de teclado y lector que figura en la matriz operativa.

#### Lo que falta después de la pasada 52

| Pendiente | Estado actual | Siguiente evidencia necesaria |
|---|---|---|
| TASK-UI-001 a TASK-UI-003 | Pendientes operativos | Base de captura aislada, dos recapturas, veinte fixtures y E2E de formularios Repuestos/Servicios. |
| TASK-UI-004 a TASK-UI-006 | Código parcial/completo; sin certificación | Revisión por viewport, zoom, teclado, lector, navegación por rol y KPI accionables. |
| TASK-UI-007 | Flujo PPA implementado; pendiente operativo | Ejecutar 40 escenarios aislados y decidir fallback sin JavaScript. |
| TASK-UI-008 | Formato TAE normalizado; pendiente operativo | E2E, 429, offline, móvil Safari/Chrome, retención local y apertura de XLSX. |
| TASK-UI-009 y DATA-IND-001 | Pendientes operativos | E2E de retorno PDTP, KPI HH, responsabilidad de denominadores y foco. |
| TASK-UI-010 y TASK-UI-011 | Parciales | E2E de usuarios/roles y salud SMTP, módulos y respaldos autorizados. |
| TASK-UI-012 | Implementación parcial | Versionar glosario, mapear enums/slugs restantes, documentar formatos legales y ejecutar búsqueda/snapshots por dominio. |
| TASK-UI-013 a TASK-UI-015 | Implementados/parciales; sin certificación | PDFs A4/móvil, overlays/tabs en navegador, gráficos, exports Excel y bundle de producción. |
| TASK-UI-016 | Cobertura inicial; pendiente operativo | Ejecutar los 52 contratos, cubrir loading/error/sesión/offline/doble envío y registrar navegador/lector. |
| TASK-UI-017 | No iniciado | Aprobar matriz legal de RUT antes de enmascarar y probar todas las superficies. |
| Build, React Doctor, Fase 5 | Abiertos | Build sin procesos compartidos, decisiones de `pdfjs-dist`/Recharts/PPA y certificación transversal WCAG, rendimiento, privacidad y producción. |

El detalle completo de cada ítem no alterado permanece en la tabla de cierre de la pasada 51 inmediatamente anterior; esta pasada sólo reduce el remanente visible de TASK-UI-012, sin cambiar sus dependencias de glosario ni certificación.

**Veredicto tras la pasada 52:** PDTP y MIPER dejan de forzar a los usuarios a interpretar ISO en sus vencimientos. El cambio es intencionalmente estrecho: la homogeneización semántica completa sigue pendiente de la decisión de glosario y de un barrido por dominio.

### Pasada 53 — Mantenciones: un vocabulario único de estado

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** impedir que una misma mantención se vea como “Completada” en su lista, pero como `completed` en el detalle del vehículo, y eliminar las copias independientes del mismo vocabulario.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-012 / contrato de mantenciones | Implementado | `MAINTENANCE_STATUSES` y `MAINTENANCE_STATUS_LABELS` pasan a ser la fuente única del enum de validación y de sus etiquetas de negocio. | Validación y copy cambian juntos, por lo que un nuevo estado no puede añadirse sin decidir su representación. |
| TASK-UI-012 / formulario y listado | Implementado | El selector del formulario itera el catálogo central y la lista reutiliza sus labels; las fechas de alertas, historial y uso también pasan por `formatDate`. | Formularios, tabla, próximas mantenciones y alertas ya comparten la misma lectura humana. |
| TASK-UI-012 / detalle de flota | Implementado | El badge de mantención reciente usa el catálogo central y mantiene como fallback el valor original para datos históricos no contemplados. | Se evita ocultar información si llega un valor legacy, sin mostrar el enum conocido al usuario. |
| TASK-UI-012 / regresión | Implementado | La prueba de validación exige las cuatro claves técnicas y sus cuatro labels en español. | Impide separar el contrato de entrada de su vocabulario visible. |

#### Verificación ejecutada

- `npx vitest run lib/__tests__/maintenance-validation.test.ts app/(app)/mantenciones/actions.test.ts`: **2 archivos y 10 pruebas verdes**.
- `npx eslint` de validación, formulario, lista y detalle, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx react-doctor@latest --verbose --scope changed` se ejecutó sin diagnóstico atribuible a este cambio. Se mantienen abiertos los hallazgos ya registrados para `pdfjs-dist`, confirmación de Recharts en build y decisión de fallback PPA.

#### Lo que falta después de la pasada 53

| Pendiente | Estado actual | Siguiente evidencia necesaria |
|---|---|---|
| TASK-UI-001 | Pendiente operativo | Base exclusiva, dos recapturas y manifest íntegro. |
| TASK-UI-002 | Pendiente operativo | Veinte fixtures de detalle, relaciones, RBAC/scope y capturas desktop/móvil. |
| TASK-UI-003 | Pendiente operativo | E2E Repuestos/Servicios, selector, payload y datos históricos. |
| TASK-UI-004 | Código completo; sin certificación | 320/390/768/1024, zoom, foco, teclado, lector y reflow. |
| TASK-UI-005 | Implementación parcial | Navegación, destinos y prohibiciones por rol en desktop/móvil. |
| TASK-UI-006 | Código completo; sin certificación | E2E de KPI y módulos de gestión, incluido 390×844. |
| TASK-UI-007 | Flujo PPA completo; pendiente operativo | 40 escenarios aislados, móvil/offline y decisión de fallback sin JavaScript. |
| TASK-UI-008 | Formato TAE normalizado; pendiente operativo | E2E, 429, offline, Safari/Chrome móvil, retención local y XLSX. |
| TASK-UI-009 y DATA-IND-001 | Pendientes operativos | Retorno PDTP, KPI HH, responsable de denominadores y foco. |
| TASK-UI-010 | Código implementado; pendiente operativo | E2E de roles, principal/excepciones, POST manipulado y accesibilidad. |
| TASK-UI-011 | Parcial | Salud de módulos, SMTP y ejercicio autorizado de respaldo/restauración. |
| TASK-UI-012 | Implementación parcial | Glosario versionado, labels de enums/slugs restantes, formatos legales y snapshots por dominio. |
| TASK-UI-013 | Código implementado; pendiente operativo | PDF Acta/OC/Entrega, errores, móvil y A4. |
| TASK-UI-014 | Código implementado; pendiente operativo | Sheets/tablists en 320/390, zoom, Escape, foco, lector y tacto. |
| TASK-UI-015 | Implementación parcial | Gráficos y tablas equivalentes en navegador, cuatro XLSX y bundle final. |
| TASK-UI-016 | Cobertura inicial; pendiente operativo | Ejecutar 52 contratos y cubrir loading/error/sesión/offline/doble envío. |
| TASK-UI-017 | No iniciado | Matriz legal de RUT aprobada antes de enmascarar y capturar. |
| Build, React Doctor y Fase 5 | Abiertos | Build sin procesos compartidos, decisiones de dependencia/bundle/fallback y certificación WCAG, rendimiento, privacidad y paridad productiva. |

**Veredicto tras la pasada 53:** la mantención tiene un único nombre de negocio desde el selector hasta el detalle del vehículo, con fallback prudente para legado. TASK-UI-012 avanza en contratos concretos, pero no se declara cerrada hasta acordar y comprobar el glosario transversal.

### Pasada 54 — Entregas: contrato móvil, error PDF y Axe

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** convertir en contratos de navegador los comportamientos que faltaban verificar en el comprobante de entrega: lectura útil a 390 px, acción PDF disponible y mensaje recuperable cuando el endpoint falla.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-013 / resumen móvil Entregas | Implementado; pendiente de ejecución | El spec de comprobante fija 390×844 y exige el `main` de resumen HTML, la sección de productos y el botón “Descargar PDF”. | Verifica el artefacto que debe quedar legible en teléfono, sin reducir la hoja A4 a la escala móvil. |
| TASK-UI-013 / error recuperable PDF | Implementado; pendiente de ejecución | El mismo spec intercepta el endpoint PDF con 503, pulsa descargar y exige el `role="status"` con error y reintento. | El comportamiento probado es el de la interfaz, no sólo el status HTTP del endpoint. |
| TASK-UI-016 / auditoría automática | Implementado; pendiente de ejecución | El comprobante `del-e2e` se incorpora al barrido Axe autenticado, con WCAG 2.2 AA ya configurado. | La ruta de impresión deja de quedar fuera de la matriz de accesibilidad automática. |

#### Verificación ejecutada

- `npx playwright test e2e/delivery-print.spec.ts e2e/accessibility.spec.ts --list`: **36 escenarios detectados**, entre ellos carga de comprobante, resumen móvil/error 503 y Axe de la ruta de entrega.
- `npx eslint` de ambos specs, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó Playwright: listar escenarios no demuestra el resumen real, la descarga ni cero violaciones Axe. Su ejecución requiere servidor, sesión y fixture aislados.

#### Lo que falta después de la pasada 54

| Pendiente | Estado actual | Siguiente evidencia necesaria |
|---|---|---|
| TASK-UI-001 | Pendiente operativo | Base exclusiva, dos recapturas y manifest íntegro. |
| TASK-UI-002 | Pendiente operativo | Veinte fixtures de detalle, relaciones, RBAC/scope y capturas desktop/móvil. |
| TASK-UI-003 | Pendiente operativo | E2E Repuestos/Servicios, selector, payload y datos históricos. |
| TASK-UI-004 | Código completo; sin certificación | 320/390/768/1024, zoom, foco, teclado, lector y reflow. |
| TASK-UI-005 | Implementación parcial | Navegación, destinos y prohibiciones por rol en desktop/móvil. |
| TASK-UI-006 | Código completo; sin certificación | E2E de KPI y módulos de gestión, incluido 390×844. |
| TASK-UI-007 | Flujo PPA completo; pendiente operativo | 40 escenarios aislados, móvil/offline y decisión de fallback sin JavaScript. |
| TASK-UI-008 | Formato TAE normalizado; pendiente operativo | E2E, 429, offline, Safari/Chrome móvil, retención local y XLSX. |
| TASK-UI-009 y DATA-IND-001 | Pendientes operativos | Retorno PDTP, KPI HH, responsable de denominadores y foco. |
| TASK-UI-010 | Código implementado; pendiente operativo | E2E de roles, principal/excepciones, POST manipulado y accesibilidad. |
| TASK-UI-011 | Parcial | Salud de módulos, SMTP y ejercicio autorizado de respaldo/restauración. |
| TASK-UI-012 | Implementación parcial | Glosario versionado, labels de enums/slugs restantes, formatos legales y snapshots por dominio. |
| TASK-UI-013 | Código completo y contrato ampliado; pendiente operativo | Ejecutar descarga/error de Acta, OC y Entrega; revisar 320/390, foco, teclado y PDF A4 de los tres documentos. |
| TASK-UI-014 | Código implementado; pendiente operativo | Sheets/tablists en 320/390, zoom, Escape, foco, lector y tacto. |
| TASK-UI-015 | Implementación parcial | Gráficos y tablas equivalentes en navegador, cuatro XLSX y bundle final. |
| TASK-UI-016 | Cobertura inicial ampliada; pendiente operativo | Ejecutar ahora 53 contratos de la matriz de accesibilidad, más loading/error/sesión/offline/doble envío. |
| TASK-UI-017 | No iniciado | Matriz legal de RUT aprobada antes de enmascarar y capturar. |
| Build, React Doctor y Fase 5 | Abiertos | Build sin procesos compartidos, decisiones de dependencia/bundle/fallback y certificación WCAG, rendimiento, privacidad y paridad productiva. |

**Veredicto tras la pasada 54:** el comprobante de Entregas ya no depende de una afirmación visual sin contrato: su resumen móvil, la acción PDF y su error recuperable forman parte de E2E y Axe. Falta ejecutarlos en ambiente aislado y realizar la inspección humana del A4 descargado.

### Pasada 55 — Acta SST y OC: paridad del contrato móvil de documento

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** extender a Acta SST y Orden de Compra el mismo contrato que cubre Entregas, de modo que las tres superficies A4 tengan evidencia de lectura móvil y recuperación ante un PDF no disponible.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-013 / OC móvil y PDF | Implementado; pendiente de ejecución | `print-mobile.spec.ts` abre `oc-e2e` a 390×844, exige su resumen HTML, sección Compra y acción PDF; intercepta un 503 y exige el mensaje recuperable. | Usa la fixture de OC ya usada por las pruebas de PDF, sin depender de una orden creada por otro spec. |
| TASK-UI-013 / Acta SST móvil y PDF | Implementado; pendiente de ejecución | El mismo contrato se aplica a `sst-eval-e2e`, sección Evaluación y el endpoint PDF SST. | Comprueba que el resumen, no la hoja A4 reducida, sea la superficie legible a teléfono. |
| TASK-UI-016 / Axe de documentos | Implementado; pendiente de ejecución | OC y Acta SST se agregan al barrido Axe autenticado junto a Entregas. | Las tres rutas de impresión quedan dentro de la misma selección WCAG 2.2 AA. |

#### Verificación ejecutada

- `npx playwright test e2e/delivery-print.spec.ts e2e/print-mobile.spec.ts e2e/accessibility.spec.ts --list`: **40 escenarios detectados**; incluye los tres documentos, errores 503 y Axe.
- `npx eslint` de los tres specs, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- No se ejecutó Playwright: la lista no demuestra el reflow, el error en DOM ni la auditoría Axe. Aún falta servidor/base/fixture aislados y abrir los tres PDF reales.

#### Lo que falta después de la pasada 55

| Pendiente | Estado actual | Siguiente evidencia necesaria |
|---|---|---|
| TASK-UI-001 | Pendiente operativo | Base exclusiva, dos recapturas y manifest íntegro. |
| TASK-UI-002 | Pendiente operativo | Veinte fixtures de detalle, relaciones, RBAC/scope y capturas desktop/móvil. |
| TASK-UI-003 | Pendiente operativo | E2E Repuestos/Servicios, selector, payload y datos históricos. |
| TASK-UI-004 | Código completo; sin certificación | 320/390/768/1024, zoom, foco, teclado, lector y reflow. |
| TASK-UI-005 | Implementación parcial | Navegación, destinos y prohibiciones por rol en desktop/móvil. |
| TASK-UI-006 | Código completo; sin certificación | E2E de KPI y módulos de gestión, incluido 390×844. |
| TASK-UI-007 | Flujo PPA completo; pendiente operativo | 40 escenarios aislados, móvil/offline y decisión de fallback sin JavaScript. |
| TASK-UI-008 | Formato TAE normalizado; pendiente operativo | E2E, 429, offline, Safari/Chrome móvil, retención local y XLSX. |
| TASK-UI-009 y DATA-IND-001 | Pendientes operativos | Retorno PDTP, KPI HH, responsable de denominadores y foco. |
| TASK-UI-010 | Código implementado; pendiente operativo | E2E de roles, principal/excepciones, POST manipulado y accesibilidad. |
| TASK-UI-011 | Parcial | Salud de módulos, SMTP y ejercicio autorizado de respaldo/restauración. |
| TASK-UI-012 | Implementación parcial | Glosario versionado, labels de enums/slugs restantes, formatos legales y snapshots por dominio. |
| TASK-UI-013 | Código completo y contratos de los tres documentos; pendiente operativo | Ejecutar las descargas/errores, revisar 320/390, foco, teclado y A4 de Acta, OC y Entrega. |
| TASK-UI-014 | Código implementado; pendiente operativo | Sheets/tablists en 320/390, zoom, Escape, foco, lector y tacto. |
| TASK-UI-015 | Implementación parcial | Gráficos y tablas equivalentes en navegador, cuatro XLSX y bundle final. |
| TASK-UI-016 | Cobertura inicial ampliada; pendiente operativo | Ejecutar ahora 55 contratos de la matriz de accesibilidad, más loading/error/sesión/offline/doble envío. |
| TASK-UI-017 | No iniciado | Matriz legal de RUT aprobada antes de enmascarar y capturar. |
| Build, React Doctor y Fase 5 | Abiertos | Build sin procesos compartidos, decisiones de dependencia/bundle/fallback y certificación WCAG, rendimiento, privacidad y paridad productiva. |

**Veredicto tras la pasada 55:** Acta, OC y Entrega tienen la misma expectativa verificable de teléfono, descarga y fallo recuperable. La paridad de código queda cubierta; la paridad real sigue pendiente de ejecutar en entorno aislado y de inspeccionar los PDFs A4 producidos.

### Pasada 56 — E2E: base explícita antes de cualquier reset

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** eliminar la última ruta implícita del harness E2E: Playwright y `start-server.sh` podían derivar una base desde `DATABASE_URL` o un valor por defecto pese a que `setup-db.ts` destruye y vuelve a crear el esquema.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-001 / resolución de BD E2E | Implementado | `resolveE2eDatabaseUrl` sólo acepta `E2E_DATABASE_URL` explícita y devuelve `undefined` si sólo existe `DATABASE_URL`. `playwright.config.ts` no configura `webServer` destructivo sin esa declaración. | El listado de pruebas sigue funcionando sin arrancar servidor ni convertir una URL ambiente en destino de reset. |
| TASK-UI-001 / guardia del proceso | Implementado | `e2e/start-server.sh` rechaza antes de conectar una URL E2E ausente y también la ausencia de `E2E_ALLOW_DESTRUCTIVE_RESET=true`. | El script no puede llegar a `setup-db.ts`, que reinicia esquema, con intención implícita. |
| TASK-UI-001 / CI explícito | Implementado | El paso E2E del workflow declara `E2E_DATABASE_URL` de su servicio `bodega_e2e`; `DATABASE_URL` conserva su uso general de CI, pero no autoriza E2E. | CI sigue teniendo un destino desechable nombrado para la suite completa. |
| TASK-UI-001 / regresión | Implementado | Se añade prueba de resolución que demuestra ausencia de fallback y se prueban ambas salidas tempranas del script en shell. | La URL E2E con espacios se normaliza; una URL de aplicación aislada no se acepta por accidente. |

#### Verificación ejecutada

- `npx vitest run e2e/environment.test.ts scripts/capture-all-routes.test.ts lib/__tests__/destructive-database-guard.test.ts`: **3 archivos y 19 pruebas verdes**.
- Guardas de `e2e/start-server.sh`: **verdes** para URL ausente y flag destructivo ausente; ambos terminan antes de Postgres.
- `npx eslint`, `npx tsc --noEmit` y `git diff --check`: **verdes**.
- `npx playwright test e2e/delivery-print.spec.ts e2e/print-mobile.spec.ts e2e/accessibility.spec.ts --list`: **40 escenarios detectados** sin iniciar webserver.
- Estado operativo leído, sin mutar: `CAPTURE_DATABASE_URL` y `E2E_DATABASE_URL` no están declaradas en esta sesión y existe un `test-server` Playwright compartido. Por tanto, no se ejecutó reset, build ni E2E.

#### Lo que falta después de la pasada 56

| Pendiente | Estado actual | Siguiente evidencia necesaria |
|---|---|---|
| TASK-UI-001 | Aislamiento de código completo; pendiente operativo | Proveer una `CAPTURE_DATABASE_URL` exclusiva y `E2E_DATABASE_URL` exclusiva, ambas con flag explícito; ejecutar dos recapturas y la suite sin servidores compartidos, validando manifest. |
| TASK-UI-002 | Pendiente operativo | Veinte fixtures de detalle, relaciones, RBAC/scope y capturas desktop/móvil. |
| TASK-UI-003 | Pendiente operativo | E2E Repuestos/Servicios, selector, payload y datos históricos. |
| TASK-UI-004 | Código completo; sin certificación | 320/390/768/1024, zoom, foco, teclado, lector y reflow. |
| TASK-UI-005 | Implementación parcial | Navegación, destinos y prohibiciones por rol en desktop/móvil. |
| TASK-UI-006 | Código completo; sin certificación | E2E de KPI y módulos de gestión, incluido 390×844. |
| TASK-UI-007 | Flujo PPA completo; pendiente operativo | 40 escenarios aislados, móvil/offline y decisión de fallback sin JavaScript. |
| TASK-UI-008 | Formato TAE normalizado; pendiente operativo | E2E, 429, offline, Safari/Chrome móvil, retención local y XLSX. |
| TASK-UI-009 y DATA-IND-001 | Pendientes operativos | Retorno PDTP, KPI HH, responsable de denominadores y foco. |
| TASK-UI-010 | Código implementado; pendiente operativo | E2E de roles, principal/excepciones, POST manipulado y accesibilidad. |
| TASK-UI-011 | Parcial | Salud de módulos, SMTP y ejercicio autorizado de respaldo/restauración. |
| TASK-UI-012 | Implementación parcial | Glosario versionado, labels de enums/slugs restantes, formatos legales y snapshots por dominio. |
| TASK-UI-013 | Código completo y contratos de los tres documentos; pendiente operativo | Ejecutar las descargas/errores, revisar 320/390, foco, teclado y A4 de Acta, OC y Entrega. |
| TASK-UI-014 | Código implementado; pendiente operativo | Sheets/tablists en 320/390, zoom, Escape, foco, lector y tacto. |
| TASK-UI-015 | Implementación parcial | Gráficos y tablas equivalentes en navegador, cuatro XLSX y bundle final. |
| TASK-UI-016 | Cobertura inicial ampliada; pendiente operativo | Ejecutar 55 contratos de la matriz de accesibilidad, más loading/error/sesión/offline/doble envío. |
| TASK-UI-017 | No iniciado | Matriz legal de RUT aprobada antes de enmascarar y capturar. |
| Build, React Doctor y Fase 5 | Abiertos | Build sin procesos compartidos, decisiones de dependencia/bundle/fallback y certificación WCAG, rendimiento, privacidad y paridad productiva. |

**Veredicto tras la pasada 56:** E2E conserva su automatización, pero ya no puede confundir una variable de aplicación con permiso para borrar datos. El bloqueo actual es operacional y visible, no una condición que el código pueda deducir o saltarse.

### Pasada 57 — Primera recaptura aislada realmente ejecutada

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** dejar de declarar el harness "listo pero sin ejecutar". Se dispuso de `bodega_capture` como base exclusiva, sin otro proceso Playwright compitiendo, y se corrió el capturador de extremo a extremo hasta que el manifest dejara de reportar problemas de integridad. Todo lo que sigue son hallazgos que sólo aparecieron al ejecutar.

#### Trabajo realizado

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-002 / orden del seed | Corregido | El fixture de solicitud de privacidad referenciaba `worker-audit-1` antes de que existiera la tabla `workers`: la preparación de base abortaba con violación de clave foránea y **ninguna captura podía correr**. Los trabajadores se siembran ahora antes de cualquier fixture preventivo que los referencie. | La primera ejecución falló en `prevention_privacy_requests`; tras el cambio el seed completa en 5 s. |
| TASK-UI-001 / contrato de interacción | Implementado | La allowlist exigía la URL exacta también después de hacer clic en una pestaña o abrir un modal. Como las vistas y pestañas persisten su estado en la URL a propósito (pasadas 41 y 51), el harness marcaba ese diseño como error: 14 de 17 `capture-invalid` eran esto. `isCaptureInteractionUrlAllowed` permite que cambie la query pero no el pathname. | Prueba nueva: `?tab=facturacion` es válido en interacción, inválido como destino de navegación, y `/compras` sigue siendo abandonar la ruta. |
| TASK-UI-001 / declaraciones desactualizadas | Corregido | `root` declaraba `/login` cuando el redirect real conserva `?callbackUrl=%2F`. `admin-productos-detalle` seguía declarado como redirect al listado pese a tener página propia desde hace pasadas: se capturaba como error en vez de como detalle. | Ambas rutas pasan a `capture-ok`; el detalle de producto entra por primera vez a la evidencia. |
| TASK-UI-009 / editor PDTP nunca capturado | Corregido | `/prevencion/pdtp/{id}/editar` sólo abre programas en borrador y el único fixture estaba `active`, así que la ruta redirigía y jamás se capturó. Se siembra `prog-audit-2` en borrador y se declara además la ruta del programa activo como redirect esperado. | Quedan las dos evidencias: el editor real y la salida correcta cuando el programa ya no es editable. |
| EVID-003 / ruta fantasma | Corregido | `/prevencion/incidentes/importar` estaba declarada en el harness y no existe en la aplicación: rendía el 404 y contaba como cobertura. Ninguna otra parte del código la referencia. | Su captura era byte a byte igual a la del 404. |
| TASK-UI-012 / hidratación e incidentes | Corregido | Incidentes formateaba fechas con tres `Intl.DateTimeFormat` propios; el del detalle además sin `timeZone`. Con `dateStyle`/`timeStyle` el ICU de Node y el de Chromium rinden distinto, y las cuatro pantallas de incidentes lanzaban **React #418 (fallo de hidratación)** en desktop y móvil. Ahora usan `formatDateTime` compartido, y `sentAt`/`escalatedAt` dejan de imprimirse como ISO crudo. | La recaptura siguiente reporta "Sin errores de cliente en ninguna ruta". |
| TASK-UI-012 / vocabulario PDTP | Implementado | El estado de programa tenía tres definiciones (controles de ciclo de vida, ternario del listado, render crudo del índice) y el listado etiquetaba `in_review`, `rejected` y `archived` como "Borrador". `lib/prevention/pdtp.ts` centraliza estado de programa y de ejecución; los tres consumidores toman de ahí el texto y conservan sólo su color. | `program-lifecycle-controls.test.tsx` sigue verde con los mismos textos. |
| TASK-UI-001 / evidencia repetida | Implementado | Cuatro causas mecánicas producían capturas idénticas: la pestaña ya activa se volvía a capturar, dos disparadores con el mismo texto pisaban el mismo archivo, una ruta que ya declara su pestaña por query volvía a barrer todas, y las rutas 404 barrían modales del chrome compartido. Además, una pestaña cuya URL coincide con otra ruta declarada ya no se captura dos veces. | Los problemas de integridad bajan de 36 a 1 entre la primera y la cuarta ejecución. |
| EVID-003 / 404 duplicado | Corregido | `/ruta-inexistente-auditoria` y `/app-ruta-inexistente-auditoria` resuelven a la misma página 404 con shell: eran dos rutas declaradas para una sola evidencia. Se conserva una. | Las capturas móviles de ambas eran idénticas byte a byte. |

#### Verificación ejecutada

- **Cinco recapturas completas** sobre `CAPTURE_DATABASE_URL=postgres:///bodega_capture` con `CAPTURE_ALLOW_DESTRUCTIVE_RESET=true`, sin otro proceso Playwright ni E2E usando esa base.
- Progresión del manifest: ejecución 1 **abortó en el seed**; tras corregirla, 157/164 rutas ok, 4 rutas con error de JavaScript y **36 problemas de integridad**. Ejecución 2: **164/164 ok, 0 errores de cliente, 0 scroll horizontal, 7 problemas**. Ejecución 3: **3 problemas**. Ejecución 4: **1 problema**. Ejecución 5: **163/163 rutas y 10/10 públicas ok, sin URL inválida, huérfano, referencia ni hash duplicado, salida 0**.
- Reflow WCAG 1.4.10: **sin scroll horizontal en ninguna ruta**, desktop 1920×1080 y móvil 390×844.
- Determinismo medido entre dos ejecuciones consecutivas del mismo build: **670 capturas comunes, 437 con hash distinto**. Las pantallas sin tiempo real (`login`, `registro`, `recuperar`, `forbidden`) son **byte a byte idénticas**, de modo que el harness es determinista y la diferencia proviene de pantallas que muestran tiempo real contra fixtures de fecha fija. La igualdad byte a byte entre corridas no es alcanzable mientras la interfaz muestre tiempo relativo, y no era el criterio declarado.
- `npx tsc --noEmit`, `npx eslint` y `npx vitest run scripts/capture-all-routes.test.ts` (**8 pruebas**) y `program-lifecycle-controls.test.tsx` (**6 pruebas**): **verdes**.
- `npm run build` completo, sin procesos compartidos: **verde**.

#### Hallazgos abiertos que surgieron al ejecutar

| Hallazgo | Naturaleza | Decisión pendiente |
|---|---|---|
| `app/not-found.tsx` no se renderiza nunca | Código muerto | Cualquier URL sin coincidencia, dentro o fuera del grupo `(app)`, resuelve al 404 con shell de `app/(app)/not-found.tsx`. Hay que decidir si se elimina el archivo raíz o si alguna ruta debe llegar a él. |
| Igualdad byte a byte entre corridas | Límite del método, no defecto | Las pantallas con tiempo real difieren entre ejecuciones aunque los fixtures tengan fecha fija. Si se quiere comparación visual entre pasadas, hay que congelar el reloj del navegador, no sólo el del seed. |
| Enums crudos en el banco de trabajo ARCO | TASK-UI-012 sin vocabulario de origen | `privacy-right-execution-workbench.tsx` imprime `status`, `fitnessStatus`, `category` y `estado` de salud ocupacional, casos reservados y documentos. No existe mapa de etiquetas para esos dominios; inventarlo aquí crearía sinónimos. Requiere acordar el glosario antes de traducirlo. |

#### Lo que falta después de la pasada 57

| Pendiente | Estado actual | Siguiente evidencia necesaria |
|---|---|---|
| TASK-UI-001, capturas | **Certificado** | Cerrado: cinco recapturas aisladas, manifest limpio y salida 0. Sólo requiere repetirse cuando cambien rutas o fixtures. |
| TASK-UI-001, E2E | Pendiente operativo | No se ejecutó la suite. Requiere `E2E_DATABASE_URL` exclusiva con `E2E_ALLOW_DESTRUCTIVE_RESET=true` y ningún otro proceso usando esa base; la suite reconstruye `.next`, por lo que no puede correr junto al capturador. |
| TASK-UI-002 | Capturas ok; casos negativos pendientes | Los veinte detalles rinden 200 en desktop y móvil. Falta el resto del contrato: inexistente/eliminado, sin permiso, retorno contextual, y que Soporte inexistente responda HTTP 404 y no una página 404 con 200. |
| TASK-UI-003 | Pendiente operativo | E2E desktop y móvil desde `/repuestos/nueva` y `/servicios/nueva`: selector, primer ítem, resumen, payload y registro creado; revisar solicitudes históricas mal tipadas antes de migrar datos. |
| TASK-UI-004 | Reflow certificado; resto pendiente | Sin scroll horizontal en 1920×1080 ni 390×844. Falta 320, 768 y 1024, zoom 200 %, recorrido por teclado, foco visible y lector de pantalla. |
| TASK-UI-005 | Implementación parcial | Navegación preventiva por rol: destinos alcanzables, prohibiciones efectivas y layout en 1280/1920 y móvil. |
| TASK-UI-006 | Código completo; sin certificación | E2E de KPI y módulos de gestión, incluido 390×844. |
| TASK-UI-007 | Flujo completo; pendiente operativo | Los 40 escenarios PPA aislados, móvil/offline y la decisión sobre fallback sin JavaScript. |
| TASK-UI-008 | Formato normalizado; pendiente operativo | E2E TAE, 429, offline, Safari/Chrome móvil, retención local y XLSX. |
| TASK-UI-009 y DATA-IND-001 | Editor capturado; retorno pendiente | El editor PDTP ya tiene evidencia visual en ambos viewports. Falta el E2E de ida y vuelta con año, faena, período, vista y filtro intactos, y la prueba por rol del KPI de HH faltantes. |
| TASK-UI-010 | Código implementado; pendiente operativo | E2E de roles, principal/excepciones, POST manipulado y accesibilidad. |
| TASK-UI-011 | Parcial | Salud real de módulos y SMTP, y ejercicio autorizado de respaldo/restauración. |
| TASK-UI-012 | Avanzado | PDTP e incidentes cerrados. Falta el glosario de salud ocupacional, casos reservados y documentos para el banco ARCO, el barrido estático del resto de enums y slugs, y los snapshots de formato por dominio. |
| TASK-UI-013 | Código completo; pendiente operativo | Ejecutar descargas y errores de Acta SST, OC y Entrega; revisar 320/390, foco, teclado y el A4. |
| TASK-UI-014 | Código implementado; pendiente operativo | Sheets y tablists en 320/390, zoom, Escape, foco, lector y tacto. |
| TASK-UI-015 | Implementación parcial | Gráficos y tablas equivalentes en navegador, los cuatro XLSX y el bundle final. |
| TASK-UI-016 | Cobertura ampliada; pendiente operativo | Ejecutar los 55 contratos de la matriz de accesibilidad, más loading, error, sesión, offline y doble envío. |
| TASK-UI-017 | **No iniciado por decisión** | El titular del proyecto decidió no tocar la exposición de RUT en esta pasada. Queda bloqueada hasta que exista matriz legal aprobada. |
| Código muerto 404 | Abierto | Decidir el destino de `app/not-found.tsx`. |
| React Doctor y Fase 5 | Abiertos | Decisiones de dependencia y bundle, y certificación de WCAG, rendimiento, privacidad y paridad productiva. |

**Veredicto tras la pasada 57:** el harness de capturas dejó de ser una promesa y pasó a ser evidencia: cinco ejecuciones aisladas, manifest limpio y salida 0. Ejecutarlo encontró lo que cincuenta y seis pasadas de lectura de código no habían encontrado —un seed que abortaba, cuatro pantallas con fallo de hidratación, un editor que nunca se había capturado, una ruta inexistente contada como cobertura y tres vocabularios de estado en conflicto—. El bloqueo restante es de la misma naturaleza: la suite E2E sigue sin ejecutarse, y hasta que se ejecute la mayoría de las tareas conserva código completo sin certificación.

### Pasada 58 — La suite E2E ejecutada por primera vez, y por qué no lo estaba

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** ejecutar los 297 escenarios sobre `bodega_e2e_local`, el bloqueo declarado desde la pasada 1.

#### Hallazgo previo: la puerta E2E estaba verde en vacío

Al inventariar la suite antes de lanzarla, `npx playwright test --list` devolvió **"Total: 0 tests in 0 files"** con salida 0. La pasada 56 añadió `e2e/environment.test.ts` —una prueba de Vitest— dentro de `testDir: "./e2e"`, y `playwright.config.ts` no declaraba `testMatch`. Playwright intenta cargar ese archivo, muere importando Vitest desde CommonJS y **aborta la recolección completa terminando en verde**.

El paso "E2E full suite" de CI ejecuta exactamente `npx playwright test`. Es decir: desde la pasada 56 la suite completa no corría en ningún commit y CI lo reportaba como aprobado.

| Tarea | Estado de código | Cambio aplicado | Evidencia local |
|---|---|---|---|
| TASK-UI-001 / recolección E2E | Corregido | `testMatch: "**/*.spec.ts"` en `playwright.config.ts`. | La recolección pasa de **0 tests en 0 archivos** a **297 tests en 67 archivos**. |
| TASK-UI-001 / regresión | Implementado | `e2e/environment.test.ts` verifica que el filtro exista y que siga habiendo pruebas unitarias en `e2e/`, que es lo que hace necesaria la defensa. | La prueba falla si alguien retira `testMatch`. |
| TASK-UI-013 / origen de render PDF | Corregido | `.env` declara `PDF_RENDER_ORIGIN=http://127.0.0.1:3001` y esa variable gana sobre `APP_URL` en `resolvePdfRenderOrigin`. `e2e/start-server.sh` no la sobrescribía, así que cada render de PDF navegaba al puerto de desarrollo. Ahora se fija al puerto E2E. | En la corrida, cuatro pruebas de PDF fallaron con `ERR_CONNECTION_REFUSED at http://127.0.0.1:3001/...`. |

#### Resultado de la ejecución

**269 aprobados, 25 fallidos, 3 saltados, 20 minutos.** Salida 1. Clasificación de los 25:

| Grupo | Cantidad | Naturaleza |
|---|---|---|
| Render de PDF al puerto de desarrollo | 4 | Entorno del harness, corregido en esta pasada. Requiere re-ejecución para confirmar. |
| `ERR_CONNECTION_REFUSED` en `localhost:3100` | 4 | El servidor E2E estuvo caído durante una ventana de la corrida. Causa no determinada; sin log del proceso no puede atribuirse a la aplicación ni al runner. |
| Peticiones que resuelven a `::1:3001` | 2 | Mismo origen de contaminación de puerto, por vía distinta a la del PDF. Pendiente de aislar. |
| Timeout de 150 s | 5 | Cuatro caen sobre `/prevencion/capa` y flujos largos; se solapan con la ventana de caída del servidor, así que no son atribuibles todavía. |
| Aserciones de interfaz | 10 | Candidatos a defecto real: violación de axe en `/combustibles/analisis`, dashboard preventivo en terreno, comprobante de entrega, flujo OC por oficina, dos de PDTP con `strict mode violation` por texto duplicado, PPA público, flujo troncal de compra con `ENT-2026-0001` resuelto a tres elementos, y **un botón de 230×21 px en `/aprobaciones`**, muy por debajo del objetivo táctil de 44 px. |

#### Lo que falta después de la pasada 58

| Pendiente | Estado actual | Siguiente evidencia necesaria |
|---|---|---|
| TASK-UI-001, E2E | **Ejecutada por primera vez**; no verde | Re-ejecutar con `PDF_RENDER_ORIGIN` corregido y capturando el log del servidor, para separar los fallos de entorno de los defectos reales. |
| Estabilidad del servidor E2E | Abierto | Determinar por qué `localhost:3100` dejó de aceptar conexiones a mitad de corrida. Hasta saberlo, 9 de los 25 fallos no son interpretables. |
| Contaminación de puerto 3001 | Parcial | `PDF_RENDER_ORIGIN` cerrado; falta la vía que lleva `apiRequestContext` a `::1:3001` en `negative-flows` y `sst-pdf`. |
| TASK-UI-004 / TASK-UI-014 | Defecto confirmado | El botón de `/aprobaciones` mide 21 px de alto con zoom 200 %. Es el primer incumplimiento de objetivo táctil demostrado con evidencia ejecutable. |
| TASK-UI-016 | Primera evidencia real | Axe falla en `/combustibles/analisis`. El resto de la matriz sigue sin ejecutarse por completo. |
| Textos duplicados en PDTP y entregas | Abierto | `Base preventiva 2026` resuelve a dos elementos y `ENT-2026-0001` a tres: o la interfaz repite el mismo dato sin distinguirlo, o los selectores necesitan un ancla estable. Hay que decidir cuál antes de tocar nada. |
| El resto de la tabla de la pasada 57 | Sin cambios | Ver la pasada anterior. |

**Veredicto tras la pasada 58:** el bloqueo declarado durante cincuenta y siete pasadas no era operacional, era un defecto de configuración: la suite no corría y CI lo daba por bueno. Ejecutarla produjo 269 aprobados y 25 fallos, de los cuales al menos diez apuntan a la interfaz. El sistema no está peor de lo que se creía; simplemente, hasta hoy no había forma de saberlo.

### Pasada 59 — Los 25 fallos, uno por uno

**Fecha:** 2 de agosto de 2026.

**Objetivo de la pasada:** resolver los 25 fallos de la primera ejecución real de la suite, separando defecto de aplicación, contrato desactualizado y contaminación del entorno.

#### Corrección que reclasificó nueve fallos

La pasada 58 atribuyó ocho fallos a "el servidor E2E estuvo caído". **Era incorrecto.** El servidor nunca cayó: `.env` declara tres orígenes absolutos apuntando al puerto de desarrollo, y `AUTH_URL` gana sobre `NEXTAUTH_URL` en `lib/auth/auth.ts`. `e2e/start-server.sh` fijaba la segunda pero no la primera, de modo que **toda redirección a `/login` salía al puerto 3001**, que en E2E no existe. Playwright lo reporta como `ERR_CONNECTION_REFUSED` sobre la URL de origen, lo que se lee como caída del servidor. Mismo mecanismo con `PDF_RENDER_ORIGIN` y las pruebas de PDF.

#### Trabajo realizado

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| TASK-UI-001 / entorno E2E | Defecto del harness | `AUTH_URL` y `PDF_RENDER_ORIGIN` se fijan al origen E2E junto a `APP_URL` y `NEXTAUTH_URL`, con el porqué escrito en el script. Nueve fallos desaparecen y ninguno era de la aplicación. |
| Rendimiento / TASK-UI-015 | **Defecto de aplicación** | Ocho pantallas de Prevención tenían un `<Link>` de Next apuntando a su endpoint de exportación. Next prefetchea todo `<Link>` visible, así que **cada visita generaba un Excel en el servidor** y la petición nunca devolvía un payload RSC. `/prevencion/capa` carga en 568 ms; lo que colgaba eran cinco prefetch, uno de ellos la exportación. Ahora son `<a download>`, que Next no prefetchea. Con eso pasan las dos pruebas de CAPA que agotaban 150 s. |
| TASK-UI-016 / nombre accesible | **Defecto de aplicación** | `FilterSelect` sólo tenía nombre accesible si el llamador pasaba `ariaLabel`, y 20 de sus 26 usos no lo pasaban: axe reportaba `button-name` crítico en `/combustibles/analisis`. El disparador de Radix es un `<button role="combobox">`, así que envolverlo en `<label>` tampoco lo nombra. El placeholder pasa a ser el nombre por defecto. |
| TASK-UI-016 / anuncio duplicado | **Defecto de aplicación** | En `lg` el `PageHeader` queda `sr-only` pero sigue en el árbol de accesibilidad, y la barra superior repite título y descripción: el lector los anunciaba **dos veces en todo escritorio**. El eco visual pasa a `aria-hidden`. |
| TASK-UI-004 / TASK-UI-014 | **Defecto de aplicación** | El botón de colapso de `/aprobaciones` no tenía alto propio y medía 21 px. Adopta `min-h-11 sm:min-h-9`, la escala táctil del sistema. |
| TASK-UI-007 / editor PDTP | **Defecto de aplicación** | El editor restauraba la pestaña desde `sessionStorage` después del primer render: pintaba Actividades y saltaba a la guardada, desmontando el panel. Un clic hecho entre ambos renders se perdía junto con su diálogo. Los paneles ya no se montan hasta que la pestaña real está resuelta. |
| TASK-UI-012 | Microcopy | "Permisos activos" pasa a "Permisos de trabajo activos": en una sección que mezcla seis dominios, el nombre corto era ambiguo. |
| Contratos desactualizados | Pruebas | Siete selectores describían una interfaz anterior: los cuatro exportes de Reportes unificados en la pasada 32 (dos pruebas), "Importar XLSX" que hoy es "Importar Excel", el folio del comprobante que aparece en tres lugares por diseño, el `role="alert"` propio de Next, y dos duplicaciones responsive de la descripción de página. |
| PPA sin tipo de trabajo | Prueba obsoleta | La prueba enviaba el formulario con un campo obligatorio vacío. Desde la pasada 24 el formulario es progresivo y **eso ya no es alcanzable**: el paso valida antes de dejar avanzar. Se reescribe sobre el contrato actual — el paso retiene, nombra lo que falta y lleva el foco al control. |
| Contaminación entre pruebas | Pruebas | `tae-public-flow`, `trazabilidad-activos` y `repuestos-servicios-oc-flow` pasan en aislamiento y fallaban por estado dejado por otras. Los dos últimos se acotaron; el primero sigue dependiendo del orden. |

#### Verificación ejecutada

- Suite completa sobre `bodega_e2e_local`, tres ejecuciones: **269/25 → 283/11 → 287/7**.
- `npx tsc --noEmit` y `npx eslint`: **verdes** tras cada tanda de cambios.
- Sonda de red directa sobre `/prevencion/capa`: `load` en **568 ms**, `networkidle` nunca alcanzado, **cinco peticiones vivas a los 20 s**, entre ellas `/api/prevencion/capa/export?_rsc=`. Ésa fue la evidencia que identificó el prefetch.

#### Lo que falta después de la pasada 59

| Pendiente | Estado actual | Siguiente evidencia necesaria |
|---|---|---|
| `module-toggles` — reactivar módulo | Reproducible, sin diagnóstico | El `<label>` del interruptor se resuelve pero Playwright lo considera no visible. Falta determinar si un ancestro queda oculto tras el primer `reload` o si la prueba encuentra la sección equivocada. |
| `oc-flow` — estado "Recibida" | Reproducible, sin diagnóstico | Tras recibir el saldo en faena el detalle no muestra "Recibida". `lib/services/receiving.ts` deriva `received` cuando todo está en faena; falta comprobar si la transición ocurre y la insignia no lo refleja, o si la recepción no completa. |
| `tae-public-flow` | Depende del orden | Pasa en aislamiento. Requiere aislar el estado que le dejan las pruebas anteriores. |
| `purchase-flow` — cierre de sesión | Probablemente en cascada | Falló después de que la prueba anterior agotara su tiempo. Reevaluar con la corrección del menú de exportación aplicada. |
| Todo lo demás | Sin cambios | Ver la tabla de la pasada 57. |

**Veredicto tras la pasada 59:** de los 25 fallos, nueve eran contaminación del entorno de pruebas, siete contratos que la propia auditoría había cambiado a propósito, y **cinco defectos reales de la aplicación** —uno de ellos, la exportación disparada por prefetch, afectaba a ocho pantallas en producción y nadie lo había visto porque el capturador se tragaba el `networkidle` fallido con un `catch`—. El resto sigue abierto con diagnóstico parcial y está nombrado arriba.

### Pasada 60 — Cierre de los fallos E2E y el 404 que mentía

**Fecha:** 3 de agosto de 2026.

**Objetivo de la pasada:** cerrar los tres fallos E2E que quedaron abiertos en la pasada 59 y seguir con los pendientes de TASK-UI-002.

#### Trabajo realizado

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| TASK-UI-002 / 404 real | **Defecto de aplicación, más amplio de lo descrito** | La auditoría atribuía a Soporte un "404 con status 200". La sonda mostró que **cuatro familias de rutas** lo hacían, y la causa es general: toda ruta de detalle tiene `loading.tsx`, Next envía la cabecera de estado al empezar a transmitir el esqueleto y para cuando la página llega a su `notFound()` el `200 OK` ya viajó. Es comportamiento documentado de Next, no un defecto suyo. Se añade `lib/routing/require-record.ts` y **30 `layout.tsx`** que comprueban existencia por fuera de la frontera de Suspense: el estado HTTP vuelve a decir la verdad y el esqueleto se conserva. |
| TASK-UI-011 / nombres de módulo | **Defecto de aplicación** | `MODULE_LABELS` devolvía el nombre del **área** de navegación, así que `/admin/modulos` mostraba seis tarjetas "Adquisiciones", tres "Control operacional", tres "Bodega" y tres "Prevención". Lo único que las distinguía era el identificador técnico en inglés (`purchasing`, `receiving`, `traceability`) — la jerga que MICRO-001 pide retirar — y quien apagaba un módulo no podía saber cuál apagaba. Cada módulo tiene ahora su nombre propio. |
| TASK-UI-015 / descarga | **Defecto de aplicación** | El botón "Descargar" del diálogo de exportación estaba envuelto en `DialogClose`: el mismo clic que inicia la descarga desmontaba el `<a>` que la produce, así que el diálogo se cerraba y a veces no llegaba archivo. Se retira el cierre automático, lo que además permite exportar de nuevo con los mismos filtros. |
| TASK-UI-014 / pestañas | **Defecto de aplicación** | `components/ui/tabs.tsx` llamaba `scrollIntoView` sin comprobar que existiera. jsdom no lo implementa, así que **cualquier prueba de componente que montara pestañas reventaba al primer render**: cuatro pruebas unitarias estaban en rojo por esto. |
| EVID-003 / 404 muerto | Código muerto | Se elimina `app/not-found.tsx`: toda URL sin coincidencia resuelve al 404 con shell del grupo `(app)`, verificado con capturas idénticas byte a byte. |
| `oc-flow` | Contrato desactualizado | Recibir el saldo en faena **cierra la orden en la misma transacción** (`closeOrderTx` desde `rollupOrderReceiptStatus`): "Recibida" es transitorio y la interfaz nunca lo muestra, ni ofrece un cierre manual. La prueba esperaba ambos. |
| `tae-public-flow` | Aislamiento | Contaba filas de toda la tabla, así que cualquier otra spec que registrara una carga TAE lo rompía. Se acota a su propio punto de carga. |
| Formato de fecha | Contrato desactualizado | `evaluation-detail.test.tsx` esperaba `15/06/2026`; el contrato compartido usa guiones desde la pasada 29. |
| Descripción duplicada | Trampa recurrente | Tercer y cuarto test que tropiezan con la misma causa: en `lg` el `PageHeader` queda `sr-only` pero sigue en el DOM, y la barra superior repite el texto. Los selectores se acotan al bloque semántico. |

#### Verificación ejecutada

- Suite completa sobre `bodega_e2e_local`: **291 aprobados, 3 fallidos, 3 saltados** (venía de 287/7 y, antes, de 269/25).
- `npx tsc --noEmit` y `npx eslint`: **verdes**.
- `npx vitest run --config vitest.non-pglite.config.ts`: las cuatro pruebas que rompía `scrollIntoView` vuelven a pasar.
- Sonda HTTP autenticada sobre `/soporte`, `/solicitudes`, `/compras` y `/prevencion/capa` con identificadores inexistentes: **200 en las cuatro** antes del cambio. Ésa fue la evidencia que amplió el alcance del hallazgo.

#### Segunda tanda de la misma pasada

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| TASK-UI-015 / diálogo de exportación | **Defecto de aplicación** | Los cuatro diálogos de exportación se montaban **dentro** del `DropdownMenuContent` que los abre. Al cerrarse el menú, Radix desmonta su contenido y se lleva el diálogo con él: el enlace "Descargar" desaparecía bajo el cursor y la exportación no llegaba a iniciarse. `ExportDialog` acepta ahora modo controlado y los diálogos viven fuera del menú. La entrada única de la pasada 32 se conserva. |
| `module-toggles` | Corrección de la corrección | Se intentó `check()`/`uncheck()` en lugar del clic forzado, pero el interruptor es controlado por un server action con `router.refresh()`: Playwright espera un cambio de estado inmediato que nunca llega y falló **una prueba que antes pasaba**. Se vuelve al clic directo sobre el input, que es lo que ya usaba la primera prueba del archivo. |

#### Resultado de la pasada 60

- Suite completa: **292 aprobados, 2 fallidos, 3 saltados**. Progresión de la auditoría: **269/25 → 283/11 → 287/7 → 291/3 → 292/2**.
- `npx tsc --noEmit`, `npx eslint` y las pruebas unitarias afectadas: **verdes**.

#### Lo que falta después de la pasada 60

| Pendiente | Estado actual | Siguiente evidencia necesaria |
|---|---|---|
| `module-toggles` — reactivar módulo | Reproducible, diagnóstico parcial | El input `sr-only` del interruptor se resuelve pero Playwright lo declara no visible, **sólo** en la reactivación; la misma acción sobre el mismo control pasa al desactivar. Se descartó la ambigüedad del selector anclándolo al identificador único del módulo. Falta capturar el DOM en ese punto exacto para ver qué ancestro cambia cuando el módulo está apagado. |
| `purchase-flow` — cierre de sesión | Reproducible en aislamiento | Tras pulsar "Cerrar sesión" la página permanece en `/dashboard`. No se determinó si el server action de cierre no llega a ejecutarse o si la redirección se pierde. Es la única prueba con implicancia de seguridad que queda en rojo y merece prioridad. |
| TASK-UI-002, casos negativos restantes | Parcial | El 404 real está resuelto para las 30 rutas de detalle. Faltan los otros tres estados del contrato: eliminado, sin permiso y retorno contextual. |
| TASK-UI-005, 011, 012, 015 | Parcial | Ver la tabla de la pasada 57; TASK-UI-011 avanza con los nombres propios de módulo y TASK-UI-015 con la descarga y el diálogo. |
| TASK-UI-017 | No iniciado por decisión | Bloqueado hasta que exista matriz legal aprobada de exposición de RUT. |
| Certificación de 001, 003, 004, 006–010, 013, 014, 016 | Código completo | Falta ejecutar: navegación por rol, 320/768/1024, zoom 200 %, teclado, lector, offline, navegadores móviles y los 55 contratos de accesibilidad. |

**Veredicto tras la pasada 60:** la suite pasó de no ejecutarse nunca a 292 de 297, y el camino hasta ahí produjo nueve defectos reales de aplicación que ninguna lectura de código había encontrado en cincuenta y seis pasadas: exportaciones disparadas por prefetch, controles sin nombre accesible, encabezados anunciados dos veces, un objetivo táctil de 21 px, un editor que perdía clics, treinta rutas que respondían 200 a un recurso inexistente, seis tarjetas de administración con el mismo nombre, un diálogo que se desmontaba al descargar y un componente de pestañas que rompía toda prueba que lo montara. Quedan dos pruebas en rojo, ambas nombradas arriba con lo que se sabe y lo que falta averiguar.

### Pasada 61 — Cierre de sesión, carrera de layout y retorno contextual

**Fecha:** 3 de agosto de 2026.

**Objetivo de la pasada:** cerrar las dos pruebas que quedaron en rojo y completar los estados de TASK-UI-002 que faltaban.

#### Trabajo realizado

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| Cierre de sesión | **Defecto de aplicación** | `handleSignOut` hacía `await signOut({ redirect: false })` y sólo después navegaba a `/login`. Si esa llamada fallaba —red intermitente, CSRF caducado— la excepción se propagaba y **el usuario quedaba exactamente donde estaba: en una pantalla autenticada, tras haber pulsado "Cerrar sesión", sin ningún aviso de que no había salido**. La navegación pasa a `finally`, de modo que salir siempre lleva a `/login`. Estaba duplicado en la barra superior y en el perfil lateral; ahora vive una vez en `components/layout/use-sign-out.ts`. |
| `module-toggles` | Carrera de layout en la prueba | El interruptor es un `<input class="sr-only">` de 1×1 px. Tras `page.reload()` aún no tiene caja, y **`force: true` desactiva la auto-espera de Playwright**, así que el clic caía sobre un elemento sin geometría y fallaba con "Element is not visible". Una sonda con el DOM real lo confirmó: `isVisible` es `false` en `domcontentloaded` y `true` con la página asentada. Se restituye la espera explícita antes de cada clic forzado. |
| TASK-UI-002 / retorno contextual | **Mejora de aplicación** | `/forbidden` ofrecía sólo "Volver al panel" y "Ver mis solicitudes": a quien lo rechazaban al abrir un detalle le tocaba rehacer el camino desde el principio. Las **37 rutas de detalle** adjuntan ahora su sección de origen al redirigir, y la pantalla ofrece "Volver a «sección»" como acción principal. |
| Seguridad del retorno | Prevención | El origen llega por la URL, así que `safeInternalPath` acepta sólo rutas internas: descarta `//host`, esquemas absolutos, contrabarras y caracteres de control. Sin ese filtro la pantalla de error sería una redirección abierta. |
| TASK-UI-002 / sin permiso | Verificado, ya cumplía | Las 37 rutas de detalle redirigen a `/forbidden` de forma consistente, no rebotan en silencio al panel. No hizo falta cambio. |

#### Segunda tanda de la pasada 61 — el estado "eliminado"

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| TASK-UI-002 / eliminado | **Defecto de aplicación** | Borrar una orden de compra no borra la fila: le pone `deletedAt` y **le muta el código a `OC-2026-0090-DELETED-<id>`** para liberar la restricción UNIQUE. La ficha no comprobaba nada de eso, así que quien abría un enlace antiguo veía el detalle completo —con ese identificador mutado presidiendo el encabezado— como si el registro siguiera vivo. Ahora la ruta corta antes: muestra el código original, la fecha de eliminación, explica que se conserva sólo para auditoría y ofrece la vuelta a Órdenes de compra. |
| TASK-UI-002 / eliminado, resto | Verificado, ya cumplía | Los documentos SST resuelven su archivado con una pantalla propia y acción "Restaurar documento". Ninguna otra tabla de detalle tiene borrado lógico, de modo que para ellas "eliminado" e "inexistente" son el mismo caso y lo cubre el 404 real de la pasada 60. |

Con esto los cuatro estados que TASK-UI-002 exigía a las rutas de detalle quedan cubiertos: **inexistente** (404 real, pasada 60), **eliminado**, **sin permiso** (redirección consistente a `/forbidden`, verificada en las 37 rutas) y **retorno contextual**.

#### Tercera tanda de la pasada 61 — el glosario que faltaba

La pasada 59 dejó abierto el vocabulario del banco de trabajo ARCO con el argumento de que **no existía fuente para esos dominios** y que inventarla crearía sinónimos. Ese argumento era incorrecto: las restricciones `check` del esquema declaran el conjunto cerrado de valores admitidos para cada columna, y ésa es la fuente.

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| TASK-UI-012 / inventario ARCO | **Defecto de aplicación** | `privacy-right-execution-workbench.tsx` listaba los registros de la persona titular como `vigente · apto`, `ley_karin · en_investigacion`, `en_revision`. Quien atiende una solicitud legal decide sobre esos registros, así que la jerga ahí es especialmente cara. `lib/prevention/privacy-inventory.ts` traduce los seis catálogos —tipo y estado de registro de salud, aptitud, categoría y estado de caso reservado, estado de documento— con los valores exactos de `prevention_health_record_type_valid`, `prevention_health_status_valid`, `prevention_health_fitness_valid`, `prevention_reserved_case_category_valid`, `prevention_reserved_case_status_valid` y `sst_documents_status_valid`. |
| TASK-UI-012 / evidencia CAPA | **Defecto de aplicación** | El detalle de una CAPA mostraba `document · CAP-2026-001`. Se añaden las cuatro etiquetas de `prevention_capa_evidence_kind_valid`. |
| TASK-UI-012 / barrido | Verificado | Un barrido estático de enums renderizados dejó dos hallazgos reales (los de arriba). El resto eran falsos positivos: props de `StateBadge`, valores de `Select`, claves de React, o texto libre del usuario — `kind` de un recurso de emergencia es un campo abierto de 2 a 120 caracteres, no un enum. |

#### Verificación ejecutada en la pasada 61

- Suite completa sobre `bodega_e2e_local`. La ejecución con el cierre de sesión y la espera del interruptor corregidos dio **294 aprobados, 0 fallidos, 3 saltados y salida 0**: la primera vez que la suite queda íntegramente verde desde que se descubrió que no se ejecutaba.
- Ejecución posterior, ya con el retorno contextual y el estado "eliminado": **292 aprobados, 2 fallidos**, ambos intermitentes y descritos abajo.
- `npx tsc --noEmit` y `npx eslint`: **verdes**.
- `lib/routing/__tests__/return-path.test.ts` (**3 pruebas**), `lib/__tests__/page-permissions.test.ts` (**14**) y las pruebas de `components/layout` (**4**): verdes.

#### Lo que falta después de la pasada 61

| Pendiente | Estado actual | Siguiente evidencia necesaria |
|---|---|---|
| `purchase-flow` — cierre de sesión | **Intermitente, relevante para seguridad** | Pasa **4 de 4** en aislamiento y falla de vez en cuando en la suite completa. Con la navegación ya en `finally`, el rebote de `/login` a `/dashboard` demuestra que en esas corridas **la sesión del servidor sobrevivió al cierre**. Se descartó el limitador de tasa: no cubre el cierre de sesión. Falta instrumentar la respuesta de `/api/auth/signout` en una corrida completa para ver por qué la cookie no se invalida. |
| `oc-reconciliation` — quitar filtro | Intermitente | El chip "Quitar filtro de facturas pendientes" no siempre limpia la query dentro del tiempo de espera. Pasó en la corrida verde. Probable carrera de hidratación. |
| TASK-UI-012 / importación de combustible | Abierto, menor | `import-fuel-modal-done.tsx` imprime `• {c.type}: {c.name}` para las entidades creadas automáticamente. No se pudo enumerar el conjunto de valores desde el código sin recorrer todo el flujo de importación, y no se inventaron etiquetas. |
| TASK-UI-005, 011, 015 | Parcial | Sin cambios respecto de la pasada 57, salvo lo ya aplicado: nombres propios de módulo (011) y la descarga y el diálogo de exportación (015). |
| TASK-UI-017 | No iniciado por decisión | Bloqueado hasta que exista matriz legal aprobada de exposición de RUT. |
| Certificación de 001, 003, 004, 006–010, 013, 014, 016 | Código completo | Falta ejecutar: navegación por rol, 320/768/1024, zoom 200 %, teclado, lector, offline, navegadores móviles y los 55 contratos de accesibilidad. |
| Recaptura | **Desactualizada** | La evidencia visual certificada en la pasada 57 ya no refleja el sistema: cambiaron los nombres de módulo, el 404, la cabecera, `/forbidden`, el detalle de OC eliminada y varias pantallas de Prevención. Hay que volver a correr el capturador. |

**Veredicto tras la pasada 61:** los cuatro estados que TASK-UI-002 exigía a las rutas de detalle quedan cubiertos, y la suite alcanzó por primera vez el verde completo. El hallazgo con más peso de esta pasada no está en ninguna pantalla: `handleSignOut` esperaba a `signOut` sin protección, de modo que cualquier fallo de esa llamada dejaba al usuario en una pantalla autenticada convencido de haber salido. Queda abierto por qué, en la suite completa, esa llamada a veces no invalida la sesión.

### Pasada 62 — Los tres intermitentes

**Fecha:** 3 de agosto de 2026.

**Objetivo de la pasada:** cerrar los tres pendientes que la pasada 61 dejó abiertos: el cierre de sesión intermitente, la carrera del chip de conciliación y el residuo de TASK-UI-012.

#### Trabajo realizado

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| Cierre de sesión | **Defecto de aplicación** | La pasada 61 ya garantizó que se navega siempre a `/login`. Faltaba la otra mitad: `signOut({ redirect: false })` **puede resolver sin que la cookie llegue a invalidarse** —la sesión es un JWT en cookie—, y entonces `/login` reconoce la sesión viva y devuelve al panel: el usuario ve su cuenta abierta después de haber cerrado sesión. `useSignOut` confirma ahora contra el servidor con `getSession()` y reintenta una vez antes de salir. La garantía de salir siempre se conserva. |
| `oc-reconciliation` | **Defecto de aplicación** | El chip "Sólo sin factura" era un `<button>` cuyo `onClick` navega con `router.replace`. Antes de que el componente hidrate, **pulsarlo no hacía nada** y la lista seguía recortada sin que el usuario supiera por qué; eso es lo que la prueba capturaba de forma intermitente. Pasa a ser un `<Link>` con href real: funciona desde el primer pintado y se puede abrir con teclado o en otra pestaña, como cualquier enlace. |
| TASK-UI-012 / importación de combustible | Falso positivo, corregido en el documento | El pendiente registrado en la pasada 61 no existía. Los valores que imprime `import-fuel-modal-done.tsx` se generan en `app/api/combustibles/import/route.ts` y ya son palabras en español —`faena`, `vehículo`, `proveedor`—, no slugs. Sólo se les añade la mayúscula inicial por consistencia. |

#### Verificación ejecutada en la pasada 62

- Suite completa sobre `bodega_e2e_local`: **294 aprobados, 0 fallidos, 3 saltados, salida 0**. Segunda corrida íntegramente verde, ahora con los tres intermitentes cerrados.
- Corrida intermedia con el chip ya convertido en enlace pero la prueba aún buscando un `button`: sirvió para confirmar que el cambio de rol era real y no un falso arreglo.
- `npx tsc --noEmit`, `npx eslint` y las pruebas de `components/layout` (**4**): verdes.

#### Lo que falta después de la pasada 62

| Pendiente | Estado actual | Siguiente evidencia necesaria |
|---|---|---|
| Recaptura | **Desactualizada** | La evidencia visual certificada en la pasada 57 ya no refleja el sistema. Cambiaron nombres de módulo, el 404, la cabecera, `/forbidden`, el detalle de OC eliminada, el inventario ARCO, el chip de conciliación y varias pantallas de Prevención. Hay que volver a correr el capturador y revisar el manifest. |
| TASK-UI-005 | Implementación parcial | Navegación preventiva por rol: destinos alcanzables y prohibiciones efectivas en 1280/1920 y móvil. |
| TASK-UI-011 | Parcial | Salud de módulos y SMTP derivada del backend real; ejercicio autorizado de respaldo y restauración. Los nombres propios de módulo ya están. |
| TASK-UI-015 | Parcial | Tablas equivalentes de los gráficos, los cuatro XLSX y el bundle final. La descarga y el diálogo de exportación ya están. |
| TASK-UI-017 | No iniciado por decisión | Bloqueado hasta que exista matriz legal aprobada de exposición de RUT. |
| Certificación de 001, 003, 004, 006–010, 013, 014, 016 | Código completo | Falta ejecutar: navegación por rol, 320/768/1024, zoom 200 %, teclado, lector de pantalla, offline, Safari/Chrome móvil y los 55 contratos de la matriz de accesibilidad. |
| Consolidación en git | Abierto | ~270 archivos modificados sin commit, con otro proceso editando el mismo checkout. |

**Veredicto tras la pasada 62:** los tres intermitentes eran cosas distintas y sólo uno era ruido de prueba. El chip de conciliación no respondía antes de hidratar —un botón que necesita JavaScript para hacer lo que un enlace hace solo—, y el cierre de sesión podía resolver sin invalidar la cookie, devolviendo al usuario a su propia cuenta después de haber salido. El tercero, el residuo de TASK-UI-012, resultó no existir: los valores ya estaban en español y el pendiente registrado en la pasada 61 era mío, no del código. La suite queda verde y el bloqueo restante vuelve a ser de certificación, no de corrección.

### Pasada 63 — Navegación preventiva: canonicalización y prueba por rol

**Fecha:** 3 de agosto de 2026.

**Objetivo de la pasada:** cerrar TASK-UI-005, que la pasada 22 dejó como "implementación parcial" a falta de canonicalización completa y de evidencia de navegador por rol.

#### Trabajo realizado

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| TASK-UI-005 / rutas fantasma | Verificado y **protegido** | El criterio de aceptación pedía "sin rutas fantasma", pero nada lo comprobaba: el árbol se compone desde los manifiestos de módulo y nadie revisa a mano si el destino existe. `lib/__tests__/navigation-targets-exist.test.ts` enumera las rutas concretas del App Router y exige que **todo destino del panel tenga página propia**. Hoy no hay ninguna huérfana; la prueba impide que vuelva a haberla. |
| TASK-UI-005 / etiquetas indistinguibles | Verificado y **protegido** | La misma prueba exige que ninguna etiqueta se repita dentro de su área ni entre los hijos de un mismo destino: dos entradas con el mismo texto en el mismo grupo son justo lo que el criterio "ninguna opción indistinguible a 1280" prohíbe. |
| TASK-UI-005 / canonicalización | **Código muerto eliminado** | Tres superficies legadas de Documentación —`nuevo`, `revisiones`, `vencimientos`— tenían el redirect declarado **dos veces**: en `next.config.ts` y como `page.tsx`. El del config actúa en la capa de rutas, así que esas páginas no llegaban a ejecutarse nunca; sólo dejaban código muerto y tres rutas de más en el inventario. Se eliminan y la prueba de canonicalización pasa a exigir lo contrario: que el archivo no exista y que el redirect esté declarado en el config. |
| TASK-UI-005 / último enlace legado | Corregido | El KPI "Documentos por vencer" del dashboard era el único punto del código que seguía apuntando a `/prevencion/documentacion/vencimientos`, con un salto de redirección de por medio. Pasa al destino canónico. |
| TASK-UI-005 / evidencia por rol | Implementado | `e2e/navegacion-por-rol.spec.ts` cubre lo que la cobertura unitaria no puede: que una ruta profunda deje exactamente un `aria-current` visible y su área desplegada, que ninguna etiqueta del panel quede vacía o recortada, que un rol restringido no vea Usuarios ni Privacidad **y que tampoco pueda alcanzarlos escribiendo la URL**, y que a 390 px el panel siga siendo accesible desde su disparador. |

#### Hallazgo anotado, fuera del alcance de esta tarea

El KPI "Documentos por vencer" lleva a la lista de Documentación, que **no admite filtro por vencimiento**: `page.tsx` sólo acepta `q`, `folder` y `page`. El indicador señala una urgencia que su propio destino no sabe acotar. Es materia de TASK-UI-006, no de canonicalización.

#### Nota sobre la propia prueba de navegación

Las dos primeras versiones del E2E fallaron por supuestos míos sobre el DOM, no por defectos del panel. Se corrigieron sondeando el árbol real: los destinos se exponen como `role="link"` —23 con Prevención desplegada, sólo 3 desde el panel con las áreas plegadas—, el disparador móvil se llama **"Abrir menú"**, y el catálogo móvil vive en su propia hoja, no en el `<nav>` de escritorio. Las aserciones pasan a consultar por rol y a comprobar que el usuario alcanza sus destinos, sin afirmar qué contenedor los aloja.

#### Verificación ejecutada en la pasada 63

- `lib/__tests__/navigation-targets-exist.test.ts` (**2 pruebas**), `lib/__tests__/prevention-documentation-canonical.test.ts` (**2**) y `lib/__tests__/navigation.test.ts`: verdes.
- `e2e/navegacion-por-rol.spec.ts`: **4 escenarios verdes** — activo/ancestro, etiquetas, rol restringido con ruta escrita a mano, y 390 px.
- `npx tsc --noEmit` y `npx eslint`: verdes. Los errores que aparecían en `.next/types/validator.ts` eran del validador generado, que aún referenciaba las páginas eliminadas; desaparecen al reconstruir.
- Suite completa sobre `bodega_e2e_local`: **298 aprobados, 0 fallidos, 3 saltados, salida 0** — cuatro escenarios más que la pasada anterior, todos verdes.

#### Lo que falta después de la pasada 63

| Pendiente | Estado actual | Siguiente evidencia necesaria |
|---|---|---|
| TASK-UI-005 / lectura y tacto | Casi cerrada | Queda lo que ninguna aserción automática demuestra: recorrer el panel con lector de pantalla real y comprobar el tooltip del estado colapsado. El resto de sus criterios —sin rutas fantasma, sin etiquetas indistinguibles, activo y ancestro visibles, rol restringido sin destinos prohibidos, 390 px— ya está cubierto por prueba. |
| TASK-UI-006 / filtro de vencimientos | Abierto | El KPI "Documentos por vencer" lleva a una lista que no admite filtrar por vencimiento. El indicador señala una urgencia que su destino no sabe acotar. |
| TASK-UI-011 | Parcial | Salud de módulos y SMTP derivada del backend real; ejercicio autorizado de respaldo y restauración. |
| TASK-UI-015 | Parcial | Tablas equivalentes de los gráficos, los cuatro XLSX y el bundle final. |
| TASK-UI-017 | No iniciado por decisión | Bloqueado hasta que exista matriz legal aprobada de exposición de RUT. |
| Certificación de 001, 003, 004, 006–010, 013, 014, 016 | Código completo | Falta ejecutar: 320/768/1024, zoom 200 %, teclado, lector de pantalla, offline, Safari/Chrome móvil y los 55 contratos de la matriz de accesibilidad. |
| Consolidación en git | Abierto | ~270 archivos modificados sin commit, con otro proceso editando el mismo checkout. |

**Veredicto tras la pasada 63:** TASK-UI-005 pasa de "implementación parcial" a cubierta por prueba en todos sus criterios automatizables. Los dos hallazgos de la pasada son de canonicalización, no de diseño: tres rutas declaraban su redirección dos veces —una de ellas código muerto que nunca se ejecutaba— y un KPI del dashboard seguía apuntando a una superficie legada. Y las propias pruebas nuevas fallaron dos veces por supuestos sobre el DOM que sólo se corrigieron sondeando el árbol real, que es exactamente el modo en que esta auditoría viene encontrando lo que la lectura de código no ve.

### Pasada 64 — Densidad: el conteo que faltaba y un indicador que no llevaba a nada

**Fecha:** 3 de agosto de 2026.

**Objetivo de la pasada:** cerrar TASK-UI-006, cuya evidencia requerida —"conteo DOM automatizado"— nunca se había producido, y el hallazgo que la pasada 63 dejó anotado.

#### Trabajo realizado

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| TASK-UI-006 / conteo automatizado | **Evidencia que faltaba** | El tope de cuatro tiles y seis filtros sólo podía comprobarse a ojo, pantalla por pantalla, y cualquier KPI añadido después pasaba inadvertido. `e2e/densidad-kpi.spec.ts` cuenta sobre el DOM real en las nueve pantallas que la tarea nombra, y en el tablero lo hace **por sección de dominio**, que es como quedó definido en la pasada 44. `KpiCard` expone `data-kpi-card` como ancla estable. **Las once comprobaciones pasan: los topes se cumplen hoy en todas las pantallas.** |
| TASK-UI-006 / KPI que filtra | **Defecto de aplicación** | El indicador "Documentos por vencer" anunciaba una urgencia y llevaba a la lista completa: el usuario tenía que buscar a mano lo que la cifra ya había contado. `searchDocuments` **ya admitía** `expiresBefore`/`expiresAfter`; sólo faltaba que la pantalla los aceptara desde la URL. Se añade `?vence=7|30|vencidos` con los mismos rangos que calcula `getDashboardCounters`, de modo que el número del indicador y el de la lista no puedan discrepar. |
| TASK-UI-006 / filtro removible | **Defecto de aplicación** | La tira "Atención documental" era texto muerto: anunciaba cifras que no se podían seguir. Las que tienen filtro equivalente pasan a ser enlaces con href real —no botones, por la lección de la pasada 62—, y con el filtro activo aparece un chip que lo nombra junto a "Quitar filtro de vencimiento". |
| TASK-UI-006 / estado cero | **Defecto de aplicación** | CAPA distinguía "vacío por filtro" de "vacío sin datos" mirando el número de filas recibidas. Pero estado, fuente y faena se filtran **en el servidor**, así que esas filas ya llegaban recortadas: con un filtro server-side sin coincidencias la pantalla anunciaba "Aún no hay acciones CAPA" —negando datos que sí existen— y **no ofrecía ninguna salida**. La causa se decide ahora por los filtros activos, no por el resultado. |

#### Nota sobre las propias pruebas

Dos de las comprobaciones nuevas fallaron al escribirlas por supuestos míos: CAPA no filtra por `?q=` —su buscador vive en la cabecera— y su salida se llama "Ver todas", no "Limpiar". Corregirlas es lo que destapó el defecto del estado cero: la prueba bien escrita falló contra la aplicación, no contra sí misma.

#### Verificación ejecutada en la pasada 64

- `e2e/densidad-kpi.spec.ts`: **12 escenarios** — nueve pantallas de gestión, el tablero por sección, el estado cero de CAPA y el filtro removible de vencimientos.
- `app/(app)/prevencion/documentacion/expiry-filter.test.ts` (**4 pruebas**) y las cinco suites de Documentación (**23**): verdes.
- `npx tsc --noEmit` y `npx eslint`: verdes.
- Suite completa, tres ejecuciones: **309/1, 320/1 y 320/1** de 324 escenarios. El fallo **rota de spec en cada corrida** —`oc-reconciliation` en dos tests distintos, luego `ppa-flow`— y siempre pasa en aislamiento (12 de 12 en el caso medido). No es un defecto por cerrar sino una característica del entorno: 324 escenarios con dos workers en esta máquina hacen que alguna aserción exceda de vez en cuando el margen por defecto de 5 s de Playwright.

#### Hallazgo de rendimiento anotado

El fallo intermitente aparece siempre en una aserción que sigue a una navegación cliente y nunca dos veces en el mismo lugar. Se alinearon las de `oc-reconciliation` al margen de 10 s que ya usaba el resto de ese archivo, y la siguiente corrida falló en `ppa-flow`: eso descarta que sea un defecto de una pantalla concreta y apunta a **latencia bajo carga paralela**. Antes de seguir subiendo tiempos de espera conviene medir cuánto tarda un payload RSC con dos workers y decidir si la suite debe correr con uno; taparlo con timeouts más largos oculta justamente la señal de rendimiento que la Fase 5 necesita.

#### Lo que falta después de la pasada 64

| Pendiente | Estado actual | Siguiente evidencia necesaria |
|---|---|---|
| TASK-UI-006 / prueba de cinco segundos | Casi cerrada | Los topes de densidad están comprobados por conteo automatizado, el KPI filtra y el estado cero conduce a acción. Falta lo que ninguna aserción demuestra: la prueba de cinco segundos con personas y el before/after visual. |
| Latencia bajo carga paralela | Abierto | Medir el payload RSC con dos workers en las listas grandes y decidir si la suite corre con un worker o si el conjunto por defecto se recorta. Afecta a varias pantallas, no sólo a `/compras`. |
| TASK-UI-005 / lectura y tacto | Casi cerrada | Recorrido con lector de pantalla real y tooltip del estado colapsado. |
| TASK-UI-011 | Parcial | Salud de módulos y SMTP derivada del backend real; ejercicio autorizado de respaldo y restauración. |
| TASK-UI-015 | Parcial | Tablas equivalentes de los gráficos, los cuatro XLSX y el bundle final. |
| TASK-UI-017 | No iniciado por decisión | Bloqueado hasta que exista matriz legal aprobada de exposición de RUT. |
| Certificación de 001, 003, 004, 007–010, 013, 014, 016 | Código completo | Falta ejecutar: 320/768/1024, zoom 200 %, teclado, lector de pantalla, offline, Safari/Chrome móvil y los 55 contratos de la matriz de accesibilidad. |
| Consolidación en git | Abierto | ~280 archivos modificados sin commit, con otro proceso editando el mismo checkout. |

**Veredicto tras la pasada 64:** la evidencia que TASK-UI-006 exigía existía en el papel y no en el repositorio; producirla confirmó que los topes de densidad se cumplen, y de paso destapó tres defectos que ningún conteo habría encontrado: un indicador que anunciaba una urgencia sin poder acotarla, una tira de cifras que no se podían seguir, y una pantalla que negaba tener datos cuando sólo estaban fuera del filtro. Los tres compartían la misma raíz —el número se calculaba bien y el camino hacia él no existía—, que es la forma más discreta que tiene una interfaz de resultar inútil.

### Pasada 65 — El camino que faltaba: filtros, tablas equivalentes y anchos sin harness

**Fecha:** 3 de agosto de 2026.

**Objetivo de la pasada:** cerrar lo que quedaba de TASK-UI-011, 012 y 015, barrer el patrón que la pasada 64 dejó anotado, y resolver una categoría de pendiente que el inventario clasificaba mal: varias tareas figuraban como "falta ejecutar la prueba" cuando en realidad **no existía con qué ejecutarla**.

#### Hallazgo previo: "pendiente de certificar" no era lo mismo que "certificable"

El inventario listaba 320/768/1024 px, Safari y Chrome móvil como certificación ejecutable, es decir, código completo a la espera de una corrida. Al ir a ejecutarlo resultó que:

- `playwright.config.ts` declaraba **un solo proyecto, Desktop Chrome**. No había motor WebKit ni perfil móvil: la prueba no estaba pendiente, estaba imposibilitada.
- Los únicos anchos presentes en toda la carpeta `e2e/` eran 390, 960 y 1440. **320, 768 y 1024 no aparecían en ninguna aserción.**
- El criterio de TASK-UI-001 pedía añadir 320×568, 768 y 1366×768 "al gate selectivo" del capturador. `capture-all-routes.ts` seguía con `desktop` y `mobile` y nada más; ese sub-criterio nunca se implementó y había desaparecido de las tablas de seguimiento.

Es la misma lección de la pasada 58 con la puerta E2E verde en vacío, en otra forma: un pendiente mal clasificado se queda quieto porque nadie lo revisa.

#### Trabajo realizado

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| SAFE-ADMIN-001 / TASK-UI-011 | **Hallazgo nuevo, sin empezar** | El inventario daba `/admin/modulos` por "falta salud de módulos", pero el hallazgo original —cambios globales sin salvaguarda— seguía **entero**: el interruptor apagaba un módulo en un gesto, sin confirmación ni impacto. Ahora apagar exige confirmar, y la confirmación **nombra las pantallas que se ocultan** en vez de preguntar "¿estás seguro?". Encender no se confirma: no retira nada. |
| TASK-UI-011 / alcance honesto | **Defecto de veracidad** | La confirmación decía primero que la ruta quedaba bloqueada. **No es cierto**: el interruptor sólo afecta la navegación (`app/(app)/layout.tsx`), y quien tenga el enlace y el permiso sigue entrando. El texto lo dice ahora explícitamente, y la cabecera de la pantalla también. Prometer un control de acceso inexistente habría sido peor que el defecto original. |
| TASK-UI-011 / salud de módulos | Implementado con su límite declarado | `/api/health` medía base de datos, volumen y disco, y su único consumidor posible era el `HEALTHCHECK` de Docker: ninguna pantalla podía leerlo. La medición se extrae a `lib/services/platform-health.ts` y `/admin/modulos` antepone una banda con las tres señales. **No se inventó salud por módulo**: no existe sonda por módulo, y fabricar un verde es el error que la tarea vino a corregir. La banda dice en voz alta que los interruptores no miden salud. |
| TASK-UI-011 / última prueba SMTP | **Estado que no podía cambiar** | La pantalla decía "Configurado: prueba de envío pendiente" **para siempre**, aunque se hubiera enviado un correo con éxito un minuto antes: la prueba se registraba en la auditoría y nadie la leía. `getLastDeliveryTest` la recupera de `audit_log` —sin tabla nueva, la auditoría **es** el registro— y el estado pasa a "Entrega confirmada" o nombra la causa del fallo. |
| §3.3 / KPI sin filtro equivalente | **Barrido completo del patrón** | La pasada 64 corrigió tres casos y dejó anotado que faltaba barrer el resto. Son **seis más**, todos en las secciones por dominio del tablero: "Incidentes abiertos", "CAPA vencidas", "Riesgos críticos sin control", "Hallazgos críticos abiertos", "Simulacros por mejorar" y "Mediciones sobre el límite". Los seis destinos **ya sabían acotar** (`?quick=open`, `?vista=overdue`, `#bloqueos`, `?vista=critical`, `?tab=drills&vista=needs_improvement`, `?tab=groups&vista=above_limit`); lo que faltaba era que el indicador los usara. El caso más elocuente: el centro de control ya enlazaba a `/prevencion/incidentes?quick=open` mientras el KPI del mismo dato apuntaba a la lista completa. |
| TASK-UI-015 / tablas equivalentes | **La partida grande** | `ChartDataSummary` cumplía el criterio sólo en Combustibles y estaba atado a pesos y litros. Se generaliza en `components/ui/chart-data-table.tsx` —recibe filas ya formateadas, así que sirve a tasas, porcentajes y conteos— y se aplica a **las once superficies que no lo tenían**: analítica, tablero (nueve gráficos), PDTP, indicadores material/ambiental, TAE por grupo, anomalías, ciclo, dispersión, evolución por equipo, histograma y rendimiento por grupo. |
| TASK-UI-015 / color como único canal | **Defecto de accesibilidad** | Al escribir las tablas aparecieron los casos concretos que el criterio describía en abstracto: la confiabilidad del rendimiento se codificaba **sólo** en el ámbar de la barra; el donut de severidad no etiqueta las porciones bajo el 8 %; la evolución por equipo **oculta su leyenda** por encima de seis series, de modo que ocho líneas quedaban sin forma de identificarse; el histograma esconde etiquetas del eje con más de ocho tramos. Cada tabla lo dice en su pie. |
| TASK-UI-012 / enums en exportes | **Hallazgo nuevo** | `gasto_faena` y `oc_por_estado` escribían `o.status` **crudo** en el XLSX. Existía `ocStatusLabel` y otros dos exportes ya lo usaban. Un exporte es tan visible como una pantalla; la prueba unitaria que afirmaba `"sent"` estaba fijando el defecto. |
| TASK-UI-012 / inventario ARCO | **Cierre incompleto** | El inventario daba ARCO por cerrado. La fila de PPA seguía imprimiendo `aprobado_auto` y `en_correccion` en crudo, y **no estaba bloqueada por glosario**: `PPA_STATE_META` ya era la fuente de `StateBadge` en toda la aplicación. Se reutiliza, y el rótulo pasa de un UUID a la fecha de la declaración. |
| TASK-UI-005 / tooltip colapsado | **Clasificado como verificación, era código faltante** | El inventario lo listaba como "comprobar el tooltip". No había nada que comprobar: `Inicio`, `Soporte` y el botón de plegar sí lo tenían; los iconos de área del rail (`RailFlyout`) sólo tenían `aria-label`. El lector de pantalla los leía; quien navega con vista o con teclado no obtenía nada hasta abrir el panel. |
| TASK-UI-001 / gate selectivo | **Sub-criterio nunca implementado** | El capturador acepta ahora `small` (320×568), `tablet` (768×1024) y `laptop` (1366×768) por nombre. La corrida por defecto sigue siendo 1920 y 390: multiplicar el barrido completo por cinco anchos lo haría inviable, y el criterio pedía "gate **selectivo**", no barrido. |
| TASK-UI-004 y 014 / anchos | **Harness que no existía** | `e2e/reflow-anchos.spec.ts` comprueba ausencia de scroll horizontal en ocho pantallas densas a 320, 768 y 1024 px, y que a 320 px el contenido principal y el acceso a la navegación sigan alcanzables —el criterio explícito de TASK-UI-005—. |
| TASK-UI-008, 013, 016 / navegadores móviles | **Harness que no existía** | `playwright.config.ts` declara `mobile-safari` (WebKit, iPhone 13) y `mobile-chrome` (Pixel 7) sobre los siete flujos de terreno. Van tras `E2E_MOBILE_BROWSERS=1` porque Playwright no tiene proyectos opcionales y multiplicar la suite por tres motores agravaría §3.1; la suite por defecto no cambia de tamaño por esto. |
| TASK-UI-015 / los cuatro XLSX | **Evidencia que faltaba** | La suite comprobaba 200 en dos de los cuatro tipos y no abría ningún archivo. Ahora los cuatro se parsean con ExcelJS: hoja correcta, encabezados no vacíos, y una comprobación específica de que la columna Estado no contiene `snake_case`. |

#### Pruebas nuevas que dejan el contrato fijado

- `components/__tests__/chart-equivalent-reading.test.ts`: barrido estático sobre `git ls-files`. Todo archivo que importe de `recharts` debe ofrecer `ChartDataTable` o `ChartDataSummary`. Las excepciones son **nombradas y con motivo**, no un patrón silencioso, y una tercera prueba falla si una excepción deja de dibujar —para que la lista no acumule entradas muertas—. Un gráfico nuevo sin lectura equivalente ya no puede entrar sin que la suite lo diga.
- `e2e/densidad-kpi.spec.ts`: dos escenarios más. Uno recorre los seis KPI de subconjunto sobre el DOM real y compara su `href` con el destino acotado; el otro comprueba que esos destinos reconocen el filtro y ofrecen quitarlo.
- `e2e/module-toggles.spec.ts`: la confirmación es la única vía, cancelar deja el módulo encendido, y el diálogo no promete un control de acceso.
- `app/(app)/admin/modulos/platform-health-card.test.tsx`, `smtp-form.test.tsx` (dos escenarios nuevos), `privacy-right-execution-workbench.test.tsx` (uno).

#### Nota sobre las propias pruebas

Tres se escribieron mal antes de escribirse bien, y las tres enseñaron algo:

- El ancla de `module-toggles.spec.ts` era el **slug del módulo pintado en la interfaz**. Al retirarlo por jerga, la prueba se quedaba sin referencia: se sustituyó por `data-module-id`, que es lo que un ancla de prueba debía haber sido desde el principio.
- `KpiCard` envuelve la tarjeta en el enlace, no al revés. Buscar un `<a>` **dentro** de `[data-kpi-card]` no encuentra nada; hay que buscar el `<a>` que lo contiene.
- La prueba unitaria de exportes afirmaba `"sent"`. No estaba comprobando el comportamiento correcto: estaba **fijando el defecto**, que es la forma en que una suite verde protege un error.

#### Verificación ejecutada en la pasada 65

- `npx tsc --noEmit` y `npx eslint`: **verdes** (4 avisos preexistentes, 0 errores).
- `npm run test:fast`: **3324 pruebas**, 400+ archivos, verdes tras corregir la aserción que fijaba el enum crudo.
- `scripts/capture-all-routes.test.ts`: 13 pruebas verdes tras mover las definiciones de viewport por encima de `parseCliArgs` — la primera versión rompía por zona muerta temporal, y el propio test lo detectó.
- `npx playwright test --list`: **336 escenarios** en la suite por defecto (324 + 12 nuevos), y **50** en cada proyecto móvil cuando se activan.

#### La primera corrida en WebKit — y el hallazgo que produjo

Instalado el motor, la primera ejecución de `mobile-safari` dejó **12 fallos de 50**. Diagnosticarlos uno a uno separó dos cosas que no son lo mismo:

**Once eran suposiciones del arnés, no defectos de Safari.** `worker-delivery-flow` localiza con `getByRole("row")`, y a 390 px `ResponsiveDataList` renderiza tarjetas: no hay filas porque el contrato de TASK-UI-004 está funcionando. `delivery-print` buscaba el artefacto A4 sin fijar viewport, de modo que bajo un proyecto móvil lo pedía en la vista que TASK-UI-013 lo oculta a propósito. Y `ppa-offline` prueba fontanería de Service Worker y permisos de notificación con `context.grantPermissions(["notifications"])` y `Object.defineProperty(Notification, …)`, que WebKit no expone.

`delivery-print` se corrigió fijando su ancho —la prueba sí quería el A4—. Las otras dos suites salieron del alcance móvil **con su motivo escrito en la configuración**, no con un `skip` mudo: certificar entregas en móvil exige reescribir sus aserciones contra el contrato de tarjeta, y eso es trabajo, no una casilla.

**El duodécimo es real y queda abierto.** `tae-public-flow`, el escenario que encola una carga sin red, falla en Safari: tras `setOffline(true)` y enviar, el indicador "1 pendiente" **nunca aparece**. En Chromium pasa siempre. `lib/pwa/tae-offline-queue.ts` guarda las evidencias como `Blob` dentro de IndexedDB, que es precisamente donde WebKit ha tenido históricamente un comportamiento distinto.

No se propone un arreglo aquí porque no está diagnosticada la causa: puede ser el `Blob` en IndexedDB, el ciclo de vida del Service Worker en WebKit o el propio `setOffline`. Lo que sí se puede afirmar es que **el flujo TAE offline nunca se había ejecutado en un motor que no fuera Chromium**, que es el navegador de la mitad de los teléfonos en terreno, y que ahí no funciona. Es el hallazgo más caro de la pasada y el que justifica por sí solo haber construido el arnés.

**Resultado final del proyecto móvil:** 17 de 18 escenarios verdes en `mobile-safari`; el fallo restante es el descrito.

#### Resultado de la pasada 65

- Suite E2E completa: **333 aprobados, 3 saltados, 0 fallos** de 336, en 15,1 minutos. El fallo intermitente de §4.1 no apareció en esta corrida; eso no lo cierra, sólo confirma que es intermitente.
- Los 30 escenarios de las cuatro specs nuevas o modificadas, ejecutados en aislamiento: **30 de 30**.
- Reflow a 320, 768 y 1024 px sobre ocho pantallas densas: **cero desbordamiento** en los tres anchos, tanto en Chromium como en WebKit.

**Veredicto tras la pasada 65:** la corrección más útil de esta pasada no fue de código sino de clasificación. Tres pendientes llevaban pasadas esperando "una corrida" que nadie podía hacer porque el harness no existía, y dos se daban por cerrados con el defecto todavía dentro. Construir lo que faltaba —cinco anchos en el capturador, tres en el E2E, dos motores móviles— confirmó lo que esta auditoría viene repitiendo desde la pasada 57: ejecutar por primera vez siempre encuentra algo. Esta vez encontró que el TAE offline, el flujo más de terreno que tiene el producto, no funciona en Safari.

### Pasada 66 — Tres diagnósticos equivocados, y por qué importa contarlos

**Fecha:** 4 de agosto de 2026.

**Objetivo de la pasada:** cerrar los pendientes que la 65 dejó — el TAE offline en Safari, la latencia bajo carga paralela, los duplicados del manifest, entregas en móvil, la matriz de estados, pluralización, snapshots de formato, barrido de vocabulario y bundle.

#### El hallazgo que no era

La pasada 65 cerró afirmando que **el TAE offline no funciona en Safari** y lo puso como el pendiente más caro del inventario: un flujo de terreno roto en la mitad de los teléfonos. Era falso, y conviene decir cómo se llegó ahí.

El escenario fallaba de verdad en `mobile-safari`. La hipótesis —`Blob` dentro de IndexedDB, donde WebKit tiene fama de comportarse distinto— era plausible y encajaba con el síntoma. Bastó instrumentarla para verla caer en tres pasos:

1. `navigator.onLine` **sí** cambia con `setOffline`: la detección de red no es el problema.
2. `indexedDB.open` funciona; lo que aborta es escribir el `Blob`. La hipótesis parecía confirmada.
3. Un `Blob` **en memoria, sin IndexedDB de por medio**, tampoco se puede releer: `await new Blob(["hola"]).text()` lanza `NotReadableError: The I/O read operation failed`.

Con el tercer paso la hipótesis se cae entera. No es IndexedDB, no es el Service Worker y no es Safari: es que en el binario de WebKit que Playwright instala aquí, **`context.setOffline(true)` deja los `Blob` ilegibles**. Ninguna aplicación que adjunte fotos puede funcionar bajo esa condición, y el resultado no dice nada sobre un iPhone real. Lo confirma `mobile-chrome`, ejecutado por primera vez en esta pasada: **18 de 18, incluido el escenario offline del TAE**.

El escenario queda con un `test.skip` condicional —`blobStorageWorks`— que se evalúa en tiempo de ejecución y no en una lista: el día que el binario se arregle, vuelve solo.

**Lo que esto enseña no es que WebKit sea raro.** Es que la pasada 65 publicó una hipótesis como conclusión. El síntoma era real, la explicación no estaba comprobada, y la diferencia entre las dos habría costado que alguien pasara un día buscando un fallo inexistente en el flujo más crítico del producto.

#### Y dos más de la misma familia

| Diagnóstico publicado | Lo que era |
|---|---|
| "El banner offline no desaparece al recuperar red" | La aserción usaba `getByText(/Sin conexión/i)` y coincidía con el copy estático de la portada del PPA: *"Funciona sin conexión a internet"*. El banner sí desaparece. **Se llegó a modificar `useOnlineStatus` sobre esa premisa; el cambio se revirtió**, porque el defecto no existía. |
| "Entregas falla en móvil" (pasada 65) | Las aserciones usaban `getByRole("row")` y a 390 px `DataTable` muestra tarjetas: el contrato de TASK-UI-004 funcionando. Con `listRecord`, que resuelve en ambas representaciones, **4 de 4 en Safari**. |

Tres veces en dos pasadas, el mismo patrón: una prueba roja se leyó como aplicación rota. La regla que queda escrita en `blobStorageWorks` y en `listRecord` es la contraria — **antes de acusar a la aplicación, comprobar que la prueba puede medirla**.

#### Trabajo realizado

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| §4.1 / latencia | **Medición que faltaba** | El fallo intermitente llevaba pasadas descrito como hipótesis. `e2e/rsc-payload.spec.ts` lo convierte en cifras: las cinco listas grandes van de **136 a 326 ms** y de **94 a 481 KB**. A un orden de magnitud del margen de 5 s de Playwright, así que **el payload no es la causa**. La primera versión de la medición estaba mal —capturaba cualquier respuesta cuya URL contuviera la ruta y devolvía 1,4 KB para todas—; se rehízo con Navigation Timing. Lo único que llama la atención es "Mis pendientes" con 481 KB, cuatro veces el resto. |
| §4.1 / decisión | **Evidencia para decidir** | Suite completa con un worker: **334 verdes, 0 fallos, 25,6 min**. Con dos: 15,1 min y un fallo intermitente ocasional. El costo del determinismo es **+69 % de tiempo**. Se conserva `workers: 2` —CI ya tiene `retries: 1`, que lo absorbe— y queda documentado `--workers=1` para cuando haga falta una corrida determinista. |
| §4.1 / causa | **Diagnóstico acotado** | Correr tres proyectos a la vez sobre la misma base degradó los mismos escenarios de 6 s a 2,6 min. La contención es de **base de datos y servidor compartidos**, no de tamaño de árbol. |
| §4.4 / duplicados | **Defecto de integridad** | Los cuatro duplicados venían de dos causas, no de una. La del barrido select/dropdown ya estaba corregida. La otra: el detector de "modal abierto" incluía `[data-state="open"]` y `[data-radix-portal]`, que coinciden con cosas **ya abiertas** —un acordeón, cualquier contenedor de portal—, así que `waitForSelector` resolvía al instante y se guardaba la página sin modal como evidencia de un modal. Ahora la condición es un aumento real de diálogos **visibles**. |
| §4.4 / regla del gate | **Regla afinada, y casi mal** | Dos rutas pueden compartir un diálogo a pantalla completa y rendir el mismo hash sin que nada esté roto. La primera versión de la excepción absorbía cualquier duplicado entre rutas distintas — y una corrida contra un build a medias produjo **90 pantallas de error idénticas** que habría dado por buenas. La excepción quedó estrecha: sólo capturas de interacción, nunca rutas base. |
| §4.3 / entregas móvil | **Aserciones reescritas** | `listRecord` localiza un registro sea fila o tarjeta. `worker-delivery-flow` vuelve al alcance móvil: 4 de 4 en Safari. |
| TASK-UI-016 | **Matriz de estados** | `e2e/matriz-estados.spec.ts` cubre las seis celdas que faltaban sobre flujos P1: carga, error recuperable con causa y control reutilizable, sin permiso, sesión expirada conservando destino, doble envío con `aria-busy`, y offline anunciado y retirado. |
| TASK-UI-012 / pluralización | **Defecto propio** | `pluralize` devuelve **sólo la palabra**, y varias llamadas —incluidas tres escritas en la pasada 65— asumían que traía el número: "Se ocultarán pantallas", "12 tramos con observaciones". Un texto gramaticalmente correcto al que le falta el dato no lo delata ningún tipo. Se añade `countOf`. |
| TASK-UI-012 / snapshots | **Evidencia que faltaba** | `lib/__tests__/format-snapshots.test.ts` congela la salida literal de fecha, hora, moneda, cantidad, tamaño y plural, más la coincidencia entre las dos fuentes de formato que el inventario señalaba como duplicadas. Anotó una rareza real sin cambiarla: `es-CL` escribe **`$-4.500`**, con el signo dentro. |
| TASK-UI-012 / barrido | **La búsqueda que el criterio pedía** | `lib/__tests__/vocabulario-visible.test.ts` busca `snake_case` en posición de texto visible sobre todos los `.tsx`. Lleva **control positivo**: reproduce los tres defectos que las pasadas manuales encontraron y comprueba que el detector los habría visto — un barrido que no encuentra nada no distingue "limpio" de "roto". |
| TASK-UI-015 / 0-1-muchos | **Fixtures que el criterio pedía** | `components/__tests__/chart-data-table.test.tsx` cubre las tres ramas más el contrato de teclado (`<summary>`, no un `div` con `onClick`). |
| TASK-UI-015 / bundle | **Medición que faltaba** | 160 rutas, peor caso `/combustibles/facturas` **2,41 MB**, mediana **1,37 MB**, presupuesto 3 MB. Las once tablas equivalentes de la pasada 65 **no lo movieron**: son HTML sin dependencias. |
| TASK-UI-003 | **E2E que faltaba** | Las pruebas existentes empezaban en `/solicitudes/nueva` y elegían el tipo a mano, así que no podían ver FORM-CORE-001. Ahora se entra por `/repuestos/nueva` y `/servicios/nueva` en dos viewports, y se comprueba que la redirección conserva la intención y que el selector no cae a EPP. |

#### Verificación ejecutada en la pasada 66

- `npx tsc --noEmit` y `npx eslint`: verdes.
- Suite con **un worker**: 334 aprobados, 3 saltados, **0 fallos**, 25,6 min.
- `mobile-safari`: 17 de 18 con el TAE saltado por entorno; `worker-delivery-flow` 4 de 4.
- `mobile-chrome`, **primera ejecución**: 18 de 18.
- `rsc-payload`, `matriz-estados`, `format-snapshots`, `vocabulario-visible`, `chart-data-table`: verdes.

#### Resultado de la pasada 66

- Suite E2E completa, dos workers: **345 aprobados, 4 saltados, 0 fallos**, 15,3 min. El fallo intermitente **no apareció** en las dos últimas corridas completas.
- Captura completa: **163/163**, sin errores de cliente, sin scroll horizontal, sin URL inválida, huérfano ni referencia duplicada.
- El duplicado del manifest cambió de causa dos veces al arreglarse: barrido doble → detector de modal contra un acordeón → animación sin terminar. Los tres cerrados. **Queda uno de naturaleza distinta**: la pestaña "Avance" del detalle de OC está declarada a la vez como ruta propia y como pestaña, así que se fotografía dos veces. `isDeclaredElsewhere` no lo ve porque esa pestaña no cambia la URL. El arreglo correcto —comparar hashes al reconciliar— queda anotado, sin implementar.

**Veredicto tras la pasada 66:** lo más valioso de esta pasada no fue lo que se construyó sino lo que se retiró: un hallazgo publicado como el pendiente más caro del proyecto que no existía, y dos más de la misma familia. Las tres veces el síntoma era real y la explicación no estaba comprobada, y las tres veces bastó instrumentar para verlo. Queda escrito en el código —`blobStorageWorks`, `listRecord`— porque un documento se lee una vez y una prueba se ejecuta siempre. Lo demás fueron cifras donde antes había hipótesis: 136–326 ms de payload, 2,41 MB de bundle, 25,6 min contra 15,3 min por dos workers. Ninguna de esas tres cosas se podía discutir antes de medirlas.

### Pasada 67 — Los formateadores mentían, y nadie lo había mirado

**Fecha:** 4 de agosto de 2026.

**Objetivo de la pasada:** cerrar lo que la 66 dejó abierto y ejecutable — el duplicado del manifest, `ppa-offline` en WebKit, los 481 KB de Mis pendientes, los estados de valor de TASK-UI-012, el estado *dirty* y la extensión de la matriz, teclado y foco en los anchos nuevos, los E2E de PDTP y de roles, y las solicitudes históricas mal tipadas.

#### El hallazgo de la pasada: tres formas de mentir con un dato

TASK-UI-012 declaraba cuatro estados de valor —ausente, desconocido, legacy y zona horaria— y **nadie los había diseñado**, así que cada formateador improvisaba el suyo. Sondearlos con seis entradas sucias bastó:

| Llamada | Devolvía |
|---|---|
| `formatDate("basura")` | **Lanzaba** `Invalid time value`. En un Server Component, un solo campo sucio se lleva la página entera al `error.tsx`. |
| `formatDate(null)` | **`31-12-1969`** — la época presentada como una fecha real. |
| `formatQty(NaN)`, `formatCLP(NaN)`, `formatFileSize(NaN)` | `"NaN"`, `"$NaN"`, `"NaN MB"`: jerga de implementación en pantalla, que es MICRO-001 otra vez. |

El segundo es el peor de los tres. Un error visible se reporta; una fecha de 1969 en un informe de vencimientos **es verosímil**, y nadie la cuestiona hasta que alguien decide sobre ella. Es exactamente el mismo patrón que el "verde ficticio" de los respaldos y el `data-state="open"` del capturador: el sistema prefiere responder algo antes que admitir que no sabe.

El contrato es ahora uno solo, `VALUE_MISSING`: un valor que no se puede representar se dice, no se inventa ni tumba la pantalla. Ausente y corrupto se ven igual a propósito — la diferencia le importa a quien depura, no a quien opera.

Ninguno de estos casos aparece en un entorno sembrado, que es por qué sobrevivieron a sesenta y seis pasadas.

#### Trabajo realizado

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| §4.2 / duplicado del manifest | **Cerrado por comparación exacta** | Cambió de causa tres veces al arreglarse; la última era la pestaña "Avance" declarada a la vez como ruta y como pestaña. Cualquier heurística por nombre o URL falla en algún caso, así que la comparación se hace donde la respuesta es exacta: **el hash del PNG**. Si una interacción produce el mismo byte que una ruta ya capturada, se borra su archivo. Sólo se poda la interacción; dos vistas idénticas siguen rompiendo el gate. |
| §4.3 / `ppa-offline` en WebKit | **Separación, no exclusión** | Los escenarios de formulario —verificación de RUT y progresión por pasos— sí pasaban en Safari y quedaban fuera **sólo por compartir archivo** con los de Service Worker. Viven ahora en `ppa-formulario.spec.ts` y entran al alcance móvil: **5 de 5 en WebKit**. Lo que queda sin certificar es exactamente lo que el motor no puede ejecutar, ni un escenario más. |
| §4.1 / los 481 KB | **Explicado, no recortado** | La cola sirve **50 registros** por página mientras Compras y Solicitudes sirven 25, y cada elemento arrastra más campos. No es una fuga: es el doble de filas más ricas. A 277 ms no se recorta —bajar el tamaño de página cambia cuántas tareas ve un usuario antes de paginar, que es decisión de producto—. El presupuesto avisará si deja de ser proporcionado. |
| TASK-UI-012 / estados de valor | **Defectos reales** | Los tres de arriba, más `formatFileSize` y `formatDateSafe` alineados al mismo contrato. Seis pruebas nuevas, incluida la de zona horaria: una marca UTC de madrugada debe mostrarse con el **día chileno**, que es el riesgo real de un proceso corriendo en UTC. |
| TASK-UI-016 / estado *dirty* | **Celda que faltaba** | El editor PDTP anuncia "Cambios sin guardar" y vuelve a "Guardado" cuando el autoguardado cierra el ciclo. Se comprueba el **rótulo visible**, no el `beforeunload`: el editor autoguarda tras una pausa, así que una aserción sobre el evento corre contra ese temporizador. |
| TASK-UI-004 y 014 / teclado | **Certificación que faltaba** | Recorrido de 25 tabulaciones en 320, 768 y 1024 px comprobando que ningún elemento enfocado quede sin área, oculto o fuera de la ventana. Verde en los tres anchos. |
| TASK-UI-009 | **E2E que faltaba** | El visor de actividades acepta ocho parámetros de URL y nada comprobaba que sobrevivieran a salir y volver. Tres escenarios: los ocho se conservan tras `goBack`, el enlace profundo abre acotado y sin "No calculable", y un programa inexistente ofrece salida. |
| TASK-UI-010 | **E2E que faltaba** | Cinco escenarios: excepciones colapsadas y en cero, **cero claves de permiso visibles en el flujo estándar** —comprobado con una expresión sobre el texto del diálogo—, la región anunciada al desplegarlas, el POST sin sesión rechazado y un usuario legítimo sin administración que no alcanza la pantalla. |
| TASK-UI-003 / datos históricos | **Diagnóstico, no migración** | `scripts/check-mistyped-requests.ts` busca solicitudes tipadas `epp` u `otro` que lleven atributos que **sólo** el editor de repuestos y servicios sabe escribir. **No escribe una fila**: reclasificar cambia el flujo de aprobación —los tipos con cotización exigen tres cotizaciones o justificación—, así que produce la lista y distingue las que ya salieron de borrador, que son las caras. |

#### Nota sobre las propias pruebas

Cinco fallaron antes de pasar, y ninguna por culpa de la aplicación:

- El E2E de roles daba por buena una barrera que no comprobó: `page.request.post` **sigue redirecciones** por defecto, así que el 302 a `/login` llegaba como el 200 de la página de inicio de sesión. Sin `maxRedirects: 0`, la aserción sobre el estado es decorativa.
- Ese mismo archivo usaba `comprador@e2e.chome.cl` como "usuario sin administración". La semilla le asigna `rol-admin`: el nombre engañaba y el falso verde estaba servido.
- La prueba de *dirty* buscaba el campo en la pestaña equivocada, luego dentro de un `<details>` colapsado, y después chocaba con que el rótulo se pinta **dos veces a propósito** —uno `sr-only` con `aria-live` y otro visible—. Se resolvió con `data-autosave-status`, igual que `data-kpi-card` y `data-module-id` antes.

#### Nota sobre el entorno

A mitad de la pasada apareció un error de tipos en `lib/services/dte-portal/`, un directorio **sin seguimiento en git y creado minutos antes**: otro proceso editando este mismo checkout, que es el riesgo que el inventario lleva pasadas señalando. No se tocó.

#### Resultado de la pasada 67

- Suite E2E completa: **356 aprobados, 4 saltados**, 16,1 min. Un fallo, `ppa-flow:208`, que **pasa en aislamiento** (10,3 s) y es uno de los dos escenarios que §4.1 tiene identificados como intermitentes por contención.
- Pruebas unitarias: **3399 aprobadas**, 408 archivos.
- Captura completa: **163/163**, sin errores de cliente, sin scroll horizontal, y por primera vez **«Integridad de capturas: sin URL inválida, huérfano, referencia o hash duplicado ✓»**. El gate de capturas cierra en verde.
- `npx tsc --noEmit` y `npx eslint`: verdes salvo el error de tipos de `lib/services/dte-portal/`, que es de otro proceso.

#### Lo que pasó con el árbol de trabajo

Durante la pasada, **otro proceso commiteó el checkout entero**: `9163aaf feat(dte)` (31 archivos) y `2337b97 docs(audit)` (**349 archivos, 17.775 inserciones**). El riesgo que el inventario venía señalando —diez pasadas viviendo sólo en el árbol— desapareció, pero no de forma limpia: el trabajo de las pasadas 65 a 67 quedó absorbido en un commit rotulado `docs(audit)` que en realidad contiene cientos de archivos de código.

No se deshizo nada: rehacer esa historia con otro proceso escribiendo sobre el mismo checkout es más peligroso que el rótulo equivocado. Queda anotado porque un `git log` de este repositorio ya no cuenta lo que pasó.

**Veredicto tras la pasada 67:** el hallazgo de la pasada no está en ninguna pantalla sino en cuatro funciones que todo el producto usa. `formatDate(null)` devolvía `31-12-1969` —la época presentada como una fecha real— y `formatDate("basura")` tumbaba la página entera. Ninguno de los dos aparece jamás en un entorno sembrado, que es por qué sobrevivieron a sesenta y seis pasadas de auditoría, capturas y pruebas. Es la misma familia que el verde ficticio de los respaldos y el `data-state="open"` del capturador: el sistema prefiere responder algo antes que admitir que no sabe. Y como en las dos veces anteriores, lo que lo destapó no fue leer el código sino ejecutarlo con datos que nadie había pensado en darle.

### Pasada 68 — Medir antes de barrer, y el rol al que nadie le había preguntado

**Fecha:** 4 de agosto de 2026.

**Objetivo de la pasada:** las cuatro cosas que quedaban accionables sin acceso a producción ni a dispositivos físicos — el barrido de tooltips, la prueba por rol del KPI de horas-hombre, la extensión de la matriz de estados a OC/recepción/incidentes, y la recaptura en los tres anchos del gate selectivo.

#### El barrido que no había que hacer

El inventario decía "444 atributos `title=`" y proponía migrarlos al componente `Tooltip`. Medirlos antes de tocarlos ahorró una migración masiva e inútil:

| De los 444 `title=` | Cuántos | Qué son |
|---|---|---|
| Props de componentes React (`<Dialog title=…>`) | **340** | No producen tooltip alguno. El recuento estaba inflado por confundir una prop con un atributo HTML. |
| Atributos HTML que **repiten el contenido visible** | **58** | Ayuda de truncado. El dato está en el DOM y un lector de pantalla lo lee entero; migrarlos a `Tooltip` habría añadido 58 paradas de tabulación sin ganar información. |
| Atributos HTML donde el `title` era la **única** fuente | **3** | Los defectos reales. |

Los tres corregidos:

- **`backup-list.tsx`** — la causa de un respaldo fallido vivía sólo en el `title` de un icono de advertencia. Es el diagnóstico que un administrador viene a buscar justamente cuando algo falló, y era inalcanzable con teclado y en un teléfono. Pasa a `Tooltip` sobre un `button` con nombre propio.
- **`program-lifecycle-controls.tsx`** — la sigla expandida de cada paso del ciclo PDTP sólo aparecía al pasar el ratón. MICRO-001 pide *expandir siglas*, y hacerlo por hover deja fuera exactamente a quien más lo necesita.
- **`bitacora-table.tsx`** — un botón que sólo muestra un icono, cuyo único nombre accesible era su `title`: el último recurso de la cadena de nombres y el peor soportado. Ahora `aria-label` + `aria-pressed`, que además comunica si la marca está puesta.

`components/__tests__/tooltip-por-foco.test.ts` fija la línea con **control positivo sobre el detector real**, no sobre una imitación: se le dan los dos casos que existían antes de la corrección y se comprueba que los ve, y tres casos legítimos para que no acuse de más.

**La conclusión útil no es que había tres defectos, es que había 441 falsos positivos.** Un inventario que dice "444 sitios" y una medición que dice "3" llevan a decisiones opuestas.

#### El rol al que nadie le había preguntado

DATA-IND-001 —las tasas que aparecían como «—» sin decir qué faltaba— estaba corregido y probado **sólo con un administrador**, que es el caso fácil: quien puede arreglarlo. La pregunta sin responder era la del otro lado: alguien que consulta indicadores sin permiso para registrar horas-hombre ve el mismo guion, y si la explicación estuviera detrás del permiso de edición, para ese rol el defecto original seguiría intacto.

No se podía responder con los usuarios sembrados: los tres existentes eran dos administradores y un solicitante de faena que ni siquiera alcanza la pantalla. Se siembra `prevencion.lectura@e2e.chome.cl` **con alcance a una faena** — sin él la prueba se saltaba sin comprobar nada, que es peor que fallar.

**El resultado es bueno:** la causa es información y no está tras el permiso. El rol de lectura ve la banda completa —qué falta, cuánto falta y por qué el mes no puede cerrarse— y no se le ofrece un botón que el servidor le rechazaría.

Y apareció un matiz que la prueba obligó a mirar: con el alcance en "Total" tampoco hay botón para el administrador, porque los denominadores se cargan por faena. En su lugar dice *"Selecciona una faena para cargarlos"*. Es la diferencia entre "no hay acción" y "la acción necesita un paso previo", y estaba bien resuelto sin que nadie lo hubiera comprobado.

#### Trabajo realizado

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| TASK-UI-012 / tooltips | **Tres defectos, 441 falsos positivos** | Descrito arriba. Más el test estático con control positivo. |
| TASK-UI-009 / KPI de HH por rol | **Certificación que faltaba** | Tres escenarios y un rol nuevo en la semilla. La explicación del denominador ausente es igual para quien puede corregirlo y para quien no. |
| TASK-UI-016 / OC, recepción, incidentes | **Celdas que faltaban** | Los tres flujos P1 más caros de deshacer —comprometer dinero, dar por recibido lo que no llegó, calificar un accidente— sólo tenían camino feliz. Ahora: sin sesión conservando destino, vacío por filtro que no niega los datos, fallo de servidor recuperable en recepción, y guardia de doble envío en el reporte de incidentes, donde un duplicado no es un registro de más sino **un accidente contado dos veces en las tasas del DS 44**. |
| TASK-UI-001 / gate selectivo | **Anchos nunca ejercitados** | Las 163 rutas capturadas en `small` (320×568), `tablet` (768×1024) y `laptop` (1366×768). Existían desde la pasada 65 y no se habían corrido. |

#### Verificación ejecutada en la pasada 68

- Captura en los tres anchos del gate selectivo, **163 rutas cada uno**: `small` (320×568), `tablet` (768×1024) y `laptop` (1366×768). Los tres con **cero errores de cliente, cero scroll horizontal e integridad limpia**. Es la certificación de WCAG 1.4.10 a 320 px sobre la aplicación entera, no sobre las ocho pantallas que cubría el E2E.
- Suite E2E: **367 aprobados, 4 saltados**, 16,9 min. Un fallo, `oc-reconciliation:46`, que **pasa en aislamiento** (5,4 s) y es uno de los dos escenarios que §4.1 tiene identificados como intermitentes por contención.
- Pruebas unitarias: **3403 aprobadas**.
- `npx tsc --noEmit` y `npx eslint`: verdes salvo el error de `lib/services/dte-portal/`, que es de otro proceso.

#### Una prueba que fijaba el defecto

`program-lifecycle-controls.test.tsx` afirmaba `toHaveAttribute("title", …)`: comprobaba que la sigla estuviera **exactamente donde el criterio dice que no debe estar**. Es la tercera vez en cuatro pasadas que una prueba verde resulta estar protegiendo el comportamiento incorrecto —antes fueron el enum `"sent"` en los exportes y el `comprador@e2e` que la semilla hace administrador—. Ahora comprueba que el rótulo es alcanzable por foco y que el `title` ya no está.

**Veredicto tras la pasada 68:** el resultado más útil de la pasada es una resta. El inventario proponía barrer 444 atributos `title`; medirlos primero dejó **3 defectos reales y 441 falsos positivos**, y de esos 441, cincuenta y ocho eran ayuda de truncado que migrar habría empeorado —cincuenta y ocho paradas de tabulación nuevas sin una sola información ganada—. Un inventario que dice "444 sitios" y una medición que dice "3" llevan a decisiones opuestas, y la diferencia entre ambos era media hora de contar bien. Lo mismo con el rol de lectura: la pregunta no era si el mensaje existía, sino a quién se le mostraba, y no se podía responder porque los tres usuarios sembrados eran dos administradores y alguien que ni llega a la pantalla.

### Pasada 69 — Las seis decisiones, resueltas

**Fecha:** 4 de agosto de 2026.

**Objetivo de la pasada:** cerrar las decisiones que llevaban pasadas bloqueadas esperando a su dueño. Ninguna era trabajo pendiente por falta de tiempo: eran preguntas cuya respuesta no me correspondía.

#### Las resoluciones

| Decisión | Respuesta | Consecuencia |
|---|---|---|
| **TASK-UI-017 · Minimización de RUT** | **Descartada.** No es necesario enmascarar. | La tarea deja de ser un pendiente bloqueado y pasa a ser una decisión tomada. No se implementa `maskRut` ni la matriz por rol. |
| **TASK-UI-011 · Salud por módulo** | **Se deja como está.** | La banda de plataforma —base de datos, volumen, disco— es la única salud que se puede demostrar, y la pantalla ya dice que los interruptores miden visibilidad y no salud. No se inventa una sonda por módulo. |
| **TASK-UI-007 · PPA sin red** | **Debe funcionar sin red.** | Ya funciona: es la PWA con cola en IndexedDB, certificada por E2E. Y como esa cola **es** JavaScript, exigir el modo offline implica que JavaScript es obligatorio: el fallback sin JavaScript queda descartado por incompatible con el requisito, no por falta de tiempo. |
| **TASK-UI-008 · Cola TAE en dispositivo compartido** | **Bloquear "Finalizar" mientras haya pendientes.** | Implementado. Ver abajo. |
| **Formato de montos negativos** | **Cambiarlo a `-$4.500`.** | Implementado. Ver abajo. |
| **Historia de git** | **No rehacerla.** Commit, merge a `main` y volver a `main` al terminar. | El commit `docs(audit)` con 349 archivos de código se queda como está. |

#### Una pregunta que respondí antes de proceder

Pregunté por **JavaScript deshabilitado** y la respuesta llegó sobre **red**. No son lo mismo, y darlo por equivalente habría cerrado un criterio con una respuesta a otra pregunta. Sin red ya funciona; sin JavaScript no existiría la cola que hace posible el modo offline. Con eso, exigir lo primero resuelve lo segundo por implicación, y así queda escrito — sujeto a corrección.

#### Trabajo realizado

| Tarea | Naturaleza | Cambio aplicado |
|---|---|---|
| TASK-UI-008 / cola en dispositivo compartido | **Decisión implementada** | "Finalizar en este dispositivo" nunca borró la cola —sólo el acceso—, así que las cargas encoladas sin red sobrevivían al cambio de turno. La atribución no se rompía: cada carga guarda su `accessToken` y se registra a nombre de quien la hizo. Lo que se perdía era la certeza: el trabajador entregaba el teléfono sin forma de saber si su registro existía. Ahora el botón se bloquea mientras haya pendientes y **dice cuántas** —un botón deshabilitado sin cifra es indistinguible de uno roto—. Se reconsulta la cola dentro del propio manejador, porque entre el último refresco y el clic pueden encolarse cargas nuevas. Y si la cola no se puede leer, se trata como "hay pendientes": bloquear de más es recuperable, borrar el acceso sobre una cola no consultada no lo es. |
| Formato de montos negativos | **Decisión implementada** | `es-CL` produce `$-4.500`, con el signo dentro del símbolo. Se antepone: `-$4.500`. Se opera sobre el valor absoluto y se prefija en vez de mover el guion con una expresión regular, para que el formato del número lo siga decidiendo `Intl`. |
| Cero negativo | **Defecto que destapó el cambio** | Al escribir la prueba apareció que `-0 < 0` es **falso** en JavaScript, así que el cero negativo llegaba a `Intl` y salía como **`$-0`**: un saldo cuadrado presentado como si tuviera signo. Aparece al restar dos montos iguales, que en conciliación es el caso normal. Normalizado. |

#### Dos pruebas que fijaban el formato anterior

`lib/__tests__/utils.test.ts` afirmaba `"$-5.000"` y el snapshot de la pasada 66 afirmaba `"$-4.500"`. Ninguna de las dos estaba mal cuando se escribió —congelaban la salida real—, y ese es justamente el valor de un snapshot: un cambio de formato no puede pasar inadvertido. Las dos se actualizaron con el motivo de la decisión escrito al lado.

#### Verificación ejecutada en la pasada 69

- Suite E2E: **368 aprobados, 4 saltados, 0 fallos**, 16,5 min. El intermitente de §4.1 no apareció.
- Pruebas unitarias: **3406 aprobadas**.
- `npx tsc --noEmit` y `npx eslint`: verdes salvo el error de `lib/services/dte-portal/`, ajeno a esta auditoría.

**Veredicto tras la pasada 69:** con estas seis respuestas **no queda un solo pendiente bloqueado por falta de decisión**. Lo que resta necesita acceso a producción, un entorno desechable o personas y dispositivos reales — nada que se resuelva escribiendo código. De las seis, dos eran implementación y cuatro eran permiso para dejar de considerar algo un pendiente, que es una forma de trabajo que no deja diff pero libera el inventario. Y una tercera cosa apareció por el camino sin que nadie la buscara: al anteponer el signo del peso, el cero negativo se destapó como `$-0` — un saldo cuadrado presentado con signo, en el caso más común de la conciliación. Es la cuarta vez en esta auditoría que un cambio cosmético descubre un defecto de datos debajo.
