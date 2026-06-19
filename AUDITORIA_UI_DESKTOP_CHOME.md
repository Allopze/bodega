# Auditoria UI Desktop Chome

Fecha: 2026-06-19  
Estado: auditoria inicial + remediacion UI aplicada el 2026-06-19.
Alcance: capturas desktop generadas desde la app real con Playwright, mas revision de codigo y build posterior a fixes.
Directrices usadas: `design-taste-frontend`, `impeccable`, `emil-design-eng`.

## Veredicto ejecutivo

La interfaz desktop de Chome ya tiene una base de producto seria: shell consistente, identidad reconocible, tablas sobrias, buen uso del verde como acento y documentos imprimibles bastante profesionales. No se ve como una maqueta improvisada.

El problema principal es de madurez visual en pantallas operativas: muchas rutas usan una composicion estrecha pegada arriba, con mucho espacio muerto y jerarquia insuficiente para decisiones importantes. El producto transmite orden, pero todavia no siempre transmite dominio operacional.

Puntuacion inicial UI desktop: **14/20, buena base con deuda de polish visible**.
Puntuacion posterior estimada por codigo: **16/20, pendiente de recaptura completa por bloqueo del sandbox local**.

| Dimension | Puntaje | Lectura |
| --- | ---: | --- |
| Identidad y coherencia visual | 3/4 | Shell, color y tono son consistentes. |
| Jerarquia y escaneo | 3/4 | Funciona en dashboard y tablas, cae en formularios/detalles. |
| Layout desktop | 2/4 | Mucho contenido queda angosto y arriba, con grandes zonas vacias. |
| Estados, vacios y errores | 2/4 | Existen, pero varios no orientan ni recuperan al usuario con fuerza. |
| Anti-patrones de producto | 4/4 | No hay gradientes AI, neon, glass decorativo ni exceso de ornamento. |

## Evidencia generada

### Verificacion posterior a fixes

| Comando | Resultado | Nota |
| --- | --- | --- |
| `npm run lint` | Pasa con 1 warning historico | Warning no relacionado: `lib/services/email-templates.ts` importa `logger` sin usar. |
| `npm run typecheck` | Pasa | `tsc --noEmit` sin errores. |
| `npm run build` | Pasa | Next 16.2.7 compila y lista `/recuperar` como ruta estatica publica. |
| `git diff --check` | Pasa | Sin whitespace problem en los parches. |

Advertencia de build persistente: Next/Turbopack reporta tracing NFT inesperado desde `next.config.ts` hacia servicios de solicitudes. No bloquea el build y no fue introducido por estos cambios UI.

Recaptura posterior: no completada por restriccion del sandbox. El comando oficial con `npx tsx` fallo con `EPERM` al abrir `/tmp/tsx-1000/*.pipe`. La variante `node --import tsx scripts/capture-all-routes.ts` avanzo mas, pero el sandbox bloqueo el socket de PostgreSQL en `/var/run/postgresql/.s.PGSQL.5432`. Esto queda como bloqueo de entorno, no como fallo de la app.

### Evidencia de auditoria inicial

Comando de build:

```bash
npm run build
```

Resultado: build correcto. Next mostro una advertencia de tracing NFT en `next.config.ts`, sin bloquear.

Comando de capturas:

```bash
CAPTURE_DATABASE_URL=postgres:///bodega_capture CAPTURE_ALLOW_DESTRUCTIVE_RESET=true PGHOST=/var/run/postgresql npx tsx scripts/capture-all-routes.ts
```

Resultado:

| Metrica | Valor |
| --- | ---: |
| Rutas inventariadas | 46 |
| Capturas totales | 92 |
| Capturas desktop | 46 |
| Fallos | 0 |
| Archivos faltantes | 0 |
| Archivos vacios | 0 |
| Secciones sembradas | 21 |

Directorio de capturas: `audit/screenshots/2026-06-09-playwright/`  
Manifest: `audit/screenshots/2026-06-09-playwright/manifest.json`

Nota operacional: el primer intento fallo porque `db/migrations/0017_email_templates.sql` duplicaba `password_reset_tokens` y `email_notifications`, ya creados en `0016_schema_additions.sql`. Se corrigio la migracion para poder ejecutar el flujo real de capturas.

## Cambios aplicados en esta pasada

| Area | Estado | Archivos principales | Cambio |
| --- | --- | --- | --- |
| Recuperacion de clave | Corregido por codigo | `proxy.ts` | `/recuperar` y `/recuperar/[token]` quedan publicas al estar cubiertas por `pathname.startsWith("/recuperar")`. |
| Layout desktop | Corregido parcial | `components/ui/page-container.tsx`, rutas `solicitudes`, `compras`, `recepcion`, `repuestos`, `servicios`, `prevencion`, `admin/productos` | Se agrego `width="workbench"` para formularios y detalles que necesitan columna lateral o mayor ancho desktop. |
| Topbar denso | Corregido parcial | `components/layout/top-bar.tsx` | Se retrasa la descripcion y las acciones de ruta a `2xl`, y se reduce el ancho del chip de faena en desktop medio. |
| Formularios guiados | Corregido parcial | `repuestos/request-form.tsx`, `servicios/request-form.tsx`, `compras/oc-form.tsx`, `recepcion/receipt-form.tsx` | Repuestos, servicios, OC y recepcion usan resumen lateral sticky con estado, requisitos y totales cuando aplica. Solicitudes ya tenia resumen lateral y ahora usa ancho workbench. |
| Productos admin | Corregido | `admin/productos/product-form.tsx`, `product-route-sheet.tsx`, paginas nuevo/editar | Crear/editar por ruta ya no abre modal con overlay. Usa variante embebida en panel de pagina; el modal sigue disponible para acciones desde tabla. |
| Overlays y dialogos | Corregido parcial | `app/globals.css`, `components/ui/dialog.tsx` | Overlay global baja de 0.32 a 0.24, blur baja a 1px y el contenido limita alto con scroll interno. |
| Estados vacios y 403 | Corregido parcial | `components/ui/empty-state.tsx`, `admin/plantillas/template-list.tsx`, `forbidden/page.tsx` | EmptyState gana `tone`, `align` y accion secundaria. Plantillas y Forbidden tienen copy y recuperacion mas especifica. |

## Hallazgos prioritarios

### P1: Las rutas de recuperacion no se capturan como recuperacion

Capturas afectadas: `desktop-recuperar.png`, `desktop-recuperar-token.png`.

El manifest muestra que `/recuperar` y `/recuperar/capture-reset-token` terminan en `/login?callbackUrl=...`. Visualmente ambas capturas son login. Para una auditoria UI esto es grave porque deja sin validar un flujo sensible: recuperacion de acceso.

Impacto: un usuario que olvido su clave necesita una ruta clara y tranquilizadora. Si el flujo real redirige a login, puede quedar bloqueado o asumir que la app esta rota.

Recomendacion: revisar middleware/auth para que estas rutas sean publicas o ajustar el inventario si el flujo correcto cambio.

Estado posterior: **corregido por codigo** en `proxy.ts`. Falta recaptura completa para reemplazar las imagenes iniciales.

### P1: Layout desktop subutilizado en pantallas de trabajo

Capturas afectadas: `desktop-perfil.png`, `desktop-recepcion.png`, `desktop-entregas.png`, `desktop-repuestos.png`, `desktop-servicios.png`, `desktop-prevencion.png`, varias admin.

Muchas pantallas concentran el contenido en el primer tercio superior, dejando grandes areas vacias. Eso no es solo estetico: en una herramienta interna, el espacio desktop debe reducir escaneo, comparar estados y acercar acciones.

Impacto: la app parece menos terminada de lo que es y obliga a leer componentes pequeños en vez de aprovechar paneles laterales, resumenes o agrupaciones por prioridad.

Recomendacion: definir patrones desktop por tipo de pantalla: lista operativa, detalle, formulario y admin catalogo. No todas necesitan mas densidad, pero si necesitan una intencion espacial clara.

Estado posterior: **parcialmente corregido**. Se agrego `workbench` y se migro la superficie de formularios/detalles principales. Listas como `perfil`, `entregas`, `reportes` y algunos catalogos admin siguen como siguiente fase.

### P2: Topbar y header compiten por atencion en rutas densas

Capturas afectadas: `desktop-dashboard.png`, formularios y detalles con breadcrumb largo.

La pill superior funciona como sistema, pero en dashboard acumula faena, alertas, busqueda, notificaciones y usuario. En rutas con breadcrumb, el titulo queda pequeño dentro de un header que compite con controles globales.

Impacto: baja la velocidad de orientacion. El usuario ve muchos chips antes de saber que accion corresponde.

Recomendacion: separar informacion persistente de contexto accionable. Mantener faena/busqueda, pero mover alertas contextuales a un bloque de pagina o una banda compacta cuando compitan con el titulo.

Estado posterior: **parcialmente corregido**. El topbar muestra menos contenido secundario en desktop medio y reserva acciones de ruta para `2xl`. Queda pendiente redisenar alertas contextuales dentro de paginas especificas.

### P2: Formularios largos usan tarjetas estaticas, no flujo guiado

Capturas afectadas: `desktop-solicitudes-nueva.png`, `desktop-compras-nueva.png`, `desktop-recepcion-nueva.png`, `desktop-repuestos-nueva.png`, `desktop-servicios-nueva.png`, `desktop-prevencion-nueva.png`.

Los formularios son claros, con labels arriba y resumenes utiles. Aun asi, muchos quedan como cajas apiladas. La accion primaria a veces esta lejos o compite con guardar borrador/cancelar.

Impacto: en solicitudes, compras y SST, el usuario necesita sentir avance y seguridad. Una composicion mas guiada reduciria errores y dudas.

Recomendacion: usar un layout de dos columnas estable: contenido principal a la izquierda, resumen/validacion sticky a la derecha, acciones finales siempre visibles o claramente agrupadas.

Estado posterior: **parcialmente corregido**. Repuestos, servicios, OC y recepcion ahora usan resumen lateral sticky. Solicitudes ya tenia resumen y ahora tiene ancho workbench. Prevencion nueva queda pendiente para una pasada dedicada por densidad y riesgo SST.

### P2: Modales de productos rompen el contexto visual

Capturas afectadas: `desktop-admin-productos-nuevo.png`, `desktop-admin-productos-detalle.png`.

El modal de producto oscurece demasiado la app y concentra un formulario complejo en una caja estrecha. Para crear o editar productos, el modal parece una solucion rapida, no una superficie administrativa robusta.

Impacto: productos tienen atributos, proveedores, categoria, precio y flags operativos. Esa complejidad merece una pagina o panel dedicado para evitar perdida de contexto y errores.

Recomendacion: convertir crear/editar producto en ruta/panel de pagina con tabs persistentes, historial y resumen lateral. Si se mantiene modal, reducir overlay, ampliar anchura y bajar protagonismo del boton cerrar.

Estado posterior: **corregido para rutas**. `/admin/productos/nuevo` y `/admin/productos/[id]` renderizan el formulario como panel embebido. El modal se conserva para el uso desde lista, donde si funciona como accion ligera.

### P2: Estados vacios y errores son correctos, pero poco instructivos

Capturas afectadas: `desktop-forbidden.png`, `desktop-not-found.png`, `desktop-app-not-found.png`, `desktop-admin-plantillas.png`.

Hay estructura y acciones basicas, pero falta explicar que paso y cual es el camino de recuperacion mas probable para este producto.

Impacto: en una app interna, un 403 o una lista vacia suele significar permisos, configuracion faltante o flujo pendiente. El usuario necesita una pista concreta.

Recomendacion: adaptar vacios por dominio: permiso insuficiente, sin plantillas, ruta inexistente, sin registros. Incluir accion primaria y secundaria con lenguaje operacional.

Estado posterior: **parcialmente corregido**. `Forbidden` y `admin/plantillas` fueron reforzados. 404 y otros vacios de listas quedan para siguiente fase.

## Tabla de mejoras de criterio visual

| Antes | Despues | Por que |
| --- | --- | --- |
| Contenido principal angosto y pegado arriba en varias rutas | Plantillas desktop por tipo de pantalla con columnas, resumen lateral y uso intencional del ancho | El desktop debe acelerar comparacion y decision, no solo dejar aire vacio |
| Header global con muchos chips antes del contexto de la pagina | Contexto de ruta primero, estado global reducido, alertas contextuales dentro de la pagina | El usuario debe entender donde esta antes de procesar indicadores |
| Formularios como tarjetas apiladas con CTA al final | Flujo guiado con resumen sticky, validaciones visibles y acciones agrupadas | Reduce errores y hace que enviar/aprobar se sienta deliberado |
| Crear/editar producto dentro de modal oscuro | Ruta o panel dedicado con tabs persistentes y contexto de catalogo | Los productos son datos maestros, no una accion ligera |
| Estados vacios genericos | Vacio por dominio con causa probable, accion primaria y ruta de retorno | La recuperacion del usuario es parte de la interfaz |
| Tablas admin con metricas identicas arriba | Resumen compacto solo cuando cambia una decision, no como decoracion | Evita patron de tarjetas repetidas sin valor nuevo |
| Transiciones y presion tactil poco visibles en controles | `:active` sutil, foco consistente, transiciones solo en `transform` y `opacity` | Los controles deben sentirse responsivos sin animacion decorativa |

## Analisis ruta por ruta

| Captura desktop | Ruta solicitada | URL final | Evaluacion UI |
| --- | --- | --- | --- |
| `desktop-root.png` | `/` | `/login?callbackUrl=%2F` | Redirige a login. Aceptable si la raiz protegida no tiene landing, pero el capture no prueba una experiencia de bienvenida. |
| `desktop-login.png` | `/login` | `/login` | Fuerte identidad de marca, composicion limpia, form compacto. Buen inicio. El bloque legal inferior es muy pequeño. |
| `desktop-registro.png` | `/registro` | `/registro` | Formulario claro, pero visualmente mas fragil que login. Falta el peso de marca del panel verde y queda demasiado flotante. |
| `desktop-recuperar.png` | `/recuperar` | `/login?callbackUrl=%2Frecuperar` | Captura inicial no muestra recuperacion. Fix aplicado en `proxy.ts`; pendiente recaptura. |
| `desktop-recuperar-token.png` | `/recuperar/capture-reset-token` | `/login?callbackUrl=%2Frecuperar%2Fcapture-reset-token` | Captura inicial no muestra reset de clave. Fix aplicado en `proxy.ts`; pendiente recaptura. |
| `desktop-not-found.png` | `/ruta-inexistente-auditoria` | `/ruta-inexistente-auditoria` | Error 404 coherente con shell, pero demasiado generico. Las tarjetas de destino parecen iguales y no priorizan. |
| `desktop-dashboard.png` | `/dashboard` | `/dashboard` | La mejor pantalla operativa. Buen ritmo tabla/metricas/acciones. Riesgo: topbar cargado y acciones horizontales compiten. |
| `desktop-perfil.png` | `/perfil` | `/perfil` | Correcta, pero demasiado pobre para desktop. Podria mostrar actividad, seguridad, sesiones o preferencias con mas contexto. |
| `desktop-app-not-found.png` | `/app-ruta-inexistente-auditoria` | `/app-ruta-inexistente-auditoria` | Misma fortaleza/debilidad que 404: consistente, pero no suficientemente util. |
| `desktop-solicitudes.png` | `/solicitudes` | `/solicitudes` | Tabla clara, filtros basicos, buen CTA. El area superior podria mostrar estados de cola sin caer en tarjetas repetidas. |
| `desktop-solicitudes-nueva.png` | `/solicitudes/nueva` | `/solicitudes/nueva` | Form legible y resumen util. Fix aplicado: ahora usa ancho `workbench` para aprovechar mejor desktop. |
| `desktop-solicitudes-detalle.png` | `/solicitudes/req-audit-1` | `/solicitudes/req-audit-1` | Seguimiento e informacion claros. La jerarquia entre estado, datos e items podria ser mas fuerte. |
| `desktop-aprobaciones.png` | `/aprobaciones` | `/aprobaciones` | Buen foco en items pendientes. Botones aprobar/rechazar se ven pequeños para la importancia de la decision. |
| `desktop-compras.png` | `/compras` | `/compras` | Tabla sobria y alerta superior util. Buen ejemplo de pantalla operativa contenida. |
| `desktop-compras-nueva.png` | `/compras/nueva` | `/compras/nueva` | Seleccion de proveedor y items clara. Fix aplicado: resumen financiero sticky y ancho `workbench`. |
| `desktop-compras-detalle.png` | `/compras/po-audit-1` | `/compras/po-audit-1` | Buen detalle financiero. La columna derecha funciona, pero el contenido se siente comprimido y largo. |
| `desktop-compras-print.png` | `/compras/po-audit-1/print` | `/compras/po-audit-1/print` | Documento muy superior al promedio de pantallas. Marca, espaciado y firma se sienten utilizables por empresa. |
| `desktop-recepcion.png` | `/recepcion` | `/recepcion` | Tabla clara pero muy vacia. Podria aprovechar desktop con cola, filtros y resumen de recepciones pendientes. |
| `desktop-recepcion-nueva.png` | `/recepcion/nueva?oc=po-audit-1` | `/recepcion/nueva?oc=po-audit-1` | Paso a paso entendible. Fix aplicado: resumen operativo sticky con etapa, OC y lineas pendientes. |
| `desktop-recepcion-detalle.png` | `/recepcion/rec-audit-1` | `/recepcion/rec-audit-1` | Detalle correcto con resumen lateral. Mucho espacio desperdiciado alrededor del contenido. |
| `desktop-bodega.png` | `/bodega` | `/bodega` | Una de las pantallas mas completas. Stock, devolucion y kardex conviven bien. Requiere afinar densidad y alineacion. |
| `desktop-entregas.png` | `/entregas` | `/entregas` | Flujo comprensible con filtros, item y accion. La pantalla se siente liviana para una tarea operacional importante. |
| `desktop-trazabilidad.png` | `/trazabilidad` | `/trazabilidad` | Fuerte como tabla de seguimiento. Buen uso de estados y fechas. Necesita mejorar lectura de columnas densas. |
| `desktop-reportes.png` | `/reportes` | `/reportes` | Clara, pero cae en tarjetas metricas repetidas. Deberia priorizar decisiones: exportar, revisar pendientes, ver tendencias. |
| `desktop-repuestos.png` | `/repuestos` | `/repuestos` | Correcta, muy vacia. El patron de metricas arriba no agrega suficiente valor visual. |
| `desktop-repuestos-nueva.png` | `/repuestos/nueva` | `/repuestos/nueva` | Form consistente con solicitudes. Fix aplicado: resumen sticky con progreso, estado de borrador y requisitos. |
| `desktop-repuestos-detalle.png` | `/repuestos/rep-audit-1` | `/repuestos/rep-audit-1` | Seguimiento claro, tabs utiles. La decision principal queda poco destacada. |
| `desktop-servicios.png` | `/servicios` | `/servicios` | Misma lectura que repuestos. Consistente, pero demasiado liviana para desktop. |
| `desktop-servicios-nueva.png` | `/servicios/nueva` | `/servicios/nueva` | Form ordenado. Fix aplicado: resumen sticky con progreso, estado de borrador y requisitos. |
| `desktop-servicios-detalle.png` | `/servicios/srv-audit-1` | `/servicios/srv-audit-1` | Buen seguimiento. Falta una sintesis mas fuerte de estado, responsable y proxima accion. |
| `desktop-prevencion.png` | `/prevencion` | `/prevencion` | Lista simple y limpia. Para SST, podria mostrar criticidad, vencimientos y responsables con mas fuerza. |
| `desktop-prevencion-nueva.png` | `/prevencion/nueva` | `/prevencion/nueva` | Form mas rico y serio. La densidad es alta, pero apropiada. Mejoraria con secciones mas respiradas. |
| `desktop-prevencion-detalle.png` | `/prevencion/sst-audit-1` | `/prevencion/sst-audit-1` | Contenido valioso y tabs utiles. Microtexto denso, necesita mayor contraste jerarquico por bloque. |
| `desktop-sst-print.png` | `/sst/sst-audit-1/print` | `/sst/sst-audit-1/print` | Excelente orientacion documental. Largo, pero apropiado para acta. Toolbar superior simple y util. |
| `desktop-admin.png` | `/admin` | `/admin` | Hub claro, pero las tarjetas son muy similares. Falta una jerarquia de tareas administrativas frecuentes. |
| `desktop-admin-auditoria.png` | `/admin/auditoria` | `/admin/auditoria` | Tabla legible. Mucho espacio vacio, pero es aceptable si el volumen real crecera. |
| `desktop-admin-configuracion.png` | `/admin/configuracion` | `/admin/configuracion` | Contenido util y panel lateral de vista OC. La pantalla se siente densa y podria dividirse por secciones persistentes. |
| `desktop-admin-faenas.png` | `/admin/faenas` | `/admin/faenas` | Tabla limpia, acciones claras. Bien para catalogo pequeno. |
| `desktop-admin-plantillas.png` | `/admin/plantillas` | `/admin/plantillas` | Captura inicial tenia estado vacio pobre. Fix aplicado: EmptyState con tono warning, causa y accion a configuracion. |
| `desktop-admin-productos.png` | `/admin/productos` | `/admin/productos` | Buen catalogo base. Los filtros/categorias al pie se sienten secundarios aunque afectan busqueda. |
| `desktop-admin-productos-nuevo.png` | `/admin/productos/nuevo` | `/admin/productos/nuevo` | Captura inicial mostraba modal. Fix aplicado: ruta renderiza panel embebido sin overlay. |
| `desktop-admin-productos-detalle.png` | `/admin/productos/prod-audit-1` | `/admin/productos/prod-audit-1` | Captura inicial mostraba modal. Fix aplicado: ruta renderiza panel embebido sin overlay. |
| `desktop-admin-proveedores.png` | `/admin/proveedores` | `/admin/proveedores` | Tabla y metricas claras. Mucho espacio vacio, pero aceptable para catalogo. |
| `desktop-admin-trabajadores.png` | `/admin/trabajadores` | `/admin/trabajadores` | Similar a proveedores. Correcta, pero las metricas no aportan gran diferencia visual. |
| `desktop-admin-usuarios.png` | `/admin/usuarios` | `/admin/usuarios` | Buena lectura de usuarios, roles y estados. Acciones compactas; revisar accesibilidad de icon-only actions. |
| `desktop-forbidden.png` | `/forbidden` | `/forbidden` | Captura inicial era minima. Fix aplicado: tono warning y accion secundaria hacia solicitudes. |

## Fortalezas a preservar

- El shell desktop es consistente y ya se siente como producto interno, no como landing disfrazada.
- La paleta restringida funciona: verde como acento, neutros claros y estados semanticos sin ruido.
- Los documentos imprimibles estan a un nivel visual superior y pueden servir como referencia de formalidad.
- Las tablas usan lineas finas, estados y acciones discretas con buena contencion.
- Los formularios respetan labels arriba, helper text y resumen, una base correcta para robustecer.

## Riesgos de sistema

1. **Plantillas de layout no consolidadas**: lista, detalle, formulario, admin y print no comparten una estrategia desktop suficientemente explicita.
2. **Estados no auditados por flujo real**: recuperacion de clave no fue visible en capturas pese a estar en inventario.
3. **Modal como atajo administrativo**: productos muestra que datos maestros pueden quedar comprimidos en modales.
4. **Densidad desigual**: algunas pantallas estan demasiado vacias, otras empiezan a apretar microtexto.
5. **Acciones criticas poco diferenciadas**: aprobar, rechazar, enviar, crear OC o registrar recepcion no siempre tienen peso proporcional al riesgo.

## Estado del plan de fixes UI

1. **Corregir recuperacion de clave en ruta real**
   Estado: hecho por codigo en `proxy.ts`. Falta recaptura para reemplazar evidencia visual inicial.

2. **Definir cuatro plantillas desktop**  
   Estado: parcial. Existe `workbench` para formulario/detalle. Falta formalizar lista operativa, catalogo admin y estados documentales como patrones reutilizables.

3. **Reformular formularios con resumen sticky**  
   Estado: parcial alto. Repuestos, servicios, compras y recepcion tienen resumen sticky. Solicitudes ya tenia resumen y ahora usa `workbench`. Prevencion nueva queda pendiente.

4. **Sacar productos del modal o fortalecerlo**  
   Estado: hecho para rutas. El modal queda solo para accion desde lista.

5. **Elevar estados vacios y errores**  
   Estado: parcial. Plantillas y Forbidden corregidos. 404 y vacios de listas quedan pendientes.

6. **Polish de microinteracciones**  
   Estado: parcial. Botones ya tienen `active:scale-[0.97]`, overlays/dialogos fueron suavizados y topbar redujo competencia. Falta revisar filas accionables e icon-only actions por ruta.

## Faltante

| Prioridad | Pendiente | Siguiente paso natural |
| --- | --- | --- |
| Alta | Recapturar desktop y comparar visualmente los fixes | Ejecutar `CAPTURE_DATABASE_URL=postgres:///bodega_capture CAPTURE_ALLOW_DESTRUCTIVE_RESET=true PGHOST=/var/run/postgresql npx tsx scripts/capture-all-routes.ts` fuera del sandbox o con permiso para socket PostgreSQL local. |
| Alta | Revisar `prevencion/nueva` con patron guiado sin perder densidad SST | Hacer una pasada especifica para SST: resumen lateral de riesgo, trabajador, estado del checklist y acciones. |
| Media | Elevar 404 y app-not-found | Usar `EmptyState` con accion primaria/secundaria y copy por contexto: ruta inexistente, modulo no disponible, regreso a dashboard. |
| Media | Listas operativas vacias o livianas | Aplicar patrones a `perfil`, `entregas`, `reportes`, `repuestos`, `servicios`, `recepcion` y catalogos admin donde el desktop aun se ve pobre. |
| Media | Acciones criticas y filas accionables | Revisar peso visual de aprobar, rechazar, crear OC, registrar recepcion e icon-only actions en usuarios/admin. |
| Baja | Warning lint historico | Limpiar `logger` sin usar en `lib/services/email-templates.ts` cuando se haga una pasada no estrictamente UI. |

## Validaciones pendientes

- No se ejecuto una auditoria completa de accesibilidad con axe en navegador. Esta auditoria se basa en capturas, manifest, revision visual, revision de codigo y build.
- El detector de `impeccable` no estuvo disponible: `Error: bundled detector not found`.
- El analisis solicitado fue desktop. Las capturas mobile existen, pero no se evaluaron en este documento.
- La recaptura posterior quedo bloqueada por sandbox local: `tsx` no pudo abrir pipe en `/tmp` y PostgreSQL local quedo bloqueado en `/var/run/postgresql`.
