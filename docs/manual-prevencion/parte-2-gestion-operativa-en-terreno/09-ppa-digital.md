# Capítulo 09: Para, Piensa y Actúa (PPA Digital) en Terreno

> **Marco de Seguridad:** Política de Detención de Tareas Inseguras (*"Yo paro si no es seguro"*).  
> **Rutas en Plataforma:**  
> *   Bandeja de Gestión PRF: `/prevencion/ppa`  
> *   Casos Pendientes: `/prevencion/ppa?estado=pendientes`  
> *   Acceso QR para Trabajadores: Panel de enlaces rápidos por faena en la cabecera.

---

## 1. La Filosofía del PPA: El Poder de Detener el Trabajo

La herramienta **"Para, Piensa y Actúa" (PPA Digital)** otorga a cualquier trabajador, conductor u operador el derecho y la obligación de **detener una labor de inmediato** si detecta una condición de peligro que no está controlada, sin temor a sanciones ni represalias de la jefatura:

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│  1. PARA    │ ───►  │  2. PIENSA  │ ───►  │  3. ACTÚA   │
│ Detén la    │       │ Analiza el  │       │ Implementa  │
│ tarea ya!   │       │ riesgo real │       │ el control  │
└─────────────┘       └─────────────┘       └─────────────┘
```

---

## 2. Cómo Generar el Código QR de Faena y Cómo Reporta el Trabajador

### ¿Cómo obtiene el Prevencionista los Códigos QR para la Faena?
1. En `/prevencion/ppa`, en la barra superior de acciones, haz clic en el botón **"Acceso para el trabajador"**.
2. Se abrirá el panel oficial de generación de accesos:
   *   **Opción por Faena (Firmada con HMAC):** Selecciona tu faena (Biodiversa, Cholguan, Horcones, Masisa, Santa Fe o Teno). El sistema generará un enlace seguro firmado criptográficamente que precarga automáticamente la faena correcta.
   *   **Opción General:** Para trabajadores flotantes o contratistas que se identifican directamente con su RUT.
3. Haz clic en **"Descargar PDF"**: el sistema generará un afiche oficial listo para imprimir en tamaño carta o autoadhesivo para pegar en las cabinas de camiones, talleres y comedores.

### El Flujo del Trabajador en Terreno (1 minuto desde su celular):
1. El trabajador escanea el código QR con la cámara de su teléfono (no necesita descargar ninguna aplicación externa ni ingresar contraseñas complejas).
2. Se abre el formulario móvil rápido:
   *   Ingresa su nombre o RUT.
   *   Selecciona la tarea que estaba ejecutando (ej. *Carga de troncos, Maniobra de retroceso, Soldadura, Tránsito en ruta de tierra*).
   *   Marca el motivo de la detención:
       * 🛑 Falla mecánica o de frenos en el equipo.
       * 🛑 Terreno resbaladizo, barro o pendiente excesiva.
       * 🛑 Condición climática extrema (viento blanco, niebla densa, lluvia torrencial).
       * 🛑 Falta de EPP adecuado para la tarea.
       * 🛑 Intervención sin bloqueo de energía (falta de LOTO).
   *   Describe brevemente el problema y presiona **"Detener Tarea y Enviar Alerta"**.
3. La tarea pasa a estado **`detenida`** y se dispara una alerta instantánea en el panel de **"Atención requerida"** del Prevencionista de Faena.

---

## 3. La Bandeja de Gestión del Prevencionista (`/prevencion/ppa`)

Al abrir `/prevencion/ppa`, verás:

### A. Barra de Métricas y Semáforo en Tiempo Real:
*   Total de PPA registrados en el mes.
*   Tareas actualmente detenidas (alerta roja parpadeante si hay casos abiertos).
*   Tiempo promedio de resolución en terreno.
*   Ranking de los motivos más frecuentes en tu faena.

### B. Listado de Casos y Filtros:
Puedes filtrar por estado:
*   🔴 **Detenidas:** Requieren tu presencia urgente en el punto de trabajo.
*   🟡 **En corrección:** La cuadrilla o el taller está implementando la solución técnica.
*   🔵 **En verificación:** El supervisor declaró que la medida está lista y espera tu visto bueno.
*   🟢 **Autorizadas / Reiniciadas:** Tareas que volvieron a operar de forma segura.

---

## 4. Paso a Paso: Cómo Gestionar una Detención y Autorizar el Reinicio

```
[PPA Reportado en Estado "Detenida"]
                 │
                 ▼
[Acudir a terreno e inspeccionar la condición]
                 │
                 ▼
[Acordar medidas de control con Supervisor y Cuadrilla]
                 │
                 ▼
[Abrir caso en /prevencion/ppa/[id] y presionar "Declarar Controles"]
                 │
                 ▼
[Verificar en terreno que el peligro fue eliminado]
                 │
                 ▼
[Presionar "Autorizar Reinicio Seguro"]
```

### Paso 1: Verificación en Terreno
Apenas recibas la alerta, dirígete al lugar con el Supervisor de Terreno. Conversa con el trabajador que detuvo la tarea para entender el peligro desde su perspectiva.

### Paso 2: Registro de Controles Implementados
Abre el caso en `/prevencion/ppa/[id]` y haz clic en **"Registrar medidas de control"**:
*   Describe qué se hizo para eliminar el riesgo (ej. *Se reemplazó manguera hidráulica averiada por repuesto nuevo en camión patente AB-CD-12* o *Se esparció gravilla en curva con barro y se instaló pretil de seguridad*).
*   Adjunta una fotografía de la condición corregida.

### Paso 3: Autorización de Reinicio Seguro
Una vez que tú y el supervisor comprobaron que no existe riesgo para las personas:
1. Haz clic en el botón verde **"Autorizar reinicio seguro"**.
2. Ingresa tu comentario de cierre.
3. El estado cambiará a **`autorizada`** y el conductor u operador podrá reiniciar su jornada con total tranquilidad.

---

## 5. Exportación de Indicadores PPA para Reuniones de Faena

En la cabecera de `/prevencion/ppa`, presiona **"Exportar PPA"**:
*   Descargarás un consolidado en Excel con todas las detenciones del mes.
*   Úsalo en la reunión mensual del Comité Paritario (CPHS) o en la reunión semanal de operaciones: **reconoce públicamente a los trabajadores que se atrevieron a detener una tarea insegura**, reforzando la cultura preventiva de la faena.
