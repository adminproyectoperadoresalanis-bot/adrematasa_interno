# Restablecer contraseña sin correo (herramienta de admin)

Esta carpeta trae una herramienta de línea de comandos para que tú, como
administrador, puedas restablecer la contraseña de un empleado que la
olvidó — sin depender de ningún correo (ni el de Firebase ni EmailJS) y sin
salir del plan gratuito Spark. Se corre a mano, una sola vez por caso, desde
la terminal de Codespaces.

**Importante:** esto NO se sube a producción ni se despliega con
`publicar.sh`. Vive aparte, solo para uso tuyo desde la terminal.

## Configuración (una sola vez)

1. **Descarga tu llave de administración del proyecto:**
   - Ve a [Firebase Console](https://console.firebase.google.com) → abre tu proyecto.
   - Clic en el engranaje ⚙️ (arriba a la izquierda) → **Configuración del proyecto**.
   - Pestaña **Cuentas de servicio** (Service accounts).
   - Botón **Generar nueva clave privada** → confirma → se descarga un archivo `.json`.

2. **Coloca ese archivo en esta misma carpeta** (`herramientas-admin/`) y
   renómbralo exactamente a `serviceAccountKey.json`.

   ⚠️ **Esta llave da acceso total de administrador a tu proyecto entero**
   (no solo a las contraseñas — a todo Firestore también). Trátala como una
   contraseña maestra:
   - Nunca la subas a GitHub. Antes de continuar, asegúrate de que tu
     `.gitignore` (en la raíz del repo) tenga esta línea:
     ```
     herramientas-admin/serviceAccountKey.json
     ```
   - No la compartas por chat ni la pegues en ningún lado público.
   - Si alguna vez crees que se filtró, puedes revocarla desde la misma
     pantalla de "Cuentas de servicio" y generar una nueva.

3. **Instala la única dependencia que necesita** (una sola vez):
   ```
   cd herramientas-admin
   npm install firebase-admin
   ```

## Uso

Cada vez que alguien olvide su contraseña:

```
cd herramientas-admin
node restablecer-contrasena.js correo@alanis.com.mx unaContrasenaTemporal123
```

Verás algo como:

```
Listo ✅
Correo: correo@alanis.com.mx
Contraseña nueva: unaContrasenaTemporal123

Ahora compártele esa contraseña al empleado por otro medio (WhatsApp, en
persona, etc.) para que pueda iniciar sesión. Su perfil, historial y saldo
de vacaciones siguen intactos.
```

Luego solo le avisas la contraseña nueva al empleado por el medio que
prefieras (no por esta herramienta — esto no manda nada, solo la cambia).
Con esa contraseña puede iniciar sesión normal en la app.

## Qué NO hace

- No manda ningún correo.
- No toca su perfil de Firestore (rol, saldo de vacaciones, historial de
  solicitudes) — todo sigue exactamente igual.
- No cambia su correo ni ningún otro dato, solo la contraseña.
