# Plantillas de correo

La pantalla **Plantillas de correo** permite editar los mensajes automaticos que
la plataforma envia por correo electronico. Las plantillas se almacenan en la
tabla `email_templates` y soportan variables dinamicas y bloques condicionales.

## Plantillas del sistema

| Clave | Nombre | Uso |
|-------|--------|-----|
| `invitation` | Invitacion | Correo de invitacion para nuevos usuarios |
| `notification` | Notificacion | Correo generico para todas las notificaciones del sistema |

## Como usarla

1. Entra a `Administracion > Plantillas de correo`.
2. Abre la plantilla que quieras cambiar.
3. Edita el **asunto** o el **cuerpo HTML**.
4. Usa la **vista previa** para verificar el resultado renderizado.
5. Guarda los cambios.

## Variables dinamicas

Las variables se escriben como `{{nombre_variable}}` y se reemplazan
automaticamente al enviar el correo. Los valores se escapan HTML
automaticamente para prevenir XSS.

### Invitation

| Variable | Descripcion | Ejemplo |
|----------|-------------|---------|
| `{{app_name}}` | Nombre de la plataforma | Plataforma Chome |
| `{{sender_name}}` | Nombre de quien invita | Maria Gonzalez |
| `{{invite_url}}` | URL unica de registro | https://app.chome.cl/registro?token=... |

### Notification

| Variable | Descripcion | Ejemplo |
|----------|-------------|---------|
| `{{app_name}}` | Nombre de la plataforma | Plataforma Chome |
| `{{user_name}}` | Nombre del destinatario | Juan Perez |
| `{{title}}` | Titulo de la notificacion | Solicitud aprobada |
| `{{body}}` | Cuerpo del mensaje | Tu solicitud fue aprobada... |
| `{{href}}` | URL de detalle (opcional) | https://app.chome.cl/solicitudes/042 |

## Bloques condicionales

Para contenido opcional, se usan bloques condicionales:

- **Bloque positivo**: `{{#variable}}...{{/variable}}` — se renderiza solo si
  la variable tiene valor (no vacia).
- **Bloque invertido**: `{{^variable}}...{{/variable}}` — se renderiza solo si
  la variable **no** tiene valor.

### Ejemplo

```html
{{#sender_name}}
<p><strong>{{sender_name}}</strong> te ha invitado a {{app_name}}.</p>
{{/sender_name}}
{{^sender_name}}
<p>Has sido invitado a {{app_name}}.</p>
{{/sender_name}}
```

Cuando `sender_name` tiene valor, se muestra el saludo personalizado. Cuando
esta vacio, se muestra el saludo generico.

## Restaurar valores por defecto

Si una plantilla fue personalizada y quieres volver al original:

1. En la lista de plantillas, haz clic en **Restaurar default** junto a la
   plantilla que quieras revertir.
2. El sistema restaura el asunto y HTML original del sistema.
3. La accion queda registrada en la auditoria.

## Notas importantes

- El HTML debe ser completo (con `<!DOCTYPE html>`, `<head>`, `<body>`).
  Las plantillas por defecto usan layout de tabla para compatibilidad con
  clientes de correo como Outlook.
- Las invitaciones usan la plantilla `invitation` automaticamente.
- Las notificaciones del sistema usan la plantilla `notification` automaticamente.
