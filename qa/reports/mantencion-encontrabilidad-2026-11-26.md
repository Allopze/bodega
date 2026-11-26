# Mantención: ¿qué tan fácil es encontrar cada cosa? (2026-11-26)

Este análisis responde una pregunta: ¿una persona que conoce su trabajo, pero no la plataforma, encuentra dónde hacer cada cosa en el submódulo de Mantención? Se hizo sobre `main` `edc9b2fb3` y no se cambió código.

Acompaña a la auditoría del mismo día ([mantencion-auditoria-2026-11-26.md](mantencion-auditoria-2026-11-26.md)) y a su detalle ([mantencion-hallazgos-detallados-2026-11-26.md](mantencion-hallazgos-detallados-2026-11-26.md)).

## Método

- **`/impeccable critique`**, con dos evaluaciones aisladas en paralelo (subagentes Sonnet):
  - **A, revisión de diseño.** Prueba de primer clic con 26 tareas de tres perfiles, heurísticas de Nielsen, carga cognitiva y personas.
  - **B, detector y navegador.** `impeccable detect` sobre 322 archivos, el detector inyectado en 7 páginas, y medidas del menú y de cada pantalla a 1440×900 y 390×844.
- **`/unslop-ui`** en modo plan, con superficie: rótulos, textos, decoración y sinónimos. No se aplicó nada.
- **`/unslop`**, pasos 1 a 3: auditoría con su lista de señales y veredicto de cuánto habría que cambiar.
- **Mapa de navegación** por perfil (jefe de mantención, supervisor, administrador de contrato, mecánico y administrador): qué ítem marca el menú, la miga, las acciones de la cabecera, el contenido de «Más acciones» y adónde lleva cada enlace.
- **Entorno:** la base desechable `bodega_e2e_auditmant`, con datos sintéticos, y la app en `localhost:3022`, ya apagada.
- **Verificación:** revisé en el código o en pantalla las afirmaciones de más peso de las tres pasadas. Lo que no se pudo comprobar se dice.

## Respuesta corta

- **Dentro de cada pantalla se encuentra bien.** Cada una tiene título, descripción, miga, pestañas con conteo y el vocabulario del oficio. La acción principal de una OT cambia con su etapa.
- **Lo difícil es llegar y saber que algo existe.** De 26 tareas, 9 son directas, 14 se logran con tropiezo, 2 están escondidas y 1 no existe.
- **Puntuación de diseño: 24 de 40,** en la banda «aceptable». Conviene mejorarla antes de que la usen personas nuevas.
- **Cinco causas:**
  1. Lo pendiente de Mantención no aparece fuera del Panel: ni en «Mis pendientes», ni en el Inicio, ni con avisos en el menú.
  2. Mantención es un grupo dentro de «Control operacional», y en el Panel se ven 2 de sus 7 ítems sin desplazar el menú. El Historial no tiene ítem.
  3. Hay rótulos que no dicen lo que contienen: «Camiones» y «Máquinas», «Marcas y talleres», «Editar mantención».
  4. Trece conceptos tienen más de un nombre.
  5. Un registro no se puede buscar por su folio.
- **La capa visual no es el problema.** El detector encontró 1 caso en 322 archivos, `/unslop` concluye que no hay nada que cambiar y `/unslop-ui` da un veredicto «Light».

---

## 1. Cómo se llega a Mantención

### Las áreas del menú, por perfil

| Perfil | Áreas del menú lateral |
|---|---|
| Jefe de mantención | Inicio, Mis pendientes, Adquisiciones, Control operacional, Bodega, Reportes, Prevención, Soporte |
| Supervisor de mantención | Inicio, Solicitudes, Control operacional |
| Administrador de contrato | Inicio, Mis pendientes, Adquisiciones, Control operacional, Guías de despacho, Facturación, Prevención, Mesa de ayuda, Soporte |
| Mecánico | Inicio, Control operacional |

Mantención no es un área. Es el tercer grupo de «Control operacional», después de Seguimiento (1 ítem) y Flota (5), y antes de Combustible (5). Sus 7 ítems son Panel de mantención, Órdenes de trabajo, Notas de pedido, Registros firmados, Equipos, Configuración y Catálogo de repuestos. Configuración pliega tres más: Pautas, Marcas y talleres, y Dispositivos.

El rótulo del grupo, «Mantención», no se puede pulsar, y en escritorio el lector de pantalla no lo anuncia (`components/layout/nav-rows.tsx:303`, `aria-hidden`).

### Lo que se ve sin desplazar el menú (1440×900)

La lista del menú mide 1.333 px y el área visible 699 px. El menú se desplaza solo hasta el ítem activo.

| Pantalla actual | Ítems de Mantención visibles |
|---|---|
| Panel, lista de OT, ficha de OT y ficha del equipo | 2 de 7: Panel de mantención y Órdenes de trabajo |
| Notas de pedido | 3 |
| Registros firmados e Historial | 4 |
| Equipos | 5 |

Configuración no muestra sus tres destinos hasta abrirla. En el teléfono, el cajón abre sólo el grupo activo y muestra los 7 ítems.

### Lo que avisa que hay trabajo

- **El Panel** abre con cuatro cifras que son enlaces: órdenes por asignar, equipos en taller, registros por revisar y notas de pedido por resolver. Es el único lugar que lo dice.
- **«Mis pendientes»** se describe como «Todo lo que requiere tu acción, en un solo lugar». Junta solicitudes, órdenes de compra, facturas, CAPA, inspecciones, MIPER, PDTP, PPA, CPHS y documentos SST, y nada de Mantención (`lib/services/operational-work-queue.ts`).
  - Con 4 órdenes por asignar, 93 registros por revisar y 2 notas por resolver, el jefe ve «Mis pendientes 4». Las cuatro son recepciones de órdenes de compra.
  - El administrador de contrato tampoco ve ahí las órdenes que esperan su conformidad.
- **El Inicio del jefe** abre con «Lo más urgente de tus pendientes» (las mismas cuatro recepciones) y con indicadores de compras y de CAPA. Nada de Mantención (captura `revision-diseno/dash-jefe.png`).
- **El menú** no tiene avisos numéricos en Mantención. Combustible sí lo tiene en «Por revisar» (`modules/combustibles/manifest.ts:84`), igual que Solicitudes, Aprobaciones, Compras, Recepción y Bodega.

### Buscar

- **La paleta de comandos** se abre con Ctrl+K o Cmd+K. Busca destinos del menú y salta a una solicitud o a una orden de compra si se escribe `SOL` u `OC`. No conoce `OT-`, `MP-`, `MC-` ni `NP-`, y ningún botón la abre (`components/layout/command-palette.tsx:21-36,84`).
- **«Filtrar en esta página»** filtra la lista ya cargada. En Notas de pedido son sólo las 50 de la página.
- **Registros firmados** busca por código o patente. Con `MP-STF-0147`, la primera fila de «Por revisar», responde «Ningún registro coincide con estos filtros. Prueba con otro período o quita algún filtro.» (captura `revision-diseno/reg-folio.png`).

---

## 2. Dónde vive cada cosa

| Qué | Dónde está | Cómo se llega | ¿Tiene ítem en el menú? |
|---|---|---|---|
| Lo pendiente hoy | Panel, pestaña Hoy: franja de cuatro cifras | Menú | Sí |
| Planificación y cumplimiento de pautas | Panel: Planificación, Camiones y Máquinas | Menú y pestaña | Dentro del Panel |
| Órdenes de trabajo | Lista con 7 pestañas por estado | Menú | Sí |
| Acciones de una OT | Botón principal según la etapa, y «Más acciones» con 1 a 8 opciones | Ficha de la OT | No |
| PDF de una OT | «Más acciones» → «Descargar PDF» | Ficha de la OT | No |
| Notas de pedido | Bandeja: Pendientes, En gestión, Cerradas y Por conciliar | Menú | Sí |
| Registros firmados | Lista: Por revisar, Observados, Revisados y Todos | Menú | Sí |
| Historial de mantenciones | Vistas Historial, Equipos por mes y Respuestas de formularios | Botón en Registros firmados, enlaces del Panel, un aviso en OT cerradas y la ficha del equipo | **No.** El menú marca «Registros firmados» |
| Importar respuestas de Google Forms | Página propia | Historial → botón de la cabecera | **No** |
| Equipos | Lista con el aviso «Falta completar» | Menú | Sí |
| Ficha del equipo | `/flota/[id]/mantencion`, pestaña Mantención | Fila de Equipos | El menú marca «Flota › Vehículos» |
| Nuevo equipo, incorporar desde la flota, importar | Diálogo «Agregar equipos» con tres opciones | Cabecera de Equipos | No |
| Lectura inicial, pauta y baja de un equipo | Diálogo «Editar mantención» | Ficha del equipo | No |
| Pautas | Lista y editor de la matriz | Configuración → Pautas | Plegado |
| Marcas, talleres, conductores, tipos de trabajo y aceites | Una página con cinco segmentos | Configuración → «Marcas y talleres» | Plegado |
| Teléfonos conectados e instalar la app | Dispositivos | Configuración → Dispositivos. El supervisor tiene además «Instalar app del mecánico» en Equipos; el jefe no | Plegado |
| Catálogo de repuestos | Lista y ficha, sin existencias | Menú | Sí |
| Existencias y reservas de repuestos | Bodega › Stock: columnas «Reservado OT» y «Libre» | Otra área | **No, desde Mantención** |
| Informe del mes en PDF | Panel, pestaña Hoy → «Exportar PDF» | Cabecera del Panel | No |

### «Más acciones» de la ficha de una OT, por etapa

| Etapa | Botón principal | En «Más acciones» |
|---|---|---|
| Por asignar | Asignar | Editar solicitud, Pedir repuestos, Descargar PDF, Anular |
| Asignada | Registrar ingreso | Reasignar, Desasignar, Editar solicitud, Pedir repuestos, Descargar PDF, Anular |
| En taller | Registrar salida, Marcar ítems | Reasignar, Corregir clasificación, Cambiar entrega estimada, Corregir ingreso, Registrar otra correctiva, Pedir repuestos, Descargar PDF, Anular |
| Por recibir | Recibir equipo, Rechazar | Corregir clasificación, Pedir repuestos, Descargar PDF |
| Por conformidad | (Dar conformidad, para quien la da) | Corregir clasificación, Pedir repuestos, Descargar PDF |
| Cerrada | Reabrir | Corregir clasificación, Descargar PDF |
| Anulada | — | Descargar PDF |

En taller, el menú tiene 8 opciones. «Pedir repuestos» abre una solicitud de compra, no una nota de pedido.

---

## 3. Prueba de primer clic

**Cómo leer la tabla.**
- **Primer clic** es lo que la persona tocaría guiándose sólo por los rótulos visibles.
- **Clics** cuenta desde el menú lateral.
- **Directo:** el primer clic acierta y el control está a la vista.
- **Con tropiezo:** se llega, pero un rótulo confunde, hay que abrir un menú o desplazarse mucho.
- **Escondido:** no hay ítem ni pista.
- **No existe:** la plataforma no lo ofrece.

### Jefe de mantención

| # | Tarea | Primer clic probable | Camino real | Clics | Veredicto | Qué ayuda o despista |
|---|---|---|---|---|---|---|
| 1 | Saber qué equipos están en el taller | Equipos u Órdenes de trabajo | Panel → cifra «Equipos en taller 9» | 2 | Con tropiezo | Equipos no tiene un filtro «En taller»: sólo llega como chip desde el Panel. La pestaña «En taller» de OT dice 7, porque 2 equipos están por una correctiva sin OT |
| 2 | Asignar un mecánico a una orden nueva | Órdenes de trabajo | Abre en «Por asignar» → fila → «Asignar» | 3 | Directo | El botón principal sale según la etapa |
| 3 | Resolver los repuestos que pidió un mecánico | Notas de pedido o Catálogo de repuestos | Notas de pedido → nota → «Sacar de bodega», «Comprar» o «Rechazar» | 3 | Directo, si ve el ítem | En el Panel el ítem queda bajo el pliegue del menú, y dos ítems hablan de repuestos |
| 4 | Revisar un registro y marcarlo | Registros firmados | Abre en «Por revisar» → fila → «Marcar revisado» | 3 | Directo | |
| 5 | Ver todo lo hecho a KA-122 en el año | Equipos o Registros firmados | Equipos → ficha → pestaña Mantención. O Registros → «Historial de mantenciones» → buscar | 3 a 4 | Con tropiezo | Hay dos historiales y ninguno está en el menú. Con los datos de prueba responden distinto, porque el Historial no cuenta los registros firmados antes del corte del 01-12. En producción aún no hay registros nativos, así que hoy no se nota |
| 6 | Saber a qué equipos les toca preventiva pronto | Equipos | Equipos, ordenada por urgencia → filtro «Próxima» | 1 a 2 | Directo | |
| 7 | Cargar el horómetro de un equipo «Sin lecturas» | Equipos | Equipos → filtro → ficha → «Editar mantención» → «Lectura inicial» | 5 | Con tropiezo | El botón dice «Editar mantención» y el campo «Lectura inicial». Si el equipo tiene registros, el campo queda fijo y no hay otra forma de cargar una lectura |
| 8 | Cambiar la pauta de un equipo | Equipos | Ficha → «Editar mantención» → pauta. O Pautas → «Asignar equipos» | 4 | Directo | |
| 9 | Agregar a Mantención un vehículo de la flota | Equipos | «Agregar equipos» → «Incorporar desde la flota» | 3 | Directo | El diálogo pregunta cómo agregar |
| 10 | Crear una orden de trabajo | Órdenes de trabajo | «Nueva orden» | 2 | Directo | |
| 11 | Registrar que un equipo salió del taller | Equipos u Órdenes de trabajo | OT → «En taller» → fila → «Registrar salida» | 4 | Con tropiezo leve | No se comprobó la salida de un equipo en taller por una correctiva sin OT |
| 12 | Corregir el tipo de una orden que ya entró al taller | Órdenes de trabajo | Ficha → «Más acciones» → «Corregir clasificación» | 4 | Con tropiezo | La ficha dice «Tipo de acción» y el menú «clasificación». Antes del ingreso lo mismo se llama «Editar solicitud» |
| 13 | Descargar el PDF de una OT y el informe del mes | Ficha de la OT; Panel | OT → «Más acciones» → «Descargar PDF». Informe → Panel → «Exportar PDF» | 4 y 2 | Con tropiezo | En el registro el PDF es un botón a la vista; en la OT va dentro del menú. El informe sólo existe en la pestaña Hoy |
| 14 | Ver el cumplimiento de pautas por patente | Panel | Panel → «Camiones» o «Máquinas» → «Cumplimiento por patente» | 2 | Con tropiezo | Las pestañas se reparten por unidad. KA-122 es un camión medido en horas y está en «Máquinas» |
| 15 | Cambiar las actividades de la mantención de 600 h | Equipos o Configuración | Configuración → Pautas → pauta → columna 600 h | 3 | Con tropiezo | «Configuración» no dice que contiene las pautas. Una vez dentro, la matriz es muy clara |
| 16 | Agregar un taller externo o un conductor | Configuración | Configuración → «Marcas y talleres» → segmento | 3 | Con tropiezo | El título nombra 2 de los 5 catálogos |
| 17 | Instalar la app en un teléfono nuevo y desconectar uno perdido | El ícono ⊞ «Apps», o Configuración | Configuración → Dispositivos | 2 a 3 | Con tropiezo | «Apps» abre el lanzador de módulos de la plataforma |
| 18 | Saber cuánto stock hay de un repuesto y cuánto está reservado | Catálogo de repuestos | Bodega → Stock | 2 | Escondido | El catálogo no muestra existencias y ninguna pantalla de Mantención enlaza al stock |
| 19 | Subir las respuestas de Google Forms que faltan | Registros firmados, o Equipos → importar | Registros → «Historial de mantenciones» → «Importar respuestas de formularios» | 3 | Escondido | «Importar desde Excel», en Equipos, es otra cosa |
| 20 | Encontrar el registro MP-STF-0147 | Buscador de Registros firmados | No hay búsqueda por folio | — | No existe | El vacío sugiere cambiar el período |
| 21 | Ver los registros observados y si el mecánico respondió | Registros firmados | Pestaña «Observados» → abrir cada uno | 3 por registro | Con tropiezo | La lista no muestra ni filtra si hay respuesta |
| 22 | Ver las horas hombre por faena del mes | Panel | Panel → Hoy → bajar unos 2.100 px | 1 y desplazarse | Con tropiezo leve | La página mide 3.580 px y no tiene índice |
| 23 | Dar de baja un equipo vendido | Equipos | Ficha → «Editar mantención» → Estado «Dado de baja» | 4 | Con tropiezo | Nada dice «baja». El texto del campo sólo habla de la app del mecánico |

### Administrador de contrato

| # | Tarea | Primer clic probable | Camino real | Clics | Veredicto | Qué ayuda o despista |
|---|---|---|---|---|---|---|
| 24 | Pedir una reparación para un equipo de su faena | Órdenes de trabajo | «Nueva orden» | 2 | Directo | El formulario muestra su faena |
| 25 | Ver qué órdenes esperan su conformidad y darla | Mis pendientes, u Órdenes de trabajo | OT → pestaña «Por conformidad» → fila → «Dar conformidad» | 3 | Con tropiezo | No está en «Mis pendientes» ni tiene aviso en el menú, y su lista abre en «En taller». No se comprobó el botón con datos: su faena no tenía órdenes por conformidad |

### Mecánico en el computador

| # | Tarea | Primer clic probable | Camino real | Clics | Veredicto | Qué ayuda o despista |
|---|---|---|---|---|---|---|
| 26 | Ver sus órdenes y registrar el trabajo de una | Órdenes de trabajo | Abre en «Asignadas» → fila → «Registrar trabajo» | 3 | Directo | Su menú tiene 2 ítems |

**Resultado:** 9 directas, 14 con tropiezo, 2 escondidas y 1 que no existe.

---

## 4. Las causas

### 4.1 Lo pendiente de Mantención no se ve fuera del Panel (P1)

- **Qué pasa:** «Mis pendientes», el Inicio y el menú no dicen que hay órdenes por asignar, registros por revisar, notas por resolver ni órdenes por conformidad. Para saberlo hay que entrar al Panel, y para eso hay que saber que existe.
- **A quién afecta:** a todos los roles de Mantención. Al administrador de contrato, cuyo único trabajo en Mantención es pedir reparaciones y dar conformidad, nada le avisa que una orden espera su conformidad.
- **Arreglo:**
  - Sumar a la cola de «Mis pendientes» las etapas de Mantención que esperan a una persona, cada una para quien la resuelve y con su alcance por faena: órdenes por asignar, por recibir y por conformidad, registros por revisar y notas de pedido por resolver.
  - Poner avisos numéricos (`badge: "count"`) en Órdenes de trabajo, Registros firmados y Notas de pedido, como en Combustible.
- **Comando sugerido:** `/impeccable shape`, porque es una función nueva de la cola y pide decidir qué cuenta para cada rol.

### 4.2 El menú esconde la mitad de Mantención (P1)

- **Qué pasa:**
  - Mantención es un grupo dentro de «Control operacional», que tiene 18 ítems en cuatro grupos.
  - En el Panel y en las OT se ven 2 de sus 7 ítems; el resto queda bajo el pliegue y el menú no indica que hay más abajo.
  - El Historial de mantenciones no tiene ítem, y estando en él el menú marca «Registros firmados».
  - Configuración pliega Pautas, Marcas y talleres, y Dispositivos.
  - La ficha del equipo marca «Flota › Vehículos», aunque la miga dice «Mantención › Equipos».
- **Arreglo, de menor a mayor cambio:**
  1. En escritorio, plegar los grupos que no son el activo, como ya hace el cajón del teléfono.
  2. Darle al Historial su propio ítem, mostrar las tres entradas de Configuración y hacer que la ficha del equipo marque «Equipos» cuando se entra desde Mantención.
  3. Hacer de Mantención un área propia del menú, con su ícono. Es el cambio más grande: toca `components/layout/areas.ts`, los manifiestos y la paridad de permisos.
- **Comando sugerido:** `/impeccable layout`.

### 4.3 Un registro no se encuentra por su folio (P1)

- **Qué pasa:** el folio es lo que va impreso en el registro, en el PDF y en la conversación («el MP-STF-0147»). Ni Registros firmados, ni el Historial, ni la paleta de comandos lo buscan. El vacío sugiere cambiar el período, que no es la causa.
- **Arreglo:**
  - Buscar por folio en Registros y en el Historial, con el texto «Folio, código o patente».
  - En la paleta, saltar con `OT-`, `MP-`, `MC-` y `NP-`, y ponerle un botón visible en la barra superior.
  - Cambiar el vacío por «No hay un registro con ese folio, código o patente».
- **Comando sugerido:** `/impeccable harden` y `/impeccable clarify`.

### 4.4 Rótulos que no dicen lo que contienen (P2)

| Rótulo actual | Qué contiene | Propuesta |
|---|---|---|
| Pestañas «Camiones» y «Máquinas» | Equipos medidos en kilómetros y en horas. Los camiones de producción están en «Máquinas» | «Por kilómetros» y «Por horas» |
| «Marcas y talleres» | Marcas, talleres, conductores, tipos de trabajo y aceites | «Catálogos». Choca con «Catálogo de repuestos»: ver la decisión 4 |
| «Dispositivos» | Los teléfonos con la app del mecánico, y el botón para instalarla | «App del mecánico» |
| «Configuración» | Pautas, catálogos y dispositivos | Mostrar las tres entradas sin plegar |
| «Editar mantención» | Pauta, lectura inicial, preventiva declarada y baja | «Editar plan de mantención», y la baja como acción aparte |
| «Corregir clasificación» | El tipo de acción, las especialidades y las horas | «Corregir tipo de acción» |
| «Pedir repuestos», en la OT | Una solicitud de compra. En la app, el mismo rótulo crea una nota de pedido | «Solicitar compra de repuestos» |
| «Sacar de bodega» | Reserva el repuesto para la OT; no lo saca físicamente | «Reservar de bodega» |
| «Repuestos pedidos», en la OT | Las solicitudes de compra | «Solicitudes de compra» |
| «Registros firmados» | Lo firmado por los mecánicos. «Firmados» es palabra de la app | Validarlo con quienes lo usan |

**Comando sugerido:** `/impeccable clarify`.

### 4.5 Un concepto, varios nombres (P2)

| Concepto | Nombres que usa hoy la interfaz | Propuesta |
|---|---|---|
| Orden de trabajo | «Orden de trabajo», «OT», «orden», «solicitud» («Editar solicitud»), «Pedida desde» y «Fecha de la orden» | «Orden de trabajo»; «OT» sólo en folios y espacios angostos; «solicitud» sólo para compras |
| Lo que firma el mecánico | «Registro firmado», «Registro de mantención», «mantención firmada», «trabajo» | «Registro firmado» para el documento; «trabajo» para cada fila del Historial |
| Tipo | En la OT «Reparación» y «Mantención»; en Registros e Historial «Correctiva» y «Preventiva» | Mantenerlo y explicarlo junto al filtro «Tipo» |
| Historial | «Historial de mantenciones» (la página y una tarjeta de la ficha), «Historial del equipo», «Hoja de vida», «Historial de cambios», «Historial» de la OT | «Historial de mantenciones» para trabajos, «Cambios» para la auditoría del equipo, «Movimientos» para la OT y «Ficha del equipo» como destino |
| Equipo | «Equipo» en Mantención, «Vehículo» en Flota (mismo ícono), «Camiones» y «Máquinas» en el Panel | «Equipo» en Mantención; «vehículo» sólo para hablar de Flota |
| Lectura | «Lectura», «Odómetro actual», «Horómetro actual», «Km actuales», «Kilómetro» | «Lectura» en las columnas; odómetro u horómetro sólo en el campo donde se lee el aparato |
| Pauta e intervalo | En la app, «Pauta que corresponde» y «Elegir otra pauta» son intervalos; «Intervalo que toca», «Nivel de pauta», «Frecuencia» | «Pauta» = el plan; «intervalo» = 10.000 km o 300 h |
| Pedido de repuestos | «Nota de pedido», «NP», «Pedido», «Repuestos pedidos», «Pedir repuestos» (dos destinos), «Pedido por» y «Pedida por» | «Nota de pedido» para lo del mecánico; «solicitud de compra» para Compras |
| Reservar | «Sacar de bodega», «Sacada de la bodega», «Se apartaron», «apartado», «Reservados sin usar», «Liberar», «Descontar» | «Reservar», «liberar» y «usar» |
| Equipo detenido | «En taller», «Días en taller», «Días detenido», «Equipo detenido», «Días fuera de servicio» | «Días en taller» para OT y registros; «detenido» sólo como urgencia de una nota; definir junto a la cifra qué mide «fuera de servicio» |
| Entrega y salida | «Entrega estimada», «Fecha estimada de entrega», «Cambiar fecha de entrega»; en el PC «Registrar salida», en la app «Terminar», «Terminar (salida de taller)» y «Terminar y avisar» | «Entrega estimada» y «Registrar salida de taller» en los dos lados |
| Quién | «Hecho por», «Responsable», «Mecánico», «Pedido por», «Solicitante», «Creada por» | «Mecánico» para la persona asignada; «Hecho por» para el autor de un registro |
| Panel | «Indicadores», «cálculos», «Panel» | «Panel» |

**Comando sugerido:** `/impeccable clarify`. Las ubicaciones exactas de cada variante están en el anexo A.

### 4.6 Acciones y datos donde no se buscan (P2)

- **PDF de la OT:** sólo en «Más acciones». En el registro es un botón a la vista.
- **«Más acciones» con 8 opciones** en una OT en taller.
- **«En taller»:** no es un filtro de Equipos.
- **Respuesta del mecánico:** «Observados» no dice si ya respondió.
- **Existencias de repuestos:** sólo en Bodega, sin enlace desde el Catálogo ni desde las notas.
- **Período en Planificación:** se puede elegir y no filtra nada.
- **Cambiar de pestaña en el Panel** borra el período y la faena.
- **«Volver a la lista»** desde «Todos» cae en «Por revisar».
- **Panel Hoy:** 3.580 px sin índice, con 17 enlaces «Ver datos» iguales.
- **App del mecánico:** «Nuevo registro» queda bajo el saludo, el aviso de observaciones, «Le toca mantención» y las OT. No se ve en la primera pantalla.

**Comandos sugeridos:** `/impeccable layout` y `/impeccable distill`.

---

## 5. Evaluación de diseño

### Especificidad

**El vocabulario y las pantallas están hechos para este producto; el menú es genérico.**
- **Lo específico:**
  - el «Avance» de la OT en cuatro etapas;
  - «Por conformidad»;
  - la matriz de la pauta con intervalos de 300, 600, 900 y 1.200 h;
  - «Reservado OT» y «Libre»;
  - «Equipo detenido» como urgencia de una nota.
- **Lo genérico:** Mantención recibe el mismo acordeón que cualquier grupo y queda como un rótulo gris dentro de otra área.

### Heurísticas de Nielsen, leídas desde la encontrabilidad

La evaluación A dio 27 de 40. Bajé tres puntos, en las heurísticas 1, 5 y 7, por lo que verifiqué después:
- «Mis pendientes» y el Inicio no incluyen Mantención;
- los dos problemas de prevención de errores se reprodujeron;
- la paleta de comandos no conoce los folios de Mantención.

| # | Heurística | Nota | Problema clave |
|---|---|---|---|
| 1 | Visibilidad del estado | 2 | Dentro del módulo, las pestañas con conteo y las cifras del Panel funcionan. Fuera, nada avisa: sin avisos en el menú, sin Mantención en «Mis pendientes» ni en el Inicio |
| 2 | Lenguaje del usuario | 3 | Buen dominio del oficio. Fallan «Camiones» y «Máquinas», «Marcas y talleres», «Corregir clasificación», «Lectura inicial» y «Faena de imputación» |
| 3 | Control y libertad | 3 | Chips que se quitan, «Quitar los filtros» y migas. Cambiar de pestaña en el Panel y volver desde «Todos» pierden el lugar |
| 4 | Consistencia | 2 | Trece conceptos con varios nombres. «Pedir repuestos» lleva a dos cosas distintas. El PDF está a la vista en el registro y escondido en la OT. La ficha marca «Vehículos». Tres textos distintos para «no encontrado» |
| 5 | Prevención de errores | 2 | Hay opciones desactivadas con su motivo y confirmaciones con motivo. Pero «Editar solicitud» borra la descripción al cambiar el tipo, y el ingreso guarda «8.100» como 8,1 (ambos reproducidos). Rótulos como «Sacar de bodega» llevan a esperar otra cosa |
| 6 | Reconocer en vez de recordar | 2 | 5 de 7 ítems bajo el pliegue. El Historial y la importación sin ítem. «En taller» sin filtro. Hay que recordar que «Camiones» son los de kilómetros y que el stock está en Bodega |
| 7 | Flexibilidad y eficiencia | 2 | Las cifras del Panel son atajos, hay revisión en lote y «/» enfoca la búsqueda. No hay búsqueda por folio, y la paleta de comandos no tiene botón ni conoce los folios de Mantención |
| 8 | Diseño minimalista | 3 | Pantallas limpias y sin decoración. Ruido puntual: el Panel Hoy de 3.580 px, cinco columnas vacías en «Por asignar», cinco acciones en la cabecera de la ficha del equipo y tres niveles de controles en el Historial |
| 9 | Recuperación de errores | 2 | La búsqueda fallida por folio sugiere cambiar el período. Con «1.234.567» el botón se desactiva sin decir por qué. «Libera esa reserva» no sirve después de liberar |
| 10 | Ayuda | 3 | Cada página dice qué es, y hay «Qué cuenta» y textos de ayuda en los campos. No hay forma de preguntar dónde está algo |
| | **Total** | **24 de 40** | **Aceptable** |

### Carga cognitiva

Fallan 3 de los 8 puntos: la carga es moderada.
- **Agrupación en bloques:** falla. «Control operacional» junta 18 enlaces.
- **Pocas opciones a la vez:** falla. Puntos de decisión con más de 4 opciones visibles:
  - menú de Mantención: 7 ítems, más 3 plegados;
  - «Más acciones» de una OT en taller: 8 opciones;
  - pestañas de OT: 7;
  - ficha del equipo: 5 acciones en la cabecera y 4 pestañas;
  - filtros de Registros: 7; de OT: 5; de Equipos: 5 y una casilla;
  - Historial: 3 vistas, 5 tipos, 3 agrupaciones y 5 filtros;
  - «Marcas y talleres»: 5 segmentos.
- **Memoria de trabajo:** falla. Hay que recordar qué es «Camiones», que el stock está en Bodega y que el Historial vive dentro de Registros.
- **Lo que aprueba:** foco único, agrupación visual, jerarquía dentro de cada pantalla, una decisión a la vez y revelación progresiva. Aun así, la revelación progresiva se aplicó también a entradas importantes, como el Historial y la importación.

### Recorrido emocional del jefe de mantención

- **Entrada:** aterriza en un Inicio de compras, sin una sola cifra de Mantención.
- **Valle:** busca «Mantención» en el menú y no está. Hay que adivinar «Control operacional» y después desplazar el menú.
- **Alivio:** el Panel abre con cuatro cifras que llevan a su lista.
- **Cierre:** las tareas de OT y de registros terminan en botones claros. Las de borde (importar, folio, stock) terminan en callejones sin salida.

### Fortalezas

1. **Cada pantalla dice qué es y dónde está.** Tiene título, descripción, miga, pestañas con conteo y la palabra del oficio.
2. **Las cifras del Panel llevan a su lista ya filtrada,** y la ficha de la OT ofrece el botón que corresponde a su etapa: Asignar, Registrar ingreso, Registrar salida, Recibir equipo, Dar conformidad o Reabrir.
3. **El menú se recorta por perfil.** El mecánico ve 2 ítems y el supervisor no ve las páginas que le darían «Sin permisos». En el teléfono, el cajón abre sólo el grupo activo.

### Personas

- **Experto e impaciente (Alex):**
  - No puede saltar a un folio.
  - La paleta de comandos existe, pero nada la anuncia.
  - Sin avisos en el menú, tiene que abrir el Panel para saber cuántas órdenes hay por asignar.
- **Teclado y lector de pantalla (Sam):**
  - Los rótulos de grupo del menú no se anuncian, así que oye una lista seguida de 21 enlaces.
  - El Historial salta de `h1` a `h3`.
  - La paleta sólo se abre con un atajo.
  - No se probó el orden del foco.
- **Jefe de mantención que venía de planillas y formularios:**
  - Busca «Historial» e «Importar» en el menú y no están.
  - Busca «lectura» u «horómetro» y sólo encuentra «Lectura inicial».
  - Pregunta por el stock de repuestos y no lo ve en Mantención.
- **Administrador de contrato:** su tarea, dar conformidad, no aparece en «Mis pendientes», en el Inicio ni en el menú. Su lista de OT abre en «En taller».
- **Mecánico en el teléfono:**
  - Al abrir la app, lo primero es un saludo.
  - «Nuevo registro», lo que más usa, queda bajo el pliegue.
  - Los controles miden 44 px o más.

---

## 6. Lo que dicen `/unslop` y `/unslop-ui`

### `/unslop`: nada que cambiar en la capa visual

No hay degradados, brillos, emojis ni animación decorativa. Los pesos no pasan de 600 y no hay mayúsculas. Las cifras naranja de la franja «Hoy» marcan estado, no decoración. Señales menores:
- dos cifras de Registros llevan íconos (`app/(app)/mantencion/registros/page.tsx:155,166`) que la franja del Panel no lleva;
- «Equipos» y «Vehículos» comparten el ícono del camión;
- en Camiones y Máquinas, la lectura del formulario sale cruda: «150000», junto a «629.317 km» (`components/mantencion/panel/looker/corrective-panel.tsx:110`);
- el título de la app del mecánico es un saludo;
- un texto de ayuda largo en el buscador de OT: «Folio, equipo (código o patente) o solicitante».

Tres refinamientos:
1. Dar formato a la lectura cuando es un número: «150000» → «150.000 km».
2. Otro ícono para «Equipos», distinto del de «Vehículos».
3. Quitar los dos íconos de las cifras de Registros.

### `/unslop-ui`: veredicto «Light»

La decoración está limpia. El texto tiene casos puntuales, y lo pesado son los sinónimos, cuyo cambio decide el dueño.

| Regla | Casos | Se conservan a propósito |
|---|---|---|
| U3, subtítulo que repite | 7 | 2: la descripción de página que pide la barra superior |
| U4, texto que narra lo obvio | 2 | unos 25 vacíos que ya dicen qué hacer |
| U5, nota de diseño | 4 | 3 («Qué cuenta», «Como estaba en la ficha al firmar», «Manda la firmada más reciente») |
| U7, rotular todo | 2 | 1 |
| U11, íconos | 2 | los del menú, los de la cabecera y los de los menús de acciones |
| U13, instrucciones de lectura de un gráfico | 4 | 1 («NA no entra en el cálculo», que es un dato) |
| U14, decir dos veces | 2 | titular, barras y «Ver datos», por regla del tablero |
| U22, nombres que no dicen adónde llevan | 9 | 4 |
| U23, cifras de igual peso | 4 franjas | todas: es decisión del 14-11 («tira compacta») |
| unslop 11, sinónimos | 13 conceptos | — |
| unslop 14, dos puntos a mitad de frase | ~8 | 8: explican una restricción |
| U1, U9, U10, U16, U17–U21, U24 | 0 | |

**Enlaces y botones que no dicen adónde llevan (U22):**
- «Más acciones», en la OT: hasta 8 opciones mezcladas.
- «Ver datos», 17 veces en el Panel Hoy.
- «Ver cuáles» (`app/(app)/mantencion/equipos/page.tsx:102`), que lleva a los equipos sin pauta.
- «Incorporarlos» (`:108`), que lleva a «Incorporar desde la flota».
- «Abrir la ficha» y «Abrir la ficha completa» (`components/mantencion/historial/history-table.tsx:106`, `history-preview.tsx:99`), que abren el trabajo, no la ficha del equipo.
- «Editar mantención» (`components/mantencion/jefatura/equipos/equipment-detail-view.tsx:104`).
- «Ver historial», en la app del mecánico.
- «Guardar», «Agregar» y «Listo», en el editor de pautas y en la vinculación del historial.

El plan completo, línea por línea, está en el anexo A.

### Jerarquía visual y encontrabilidad, por pantalla

- **Panel Hoy:** manda la franja de cuatro cifras. Desde la segunda sección nada manda: ocho titulares numéricos del mismo tamaño y 17 «Ver datos». El título de la página mide lo mismo que los de sección. El enlace «Órdenes de trabajo», a la derecha del título de sección del mismo nombre, es chico y gris y no se lee como enlace.
- **Órdenes de trabajo:** la mejor pantalla. Mandan las pestañas con conteo y el único botón principal, «Nueva orden».
- **Registros firmados:** la franja «Indicadores» y sus dos cifras compiten con el «93» de la pestaña. La primera fila está a 446 px de 900.
- **Historial:** tres niveles de controles, el resumen y los gráficos abiertos. A 900 px de alto no se ve ninguna fila.
- **Equipos:** manda el aviso «Falta completar». La lista se dice ordenada por urgencia, pero el estado es la insignia más chica y la última de la fila.
- **Notas de pedido:** limpia. Pestañas, un filtro y la tabla. En la ficha, la tarjeta «Pedido» y las líneas con sus tres botones.
- **Ficha del equipo:** cinco botones en la cabecera y cuatro pestañas. Las seis cifras de «Mantención» pesan lo mismo y el historial queda bajo el pliegue.
- **Ficha de la OT:** manda «Avance» con el botón verde. La tarjeta «Repuestos» apila cuatro subtítulos iguales.

---

## 7. Detector y medidas (evaluación B)

### `impeccable detect`

| Árbol | Archivos | Hallazgos |
|---|---|---|
| `app/(app)/mantencion` | 92 | 0 |
| `components/mantencion` | 222 | 0 |
| `app/(app)/flota/[id]/mantencion` | 2 | 0 |
| `app/(mecanico)` | 6 | 1 |

- **El único hallazgo** es `side-tab`, una franja lateral de 4 px en `app/(mecanico)/mant-screens.css:154`. Es la regla `.repstk` de la tarjeta «Repuesto de bodega» de la app (`components/mantencion/app/trabajo-jobs.tsx:98`).
- **Los ceros son reales.** El escaneo se repitió sin configuración ni ignorados y dio lo mismo. Un `grep` complementario tampoco encontró tamaños de texto menores a 12 px, franjas, degradados, `animate-pulse` ni `uppercase` fuera de las pruebas.

### El detector dentro del navegador

La política de seguridad de contenido de la app bloquea inyectar `detect.js` por URL. Se pasó el código con `page.evaluate` en Chromium sin ventana, así que no quedó ninguna capa visible para el usuario.

| Página | Hallazgos | Lectura |
|---|---|---|
| Panel | `cramped-padding` ×3, `nested-cards` ×3, `line-length` ×2 | Falsos positivos: los paneles del tablero son una excepción declarada, y el largo de línea son subtítulos de gráfico |
| Lista de OT, Registros, Equipos, notas | `nested-cards` | Falso positivo: el detector toma el «pozo» blanco del shell como tarjeta exterior |
| Ficha de la OT | `nested-cards` ×9 | Mismo falso positivo |
| Historial | `nested-cards` ×3 y `skipped-heading` | El salto de `h1` a `h3` es real |

### Medidas de navegación

| Página | Acciones en la cabecera | Filtros antes de la lista | Primera fila, 1440 px | Primera fila, 390 px | Alto, 390 px | Ítem que marca el menú |
|---|---|---|---|---|---|---|
| Panel | 6 | 3 lógicos (faena, período, equipo) | 227 (cifras) | 490 | 6.286 | Panel de mantención |
| Lista de OT | 2 | 5 | 243 | 431 | 1.205 | Órdenes de trabajo |
| Ficha de la OT | 3 | 0 | 197 | 383 | 3.693 | Órdenes de trabajo |
| Registros firmados | 2 | 7 | 416 | 742 | 8.169 | Registros firmados |
| Historial | 2 | 5, y más dentro de «Más filtros» | 904 | 1.745 | 8.877 | Registros firmados |
| Equipos | 2 | 5 | 303 | 533 | 6.950 | Equipos |
| Ficha de una nota | 1 | 0 | 426 (líneas) | 732 | 1.187 | Notas de pedido |
| Ficha del equipo | 5 | 0 | 269 | 500 | 3.061 | Vehículos |

Ninguna página usa `role="tablist"`. Las pestañas son enlaces dentro de un `<nav>` con `aria-current`, lo que se anuncia bien.

---

## 8. Qué cambiaría, en orden

| # | Cambio | Resuelve | Tamaño | Comando |
|---|---|---|---|---|
| 1 | Mantención en «Mis pendientes», por rol y faena, y avisos numéricos en Órdenes de trabajo, Registros firmados y Notas de pedido | 4.1; tareas 1, 2, 4, 25 | Medio. Pide decidir qué cuenta para cada rol | `/impeccable shape` |
| 2 | Plegar en escritorio los grupos que no son el activo; ítem propio para el Historial; mostrar las tres entradas de Configuración; la ficha del equipo marca «Equipos» | 4.2; tareas 3, 5, 15, 16, 17, 19 | Chico a medio | `/impeccable layout` |
| 3 | Búsqueda por folio en Registros y en el Historial; la paleta salta con `OT-`, `MP-`, `MC-` y `NP-` y tiene un botón visible | 4.3; tarea 20 | Chico | `/impeccable harden` |
| 4 | Rótulos: «Por kilómetros» y «Por horas», «Catálogos», «App del mecánico», «Editar plan de mantención», «Corregir tipo de acción», «Solicitar compra de repuestos», «Reservar de bodega» | 4.4; tareas 12, 14, 16, 17, 23 | Chico | `/impeccable clarify` |
| 5 | Un nombre por concepto, con la tabla 4.5 | 4.5 | Medio: muchos archivos y la app | `/impeccable clarify` |
| 6 | PDF de la OT a la vista; filtro «En taller» en Equipos; «Con respuesta» en Observados; enlace al stock desde el Catálogo y las notas; ocultar el período en Planificación; conservar período y faena al cambiar de pestaña | 4.6; tareas 1, 13, 18, 21 | Chico cada uno | `/impeccable layout` |
| 7 | En la app del mecánico, «Nuevo registro» arriba y un título que diga la faena | 4.6 | Chico | `/impeccable adapt` |
| 8 | El plan de texto del anexo A | Ruido y U22 | Chico | `/impeccable clarify` |
| 9 | Pasada final | | | `/impeccable polish` |

El punto 2, en su versión mayor, y el 5 tocan decisiones de producto: ver la sección siguiente.

**Estado (26-11):** los puntos 2 a 9 están hechos en la rama `fix/mantencion-encontrabilidad`, sin desplegar ([mantencion-arreglos-2026-11-26.md](mantencion-arreglos-2026-11-26.md)). Queda el punto 1, «Mis pendientes»: hay un brief de diseño y faltan sus decisiones.

## 9. Decisiones

**Respondidas el 26-11:**
1. **Primero los errores de datos:** OT4-6, OTN-6 y REG4-1, antes que la encontrabilidad.
2. **Menú:** Mantención se queda en «Control operacional». En escritorio sólo se abre el grupo activo, como en el teléfono.
3. **Pestañas del Panel:** «Por kilómetros» y «Por horas».
4. **«Mis pendientes», por responsable:**
   - jefe: órdenes por asignar y notas por resolver;
   - supervisor: registros por revisar;
   - administrador de contrato: órdenes por conformidad;
   - mecánico: sus órdenes asignadas.

**Abiertas:**
1. **¿Cómo se llama la página «Marcas y talleres»?** «Catálogos» choca con «Catálogo de repuestos».
2. **¿«Registros firmados» se entiende** en la oficina, o se valida con quienes lo usan?

---

## Anexo A. Plan de `/unslop-ui` (aplicado el 26-11, salvo «Marcas y talleres» y «Faena de imputación», que decide el dueño)

Cada línea es `archivo:línea · regla · cambio`. Los números de línea son del código actual; los revisé al azar y cuadran.

**Menú, títulos y pestañas**
- `modules/mantencion-equipos/manifest.ts:127` · U22, unslop 11 · «Marcas y talleres» → «Catálogos». También `components/mantencion/jefatura/catalogos/catalogs-workbench.tsx:91,93` y `app/(app)/mantencion/catalogos/page.tsx:11`.
- `modules/mantencion-equipos/manifest.ts:130` y `app/(app)/mantencion/dispositivos/page.tsx:27,29` · unslop 11 · «Dispositivos» → «App del mecánico».
- `components/mantencion/panel/looker/panel-tabs.tsx:11-12` · unslop 11 · «Camiones» → «Por kilómetros»; «Máquinas» → «Por horas». También `app/(app)/mantencion/panel/page.tsx:64` y `work-tab.tsx:40`.
- `components/mantencion/jefatura/ot/ot-aside.tsx:66` · unslop 11 · «Historial» → «Movimientos». El mismo archivo ya dice «Sin movimientos todavía».
- `components/mantencion/jefatura/ot/ot-sections.tsx:157` · U7 · «Orden de trabajo» → «Datos de la orden». La tarjeta repite el título de la página.
- `components/mantencion/jefatura/ot/ot-sections.tsx:314` · unslop 11 · «Repuestos pedidos» → «Solicitudes de compra». La línea `:320` ya dice «Sin solicitudes de compra».
- `components/mantencion/jefatura/notas-pedido/parts-note-detail.tsx:104,125` · unslop 11 · «Pedido» → «Datos de la nota»; «Líneas del pedido» → «Líneas de la nota».
- `components/mantencion/jefatura/equipos/equipment-detail-view.tsx:104` · U22 · «Editar mantención» → «Editar plan de mantención».

**Cabeceras de tabla**
- `components/mantencion/jefatura/notas-pedido/parts-notes-table.tsx:15` · A6 · «NP» → «Nota».
- `parts-notes-table.tsx:18,75` · unslop 11 · «Pedido por» → «Pedida por», como en la ficha.

**Botones y enlaces**
- `app/(app)/mantencion/equipos/page.tsx:102` · U22 · «Ver cuáles» → «Ver equipos sin pauta».
- `app/(app)/mantencion/equipos/page.tsx:108` · U22 · «Incorporarlos» → «Incorporar desde la flota».
- `components/mantencion/historial/history-table.tsx:106` y `history-preview.tsx:99` · U22 · «Abrir la ficha» y «Abrir la ficha completa» → «Ver el trabajo».
- `components/mantencion/jefatura/ot/ot-sections.tsx:299` y `ot-actions.tsx` · unslop 11 · «Pedir repuestos» → «Solicitar compra de repuestos».
- `ot-actions.tsx` y `components/mantencion/jefatura/ot/ot-labels.ts:14` · unslop 11 · «Editar solicitud» → «Editar orden»; «Solicitud editada» → «Orden editada».
- `components/mantencion/jefatura/panel/panel-equipment-filter.tsx:50` y `app/(app)/mantencion/panel/trinorma-sections.tsx:82,321` · unslop 11 · «Ver hoja de vida» y «Hoja de vida del equipo» → «Ficha del equipo».
- `components/mantencion/jefatura/notas-pedido/ot-parts-overview.tsx:38` · unslop 11 · «apartado» → «reservado».

**Textos que narran o repiten**
- `app/(app)/mantencion/panel/hoy-tab.tsx:183` · unslop 28 · descripción de 125 caracteres → «Lo pendiente hoy y el avance de órdenes, pautas, disponibilidad y reportes de turno.»
- `components/mantencion/jefatura/panel/panel-today.tsx:91` · U7 · quitar el título «Hoy», que repite la pestaña; dejar `aria-label="Pendientes de hoy"` en la sección.
- `app/(app)/mantencion/panel/planificacion-tab.tsx:44` · U4 · quitar «Ordenado por faltantes: lo vencido queda arriba.»
- `planificacion-tab.tsx:63,94` · U13 · quitar «Barras más grandes primero.»
- `planificacion-tab.tsx:72,103` · unslop 11 · «Sin mantenimientos con…» → «Sin mantenciones con…».
- `components/mantencion/panel/looker/corrective-panel.tsx:203` · U13 · quitar «Ejes separados porque son escalas distintas.»
- `app/(app)/mantencion/ot/page.tsx:134-135` · U4 · acortar a «Los trabajos de los formularios y los registros firmados están en el Historial de mantenciones.»
- `components/mantencion/jefatura/ot/ot-sections.tsx:121` · U3 · quitar «Dónde está la orden y qué sigue.»
- `components/mantencion/jefatura/ot/ot-aside.tsx:66` · U3 · quitar «Quién lo hizo y el motivo, cuando lo hay.»
- `ot-aside.tsx:115` · U3 · quitar «Registros firmados contra esta orden y, si nació de una inspección, su hallazgo.»
- `ot-aside.tsx:118` · unslop 11 · «Registros de mantención» → «Registros firmados».
- `ot-sections.tsx:309` · U3 · quitar «Notas de pedido, reservas, compras y consumo de esta orden.»
- `app/(app)/mantencion/registros/page.tsx:182` · U5 · quitar «Un registro anulado sigue visible, marcado, pero no cuenta en los indicadores.» Ya lo dicen la tabla y el diálogo de anular.
- `registros/page.tsx:196-197` · U7 · «Indicadores · 93 registros vigentes del…» → «93 registros vigentes del…».
- `registros/page.tsx:155,166` · U11 · quitar los íconos de las dos cifras.
- `components/mantencion/jefatura/registros/record-aside.tsx:16` · U4 · quitar «Toca una foto para ampliarla.»
- `record-aside.tsx:52` · U3 · quitar «Los últimos registros vigentes de este equipo que puedes ver.»
- `app/(app)/mantencion/registros/historicos/page.tsx:161` · U5 · quitar «Mismo criterio que el Panel.»
- `components/mantencion/historial/work-matrix.tsx:156` · U13 · quitar «Cada celda cuenta los trabajos del equipo en el mes.»
- `components/mantencion/historial/equipment-timeline.tsx:117` · U3 · quitar «Del más reciente al más antiguo». Este archivo lo trabaja otra rama (`fix/mantencion-hoja-vida-consistencia`).
- `app/(app)/mantencion/equipos/page.tsx:84` · U5 · «…de la más urgente a la más al día.» → «Estado de mantención de cada equipo.»
- `app/(app)/mantencion/pautas/page.tsx:31` · U5 · quitar «Cada equipo tiene una pauta.»
- `components/mantencion/jefatura/notas-pedido/parts-note-detail.tsx:126` · U4 · quitar «Resuelve cada línea: sácala de la bodega, cómprala o recházala.» y «Dónde está cada repuesto pedido.»
- `components/mantencion/app/home-lists.tsx:160` · U14 · «Tu supervisor dejó N observaciones…» → «Tu supervisor dejó observaciones…», porque el título ya dice cuántas.

**Tareas que decide el dueño**
- La franja «Hoy» tiene cuatro cifras de igual peso (U23). Si una manda, que pese más. Hoy domina «93 registros por revisar».
- Filtros del Panel con dos estilos: «Todas las faenas» en Hoy y «Faena: Todas» en las otras pestañas. En Planificación la tabla pone «Patente» antes de «Código», al revés del resto de la plataforma.
- «Exportar historial» en la ficha del equipo no usa el rótulo «Exportar Excel» de la regla A6.
- «Faena de imputación» es jerga (`components/mantencion/jefatura/ot/ot-sections.tsx:174`, `new-ot-sheet.tsx:171`, `edit-ot-sheet.tsx:134`).

## Anexo B. Evidencia

- **Capturas** en `audit/mantencion-2026-11-26/` (carpeta ignorada por git):
  - `desk/`, `mobile/`, `supervisor/`, `contrato/`, `mecanico/`, `app/` e `interact/`, del recorrido de la auditoría;
  - `encontrabilidad/revision-diseno/`, de la evaluación A;
  - `encontrabilidad/detector/`, con los JSON del detector y las medidas;
  - `encontrabilidad/navegacion/`, con el mapa de navegación por perfil.
- **Guiones para repetirlo** en `~/backups-dev/mock-2026-11-26-e2e-auditmant/`.
- **Snapshot de la crítica** en `.impeccable/critique/`, con la puntuación para seguir la tendencia.
