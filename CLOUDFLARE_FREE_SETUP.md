# Migración gratuita a Cloudflare Pages + D1

Esta rama prepara una versión de Familia AKT para publicarse en Cloudflare Pages con una base de datos D1 persistente. **No modifica la rama `main` ni sustituye el servicio de Railway actual.**

## Qué cambia

- Los archivos web se sirven desde `public/`.
- Las rutas de API viven en `functions/`.
- Los movimientos, los lotes y el catálogo LPN se guardan en una fila JSON de D1.
- El inicio de sesión se verifica en el servidor. Las llamadas a la API requieren una sesión; la sesión expira a las 12 horas.
- Los usuarios de entrega solo pueden añadir movimientos en puestos asignados. Los administradores y mesanines conservan las funciones de operación previstas.
- La ruta `/importar-respaldo.html` permite importar una exportación de Railway solo si la base nueva todavía no tiene tareas ni catálogo.
- El Service Worker no almacena en caché las respuestas de API.

## Configuración en Cloudflare (plan gratuito)

1. Crea o abre una cuenta en Cloudflare: https://dash.cloudflare.com/sign-up
2. En **Workers & Pages**, crea una aplicación **Pages** y conecta GitHub. Selecciona este repositorio: `tobongaviriaje-del/familia-akt-control-canastas`.
3. Selecciona como rama de producción `cloudflare-free-migration`. Configura el comando de build vacío y el directorio de salida `public`.
4. En **Storage & Databases > D1**, crea una base llamada `familia-akt-control-canastas`.
5. En el proyecto Pages, abre **Settings > Functions > D1 database bindings** y añade un binding llamado exactamente `DB`, seleccionando esa base D1.
6. En **Settings > Variables and Secrets**, crea la variable secreta `BOOTSTRAP_ADMIN_PASSWORD` con una contraseña inicial propia de al menos 12 caracteres. Guárdala en tu gestor de contraseñas.
7. Guarda la configuración y vuelve a desplegar. La ruta `/health` debe responder JSON con `"ok": true`.

No hay que copiar SQL a mano: las funciones crean las tablas necesarias en D1 la primera vez que se usan. Si falla la base de datos o falta el secreto, la API devuelve un error explícito.

## Traslado de los datos que ya existen

1. En la página anterior de Familia AKT, exporta el estado. Puedes usar `tools/exportar-estado-railway.html` de esta misma rama (ábrela desde la URL raw.githack indicada por el equipo) y descargar el JSON directamente al computador. El archivo contiene información operativa y contraseñas: **no lo adjuntes a chats ni lo compartas**.
2. Abre la nueva aplicación Pages e ingresa como `admin` con la contraseña inicial configurada en `BOOTSTRAP_ADMIN_PASSWORD`.
3. En la misma cuenta/navegador abre `/importar-respaldo.html`, selecciona el JSON exportado y confirma la importación. El importador se niega a reemplazar una base con tareas existentes.
4. Cierra sesión e ingresa con las credenciales que estaban en la aplicación anterior.
5. Abre **Administración de usuarios > Estándares de motos**. Revisa y aplica los lotes iniciales correctos por referencia, conservando las entregas ya registradas:
   - CR4 150: 110 unidades
   - CR4 125: 270 unidades
   - VOGE/VOGI 180: 62 unidades
   - CH: 300 unidades
6. Comprueba un registro de entrega de prueba, incluidas canastas físicas, antes de usar el servicio en operación.

## Notas de seguridad y continuidad

- Mantén Railway intacto hasta que la aplicación nueva haya sido probada. No borres el proyecto ni su volumen.
- El plan gratuito de Cloudflare tiene límites de uso diarios; no proporciona una garantía de disponibilidad empresarial.
- Si la importación no confirma éxito, conserva el archivo JSON local y no repitas la importación hasta revisar el estado.
- La API antigua de Railway queda como estaba en `main`; el parche de autenticación solo existe en esta rama.
