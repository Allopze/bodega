# Prompt para implementar el módulo PPA Digital / Para, Piensa y Actúa

Actúa como una IA desarrolladora senior con acceso completo al repositorio de mi webapp. Tu tarea es implementar un nuevo módulo llamado **PPA Digital / Para, Piensa y Actúa**, siguiendo la arquitectura, convenciones, stack, patrones de código, estructura de carpetas, sistema de autenticación, estilos visuales y lógica existente del proyecto.

No quiero una aplicación aparte. No quiero una reescritura completa. No quiero una solución sobredimensionada. Implementa el módulo dentro de la webapp actual de la forma más limpia, mantenible y coherente posible.

## Contexto del módulo

El módulo busca digitalizar el proceso de evaluación preventiva antes del inicio de una tarea. El trabajador debe completar un PPA rápido desde un QR o enlace directo, responder preguntas críticas sobre la tarea, los peligros, los cambios, los controles y la seguridad de inicio.

El sistema debe permitir detectar condiciones inseguras, detener el trabajo, alertar al supervisor, registrar la intervención correctiva y dejar trazabilidad para análisis posterior.

El objetivo no es crear un simple formulario digital. El objetivo es crear un flujo preventivo real que ayude a evitar que un trabajo comience si existe un riesgo no controlado.

## Decisión importante sobre usuarios trabajadores

No debes crear cuentas de usuario para cada trabajador.

Los trabajadores no deben iniciar sesión ni tener contraseña. El acceso del trabajador debe ser simple, mediante QR o enlace directo al formulario PPA.

Al inicio del formulario, el trabajador debe identificarse de una forma simple y ordenada. Debe poder buscarse o seleccionarse desde una lista controlada de trabajadores, o ingresar un identificador como nombre, RUT, código interno, empresa o dato equivalente según lo que ya exista en la webapp.

Si el trabajador no aparece en la lista, el sistema debe permitir continuar con identificación manual, pero esa identificación debe quedar marcada visualmente para revisión o validación posterior por un usuario autorizado.

Los usuarios autenticados del sistema deben ser solo perfiles internos como administrador, supervisor, prevencionista o jefe de área, según los roles que ya existan en la webapp.

No inventes un sistema nuevo de autenticación si ya existe uno. No crees usuarios trabajadores si no son necesarios. Mantén el flujo del trabajador con la menor fricción posible.

## Reglas técnicas generales

Antes de implementar, inspecciona el repositorio y entiende:

- Qué framework usa la webapp.
- Cómo están organizadas las rutas, páginas, componentes y servicios.
- Cómo se maneja la autenticación.
- Cómo se manejan los permisos.
- Cómo se persiste la información.
- Cómo se validan formularios.
- Cómo se muestran notificaciones, alertas, modales y estados.
- Cómo se construyen tablas, dashboards o reportes.
- Qué sistema de estilos o componentes visuales ya existe.

Después de revisar el proyecto, implementa siguiendo los patrones actuales. No impongas una arquitectura externa si el proyecto ya tiene una forma clara de trabajar.

No propongas campos específicos de base de datos en la respuesta final. Si necesitas persistencia, resuélvela internamente usando las convenciones existentes del proyecto y explica la decisión a nivel funcional, no como diseño de tablas.

## Alcance del MVP

Implementa una primera versión funcional del módulo con el siguiente alcance:

1. Acceso al formulario PPA desde la webapp.
2. Acceso al formulario mediante QR o enlace directo.
3. Identificación simple del trabajador sin login.
4. Formulario PPA preventivo antes del inicio del trabajo.
5. Evaluación automática de respuestas críticas.
6. Detención automática del trabajo cuando exista riesgo no controlado.
7. Mensaje claro al trabajador cuando el trabajo debe detenerse.
8. Alerta al supervisor responsable.
9. Vista para que el supervisor revise PPA detenidos o pendientes.
10. Registro de intervención del supervisor.
11. Autorización o rechazo del inicio del trabajo por parte del supervisor.
12. Historial de PPA realizados.
13. Panel básico de análisis e indicadores.
14. Filtros básicos para revisar la información.
15. Exportación simple de datos si la webapp ya cuenta con mecanismos de exportación o si puede implementarse sin sobredimensionar.

## Flujo del trabajador

El flujo del trabajador debe ser lo más simple posible:

1. Escanea un QR o abre un enlace directo.
2. Llega al formulario PPA.
3. Se identifica sin iniciar sesión.
4. Selecciona o indica el área, lugar o contexto de trabajo si corresponde.
5. Responde las preguntas del PPA.
6. Envía el formulario.
7. Recibe una respuesta clara del sistema:
   - Puede iniciar el trabajo.
   - Debe detener el trabajo y comunicarse con el supervisor.

El formulario debe estar optimizado para uso en celular. Debe ser rápido, claro y fácil de completar en terreno.

## Preguntas mínimas del formulario PPA

Incluye estas preguntas como base funcional del formulario:

### Pregunta 1

¿Qué trabajo voy a realizar?

Opciones sugeridas:

- Mantención.
- Operación.
- Limpieza.
- Izaje.
- Trabajo en altura.
- Espacio confinado.
- Excavación.
- Otro.

Si el usuario selecciona “Otro”, debe poder especificar el tipo de trabajo.

### Pregunta 2

¿Existe algún cambio respecto a lo planificado?

Opciones:

- No.
- Sí.

Si responde “Sí”, debe aparecer una pregunta adicional:

¿Qué cambió?

### Pregunta 3

¿Existe un peligro que no esté controlado?

Opciones:

- No.
- Sí.

Si responde “Sí”, debe aparecer una pregunta adicional:

¿Cuál es el peligro?

### Pregunta 4

¿Tengo todos los controles implementados?

Controles sugeridos:

- Permiso de trabajo.
- Elementos de protección personal.
- Herramientas adecuadas y en buen estado.
- Energías bloqueadas.
- Señalización.
- Área despejada.
- Comunicación con el equipo.
- Otro control necesario para la tarea.

### Pregunta 5

¿Es seguro comenzar el trabajo?

Opciones:

- Sí.
- No.

Si responde “No”, el sistema debe detener el flujo y mostrar un mensaje claro de detención.

## Preguntas complementarias Para, Piensa y Actúa

Incluye también preguntas orientadas a verificar si el trabajador realmente observó, pensó y evaluó el riesgo antes de comenzar:

1. ¿Cuál es el peligro más crítico de la tarea que realizarás?
2. ¿Qué cambió hoy en el área de trabajo que podría aumentar el riesgo?
3. ¿Qué revisión realizaste al equipo o herramienta antes de comenzar?
4. ¿Qué condición del clima, ambiente o entorno podría hacerte detener el trabajo?

Estas preguntas deben ser obligatorias cuando la tarea sea crítica o cuando el flujo lo requiera. Si no existe configuración previa de tareas críticas, implementa una solución simple y fácil de extender, sin sobredimensionar.

## Reglas para detener el trabajo

El sistema debe detener el trabajo si ocurre cualquiera de estas situaciones:

- El trabajador responde que no es seguro comenzar.
- El trabajador declara que existe un peligro no controlado.
- El trabajador informa un cambio respecto a lo planificado y no describe el cambio.
- El trabajador deja sin responder una pregunta crítica.
- El trabajador responde de forma vacía, genérica o insuficiente en preguntas obligatorias.
- El trabajador indica que no identifica peligros en una tarea donde debería existir evaluación de riesgo.
- Faltan controles relevantes para la tarea seleccionada.

Cuando el trabajo se detenga, el trabajador debe ver un mensaje claro, visible y difícil de ignorar:

> DETENGA EL TRABAJO. Comuníquese con su supervisor.

El mensaje debe explicar que el trabajo no debe comenzar hasta que el supervisor revise la situación y autorice el inicio.

## Resultado cuando todo está correcto

Si las respuestas no activan ninguna condición crítica, el sistema debe permitir finalizar el PPA con un mensaje claro:

> Puede iniciar el trabajo de forma segura.

Ese resultado debe quedar registrado para trazabilidad y análisis posterior.

## Flujo del supervisor

Cuando el sistema detecte una condición insegura, debe generarse una alerta para el supervisor correspondiente o para el panel de supervisión disponible.

La alerta debe mostrar de forma clara:

- Trabajador identificado.
- Hora del registro.
- Lugar, área o contexto del trabajo.
- Tipo de tarea.
- Motivo de la alerta.
- Respuesta crítica que activó la detención.
- Estado actual del PPA.

El supervisor debe poder abrir el detalle del PPA y responder al menos estas preguntas:

1. ¿Fui al lugar?
2. ¿Qué acción correctiva implementé?
3. ¿Autorizo iniciar el trabajo?

El supervisor no debe poder autorizar el inicio si no registra una acción correctiva cuando el trabajo fue detenido por riesgo o condición insegura.

La autorización o rechazo del supervisor debe quedar registrada dentro del historial del PPA.

## Estados funcionales del PPA

El módulo debe manejar estados funcionales claros para que el trabajador, el supervisor y los administradores entiendan en qué situación está cada PPA.

Estados mínimos esperados:

- Enviado.
- Aprobado automáticamente.
- Trabajo detenido.
- Pendiente de revisión del supervisor.
- En corrección.
- Autorizado por supervisor.
- Rechazado por supervisor.
- Cerrado.

Usa los nombres y estructura que mejor calcen con el proyecto, pero asegúrate de que estos estados funcionales existan o puedan representarse claramente en la interfaz.

## Panel del supervisor

Implementa una vista donde el supervisor pueda revisar:

- PPA pendientes de revisión.
- PPA con trabajo detenido.
- PPA ya autorizados.
- PPA rechazados.
- Historial de intervenciones.

Debe poder filtrar o buscar registros de forma simple, especialmente por fecha, estado, área, trabajador o tipo de tarea, si esos datos están disponibles en el flujo.

## Panel de administración y análisis

Implementa una vista básica de análisis para perfiles autorizados.

Debe permitir revisar indicadores como:

- Cantidad total de PPA realizados.
- Cantidad de trabajos detenidos.
- Porcentaje de PPA con desviaciones.
- Riesgos o motivos de alerta más frecuentes.
- Áreas con mayor cantidad de desviaciones.
- Tipos de trabajo con más alertas.
- Tiempo promedio de respuesta del supervisor, si la información está disponible.
- Cantidad de PPA aprobados automáticamente.
- Cantidad de PPA autorizados o rechazados por supervisor.

No es necesario construir un sistema avanzado de inteligencia de negocios. Implementa un dashboard útil, simple y coherente con la webapp actual.

## Trazabilidad

Cada PPA debe dejar trazabilidad suficiente para auditoría y análisis.

Debe poder saberse:

- Quién realizó el PPA o cómo se identificó el trabajador.
- Cuándo se realizó.
- Qué tarea declaró.
- Qué respuestas entregó.
- Qué condición activó una alerta, si aplica.
- Qué supervisor intervino, si aplica.
- Qué acción correctiva se registró.
- Qué decisión final tomó el supervisor.
- Cuándo se cerró o autorizó el caso.

No conviertas esto en una explicación de campos de base de datos. Resuelve la persistencia siguiendo el patrón del proyecto y entrega la trazabilidad funcional esperada.

## Notificaciones

Implementa notificaciones según lo que ya exista en la webapp.

Prioridad de canales:

1. Notificación interna dentro de la webapp.
2. Correo electrónico, si el proyecto ya lo soporta o es simple de implementar.
3. Integraciones externas solo si ya existen en el proyecto.

No agregues integraciones complejas como Teams, Slack o WhatsApp en el MVP si el proyecto no las tiene preparadas.

Las notificaciones mínimas son:

- Al supervisor cuando un trabajo es detenido.
- Al supervisor cuando un PPA queda pendiente de revisión.
- Al trabajador o vista pública cuando el trabajo queda autorizado.
- Al trabajador o vista pública cuando el trabajo queda rechazado o requiere corrección.

## Experiencia de usuario

El módulo debe ser extremadamente claro.

Prioridades de UX:

- Mobile first.
- Formulario breve.
- Lenguaje simple.
- Botones grandes y comprensibles.
- Estados visuales claros.
- Mensajes de riesgo visibles.
- Confirmaciones antes de enviar respuestas críticas.
- Evitar pantallas innecesarias.
- Evitar que el trabajador tenga que iniciar sesión.
- Evitar campos largos cuando se pueda seleccionar desde opciones.

El trabajador debe entender rápidamente si puede iniciar o debe detener el trabajo.

El supervisor debe entender rápidamente qué ocurrió, qué debe revisar y qué decisión debe registrar.

## Permisos

Respeta el sistema de permisos existente en la webapp.

Los trabajadores sin login solo deben poder acceder al formulario público/controlado y ver el resultado asociado al envío actual.

Los supervisores deben poder ver y gestionar los PPA que les correspondan según la lógica del proyecto.

Los administradores o prevencionistas deben poder revisar el conjunto de registros e indicadores.

Si el proyecto aún no tiene granularidad suficiente, implementa una solución mínima y coherente, sin crear una arquitectura de permisos innecesariamente compleja.

## Validaciones

El formulario debe validar:

- Identificación del trabajador.
- Tipo de trabajo.
- Preguntas críticas obligatorias.
- Descripciones requeridas cuando se responde “Sí” a cambios o peligros.
- Selección de controles.
- Confirmación de seguridad para iniciar.

Las validaciones deben ocurrir tanto en el frontend como en el backend si el proyecto tiene esa separación.

## QR o enlace directo

Implementa o deja preparado el acceso mediante QR o enlace directo.

Si la webapp ya tiene generación de QR, úsala.

Si no existe, implementa una solución simple para generar o mostrar un enlace que luego pueda convertirse en QR.

El QR o enlace debe llevar al formulario PPA correspondiente, idealmente con contexto de área, planta, faena o ubicación si la webapp ya maneja esa información.

No bloquees el MVP por una generación avanzada de QR. El acceso directo al formulario es suficiente si queda bien preparado.

## Funcionalidades fuera del MVP

No implementes en esta primera versión, salvo que ya existan en la webapp y sea trivial integrarlas:

- Cuentas de usuario para trabajadores.
- Aplicación móvil nativa.
- Inteligencia artificial para evaluar respuestas abiertas.
- Integraciones complejas con ERP.
- Integración avanzada con Teams, Slack o WhatsApp.
- Firma electrónica avanzada.
- Modo offline.
- Geolocalización obligatoria.
- Reportes predictivos.
- Matriz de riesgos completa.
- Gestión documental HSE completa.
- Capacitaciones dentro del módulo.
- Auditorías completas de seguridad.

Mantén el MVP enfocado en el flujo crítico: responder, evaluar, detener, alertar, corregir, autorizar y analizar.

## Criterios de aceptación

La implementación se considerará correcta si cumple con lo siguiente:

1. Un trabajador puede acceder al formulario sin iniciar sesión.
2. Un trabajador puede identificarse de forma simple y ordenada.
3. Un trabajador puede completar el PPA desde celular.
4. El sistema detecta respuestas críticas.
5. El sistema detiene automáticamente el trabajo cuando corresponde.
6. El sistema muestra un mensaje claro de detención.
7. El supervisor recibe o visualiza una alerta del PPA detenido.
8. El supervisor puede revisar el detalle del PPA.
9. El supervisor puede registrar una acción correctiva.
10. El supervisor puede autorizar o rechazar el inicio del trabajo.
11. Los PPA quedan disponibles en un historial.
12. Los usuarios autorizados pueden revisar indicadores básicos.
13. La solución respeta la arquitectura y estilos de la webapp actual.
14. La solución no crea cuentas innecesarias para trabajadores.
15. La solución no rompe funcionalidades existentes.

## Pruebas esperadas

Si el proyecto tiene sistema de pruebas, agrega o actualiza pruebas para los flujos principales:

- Envío de PPA seguro.
- Envío de PPA con trabajo detenido.
- Validación de preguntas críticas.
- Revisión por supervisor.
- Autorización por supervisor.
- Rechazo por supervisor.
- Acceso y permisos básicos.

Si el proyecto no tiene pruebas automatizadas, entrega una lista clara de pruebas manuales realizadas o recomendadas.

## Entrega esperada

Al finalizar, entrega:

1. Resumen de lo implementado.
2. Archivos modificados o creados.
3. Decisiones técnicas importantes.
4. Cómo probar el flujo del trabajador.
5. Cómo probar el flujo del supervisor.
6. Cómo revisar los indicadores.
7. Limitaciones conocidas.
8. Próximos pasos recomendados.

No entregues una propuesta genérica. Implementa el módulo dentro del código existente.

No inventes requisitos que no fueron solicitados.

No crees un sistema de usuarios trabajadores.

No entregues diseño de base de datos como respuesta principal.

No conviertas el MVP en una plataforma HSE completa.

Prioriza una implementación funcional, clara, segura, mantenible y fácil de extender.
