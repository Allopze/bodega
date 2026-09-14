# Capítulo 07: Capacitaciones, Charlas y Matriz de Brechas

> **Marco Normativo:** Decreto Supremo 40 (DS 40, Art. 21 - Obligación de Informar los Riesgos Laborales ODI) y Decreto Supremo 44 (DS 44, Programa de Capacitación).  
> **Rutas en Plataforma:**  
> *   Sesiones de Capacitación: `/prevencion/capacitacion`  
> *   Catálogo de Cursos: `/prevencion/capacitacion/catalogo`  
> *   Matriz de Brechas: `/prevencion/capacitacion/brechas`  
> **Actividades PDTP Asociadas:** N° 16, 37, 38, 51, 53, 54, 55, 56, 57, 58, 59, 60 y 63.

---

## 1. El Sistema de Capacitación y Competencias en CHOME

La capacitación preventiva en la plataforma no es un simple repositorio de listas de asistencia en papel: es un **motor de competencias laborales** que garantiza que nadie opere una máquina o conduzca un camión sin la preparación técnica requerida por la ley.

El sistema administra 13 cursos normados vinculados directamente al Programa de Trabajo Preventivo (PDTP), destacando:
*   **PDTP-53:** Charla diaria de 5 minutos de inicio de turno.
*   **PDTP-38:** Charla mensual de refuerzo operacional.
*   **PDTP-56:** Curso integral de Manejo a la Defensiva (mínimo 480 minutos).
*   **PDTP-57:** Aislamiento y bloqueo de energías peligrosas (LOTO).
*   **PDTP-51 / 54 / 58 / 59:** Ergonomía, Uso de EPP, Sustancias Peligrosas y Trabajo en Altura.

---

## 2. Paso a Paso: Cómo Registrar una Sesión de Capacitación o Charla

```
[Ir a /prevencion/capacitacion]
               │
               ▼
[Presionar "Registrar Sesión"]
               │
               ▼
1. Seleccionar Faena y Curso del Catálogo Oficial
2. Definir Relator, Fecha, Hora y Duración en minutos
3. Seleccionar Trabajadores Asistentes (por RUT o Nombre)
4. Ingresar Calificación / Prueba si el curso lo exige
5. Adjuntar Lista Firmada en PDF o Foto de Terreno
               │
               ▼
[Presionar "Cerrar y Acreditar Sesión"]
```

### Paso 1: Iniciar el Registro
En `/prevencion/capacitacion`, presiona el botón **"Registrar sesión"**.

### Paso 2: Datos de la Sesión
*   **Faena:** Selecciona el centro de trabajo donde se dictó la actividad.
*   **Curso:** Elige el curso en el desplegable. 
    > [!IMPORTANT]
    > Solo puedes registrar sesiones sobre **versiones publicadas** de los cursos. Si un curso aparece deshabilitado, solicita a la Jefa de Prevención que apruebe su temario.
*   **Relator:** Selecciona si fue dictado por el Prevencionista de Faena, el Jefe de Terreno, el Supervisor o un organismo externo (Mutual de Seguridad, proveedor técnico).
*   **Fecha y Duración:** Indica la duración real en minutos (para la charla diaria son habitualmente 5 a 15 minutos; para cursos especializados debe cumplir el mínimo legal).

### Paso 3: Carga de Asistentes y Calificaciones
*   En la sección de participantes, escribe el RUT o nombre de cada trabajador presente y presiona *"Agregar"*.
*   **Prueba de Evaluación (Actividades PDTP N° 16 y 63):** Si el curso exige evaluación teórica con nota de corte (ej. mínimo 75% o nota 4.0):
    *   Ingresa la nota o puntaje de cada trabajador.
    *   El sistema marcará automáticamente si el trabajador aprobó o reprobó. Solo los trabajadores que aprueben contarán para el cumplimiento de la actividad en el PDTP.

### Paso 4: Carga de Respaldo Documental y Cierre
*   Sube el archivo PDF escaneado con las firmas de los trabajadores o una fotografía nítida de la planilla de asistencia.
*   Presiona **"Cerrar sesión"**.
*   **Resultado:**
    1. Se actualiza la hoja de vida de capacitación de cada trabajador.
    2. La celda correspondiente en el Programa de Trabajo Preventivo (`/prevencion/pdtp`) se pinta automáticamente de **verde**.

---

## 3. El Tablero de Brechas de Competencia (`/prevencion/capacitacion/brechas`)

El tablero de brechas es una de las herramientas más valiosas para el Prevencionista antes de autorizar la jornada de trabajo:

```
FILTRO DE BRECHAS: [ Faena: Santa Fe - Grúas ]  [ Cargo: Operador de Grúa ]
─────────────────────────────────────────────────────────────────────────────
Trabajador             Manejo Defensivo     Bloqueo LOTO       Trabajo Altura
─────────────────────────────────────────────────────────────────────────────
Juan Pérez             🟢 Vigente           🟢 Vigente         🟢 Vigente
Pedro Gómez            🔴 Vencido           🟢 Vigente         ⚪ No aplica
Rodrigo Soto           ⚠️ Sin registro      🔴 Vencido         🟢 Vigente
```

### Cómo Utilizar el Tablero para Prevenir Accidentes:
1. Entra a `/prevencion/capacitacion/brechas`.
2. Filtra por tu faena.
3. El sistema te mostrará a toda la dotación en una matriz tipo semáforo:
   * 🟢 **Vigente:** El trabajador cuenta con su capacitación aprobada dentro del plazo de vigencia (ej. anual).
   * 🔴 **Vencido / Sin registro:** El trabajador no tiene el curso o su certificación expiró.
4. **Acción Operativa:** Si detectas a un operador con cursos críticos en rojo (ej. LOTO o Manejo a la defensiva), coordina de inmediato con el Jefe de Terreno para programar su capacitación de refuerzo antes de asignarlo a tareas de alto riesgo.
