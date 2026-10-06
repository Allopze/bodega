---
target: dashboard de inicio (app/(app)/dashboard)
total_score: 20
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/allopze/dev/chome/bodega/app/(app)/dashboard"
timestamp: 2026-10-06T00-19-45Z
slug: app-app-dashboard
---
Method: dual-agent (A: tres revisiones de diseño aisladas, una por área · B: detector + navegador). Ninguna evaluación A vio la salida de B.

# Crítica UI/UX: Inicio, Adquisiciones y Bodega (5 de octubre de 2026)

**Alcance:**

- **Listas y vistas (18):**
  - Inicio: `/dashboard` con sus 9 vistas;
  - Adquisiciones: `/solicitudes`, `/aprobaciones`, `/compras` y `/recepcion`;
  - Bodega: `/bodega`, `/bodega/trazabilidad`, `/bodega/guias`, `/bodega/documentos` y `/entregas`.
- **Además:**
  - 13 detalles;
  - 4 formularios de alta;
  - la hoja "Registrar movimiento" en sus 4 modos.
- **Condiciones:** 1440×900 y 390×844, con la sesión QA (rol administrador global) y en solo lectura.

Informe con IDs y clasificación por categoría: `qa/reports/2026-10-05-inicio-adquisiciones-bodega-uiux-audit.md`.

## El diagnóstico en una frase

El problema no es visual sino de organización. Cada pantalla está bien hecha, pero cada una se ordena según su entidad o según el estado interno de su módulo. Ninguna parte de la pregunta del usuario: *¿qué me toca, en qué etapa va y quién lo tiene?*

Por eso "funciona" y aun así no se entiende.

## Puntaje de salud de diseño

| # | Heurística | Inicio | Adq. | Bodega | Problema clave |
|---|---|---|---|---|---|
| 1 | Visibilidad del estado | 2 | 2 | 2 | La etapa y el responsable solo se ven en el detalle. Lo pendiente se ve más débil que lo cerrado. |
| 2 | Lenguaje del usuario | 2 | 2 | 2 | Siglas sin expandir. "Emitir y enviar" no envía nada. "Trazabilidad" muestra compras. |
| 3 | Control y libertad | 3 | 2 | 3 | El alcance vive en la URL y "atrás" funciona. Las acciones irreversibles se hacen con un clic. |
| 4 | Consistencia | 1 | 2 | 2 | Un mismo rótulo muestra cifras distintas. Hay 7 nombres para "esperando proveedor". La faena por defecto cambia según la pantalla. |
| 5 | Prevención de errores | 3 | 2 | 2 | No hay confirmación al aprobar en lote, al emitir la OC ni al cerrar el conteo. El ajuste no muestra el saldo resultante. |
| 6 | Reconocer antes que recordar | 2 | 2 | 2 | La OC emitida "se muda" a Recepción. La hoja no hereda la faena. |
| 7 | Flexibilidad y eficiencia | 2 | 3 | 1 | Registrar un movimiento en Bodega cuesta 6–7 interacciones. La hoja se cierra después de cada uno y no hay acciones por fila. |
| 8 | Estética y minimalismo | 2 | 2 | 2 | El hero muestra "Inversión $0". El detalle de solicitud mide 7.837 px en móvil. Trazabilidad abre con 7 ceros. |
| 9 | Recuperación de errores | 2 | 3 | 3 | Algunas búsquedas responden "sin resultados" cuando el registro sí existe. |
| 10 | Ayuda y documentación | 1 | 3 | 2 | Inicio no explica ninguna sigla. `KpiCard.glossary` existe y no se usa. |
| **Total** | | **20/40** | **23/40** | **21/40** | Las tres áreas quedan en "Aceptable". Combinado: 64/120 (53 %). |

## Veredicto de especificidad

**Evaluación del modelo.** Las tres revisiones llegaron por separado a la misma conclusión.

- **El lenguaje visual sí es de Chome:** pozo blanco, Exo y Myriad, cifras en mono y naranja reservado para pendientes.
- **La estructura es intercambiable.** Todas las pantallas usan `PageHeader` + pestañas de estado + filtros + `DataTable`. Inicio sigue la receta de tablero SaaS: tile hero, medidor radial, gráfico de áreas y feed.
- **Lo propio del dominio solo existe en el detalle:** el stepper Solicitado → Entrega, el Expediente SOL → OC → REC → GDI, el detalle de guía con su cotejo y la talla habitual en la entrega. Nada de eso llega a las listas, que es donde el usuario decide.

**Escaneo determinista.**

- **CLI:** 0 hallazgos en 174 archivos. Comprobé que funciona con un archivo trampa.
- **Navegador:** 419 hallazgos en bruto, de los cuales ~80 son verdaderos positivos con ~10 causas, todos P3. El resto son falsos positivos: 233 "tarjetas anidadas" cuya única tarjeta exterior es el pozo de la shell, texto dentro de `<details>` cerrados y la transición de Sonner.
- **axe:** 0 violaciones en 36/36.
- **Consola y red:** 0 errores y 0 requests fallidos.

**Coincidencias y diferencias.** El detector confirma que no hay "relleno genérico": el problema no está en la pintura, y por eso el detector no lo ve. Aportó lo que las revisiones no vieron:

- la campana con `animate-ping` permanente;
- texto de 10 px;
- `transition-all` en `KpiCard`;
- 19 objetivos táctiles bajo 24 px en Guías y 17 en Entregas.

**Overlays.** No hay overlay visible: el navegador fue headless, y `detect.js` exigió `bypassCSP` porque el nonce de la CSP lo bloquea.

## Impresión general

**Lo que funciona** es la base: estado en la URL, tiles que llevan a su subconjunto, formularios guiados y accesibilidad automática limpia.

**Lo que falla** es la capa que convierte datos en orientación:

- Inicio contradice sus propias cifras.
- Adquisiciones son cuatro herramientas cosidas.
- Bodega no responde "qué necesita atención".

**La mayor oportunidad:** llevar a las listas la etapa y el "le toca a" que el dominio ya calcula (`requestCurrentStage` / `requestNextAction`).

## Lo que funciona

1. **Hilo documental del detalle.** `RequestProgressPanel` muestra la etapa, el siguiente paso con su CTA y el expediente SOL → OC → REC → GDI, y el detalle de guía incluye el cotejo. Es el modelo que les falta a las listas: no hay que inventarlo, solo subirlo.
2. **Alcance honesto y persistente.**
   - `vista`, `faena` y `periodo` viven en la URL, con `router.replace` + `scroll:false`.
   - Cada tile lleva a su subconjunto.
   - "Atrás" vuelve a la vista correcta (verificado).
3. **Formularios de captura que conocen el dominio:**
   - "Generar OC" precargado y con el aviso "se dividirá en 2 OC";
   - guardas de sobre‑recepción;
   - entrega por familia y luego talla, con la talla habitual y el canje plegado;
   - checklist en vivo en la solicitud.

## Problemas prioritarios

### [P1] 1. Inicio: el mismo rótulo muestra cifras que no cuadran, y el período no hace nada

**Qué pasa:**

- **OC emitidas, período Mes:** Resumen 0, Adquisiciones 2, Finanzas 2.
- **Período Año:** Resumen dice 28 e "Inversión $4.276.923"; Finanzas dice "29 OC" y "$3.105.487".
- **Pendientes:** 331 / 99+ / 215 / 238, sin explicar cómo se relacionan.
- **Causa de las OC:** Resumen cuenta por `issuedAt`, mientras Adquisiciones llama "OC emitidas" a lo que su detalle llama "Órdenes creadas" (`acquisitions-section.tsx:57`).
- **Período:** al pasar de Mes a Año, el texto completo de Mi trabajo, Prevención y Terreno queda idéntico. Aun así el control se muestra siempre (`dashboard-scope-controls.tsx:282`).

**Por qué importa:** PRODUCT.md exige "indicadores reconciliables". Quien compara deja de creer en el tablero.

**Cómo arreglarlo:**

- Una definición por rótulo, servida por un solo servicio. Si las definiciones difieren, que los rótulos también difieran.
- Mostrar el período solo donde algo responde. En las demás vistas, "Estado al día de hoy".

**Comando sugerido:** `/impeccable clarify`

### [P1] 2. Inicio: jerarquía invertida

**Qué pasa:**

- El único tile hero es siempre la primera ranura (`operational-metrics-strip.tsx:248`). Hoy muestra "Inversión $0".
- Las 215 vencidas aparecen recién en el 4.º tile.
- En móvil, "Requiere atención" queda ~2.000 px más abajo.
- El CTA primario apunta a 1 ítem.
- **"Mi trabajo" duplica `/pendientes`, pero peor:**
  - corta en 12 ("12 de 12 visibles" con 331 en total);
  - el buscador filtra solo esas 12;
  - los chips navegan fuera de la página;
  - la misma cola tiene 5 nombres.

**Cómo arreglarlo:**

- Quitar el hero, o que destaque lo más urgente con valor mayor que 0.
- "Requiere atención" primero.
- CTA calculado: "Ver 215 vencidas".
- "Mi trabajo" como un resumen de "Hoy" con un solo enlace.

**Comando sugerido:** `/impeccable layout` + `/impeccable distill`

### [P1] 3. Adquisiciones: el proceso solo existe en el detalle

**Qué pasa:**

- **Las listas muestran el estado interno del módulo**, sin etapa ni responsable.
- **Vocabulario:**
  - "Esperando al proveedor" tiene 7 nombres;
  - Recepción tiene juntas las pestañas "Por recibir" y "Pendiente de recepción".
- **La OC emitida sale de Compras:** buscar `OC-2026-0029` muestra "Sin órdenes de compra".
- **Aprobaciones:**
  - "APROBADA" se ve como un éxito, pero en realidad está esperando su OC;
  - el código de solicitud no enlaza a la solicitud;
  - Repuestos y Servicios quedan fuera de la bandeja.
- **Sidebar:**
  - el badge de Solicitudes dice 36, que son todas las abiertas;
  - Compras y Recepción no muestran badge: el layout calcula el número, pero los manifests no declaran `badge`.

**Cómo arreglarlo:**

- Columna "Etapa · Le toca a", con `buildRequestProgress`.
- Pestañas por etapa.
- Un solo mapa de vocabulario.
- Badges de "te toca".
- Pestaña "Emitidas (en Recepción)".
- "Ver solicitud" en Aprobaciones.

**Comando sugerido:** `/impeccable shape`, y luego `clarify`

### [P1] 4. Todas las áreas: lo pendiente se ve débil y lo cerrado, fuerte

**Qué pasa:**

- **Badges:**
  - las variantes de severidad del `Badge` van en mono y MAYÚSCULAS;
  - `default` e `info` van en caja normal;
  - resultado: APROBADA, RECIBIDA, ANULADA y COMPLETADA destacan, mientras Borrador, Despachada y Pendiente de recepción pasan desapercibidas.
- **Guías despachadas:**
  - "Despachada" usa `info` (`state-badge.tsx:155`);
  - hay 5 guías con 35 días sin confirmar, y nada lo señala.
- **Bodega no tiene capa de atención:**
  - se retiró el stock mínimo;
  - un 0 se ve con el mismo peso que 121;
  - el badge del menú Bodega está declarado, pero nunca se calcula;
  - Entregas calcula el EPP por entregar y lo descarta.

**Cómo arreglarlo:**

- Corregir el mapeo en `state-badge.tsx`: lo que espera acción va en `signal`, lo cerrado en un tono tranquilo.
- Una franja de hasta 4 alertas en `/bodega`.

**Comando sugerido:** `/impeccable colorize` + `/impeccable clarify`

### [P1] 5. Todas las áreas: acciones irreversibles con un clic, y una que afirma algo falso

**Qué pasa:**

- **"Emitir y enviar":**
  - se ejecuta con un clic, también desde la fila;
  - la plataforma no despacha nada (`order-status.ts:80`);
  - aun así, el banner dice "Orden emitida y enviada al proveedor." (`compras/[id]/page.tsx:587`).
- **"Aprobar N" en lote:** no pide confirmación, pero aprobar 1 ítem sí la pide.
- **"Cerrar conteo":** cierra sin resumen previo, y carga 266 productos cuando solo 8 tienen stock.
- **Ajuste:** un Egreso de 99999 con stock 4 deja el botón habilitado.
- **Recepción:** viene precargada al 100 %.

**Cómo arreglarlo:**

- **Emisión de la OC:**
  - renombrar el botón a "Emitir OC";
  - confirmación con proveedor y total;
  - después: "Ahora envíala: PDF / correo / constancia".
- **Lote:** confirmación con un resumen.
- **Conteo:** resumen de los ajustes antes de cerrar.
- **Ajuste:** pedir la cantidad real y mostrar "4 → X".

**Comando sugerido:** `/impeccable harden`

### [P1] 6. Bodega: la arquitectura sigue a los documentos, no a los trabajos

**Qué pasa:**

- **La hoja de movimientos:**
  - no ofrece Entregar ni Ingresar;
  - la Devolución es un callejón sin salida: exige entregas "a faena", y el código solo crea entregas a trabajador (en dev, 58/58 son a trabajador);
  - la merma cabe en 3 opciones.
- **Trazabilidad** en realidad es seguimiento de compras: muestra 7 ceros y un vacío sin CTA.
- **Documentos** es pestaña y página a la vez: al entrar, se pierden las pestañas.
- **Guías** se titula "Historial".
- **La hoja no hereda la faena.**

**Cómo arreglarlo:**

- **La hoja:** ordenarla por frecuencia; reconectar la Devolución o retirarla.
- **Navegación:**
  - pestañas Stock | Movimientos | Documentos;
  - Guías abre en "Por confirmar";
  - Trazabilidad pasa a Adquisiciones.
- **Contexto:** faena precargada y menú por fila.

**Comando sugerido:** `/impeccable shape`

### [P1] 7. Búsquedas que dicen "no existe" cuando sí existe (bug confirmado en ejecución)

**Qué pasa:**

- **Entregas:** la shell filtra solo 25 de 58 filas. Buscar "Eduardo" (página 3) responde "Sin entregas" mientras se lee "1 - 25 de 58". La causa: `/entregas` no está en `ROUTES_WITH_OWN_SEARCH` y no usa `disableInternalSearch`.
- **Inicio:** el buscador aparece en 9 vistas y solo filtra Mi trabajo. Es el mismo defecto que TIUX-35.
- **Compras:** los filtros de la tabla de abajo vacían la cola de arriba.

**Cómo arreglarlo:**

- Búsqueda de servidor en Entregas.
- Ocultar la búsqueda de la shell en `/dashboard` salvo en `vista=trabajo`.
- En Compras, un vacío que diga "¿Buscas una OC emitida? Está en Recepción →".

**Comando sugerido:** `/impeccable harden`

## Alertas por persona

**Alex (comprador con 30 OC / bodeguero con 20 movimientos):**

- 29 de sus OC viven en Recepción.
- Buscarlas en Compras no da resultados.
- Compras no tiene badge.
- No puede emitir en lote.
- "Crear OC (5 ítems)" crea 2 OC.
- Cada movimiento cuesta 6–7 interacciones, la hoja se cierra después de cada uno y tiene que volver a elegir la faena.

**Sam (teclado y lector de pantalla):**

- Lo bueno: foco visible y orden lógico.
- "Requiere atención" llega recién en la parada 20 de Tab, después de 2 `<svg>` de recharts sin nombre.
- No hay `<abbr>`.
- El select "Vía oficina" se autoenvía.
- El detalle de solicitud se anuncia como unos 15 combobox deshabilitados.
- El conteo tiene 266 inputs dentro de un scroll anidado.

**Jordan (primera vez):**

- Lee "APROBADA" como "viene en camino".
- Lee el badge 36 como "36 cosas por hacer".
- El formulario le pide decisiones de compras.
- La faena por defecto no es la suya [C].
- Ve "Bodega › Bodega".
- "Devolución a stock" le responde "Sin entregas pendientes".

**Bodeguero en faena (celular, guantes):**

- En Recepción, la primera OC aparece a unos 590 px.
- Guías tiene 19 objetivos táctiles bajo 24 px, y Entregas 17.
- El formulario de entrega mide 1.207 px y no tiene barra fija.
- El conteo trunca la talla.

**Jefatura en Inicio:**

- Ve "$0", un 215 en rojo y un 0 % en el medidor.
- Toca "Trimestre" y no pasa nada.
- Las cifras no cuadran entre vistas.

## Observaciones menores (P2/P3)

**Inicio:**

- El saludo termina en "—": `formatDateLong()` se llama sin argumento (`page.tsx:169`).
- "-472526 vs. mes anterior", sin formato.
- "1 tareas críticas".
- El gasto que baja aparece en rojo.
- Estados crudos: "borrador: 99".
- "Por área" esconde 7 dominios, con nombres distintos a los del sidebar.
- Formatos de gráfico mezclados.

**Adquisiciones:**

- Compras tiene dos tablas con filtros cruzados y pestañas que no suman. "COMPLETADA" aparece junto a "Revisar conciliación".
- El detalle de solicitud es un formulario deshabilitado de 3.269 px. Repite los ítems 3 veces y muestra `supervisor_faena`.
- El siguiente paso está desactualizado: "Despacha a faena" con la GDI ya despachada, y "Guía: Sin guía" junto a GDI-000019.
- Una SOL Cerrada tiene el stepper detenido en Recepción.
- "1ÍTEM".
- El chip "12 Por recibir".

**Bodega:**

- La faena por defecto cambia según la pantalla, y "Limpiar filtros" lleva a Oficina Central.
- El tile "Movimientos · 30 d: 6" lleva a un Kardex de 70.
- El Kardex tiene 9 columnas y 6 filtros.
- Entregas no busca por RUT.
- 25 botones "Anular" en rojo.

**Detector:**

- `animate-ping` permanente en `notification-bell.tsx:42`.
- Texto de 10 y de 11 px tenue.
- Badge en mayúsculas de 38 caracteres.
- Tarjetas anidadas en Documentos móvil.
- `transition-all` en `KpiCard`.

## Preguntas para pensar

- ¿Y si Inicio respondiera una sola pregunta, "qué me toca hoy y en qué faena", y los 7 tableros por área pasaran a Analítica?
- ¿Y si Adquisiciones fuera una sola lista de pedidos con la etapa como columna, y las cuatro pantallas actuales fueran vistas "me toca" por rol?
- Si se retiró el stock mínimo, ¿qué responde hoy "qué falta"?
- Si la plataforma no envía la OC, ¿por qué el verbo dice que sí?

## Cobertura y límites

- **Verificado en navegador:**
  - todas las listas en los 2 tamaños;
  - 5 detalles de SOL, 6 de OC, 2 de REC y 1 de GDI;
  - formularios llenados a medias;
  - la hoja en sus 4 modos;
  - búsquedas, filtros, "atrás" y orden de Tab.
- **Solo en código:**
  - lo que pasa después de enviar;
  - Repuestos y Servicios;
  - la faena por defecto de la solicitud.
- **No verificado:**
  - roles acotados (la sesión QA es global);
  - lector de pantalla real;
  - red lenta;
  - volúmenes de producción.
