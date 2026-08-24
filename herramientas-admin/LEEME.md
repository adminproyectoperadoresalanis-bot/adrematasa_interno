# Herramientas de admin (línea de comandos)

Esta carpeta trae herramientas de línea de comandos para tareas que tú,
como administrador, necesitas hacer directo contra Firebase sin depender de
ningún correo ni salir del plan gratuito Spark. Se corren a mano desde la
terminal de Codespaces:

- `restablecer-contrasena.js` — restablece la contraseña de un empleado que
  la olvidó.
- `crear-usuario.js` — crea de una vez a alguien ya activo (cuenta + Área +
  Puesto), sin que esa persona tenga que registrarse. Pensado para gente
  que necesita salir en el Organigrama / Catálogo de empleados pero que
  nunca va a usar la app (por ejemplo, un director).

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

## Uso: restablecer-contrasena.js

Cada vez que alguien olvide su contraseña:

```
cd herramientas-admin
node restablecer-contrasena.js
```

(y responde las preguntas; también puedes seguir pasando correo y
contraseña directo como antes: `node restablecer-contrasena.js
correo@alanis.com.mx unaContrasenaTemporal123`)

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

Qué NO hace: no manda ningún correo, no toca su perfil de Firestore (rol,
saldo de vacaciones, historial de solicitudes) ni su correo — solo cambia
la contraseña.

## Uso: crear-usuario.js

Para dar de alta a alguien que necesitas que aparezca en el Organigrama o
en Catálogo de empleados, pero que nunca va a entrar a la app:

```
cd herramientas-admin
node crear-usuario.js
```

Te pregunta nombre, correo Alanis, Área, Puesto y rol (Área y Puesto deben
escribirse EXACTAMENTE igual que en Configuración › Áreas y puestos, para
que haga match). Queda activo de inmediato — no pasa por "pendiente" ni
necesita aprobación.

Como esa persona no va a iniciar sesión, la herramienta le pone una
contraseña aleatoria por su cuenta (no te la muestra ni la necesitas). Si
algún día sí necesita entrar, usa `restablecer-contrasena.js` para ponerle
una que sí conozca.