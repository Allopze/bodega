# Auditoria UI desktop - capturas Playwright 2026-06-09

Fecha de revision: 2026-06-16  
Fuente revisada: `audit/screenshots/2026-06-09-playwright/`  
Alcance: 37 capturas `desktop-*.png` revisadas una por una. No se revisaron las capturas mobile para este informe.

## Resumen ejecutivo

La interfaz desktop ya tiene una base coherente: sidebar estable, header consistente, superficies sobrias, buen uso de estado en badges y una direccion visual apropiada para una herramienta interna. Las pantallas mas fuertes son `desktop-dashboard.png`, `desktop-bodega.png`, `desktop-solicitudes-nueva.png`, `desktop-solicitudes-detalle.png`, `desktop-admin-configuracion.png` y `desktop-admin-productos.png`.

El problema principal no es falta de estilo, sino falta de densidad util en desktop. Muchas pantallas renderizan una tabla o tarjeta corta arriba y dejan el 55-75% inferior del lienzo como fondo vacio. En una app operacional eso se siente menos como calma visual y mas como pantalla incompleta.

Hallazgo mas importante: `desktop-repuestos-nueva.png` y `desktop-servicios-nueva.png` muestran opciones de select como texto vertical sin contenedor. Esto rompe la affordance de controles editables y debe corregirse antes de cualquier pulido espacial. En codigo, ambas pantallas usan `@/components/ui/select` con `<option>` hijos, pero el componente es Radix y espera `SelectTrigger`, `SelectValue`, `SelectContent` y `SelectItem`.

Puntuacion UI desktop actual: **72/100**  
Veredicto: **usable y consistente, pero aun no se siente completamente terminado en desktop**. El shell esta fuerte; las pantallas de lista corta y algunos formularios necesitan una capa de layout adaptativo y contexto secundario.

## Criterio usado

Esta es una herramienta interna de solicitudes, compras, recepcion, bodega y reportes. La escena de uso esperada es un usuario administrativo u operativo revisando trabajo pendiente en un monitor desktop durante la jornada. Para este tipo de producto, el aire solo es valioso si mejora decision, lectura o confianza. Si el espacio queda sin trabajo, baja la percepcion de control.

Niveles de aire usados en la tabla:

- **Bajo**: el espacio ayuda a foco, lectura o flujo.
- **Medio**: hay aire visible, pero la pantalla conserva proposito.
- **Alto**: la pantalla parece incompleta, demasiado estrecha o con una sola pieza de contenido flotando.
- **Critico**: ademas de aire, hay perdida clara de affordance o funcionalidad visual.

## Hallazgos prioritarios

### P1 - Selects rotos en repuestos y servicios nuevos

Evidencia:

- `audit/screenshots/2026-06-09-playwright/desktop-repuestos-nueva.png`
- `audit/screenshots/2026-06-09-playwright/desktop-servicios-nueva.png`
- `app/(app)/repuestos/request-form.tsx`
- `app/(app)/servicios/request-form.tsx`
- `components/ui/select.tsx`

En ambas capturas, `Faena`, `Urgencia` y `Unidad` aparecen como listas de texto sin caja, trigger ni indicador de seleccion. En una pantalla de creacion esto es grave: el usuario no sabe si esta mirando texto, opciones abiertas o controles editables.

Fix recomendado: usar el patron Radix completo, como ya hace `app/(app)/solicitudes/request-form.tsx`: `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`. Evitar `<option>` dentro de este `Select`.

### P1 - Tablas cortas estiradas sobre lienzos enormes

Evidencia destacada:

- `desktop-repuestos.png`
- `desktop-servicios.png`
- `desktop-admin-faenas.png`
- `desktop-admin-auditoria.png`
- `desktop-admin-proveedores.png`
- `desktop-admin-trabajadores.png`
- `desktop-compras.png`
- `desktop-recepcion.png`

El patron se repite: una tabla full-width con 1-4 filas ocupa el tercio superior y el resto queda vacio. Esto no es minimalismo; es una falta de modo para datasets pequenos.

Fix recomendado: mantener la tabla para volumen real, pero agregar un modo compacto cuando hay pocas filas. Opciones:

- resumen por estado arriba o a la derecha;
- filtros/segmentos persistentes;
- tarjetas de cola de trabajo para 1-5 items;
- panel lateral con proximo paso o actividad reciente;
- empty/low-data state con accion contextual.

### P2 - Recepcion detalle no transmite suficiente cierre operativo

Evidencia:

- `desktop-recepcion-detalle.png`
- `app/(app)/recepcion/[id]/page.tsx`

La pantalla muestra destino, guia, receptor, fecha y una fila recibida, pero todo termina muy arriba. Para una recepcion cerrada o abierta, el usuario espera mas confianza documental: OC relacionada, historial, estado de stock, diferencias oficina/faena, adjuntos o proximo paso.

Fix recomendado: pasar de una columna `width="form"` a una composicion de dos columnas: contenido recibido a la izquierda y panel contextual a la derecha, similar al buen patron de `desktop-compras-detalle.png` o `desktop-solicitudes-detalle.png`.

### P2 - Reportes tiene buena cabecera, pero poco cuerpo

Evidencia:

- `desktop-reportes.png`
- `app/(app)/reportes/page.tsx`

Las metricas superiores funcionan, pero el modulo termina en un resumen de estados muy corto. Para una pantalla llamada Reportes, el usuario espera una salida accionable: tabla, desglose por faena, tendencia, filtros aplicados o ultimas exportaciones.

Fix recomendado: agregar una segunda capa bajo `Estados principales`, por ejemplo "items sin OC", "OC pendientes por faena" o "ultimas exportaciones". Mantener exportacion en XLSX para cualquier salida de datos.

### P2 - 404 autenticado demasiado pequeno para desktop

Evidencia:

- `desktop-app-not-found.png`
- `desktop-not-found.png`

El mensaje queda centrado, pequeno y con una sola accion. En un sistema interno, un error de ruta deberia ayudar a recuperarse: volver al modulo anterior, ir al dashboard, buscar registro, o explicar si el registro fue eliminado.

Fix recomendado: usar una tarjeta mas ancha, acciones secundarias y, en app autenticada, conservar contexto del modulo cuando sea posible.

### P3 - Header superior a veces queda como capsula vacia

Evidencia:

- `desktop-dashboard.png`
- varios listados con acciones fuera del header.

El shell se ve pulido, pero cuando el header no contiene titulo/acciones utiles, la capsula blanca superior se siente decorativa. No es urgente, pero cada pixel del chrome deberia justificar su presencia.

Fix recomendado: mover contadores, filtros o acciones primarias al header cuando aporten contexto. El proyecto ya tiene `PageHeader headerActions` para eso.

## Tabla Before/After prioritaria

| Before | After | Why |
| --- | --- | --- |
| `Select` Radix usado con `<option>` hijos en repuestos/servicios | Usar `SelectTrigger`, `SelectValue`, `SelectContent` y `SelectItem` | Recupera affordance, foco, teclado y consistencia visual |
| Tabla full-width con 1-2 filas y 70% inferior vacio | Modo low-density: resumen por estado + lista compacta o panel contextual | El espacio debe guiar decision, no hacer que la pantalla parezca incompleta |
| `recepcion/[id]` en `PageContainer width="form"` con una sola tabla corta | Layout 2 columnas con OC, guia, estado, historial y stock | Una recepcion necesita cierre operacional y evidencia, no solo confirmacion minima |
| Reportes con metricas + un resumen corto | Reporte accionable bajo el resumen: desglose, tendencia o cola exportable XLSX | El usuario llega a reportes para tomar decisiones o extraer datos |
| 404 app con icono pequeno y un solo boton | Estado de recuperacion con dashboard, busqueda y vuelta al modulo anterior | Reduce callejones sin salida y mantiene orientacion |
| Accion primaria separada lejos del contenido editado | Accion anclada al bloque o al header contextual | La interfaz se siente mas responsiva y menos dispersa |

## Revision una por una

| Captura | Ruta aproximada | Aire | Hallazgo | Recomendacion |
| --- | --- | --- | --- | --- |
| `desktop-admin-auditoria.png` | `/admin/auditoria` | Alto | Tabla clara pero con solo 4 eventos en una franja superior. Gran vacio inferior. | Agregar filtros visibles, resumen por accion/entidad y paginacion o actividad reciente. |
| `desktop-admin-configuracion.png` | `/admin/configuracion` | Bajo | Buena composicion de formulario + vista previa + parametros. El espacio se siente intencional. | Mantener este patron. Acercar o anclar mejor el boton guardar al formulario activo. |
| `desktop-admin-faenas.png` | `/admin/faenas` | Alto | Dos faenas en tabla full-width, mucho aire sin informacion secundaria. | Usar lista compacta o panel con cobertura por faena, usuarios asociados y estado. |
| `desktop-admin-productos-detalle.png` | `/admin/productos/prod-audit-1` | Bajo | Modal de edicion claro, controles reconocibles, foco de tarea correcto. | Mantener. Revisar solo densidad interna si crecen tabs de atributos/proveedores. |
| `desktop-admin-productos-nuevo.png` | `/admin/productos/nuevo` | Bajo | Modal consistente y bien contenido. Tabs y acciones al pie funcionan. | Mantener como referencia para otros formularios. |
| `desktop-admin-productos.png` | `/admin/productos` | Medio | Tabla principal mas bloque de categorias debajo. El aire tiene segunda lectura. | Buen patron reutilizable para catálogos con datos relacionados. |
| `desktop-admin-proveedores.png` | `/admin/proveedores` | Alto | Tabla con pocos proveedores, termina demasiado pronto. | Agregar resumen de condiciones/contactos o modo tarjetas compactas. |
| `desktop-admin-trabajadores.png` | `/admin/trabajadores` | Alto | Tabla corta y sin contexto adicional de dotacion. | Agregar conteo por faena, estado o proximos vencimientos si aplica. |
| `desktop-admin-usuarios.png` | `/admin/usuarios` | Medio | Lista mas rica por avatar/roles, pero aun queda mucho aire inferior. | Mejorar con filtros por rol/faena y resumen de permisos o invitaciones pendientes. |
| `desktop-admin.png` | `/admin` | Medio | Hub bien agrupado en 3 columnas, pero la mitad inferior queda sin proposito. | Agregar actividad reciente del sistema o estado de configuracion. |
| `desktop-app-not-found.png` | ruta inexistente autenticada | Alto | Estado 404 pequeno, centrado y con una sola salida. | Expandir recuperacion: dashboard, modulo anterior, busqueda y explicacion. |
| `desktop-aprobaciones.png` | `/aprobaciones` | Medio | Tarjetas de decision con buen contexto; aire inferior visible pero aceptable. | Agregar resumen de aprobados/rechazados recientes si hay datos. |
| `desktop-bodega.png` | `/bodega` | Bajo | Excelente densidad: stock, kardex y devolucion usan el ancho con claridad. | Mantener como patron de pantalla operacional desktop. |
| `desktop-compras-detalle.png` | `/compras/po-audit-1` | Medio | Buen panel derecho, pero el lado izquierdo queda corto tras items/notas. | Agregar historial de estados, recepciones relacionadas o timeline bajo la OC. |
| `desktop-compras-nueva.png` | `/compras/nueva` | Medio | Formulario claro, pero una sola columna principal deja espacio libre. | Sumar panel lateral de proveedor/OC, items aprobados y reglas de generacion. |
| `desktop-compras-print.png` | `/compras/po-audit-1/print` | Bajo | La hoja imprimible esta bien centrada y el aire corresponde al formato papel. | Mantener. Verificar solo que impresion/export PDF no recorte. |
| `desktop-compras.png` | `/compras` | Alto | Aviso + tabla de 2 OC, pero mucho vacio y dos CTAs compiten visualmente. | Convertir aviso en bandeja accionable de items aprobados y sumar resumen por estado. |
| `desktop-dashboard.png` | `/dashboard` | Bajo | Mejor densidad general: metricas, acciones y cola de trabajo sobre el fold. | Pulir header vacio, pero conservar estructura. |
| `desktop-entregas.png` | `/entregas` | Medio | Formulario + historial, uso razonable del primer pantallazo. | Agregar panel lateral si crece la complejidad, pero no es prioritario. |
| `desktop-login.png` | `/login` | Bajo | Composicion cuidada, marca fuerte y foco claro. | Reducir ligeramente el grosor visual del foco si se busca mas delicadeza. |
| `desktop-not-found.png` | ruta inexistente publica | Alto | Estado vacio demasiado pequeno para desktop. | Igual que app 404: mas recuperacion y mejor escala. |
| `desktop-recepcion-detalle.png` | `/recepcion/rec-audit-1` | Alto | Resumen y una fila recibida ocupan poco; no hay cierre documental. | Dos columnas con OC, guia, historial, diferencias y efecto en stock. |
| `desktop-recepcion-nueva.png` | `/recepcion/nueva` | Medio-Alto | Flujo entendible, pero sin panel de apoyo y con mucho espacio inferior. | Agregar resumen OC, reglas de recepcion oficina/faena y efecto en stock. |
| `desktop-recepcion.png` | `/recepcion` | Alto | Tabla de 2 recepciones en una franja superior. | Sumar bandeja de OC pendientes y filtros por destino/estado. |
| `desktop-registro.png` | `/registro` | Bajo | Aire justificado por tarea unica y flujo interno de invitacion. | Mantener. Solo asegurar estados de error y token vencido. |
| `desktop-reportes.png` | `/reportes` | Medio-Alto | Buen inicio con metricas, pero cuerpo demasiado corto para un modulo de reportes. | Agregar reporte accionable, desglose por faena o ultimas exportaciones XLSX. |
| `desktop-repuestos-detalle.png` | `/repuestos/rep-audit-1` | Bajo | Seguimiento, contexto y secciones apiladas dan buena sensacion de proceso. | Mantener como referencia para detalles de servicios/repuestos. |
| `desktop-repuestos-nueva.png` | `/repuestos/nueva` | Critico | Selects aparecen como texto sin contenedor. Layout ancho, pero controles pierden affordance. | Corregir uso de `Select`. Luego revisar densidad del bloque de datos generales. |
| `desktop-repuestos.png` | `/repuestos` | Alto | Una fila en tabla full-width crea pantalla incompleta. | Modo cola compacta para pocos registros + resumen de urgencias. |
| `desktop-root.png` | `/` redirige a login | Bajo | Correctamente equivalente al login por redireccion. | Mantener. |
| `desktop-servicios-detalle.png` | `/servicios/srv-audit-1` | Bajo | Detalle con seguimiento, contrato visual consistente y buena cantidad de informacion. | Mantener. |
| `desktop-servicios-nueva.png` | `/servicios/nueva` | Critico | Mismo problema de selects renderizados como texto. | Corregir uso de `Select` con el patron Radix completo. |
| `desktop-servicios.png` | `/servicios` | Alto | Una fila con urgencia alta, pero sin jerarquia que la haga accionable. | Modo low-data con cola, resumen por urgencia y accion directa. |
| `desktop-solicitudes-detalle.png` | `/solicitudes/req-audit-1` | Bajo | Muy buen patron: seguimiento, resumen lateral y continuacion bajo fold. | Mantener como referencia para otros detalles. |
| `desktop-solicitudes-nueva.png` | `/solicitudes/nueva` | Bajo | Formulario y resumen lateral guian bien la creacion. | Mantener. |
| `desktop-solicitudes.png` | `/solicitudes` | Medio-Alto | Cinco filas con buenas senales de tipo/urgencia, pero sigue siendo tabla-isla. | Agregar filtros visibles, resumen por urgencia/tipo o tabs de cola. |
| `desktop-trazabilidad.png` | `/trazabilidad` | Medio | Tabla mas informativa y banner de alerta ayudan, aunque queda aire inferior. | Mantener base; sumar filtros persistentes o resumen de discrepancias si hay datos. |

## Patrones a rescatar

- `desktop-bodega.png`: usa dos columnas, datos vivos y accion lateral sin sentirse decorativo.
- `desktop-dashboard.png`: convierte el primer pantallazo en una cola de trabajo real.
- `desktop-solicitudes-nueva.png`: muestra el mejor uso de resumen lateral para formularios.
- `desktop-solicitudes-detalle.png`: seguimiento de etapas + resumen + detalle, buen modelo para cierres operativos.
- `desktop-admin-configuracion.png`: vista previa y parametros transforman el ancho desktop en contexto.
- `desktop-admin-productos.png`: tabla principal + bloque secundario evita que el catalogo se sienta vacio.

## Plan de mejora recomendado

1. Corregir `Select` en repuestos/servicios nuevos. Es el hallazgo de mayor impacto porque afecta comprension y edicion.
2. Definir un patron `LowDataTableLayout` o equivalente para listas con 1-5 filas. No inventar datos: usar resumen, filtros, actividad o acciones reales.
3. Redisenar `recepcion/[id]` con panel contextual de OC/guia/historial/stock.
4. Enriquecer `reportes` con una capa accionable bajo las metricas.
5. Mejorar 404 autenticado y publico con recuperacion contextual.
6. Revisar headerActions por modulo para que la capsula superior no quede decorativa.

## Checklist

- [ ] Repuestos nueva: reemplazar `<option>` por `SelectItem`.
- [ ] Servicios nueva: reemplazar `<option>` por `SelectItem`.
- [ ] Crear patron para tablas con pocos registros.
- [ ] Aplicar patron a repuestos, servicios, faenas, auditoria, proveedores y trabajadores.
- [ ] Recepcion detalle: sumar contexto lateral y cierre operativo.
- [ ] Recepcion nueva: sumar resumen de OC y reglas de stock.
- [ ] Reportes: agregar salida accionable o desglose secundario.
- [ ] 404 app/publico: ampliar recuperacion.
- [ ] Revisar headerActions del dashboard y listados principales.

