# Reporte de Auditoría UI/UX — Chome Solicitudes y Bodega
**Fecha:** 2026-06-10  
**Método:** Playwright desktop (1440×900), sesión admin, fullPage screenshots  
**Capturas:** 36 imágenes en `ui-audit/screenshots/`  
**Severidades:** 🔴 Crítico · 🟠 Alto · 🟡 Medio · 🔵 Bajo · ⚪ Nit

---

## Resumen ejecutivo

El sistema tiene un diseño visual coherente y bien definido: paleta verde oscuro, tipografía sans-serif, layout sidebar+contenido, y lenguaje visual consistente en la mayoría de los componentes. Sin embargo, la auditoría reveló **10 problemas transversales** y **~50 hallazgos puntuales** distribuidos en todas las rutas. Los más graves son:

1. **Valores de BD en inglés en producción** (Reportes) — inaceptable para usuarios finales.
2. **Campana de notificaciones no abre panel** — el badge muestra "3" pero el click no hace nada visible.
3. **Filas de tabla no navegan al hacer click** — la única forma de acceder a detalle es el ícono `→` que solo aparece en hover del primer row.
4. **Input de archivo sin estilo** (Entregas) — único componente con apariencia nativa del browser.
5. **Tres pantallas de Recepción idénticas** — `/recepcion/nueva` y `/recepcion/[id]` redirigen al mismo estado vacío.

---

## Problemas transversales

Estos hallazgos se repiten en múltiples pantallas:

| # | Severidad | Problema | Componente afectado |
|---|-----------|----------|---------------------|
| T1 | 🟠 Alto | **Indicador Next.js "N"** visible en todas las páginas autenticadas (esquina inferior izquierda). Artefacto de desarrollo que no debe aparecer en producción. | `app/layout.tsx` |
| T2 | 🟠 Alto | **Filas de tabla no navegan con click.** Las tablas de Solicitudes, Compras, etc., solo muestran un ícono `→` en hover sobre la primera fila (state inconsistente). Toda la fila debería ser clickeable o debe haber un affordance visible en todas las filas. | `components/ui/table.tsx`, todos los list components |
| T3 | 🟡 Medio | **Selects nativos mezclados con los custom.** En Trazabilidad (filtros Faena/Estado) y en el formulario de Trabajadores (campo Faena) se usan `<select>` nativos del browser, mientras el resto de la app usa el componente custom `Select` de shadcn. | `app/(app)/trazabilidad/page.tsx`, `admin/trabajadores/worker-form.tsx` |
| T4 | 🟡 Medio | **Botón "Volver al inicio" y otros CTAs secundarios** usan estilo outlined/ghost en lugar del patrón primary green establecido, dificultando la jerarquía de acciones en pantallas como 404 y algunas páginas de admin. | `components/ui/button.tsx` |
| T5 | 🔵 Bajo | **Botón de cerrar (X) en modales inconsistente.** Los diálogos de Nuevo Producto / Editar Producto tienen un X con borde cuadrado; los demás diálogos (Faena, Trabajador, Proveedor) tienen un × de texto plano. | Todos los `*-form.tsx` en `app/(app)/admin/` |
| T6 | ⚪ Nit | **Texto en sidebar footer** ("CHOME / SOLICITUDES-Y-BODEGA") aparece cortado/solapado con el ícono "N". Visualmente ruidoso. | `components/layout/sidebar.tsx` |
| T7 | ⚪ Nit | **Avatar inicial del usuario en color dorado/ocre** (Alejandro = "AZ") contrasta con los demás avatares que siguen una paleta más fría (verde para CR, rosa para LA, ocre para VP). Sin sistema definido para colores de avatares. | `components/layout/top-bar.tsx` |

---

## Análisis por pantalla

---

### 01 · Login `/login`
📸 [`01-login.png`](screenshots/01-login.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | El panel izquierdo de marketing tiene **exceso de espacio en blanco** arriba y abajo — el contenido no está centrado verticalmente. A 900px de alto parece flotando sin ancla. |
| 🟡 | La captura muestra el campo email con foco activo (borde verde grueso) y el campo password ya con puntos — se ve el estado "post-fill". En el estado inicial, los dos campos deberían tener el mismo estilo sin foco. Verificar que el autofocus del email no dispara el borde verde inmediatamente al cargar. |
| 🔵 | La línea "USO EXCLUSIVO DEL PERSONAL AUTORIZADO" al pie del panel izquierdo tiene **contraste muy bajo** (texto claro sobre fondo claro en espacio) — casi ilegible. |
| ⚪ | El placeholder del email ("nombre@chome.cl") es buen branded touch. Mantener. |

**Sugerencia:** Centrar verticalmente el bloque de contenido del panel izquierdo con `flex items-center justify-center h-full`. Aumentar contraste del texto legal.

---

### 02 · Registro sin token `/registro`
📸 [`02-registro-sin-token.png`](screenshots/02-registro-sin-token.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | El mensaje de advertencia ("Para crear tu cuenta necesitas abrir el enlace...") aparece en un **recuadro sin color de alerta** — fondo blanco puro, sin ícono de warning ni color ámbar/rojo. El usuario podría no notar que es un mensaje de error. |
| 🟡 | El botón "Crear cuenta" está **visualmente deshabilitado** (gris) pero el formulario completo sigue visible y editable — genera confusión sobre por qué no puede actuar. Sería mejor mostrar solo el mensaje de error y ocultar/minimizar el formulario. |
| 🔵 | El layout del registro está **centrado en 480px de ancho** dejando mucho espacio en los laterales a 1440px. Diferente al login (split layout). Podría aprovechar el espacio o usar el mismo layout split. |

---

### 03 · Dashboard `/dashboard`
📸 [`03-dashboard.png`](screenshots/03-dashboard.png)

| Sev | Hallazgo |
|-----|----------|
| 🟠 | **Las tareas del dashboard no son clickeables por fila completa** — solo los CTAs del borde derecho ("Ver avance →", "Enviar al proveedor →"). Al ser una lista de tareas de trabajo, el usuario esperaría poder hacer click en cualquier parte de la fila. |
| 🟠 | Los estados inline dentro de las tareas ("EN COMPRA · 10-JUN", "OC EMITIDA · 10-JUN") usan **texto uppercase sin badge visual** — diferente al patrón de badges con punto de color usado en las tablas. Inconsistencia de vocabulario visual. |
| 🟡 | El link "Carga, costos y alertas" (sección 02 — INDICADORES) es muy pequeño y de bajo contraste — no se percibe como un enlace accionable. |
| 🟡 | Los 4 KPIs inferiores ("Pendientes de aprobación", "Aprobados sin OC", "OC por recibir", "Alertas de stock") muestran todos **"0"** — cuando todos son cero, el bloque de 4 tarjetas parece decorativo. Considerar ocultarlos o mostrar un mensaje positivo unificado cuando todo está en orden. |
| 🔵 | La sección "03 — FAENAS" tiene el subtítulo "Ordenado por OC emitida" en la derecha — muy pequeño y de bajo contraste. |

---

### 04 · Solicitudes lista `/solicitudes`
📸 [`04-solicitudes-lista.png`](screenshots/04-solicitudes-lista.png)

| Sev | Hallazgo |
|-----|----------|
| 🟠 | **El ícono `→` de navegación a detalle solo aparece en la primera fila** (hover state capturado solo ahí). Las filas 2 y 3 no muestran ningún affordance de navegación. Los usuarios no sabrán que son clickeables. Aplicar hover/cursor pointer a toda fila o mostrar el `→` siempre visible. |
| 🟡 | Los badges de **ESTADO son visualmente inconsistentes entre sí**: "EN OC" usa fondo azul con texto; "CERRADA" y "BORRADOR" usan dot + texto gris. El badge "EN OC" tiene mucho más peso visual que los otros. Unificar el patrón de badges de estado. |
| 🟡 | El badge "EPP" en la columna TIPO usa un **azul diferente** al resto de la paleta de la app (que es predominantemente verde). Si es intencional diferenciar tipos de solicitud, documentar; si no, unificar. |
| ⚪ | La columna FAENA tiene mucho espacio vacío a 1440px — podría acomodar más información útil. |

---

### 05 · Nueva solicitud `/solicitudes/nueva`
📸 [`05-solicitudes-nueva.png`](screenshots/05-solicitudes-nueva.png)

| Sev | Hallazgo |
|-----|----------|
| 🟠 | El campo **fecha muestra placeholder "mm/dd/yyyy"** — formato anglosajón (mes/día/año) en una app en español. Debería ser "dd/mm/aaaa" o usar un date picker con locale `es-CL`. |
| 🟡 | Los **botones de footer** tienen layout confuso: "← Volver" está alineado a la izquierda, "Guardar borrador" está a la derecha en la misma fila, y "Enviar a aprobación" está debajo en una fila separada. El CTA primario debería estar claramente en una posición de mayor jerarquía visual (más a la derecha, o en la misma línea que los secundarios). |
| 🟡 | La sección de ítem tiene **número circular "1"** muy pequeño — si hay múltiples ítems, estos números actuarán como identificadores pero podrían confundirse con bullets. |
| 🔵 | El campo "Unidad" muestra "unidad" como texto editable de libre escritura — un select sería más consistente. |
| ⚪ | El campo "Proveedor sugerido" usa el placeholder "Escribir nombre..." con un ícono de dropdown — es un combo híbrido texto+select. Asegurarse de que el comportamiento sea claro para el usuario. |

---

### 06 · Detalle solicitud `/solicitudes/[id]`
📸 [`06-solicitud-detalle.png`](screenshots/06-solicitud-detalle.png)

| Sev | Hallazgo |
|-----|----------|
| 🔴 | **El click en la fila no navega al detalle** — el script de Playwright intentó hacer click en la primera fila y terminó en la misma lista. Esto confirma T2: las filas no tienen navegación por click completo. El único affordance son los `→` visibles solo en hover. **Este es el problema de discoverability más grave del sistema.** |

> **Nota:** No se pudo capturar la pantalla de detalle de solicitud. Verificar manualmente que `/solicitudes/[id]` exista y tenga contenido, y luego aplicar el patrón de fila clickeable.

---

### 07 · Aprobaciones `/aprobaciones`
📸 [`07-aprobaciones.png`](screenshots/07-aprobaciones.png)

| Sev | Hallazgo |
|-----|----------|
| 🔵 | El **empty state** ("Sin ítems pendientes") está bien ejecutado, pero su posición vertical está muy alta — aparece casi inmediatamente bajo la línea divisora del título. Un poco más de padding top haría la pantalla respirar. |
| ⚪ | El ícono de checkmark circular es correcto semánticamente. Considerar usar el mismo componente `<ErrorState>` / empty state de otros módulos para consistencia. |

---

### 08 · Órdenes de compra lista `/compras`
📸 [`08-compras-lista.png`](screenshots/08-compras-lista.png)

| Sev | Hallazgo |
|-----|----------|
| 🟠 | **"Marcar enviada"** aparece como texto inline dentro de la celda ESTADO junto al badge "EMITIDA" — es una acción destructiva/transicional mezclada con datos. Debería estar en la columna de acciones al final de la fila, o como botón en el detalle de la OC. El usuario puede hacer click accidentalmente. |
| 🟡 | La misma columna ESTADO tiene densidad visual desigual: fila 1 tiene badge + link acción; fila 2 tiene solo badge. Crea inconsistencia horizontal. |
| ⚪ | La columna "TOTAL" muestra "$0" para la OC emitida — visualmente llamativo. Si es por precio unitario 0, considerar una advertencia o indicador visual. |

---

### 09 · Nueva orden de compra `/compras/nueva`
📸 [`09-compras-nueva.png`](screenshots/09-compras-nueva.png)

| Sev | Hallazgo |
|-----|----------|
| 🟠 | **La ruta `/compras/nueva` redirigió a la lista** — el script navegó a `/compras/nueva` pero el screenshot muestra la lista de OCs. Esto puede ser porque la ruta requiere contexto de solicitudes aprobadas sin OC, y si no hay ninguna, redirige. Si es así, el usuario necesita una **retroalimentación clara de por qué no puede crear una OC en este momento**, en lugar de una redirección silenciosa. |

---

### 10 · Detalle OC `/compras/[id]`
📸 [`10-compra-detalle.png`](screenshots/10-compra-detalle.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | El **botón "Imprimir / PDF"** tiene un estilo de texto-link sin peso visual claro — está alineado a la derecha junto al badge de estado pero sin el estilo outlined que tendría en otras partes. Considerar usar un botón secondary/outlined consistente. |
| 🟡 | El **icono de reloj** en la sección "Historial de cambios" no está claro en su función — ¿es un botón? ¿abre algo? Parece decorativo pero tiene un estilo de botón. |
| 🔵 | La card de información superior (Proveedor, Condición de pago, Entrega estimada, Total) usa un borde muy sutil — casi no se distingue del fondo en pantallas con brillo bajo. |
| ⚪ | El formato de fecha "10-06-2026" en la card usa guiones, mientras la tabla usa "10-06-2026" también — consistente aquí, pero verificar contra otros módulos. |

---

### 11 · 12 · 13 · Recepción `/recepcion`, `/recepcion/nueva`, `/recepcion/[id]`
📸 [`11-recepcion-lista.png`](screenshots/11-recepcion-lista.png) · [`12-recepcion-nueva.png`](screenshots/12-recepcion-nueva.png) · [`13-recepcion-detalle.png`](screenshots/13-recepcion-detalle.png)

| Sev | Hallazgo |
|-----|----------|
| 🔴 | **Las tres pantallas muestran el mismo empty state** — `/recepcion/nueva` y `/recepcion/[id]` no renderizan su contenido propio. Esto indica que ambas rutas redirigen a `/recepcion` cuando no hay OCs emitidas pendientes. Si es comportamiento intencional, debe haber **feedback explícito** en lugar de una redirección silenciosa. Si no es intencional, hay un bug de routing. |
| 🟡 | El nombre de columna "**ENVIADA**" es ambiguo — ¿enviada al proveedor? Podría renombrarse "Fecha envío" o "Enviada al proveedor" para claridad. |
| 🟡 | El **empty state** muestra headers de columnas pero cero filas — el patrón correcto es ocultar los headers y mostrar solo el empty state centrado, o mostrar los headers pero con una fila de placeholder. Actualmente los headers flotando sobre el empty state se ven incompletos. |
| 🔵 | El empty state copy "Las órdenes de compra enviadas al proveedor aparecerán aquí cuando deban marcarse como recibidas." es informativo pero largo. Podría acortarse. |

---

### 14 · Bodega `/bodega`
📸 [`14-bodega-stock.png`](screenshots/14-bodega-stock.png)

| Sev | Hallazgo |
|-----|----------|
| 🟠 | El **formulario "Devolver a stock" está embebido inline** en la página entre la tabla de stock y el kardex, interrumpiendo el flujo de lectura vertical. Este patrón es inusual — un formulario de acción interrumpe una página de consulta. Recomendación: mover a un diálogo/modal o a una sección colapsable. |
| 🟡 | El título de sección "← Devolver a stock" usa una **flecha ← como ícono decorativo** en el título — inconsistente con los demás títulos de sección de la app. |
| 🟡 | La columna "Mínimo" en la tabla de stock muestra "— ✏" (dash + ícono edición) — el ícono de editar está muy pegado al dash, visualmente confuso. El ícono debería estar en una columna de acciones separada o con más separación. |
| 🔵 | El texto en la columna "Observación" del Kardex se corta ("Recepción REC-2026-0001 — guía s/n"). Verificar que hay tooltip o expansión para el texto completo. |
| ⚪ | El empty state de "Cholguan — Sin stock en esta faena" aparece inline entre secciones de faenas — correcto contextualmente, pero podría tener más padding para separarse visualmente. |

---

### 15 · Entregas `/entregas`
📸 [`15-entregas.png`](screenshots/15-entregas.png)

| Sev | Hallazgo |
|-----|----------|
| 🟠 | El campo **"Comprobante"** usa el **input nativo del browser** ("Choose File No file chosen") sin ningún estilo — único componente en toda la app con apariencia nativa. Rompe completamente el look & feel. Usar un componente de file upload estilizado (drag & drop o botón custom). |
| 🟡 | El botón "Registrar entrega" aparece deshabilitado visualmente (gris) pero está alineado a la derecha del grupo Comprobante/Notas, lejos del flujo natural del formulario (que empieza arriba a la izquierda). El CTA principal debería estar más al final lógico del formulario. |
| 🔵 | El formulario ocupa todo el ancho a 1440px — los campos de fecha/texto se extienden demasiado. Max-width de ~800px para el form container mejoraría la legibilidad. |
| ⚪ | El empty state del historial usa un ícono de persona (avatar) — semánticamente correcto para "sin entregas a trabajadores", pero el ícono es muy pequeño. |

---

### 16 · Trazabilidad `/trazabilidad`
📸 [`16-trazabilidad.png`](screenshots/16-trazabilidad.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | Los **filtros de Faena y Estado usan `<select>` nativos** del browser — inconsistentes con el resto del sistema (ver T3). A 1440px se notan visualmente diferentes. |
| 🟡 | El nombre del producto "Blusa Absolute Zero Lightwind Polié..." está **truncado** con elipsis — hay suficiente espacio horizontal para más texto o al menos un tooltip al hover. |
| 🟡 | El botón **"Exportar Excel"** usa ícono de descarga y estilo outlined, mientras los botones de exportar en Reportes tienen un estilo diferente. Unificar el patrón de botones de exportación. |
| 🔵 | La nota informativa al pie ("Las filas resaltadas indican ítems aprobados cuya cantidad...") es de texto muy pequeño. Considerar aumentar el tamaño o convertirla en un tooltip/info icon. |

---

### 17 · Reportes `/reportes`
📸 [`17-reportes.png`](screenshots/17-reportes.png)

| Sev | Hallazgo |
|-----|----------|
| 🔴 | **Los estados del sistema están en inglés sin traducir**: la sección "Estados principales" muestra `draft`, `closed`, `in_purchasing`, `received`, `in_purchase_order`, `issued` — valores directos de la BD. Para usuarios en producción esto es inaceptable. Deben mapear a etiquetas en español: "Borrador", "Cerrada", "En compra", "Recibida", "En OC", "Emitida". |
| 🟡 | El botón **"Exportar Ítems sin OC"** tiene un estilo diferente (borde color ámbar/naranja) comparado con los otros dos botones de exportar (borde gris). Si es para diferenciar una acción más importante, usar el botón primary verde. Si no, unificar estilos. |
| 🟡 | Los **KPI cards** a 1440px tienen mucho espacio interno — los 5 cards en una fila podrían usar el espacio de forma más densa (o un máximo de 3 por fila con más contenido por card). |
| 🔵 | El contador "0 OC pendientes de recepción" en la card "Recepciones" — el texto de descripción y el número son del mismo peso visual, el número no destaca como el KPI principal. |

---

### 18 · Panel de Administración `/admin`
📸 [`18-admin-hub.png`](screenshots/18-admin-hub.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | La tarjeta **"Proveedores"** parece tener un fondo con tinte ligeramente diferente (verde/gris) comparado con las otras tarjetas blancas — podría ser un hover state capturado o un bug de estilo. Verificar en browser. |
| 🔵 | El grid de 3 columnas deja la tarjeta "Log de Auditoría" sola en la tercera fila — layout visualmente desequilibrado. Con 7 tarjetas, considera una grilla de 4+3 o 3+2+2. |
| ⚪ | Las tarjetas no tienen ningún indicador visual de conteo/estado (ej: "4 usuarios activos", "53 productos") — podría agregar valor contextual al panel de administración. |

---

### 19 · Usuarios `/admin/usuarios`
📸 [`19-admin-usuarios.png`](screenshots/19-admin-usuarios.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | La columna **"Faenas"** muestra "0" para todos los usuarios incluido el administrador — si el admin es global y no necesita faenas asignadas, mostrar "Global" o "Todas" en lugar de "0", que suena como si fuera un error. |
| 🟡 | Los **íconos de acción** en la última columna (lápiz + toggle) son muy pequeños y sin label — al menos un tooltip en hover mejoraría la accesibilidad. El toggle (ojo de activar/desactivar) no tiene estado visual claro de activo/inactivo sin colores distintos. |
| 🔵 | Los **avatares de colores** de los usuarios no siguen un sistema consistente — algunos son verdes, rosa, ocre, etc. Usar un hash del email/nombre para color determinístico, o mantener solo un color de marca. |

---

### 20 · Diálogo Nuevo usuario
📸 [`20-admin-usuarios-dialog-crear.png`](screenshots/20-admin-usuarios-dialog-crear.png)

| Sev | Hallazgo |
|-----|----------|
| 🟠 | Los **chips de roles** ("Administrador", "Jefa Chome", etc.) no muestran cuál está seleccionado — ninguno tiene estado visual activo. El usuario no sabe si debe hacer click para seleccionar uno. ¿Son radio buttons? ¿Checkboxes? ¿Toggles? El patrón necesita un estado de "selected" claro (fondo sólido, checkmark, borde más grueso). |
| 🟡 | La sección "FAENAS ASIGNADAS" muestra nombre + código en mayúscula ("Cabrero CABRERO") — el código técnico en all-caps es ruido visual. Mostrar solo el nombre o el código como subtexto pequeño. |
| 🟡 | El campo contraseña tiene placeholder "Mínimo 6 caracteres" — pero en `/registro` dice "Mínimo 8 caracteres". Inconsistencia en requisitos mínimos de contraseña. Unificar. |
| 🔵 | El modal no tiene indicación de scroll si hubiera más faenas — considerar altura máxima + scroll interno para la sección de faenas. |

---

### 21 · Diálogo Invitar usuario
📸 [`21-admin-usuarios-dialog-invitar.png`](screenshots/21-admin-usuarios-dialog-invitar.png)

| Sev | Hallazgo |
|-----|----------|
| 🟠 | Mismo problema de **chips de rol sin estado visible de selección** (ver #20). |
| 🟡 | El campo **"Nombre"** no tiene asterisco de requerido, pero en el diálogo de Nuevo Usuario el "Nombre completo" sí lo tiene. Inconsistencia: ¿es el nombre requerido para invitar o no? Aclara y unifica. |
| 🔵 | El campo "Vigencia" (número de días) se ve como un input de texto libre — un `<input type="number">` con min/max o un selector de días predefinidos sería más claro. |

---

### 22 · Faenas `/admin/faenas`
📸 [`22-admin-faenas.png`](screenshots/22-admin-faenas.png)

| Sev | Hallazgo |
|-----|----------|
| 🔵 | Tabla limpia y funcional. El **ícono de acción derecha** (toggle) tiene la misma ambigüedad señalada en Usuarios — sin estado visual claro. |
| ⚪ | La columna "REGIÓN" muestra "Bio-Bio" y "Ñuble" con capitalización mixta — considerar formato consistente (todo title-case). |

---

### 23 · Diálogo Nueva faena
📸 [`23-admin-faenas-dialog.png`](screenshots/23-admin-faenas-dialog.png)

| Sev | Hallazgo |
|-----|----------|
| 🔵 | Formulario limpio y bien estructurado. El help text "Código único. Se auto-genera del nombre." es útil. |
| ⚪ | El campo "Región" acepta texto libre — un select con las regiones de Chile sería más preciso y consistente. |

---

### 24 · Trabajadores `/admin/trabajadores`
📸 [`24-admin-trabajadores.png`](screenshots/24-admin-trabajadores.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | El **empty state duplica el CTA**: el botón "+ Nuevo trabajador" está tanto arriba-derecha como centrado en el empty state. Con pocos usuarios, ambos son visibles simultáneamente — redundante. El patrón preferible: mostrar solo en el empty state cuando no hay datos, y solo en top-right cuando sí hay datos. |
| 🔵 | Los **headers de tabla se muestran con el empty state** — visualmente los headers flotan sobre el mensaje de vacío. Ocultar headers cuando la tabla está vacía. |

---

### 25 · Diálogo Nuevo trabajador
📸 [`25-admin-trabajadores-dialog.png`](screenshots/25-admin-trabajadores-dialog.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | El **select de Faena usa `<select>` nativo** ("Selecciona una faena") — inconsistente con el resto (ver T3). |
| 🔵 | El texto de ayuda "Formato: 12345678-9" para el RUT es útil, pero el campo no tiene máscara/formato automático — el usuario debe escribir manualmente el guión. Considerar una máscara de RUT chileno. |

---

### 26 · Catálogo de productos `/admin/productos`
📸 [`26-admin-productos.png`](screenshots/26-admin-productos.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | La tabla de productos es muy **densa a 1440px** con 50+ productos — la página de full-scroll es muy larga. La paginación o scroll virtual mejoran la UX. Verificar si existe paginación (no visible en la captura). |
| 🟡 | La columna de categoría al final de la página muestra texto truncado ("Elementos de protección personal PP") — las categorías largas no tienen suficiente ancho. |
| 🔵 | El **panel de categorías** (category-panel) mencionado en el código no se abrió en la captura — verificar que existe un trigger visible para él. |

---

### 27 · Nuevo producto `/admin/productos/nuevo`
📸 [`27-admin-productos-nuevo.png`](screenshots/27-admin-productos-nuevo.png)

| Sev | Hallazgo |
|-----|----------|
| 🟠 | La ruta `/admin/productos/nuevo` es una **página completa con título "Nuevo producto"** pero la captura muestra que se abre un **modal encima** con el mismo título "Nuevo producto" — el usuario ve doble título. La ruta de página y el modal están duplicando la misma funcionalidad. Decidir: ¿es una ruta de página o un modal? No debería ser ambos. |
| 🟡 | El **botón de cierre del modal (X)** tiene un estilo de box con borde — diferente a los demás modales que usan un × de texto (ver T5). |
| 🔵 | Las **tabs "General / Atributos / Proveedores"** son una buena solución para un formulario complejo, pero no hay indicación visual de si alguna tab tiene errores de validación. |

---

### 28 · Editar producto `/admin/productos/[id]`
📸 [`28-admin-producto-editar.png`](screenshots/28-admin-producto-editar.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | Mismo problema de **doble contexto** que #27 — la página de fondo muestra el nombre del producto, y el modal dice "Editar producto". |
| 🟡 | La tab "Proveedores **1**" muestra un badge numérico — buen patrón, pero el "1" es muy pequeño. Considerar un badge más visible. |
| ⚪ | El campo Notas ya muestra "Fuente: EPP PROVEEDORES.xlsx. Proveedor original: TRECK." — notas de importación de datos en producción. Limpiar o mover a un campo interno. |

---

### 29 · Proveedores `/admin/proveedores`
📸 [`29-admin-proveedores.png`](screenshots/29-admin-proveedores.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | La columna **"GIRO"** muestra dos líneas de texto (giro + dirección) dentro de una celda — mezcla dos datos distintos. Separar en columnas "Giro" y "Dirección/Ciudad" para lectura más clara. |
| 🔵 | El texto del GIRO está en TODAS MAYÚSCULAS ("DISTRIBUCION, IMPORTACION Y EXPORTACION") — proveniente de los datos, pero podría aplicarse capitalización con CSS (`text-transform: capitalize` o procesarlo). |

---

### 30 · Diálogo Nuevo proveedor
📸 [`30-admin-proveedores-dialog.png`](screenshots/30-admin-proveedores-dialog.png)

| Sev | Hallazgo |
|-----|----------|
| 🟠 | El **modal se desborda fuera del viewport visible** — el campo "Notas" al final está cortado y no hay barra de scroll visible dentro del modal. El usuario no sabe que hay más contenido. Agregar `overflow-y-auto max-h-[80vh]` al contenido del modal. |
| 🔵 | El formulario es largo (12+ campos) — un layout de 2 columnas para campos cortos (Contacto/Teléfono, Comuna/Ciudad) está bien, pero la modal completa podría beneficiarse de secciones colapsables o una tab "Información comercial" separada. |

---

### 31 · Configuración del sistema `/admin/configuracion`
📸 [`31-admin-configuracion.png`](screenshots/31-admin-configuracion.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | El grid de campos es **inconsistente**: "Razón social" + "RUT" van en 2 columnas; "Dirección" es full-width; "Giro" es full-width; "Otra dirección" es full-width; "Teléfono" + "Correo" + "Sitio web" van en **3 columnas**. El ritmo de 2→1→1→1→3 se siente errático. Definir una grilla consistente de 2 columnas y hacer full-width solo los campos que lo necesiten. |
| 🔵 | El campo "Límite de tamaño de archivo PDF (MB)" muestra el número "10" con etiqueta "MB" al lado — funciona, pero un input tipo range o un number input con unidades integradas sería más claro. |
| ⚪ | El botón "Guardar Configuración" está al final de la página sin un sticky footer — en pantallas largas el usuario necesita scrollear para encontrarlo. |

---

### 32 · Log de Auditoría `/admin/auditoria`
📸 [`32-admin-auditoria.png`](screenshots/32-admin-auditoria.png)

| Sev | Hallazgo |
|-----|----------|
| 🟠 | Hay un **botón flotante verde "Crear..."** en la esquina inferior izquierda del log de auditoría — un log de auditoría no debería tener CTAs de creación. Este parece ser un artefacto de desarrollo o un componente de navegación que no debería estar aquí. Investigar y remover. |
| 🟡 | La tabla es muy **densa y de texto muy pequeño** en fullPage — hay muchas columnas (FECHA/HORA, USUARIO, ACCIÓN, ENTIDAD, OBJETO, MOTIVO). Las columnas de texto largo están truncadas. Considerar un layout más espacioso o la posibilidad de expandir una fila para ver detalles. |
| 🔵 | No hay filtros visibles (por fecha, usuario, tipo de acción) — para un log de auditoría esto es esencial. |

---

### 33 · Menú de usuario (top-bar dropdown)
📸 [`33-topbar-user-menu.png`](screenshots/33-topbar-user-menu.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | No hay **separador visual** entre el link "Administración" y "Cerrar sesión" — la acción de cerrar sesión es destructiva/importante y debería estar claramente separada del link de navegación. Agregar un `<Separator />` entre ambos. |
| 🔵 | El badge de rol "ADMINISTRADOR" en el dropdown usa texto monoespaciado en all-caps — diferente al estilo de los badges de rol en la tabla de Usuarios ("ADMINISTRADOR" con diferente tamaño y color). Unificar. |
| ⚪ | El dropdown aparece correctamente alineado a la derecha. Buen comportamiento. |

---

### 34 · Campana de notificaciones
📸 [`34-topbar-notification-bell.png`](screenshots/34-topbar-notification-bell.png)

| Sev | Hallazgo |
|-----|----------|
| 🔴 | **El click en la campana no abre ningún panel de notificaciones** — la captura muestra el mismo dashboard sin ningún cambio. La campana muestra badge "3" pero es un elemento no funcional (o el evento click no se propagó correctamente). Los usuarios que vean el badge "3" esperarán poder ver esas notificaciones. **Esto es un bug de alto impacto de UX.** |

---

### 35 · Vista de impresión de OC `/compras/[id]/print`
📸 [`35-compra-print.png`](screenshots/35-compra-print.png)

| Sev | Hallazgo |
|-----|----------|
| 🟠 | El documento imprimible usa **formato de número "0,00"** (coma como separador decimal) mientras toda la app usa **punto como separador de miles** ("$1.092.349"). Esta inconsistencia es visible: el valor en la OC muestra "0,00" pero el total del sistema era "$0". Unificar con el formato chileno estándar: punto de miles, sin decimales para montos enteros. |
| 🟡 | La línea "**NP 03**" aparece en el campo "Detalle" de la línea de producto — parece ser una referencia interna ("Nota de Pedido 03") que no tiene contexto para el proveedor que recibe el documento. Considerar omitirla o agregar una etiqueta explícita. |
| 🟡 | El encabezado de la empresa solo muestra "Chome" y el logo — falta la dirección, teléfono y correo que sí se configuraron en `/admin/configuracion`. El layout del print no está consumiendo todos los campos de configuración. |
| 🔵 | El área de firma al pie tiene campos de "Nombre", "R.U.T.", "Fecha", "Recinto", "Firma" — todos en líneas punteadas. A 1440px (pre-print) la OC se ve centrada con márgenes laterales grandes, lo que es correcto para orientación de impresión. |

---

### 36 · Error 404 / Recurso no encontrado
📸 [`36-404-interno.png`](screenshots/36-404-interno.png)

| Sev | Hallazgo |
|-----|----------|
| 🟡 | El botón **"Volver al inicio"** usa un estilo outlined/secondary — en una pantalla de error el CTA de recuperación debería ser el botón primary (verde) para guiar con claridad al usuario. |
| 🟡 | La pantalla no tiene **breadcrumbs ni indica la URL** que causó el error — el usuario no tiene contexto de dónde estaba. Aunque es difícil de hacer elegante, al menos el mensaje podría personalizarse según el tipo de recurso. |
| 🔵 | El **copy** "El registro que buscas no existe o fue eliminado." supone que el usuario estaba buscando un registro específico — pero podría haberse equivocado en la URL. Copy más neutral: "La página que buscas no existe o no tienes acceso a ella." |

---

## Tabla de quick-wins priorizados

Issues de alto impacto y bajo costo de implementación ordenados por ROI:

| Prioridad | Issue | Archivo(s) clave | Esfuerzo |
|-----------|-------|-----------------|---------|
| 🔴 1 | Traducir estados de BD al español en Reportes | `app/(app)/reportes/page.tsx` | 1h |
| 🔴 2 | Investigar y arreglar campana de notificaciones | `components/layout/notification-bell.tsx` | 2–4h |
| 🟠 3 | Hacer filas de tablas completamente clickeables (cursor pointer + onClick) | `components/ui/table.tsx`, todos los list components | 2h |
| 🟠 4 | Agregar estado visual de selección a chips de rol en diálogos | `app/(app)/admin/usuarios/user-form.tsx`, `user-invite-form.tsx` | 1h |
| 🟠 5 | Estilizar el input de archivo en Entregas con componente custom | `app/(app)/entregas/` (delivery form component) | 2h |
| 🟠 6 | Limitar altura del modal de Proveedor y agregar scroll interno | `app/(app)/admin/proveedores/supplier-form.tsx` | 30min |
| 🟠 7 | Remover el botón flotante "Crear" del Log de Auditoría | `app/(app)/admin/auditoria/page.tsx` | 15min |
| 🟠 8 | Eliminar la indicación de desarrollo "N" de Next.js en producción | `next.config.ts` o `app/layout.tsx` (condition NODE_ENV) | 30min |
| 🟡 9 | Corregir el placeholder de fecha a formato `dd/mm/aaaa` | `app/(app)/solicitudes/request-form.tsx` | 15min |
| 🟡 10 | Reemplazar `<select>` nativos por componente `Select` de shadcn | `app/(app)/trazabilidad/page.tsx`, `admin/trabajadores/worker-form.tsx` | 1h |
| 🟡 11 | Agregar separador entre "Administración" y "Cerrar sesión" en user menu | `components/layout/top-bar.tsx` | 10min |
| 🟡 12 | Unificar el formato numérico en el print de OC (punto de miles, sin decimales) | `app/(print)/compras/[id]/print/page.tsx` | 1h |
| 🟡 13 | Resolver doble título en `/admin/productos/nuevo` (página + modal) | `app/(app)/admin/productos/nuevo/page.tsx` | 1h |
| 🟡 14 | Mover la acción "Marcar enviada" fuera de la celda de estado | `app/(app)/compras/oc-list.tsx` | 1h |
| 🔵 15 | Agregar máscara de RUT chileno en formularios de Trabajadores y Proveedores | `admin/trabajadores/worker-form.tsx`, `admin/proveedores/supplier-form.tsx` | 1h |

---

*Reporte generado automáticamente con Playwright (Chromium headless, 1440×900) — 2026-06-10*
