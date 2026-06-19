# Auditoria UI Desktop Chome

Fecha: 2026-06-19  
Alcance: capturas desktop generadas desde la app real con Playwright.  
Directrices usadas: `design-taste-frontend`, `impeccable`, `emil-design-eng`.

## Veredicto ejecutivo

La interfaz desktop de Chome ya tiene una base de producto seria: shell consistente, identidad reconocible, tablas sobrias, buen uso del verde como acento y documentos imprimibles bastante profesionales. No se ve como una maqueta improvisada.

El problema principal es de madurez visual en pantallas operativas: muchas rutas usan una composicion estrecha pegada arriba, con mucho espacio muerto y jerarquia insuficiente para decisiones importantes. El producto transmite orden, pero todavia no siempre transmite dominio operacional.

Puntuacion general UI desktop: **14/20, buena base con deuda de polish visible**.

| Dimension | Puntaje | Lectura |
| --- | ---: | --- |
| Identidad y coherencia visual | 3/4 | Shell, color y tono son consistentes. |
| Jerarquia y escaneo | 3/4 | Funciona en dashboard y tablas, cae en formularios/detalles. |
| Layout desktop | 2/4 | Mucho contenido queda angosto y arriba, con grandes zonas vacias. |
| Estados, vacios y errores | 2/4 | Existen, pero varios no orientan ni recuperan al usuario con fuerza. |
| Anti-patrones de producto | 4/4 | No hay gradientes AI, neon, glass decorativo ni exceso de ornamento. |

## Evidencia generada

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

## Hallazgos prioritarios

### P1: Las rutas de recuperacion no se capturan como recuperacion

Capturas afectadas: `desktop-recuperar.png`, `desktop-recuperar-token.png`.

El manifest muestra que `/recuperar` y `/recuperar/capture-reset-token` terminan en `/login?callbackUrl=...`. Visualmente ambas capturas son login. Para una auditoria UI esto es grave porque deja sin validar un flujo sensible: recuperacion de acceso.

Impacto: un usuario que olvido su clave necesita una ruta clara y tranquilizadora. Si el flujo real redirige a login, puede quedar bloqueado o asumir que la app esta rota.

Recomendacion: revisar middleware/auth para que estas rutas sean publicas o ajustar el inventario si el flujo correcto cambio.

### P1: Layout desktop subutilizado en pantallas de trabajo

Capturas afectadas: `desktop-perfil.png`, `desktop-recepcion.png`, `desktop-entregas.png`, `desktop-repuestos.png`, `desktop-servicios.png`, `desktop-prevencion.png`, varias admin.

Muchas pantallas concentran el contenido en el primer tercio superior, dejando grandes areas vacias. Eso no es solo estetico: en una herramienta interna, el espacio desktop debe reducir escaneo, comparar estados y acercar acciones.

Impacto: la app parece menos terminada de lo que es y obliga a leer componentes pequeños en vez de aprovechar paneles laterales, resumenes o agrupaciones por prioridad.

Recomendacion: definir patrones desktop por tipo de pantalla: lista operativa, detalle, formulario y admin catalogo. No todas necesitan mas densidad, pero si necesitan una intencion espacial clara.

### P2: Topbar y header compiten por atencion en rutas densas

Capturas afectadas: `desktop-dashboard.png`, formularios y detalles con breadcrumb largo.

La pill superior funciona como sistema, pero en dashboard acumula faena, alertas, busqueda, notificaciones y usuario. En rutas con breadcrumb, el titulo queda pequeño dentro de un header que compite con controles globales.

Impacto: baja la velocidad de orientacion. El usuario ve muchos chips antes de saber que accion corresponde.

Recomendacion: separar informacion persistente de contexto accionable. Mantener faena/busqueda, pero mover alertas contextuales a un bloque de pagina o una banda compacta cuando compitan con el titulo.

### P2: Formularios largos usan tarjetas estaticas, no flujo guiado

Capturas afectadas: `desktop-solicitudes-nueva.png`, `desktop-compras-nueva.png`, `desktop-recepcion-nueva.png`, `desktop-repuestos-nueva.png`, `desktop-servicios-nueva.png`, `desktop-prevencion-nueva.png`.

Los formularios son claros, con labels arriba y resumenes utiles. Aun asi, muchos quedan como cajas apiladas. La accion primaria a veces esta lejos o compite con guardar borrador/cancelar.

Impacto: en solicitudes, compras y SST, el usuario necesita sentir avance y seguridad. Una composicion mas guiada reduciria errores y dudas.

Recomendacion: usar un layout de dos columnas estable: contenido principal a la izquierda, resumen/validacion sticky a la derecha, acciones finales siempre visibles o claramente agrupadas.

### P2: Modales de productos rompen el contexto visual

Capturas afectadas: `desktop-admin-productos-nuevo.png`, `desktop-admin-productos-detalle.png`.

El modal de producto oscurece demasiado la app y concentra un formulario complejo en una caja estrecha. Para crear o editar productos, el modal parece una solucion rapida, no una superficie administrativa robusta.

Impacto: productos tienen atributos, proveedores, categoria, precio y flags operativos. Esa complejidad merece una pagina o panel dedicado para evitar perdida de contexto y errores.

Recomendacion: convertir crear/editar producto en ruta/panel de pagina con tabs persistentes, historial y resumen lateral. Si se mantiene modal, reducir overlay, ampliar anchura y bajar protagonismo del boton cerrar.

### P2: Estados vacios y errores son correctos, pero poco instructivos

Capturas afectadas: `desktop-forbidden.png`, `desktop-not-found.png`, `desktop-app-not-found.png`, `desktop-admin-plantillas.png`.

Hay estructura y acciones basicas, pero falta explicar que paso y cual es el camino de recuperacion mas probable para este producto.

Impacto: en una app interna, un 403 o una lista vacia suele significar permisos, configuracion faltante o flujo pendiente. El usuario necesita una pista concreta.

Recomendacion: adaptar vacios por dominio: permiso insuficiente, sin plantillas, ruta inexistente, sin registros. Incluir accion primaria y secundaria con lenguaje operacional.

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
| `desktop-recuperar.png` | `/recuperar` | `/login?callbackUrl=%2Frecuperar` | No muestra recuperacion. Hallazgo P1 de flujo y auditoria visual. |
| `desktop-recuperar-token.png` | `/recuperar/capture-reset-token` | `/login?callbackUrl=%2Frecuperar%2Fcapture-reset-token` | No muestra reset de clave. Hallazgo P1. |
| `desktop-not-found.png` | `/ruta-inexistente-auditoria` | `/ruta-inexistente-auditoria` | Error 404 coherente con shell, pero demasiado generico. Las tarjetas de destino parecen iguales y no priorizan. |
| `desktop-dashboard.png` | `/dashboard` | `/dashboard` | La mejor pantalla operativa. Buen ritmo tabla/metricas/acciones. Riesgo: topbar cargado y acciones horizontales compiten. |
| `desktop-perfil.png` | `/perfil` | `/perfil` | Correcta, pero demasiado pobre para desktop. Podria mostrar actividad, seguridad, sesiones o preferencias con mas contexto. |
| `desktop-app-not-found.png` | `/app-ruta-inexistente-auditoria` | `/app-ruta-inexistente-auditoria` | Misma fortaleza/debilidad que 404: consistente, pero no suficientemente util. |
| `desktop-solicitudes.png` | `/solicitudes` | `/solicitudes` | Tabla clara, filtros basicos, buen CTA. El area superior podria mostrar estados de cola sin caer en tarjetas repetidas. |
| `desktop-solicitudes-nueva.png` | `/solicitudes/nueva` | `/solicitudes/nueva` | Form legible y resumen util. Hay mucho aire alrededor y la accion final queda separada del flujo. |
| `desktop-solicitudes-detalle.png` | `/solicitudes/req-audit-1` | `/solicitudes/req-audit-1` | Seguimiento e informacion claros. La jerarquia entre estado, datos e items podria ser mas fuerte. |
| `desktop-aprobaciones.png` | `/aprobaciones` | `/aprobaciones` | Buen foco en items pendientes. Botones aprobar/rechazar se ven pequeños para la importancia de la decision. |
| `desktop-compras.png` | `/compras` | `/compras` | Tabla sobria y alerta superior util. Buen ejemplo de pantalla operativa contenida. |
| `desktop-compras-nueva.png` | `/compras/nueva` | `/compras/nueva` | Seleccion de proveedor y items clara. El layout queda estrecho y la accion primaria no domina lo suficiente. |
| `desktop-compras-detalle.png` | `/compras/po-audit-1` | `/compras/po-audit-1` | Buen detalle financiero. La columna derecha funciona, pero el contenido se siente comprimido y largo. |
| `desktop-compras-print.png` | `/compras/po-audit-1/print` | `/compras/po-audit-1/print` | Documento muy superior al promedio de pantallas. Marca, espaciado y firma se sienten utilizables por empresa. |
| `desktop-recepcion.png` | `/recepcion` | `/recepcion` | Tabla clara pero muy vacia. Podria aprovechar desktop con cola, filtros y resumen de recepciones pendientes. |
| `desktop-recepcion-nueva.png` | `/recepcion/nueva?oc=po-audit-1` | `/recepcion/nueva?oc=po-audit-1` | Paso a paso entendible. La seleccion de items y observaciones podria tener mejor agrupacion visual. |
| `desktop-recepcion-detalle.png` | `/recepcion/rec-audit-1` | `/recepcion/rec-audit-1` | Detalle correcto con resumen lateral. Mucho espacio desperdiciado alrededor del contenido. |
| `desktop-bodega.png` | `/bodega` | `/bodega` | Una de las pantallas mas completas. Stock, devolucion y kardex conviven bien. Requiere afinar densidad y alineacion. |
| `desktop-entregas.png` | `/entregas` | `/entregas` | Flujo comprensible con filtros, item y accion. La pantalla se siente liviana para una tarea operacional importante. |
| `desktop-trazabilidad.png` | `/trazabilidad` | `/trazabilidad` | Fuerte como tabla de seguimiento. Buen uso de estados y fechas. Necesita mejorar lectura de columnas densas. |
| `desktop-reportes.png` | `/reportes` | `/reportes` | Clara, pero cae en tarjetas metricas repetidas. Deberia priorizar decisiones: exportar, revisar pendientes, ver tendencias. |
| `desktop-repuestos.png` | `/repuestos` | `/repuestos` | Correcta, muy vacia. El patron de metricas arriba no agrega suficiente valor visual. |
| `desktop-repuestos-nueva.png` | `/repuestos/nueva` | `/repuestos/nueva` | Form consistente con solicitudes. Buen orden, pero falta sensacion de avance y validacion contextual. |
| `desktop-repuestos-detalle.png` | `/repuestos/rep-audit-1` | `/repuestos/rep-audit-1` | Seguimiento claro, tabs utiles. La decision principal queda poco destacada. |
| `desktop-servicios.png` | `/servicios` | `/servicios` | Misma lectura que repuestos. Consistente, pero demasiado liviana para desktop. |
| `desktop-servicios-nueva.png` | `/servicios/nueva` | `/servicios/nueva` | Form ordenado. El bloque de servicio solicitado puede necesitar mejor jerarquia para evitar errores. |
| `desktop-servicios-detalle.png` | `/servicios/srv-audit-1` | `/servicios/srv-audit-1` | Buen seguimiento. Falta una sintesis mas fuerte de estado, responsable y proxima accion. |
| `desktop-prevencion.png` | `/prevencion` | `/prevencion` | Lista simple y limpia. Para SST, podria mostrar criticidad, vencimientos y responsables con mas fuerza. |
| `desktop-prevencion-nueva.png` | `/prevencion/nueva` | `/prevencion/nueva` | Form mas rico y serio. La densidad es alta, pero apropiada. Mejoraria con secciones mas respiradas. |
| `desktop-prevencion-detalle.png` | `/prevencion/sst-audit-1` | `/prevencion/sst-audit-1` | Contenido valioso y tabs utiles. Microtexto denso, necesita mayor contraste jerarquico por bloque. |
| `desktop-sst-print.png` | `/sst/sst-audit-1/print` | `/sst/sst-audit-1/print` | Excelente orientacion documental. Largo, pero apropiado para acta. Toolbar superior simple y util. |
| `desktop-admin.png` | `/admin` | `/admin` | Hub claro, pero las tarjetas son muy similares. Falta una jerarquia de tareas administrativas frecuentes. |
| `desktop-admin-auditoria.png` | `/admin/auditoria` | `/admin/auditoria` | Tabla legible. Mucho espacio vacio, pero es aceptable si el volumen real crecera. |
| `desktop-admin-configuracion.png` | `/admin/configuracion` | `/admin/configuracion` | Contenido util y panel lateral de vista OC. La pantalla se siente densa y podria dividirse por secciones persistentes. |
| `desktop-admin-faenas.png` | `/admin/faenas` | `/admin/faenas` | Tabla limpia, acciones claras. Bien para catalogo pequeno. |
| `desktop-admin-plantillas.png` | `/admin/plantillas` | `/admin/plantillas` | Estado vacio demasiado pobre. Deberia explicar que plantillas faltan y como crearlas/restaurarlas. |
| `desktop-admin-productos.png` | `/admin/productos` | `/admin/productos` | Buen catalogo base. Los filtros/categorias al pie se sienten secundarios aunque afectan busqueda. |
| `desktop-admin-productos-nuevo.png` | `/admin/productos/nuevo` | `/admin/productos/nuevo` | Modal grande para tarea compleja. Overlay pesado, poco contexto, boton cerrar demasiado protagonista. |
| `desktop-admin-productos-detalle.png` | `/admin/productos/prod-audit-1` | `/admin/productos/prod-audit-1` | Misma deuda de modal. Editar producto necesita superficie mas robusta. |
| `desktop-admin-proveedores.png` | `/admin/proveedores` | `/admin/proveedores` | Tabla y metricas claras. Mucho espacio vacio, pero aceptable para catalogo. |
| `desktop-admin-trabajadores.png` | `/admin/trabajadores` | `/admin/trabajadores` | Similar a proveedores. Correcta, pero las metricas no aportan gran diferencia visual. |
| `desktop-admin-usuarios.png` | `/admin/usuarios` | `/admin/usuarios` | Buena lectura de usuarios, roles y estados. Acciones compactas; revisar accesibilidad de icon-only actions. |
| `desktop-forbidden.png` | `/forbidden` | `/forbidden` | Estado claro pero demasiado minimo. Falta contacto, permiso requerido o ruta de solicitud de acceso. |

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

## Plan recomendado de fixes UI

1. **Corregir recuperacion de clave en capturas y ruta real**  
   Asegurar que `/recuperar` y `/recuperar/[token]` sean publicas si ese es el flujo esperado.

2. **Definir cuatro plantillas desktop**  
   Lista operativa, detalle operativo, formulario guiado y catalogo admin. Aplicarlas sin redisenar rutas ni cambiar nombres.

3. **Reformular formularios con resumen sticky**  
   Solicitudes, compras, recepcion, repuestos y servicios deberian compartir el mismo patron.

4. **Sacar productos del modal o fortalecerlo**  
   Preferible ruta dedicada. Alternativa minima: modal mas ancho, overlay mas suave, cierre menos dominante y tabs con mejor jerarquia.

5. **Elevar estados vacios y errores**  
   Plantillas, forbidden y 404 necesitan copy y acciones especificas del dominio.

6. **Polish de microinteracciones**  
   Botones y filas accionables deberian tener estado `:active` sutil, foco visible consistente y transiciones cortas de 150 a 200 ms.

## Validaciones pendientes

- No se ejecuto una auditoria completa de accesibilidad con axe en navegador. Esta auditoria se basa en capturas, manifest y revision visual.
- El detector de `impeccable` no estuvo disponible: `Error: bundled detector not found`.
- El analisis solicitado fue desktop. Las capturas mobile existen, pero no se evaluaron en este documento.
