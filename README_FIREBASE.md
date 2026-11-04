# GymOS con Firebase obligatorio

Este proyecto usa Firebase Auth, Firestore y Firebase Storage. La app no ofrece
modo local: si Firebase no carga o las reglas bloquean la escritura, los cambios
no se consideran guardados.

## Archivos clave

- `firebase-sync.js`: inicializa Firebase, Auth, Firestore y Storage.
- `firestore.rules`: permite leer y escribir solo al usuario autenticado en
  `users/{uid}/appState/main`.
- `storage.rules`: permite subir imagenes solo al usuario autenticado dentro de
  `gymos/exercise-images/{uid}/`.

## Datos guardados

Firestore guarda el estado completo por usuario en:

```text
users/{uid}/appState/main
```

Firebase Storage guarda imagenes de ejercicios en:

```text
gymos/exercise-images/{uid}/{archivo}
```

## Antes de probar

En Firebase Console deben estar activos:

1. Authentication con proveedor Google.
2. Cloud Firestore.
3. Firebase Storage.
4. Reglas publicadas desde `firestore.rules` y `storage.rules`.

## Uso

1. Abre la app publicada o desde un servidor local.
2. Inicia sesion con un correo autorizado en `firebase-sync.js`.
3. Crea o edita rutinas y sesiones.
4. Usa **Ajustes > Firebase > Guardar nube** si quieres forzar una escritura.
5. Usa **Recargar nube** para volver a leer el estado guardado en Firestore.

## Servidor local recomendado

Evita abrir `index.html` con `file://`. Para probar Firebase localmente:

```bash
python -m http.server 8000
```

Luego abre:

```text
http://localhost:8000
```

## Generador de rutinas con IA

En Rutinas, **Crear con IA** genera un borrador que se revisa en el editor antes
de guardarlo. La primera versión admite movilidad suave de 10, 15, 20 o 25 minutos.
El servidor selecciona ejercicios de un catálogo cerrado y calcula sus tiempos.
Los minutos incluyen series y descansos programados. Las cuentas de preparación,
avisos, pausas manuales y cambios de ejercicio pueden alargar la sesión real.

El catálogo inicial requiere revisión técnica de una persona con formación en
actividad física. Las peticiones sobre lesiones o dolor se remiten a otro enfoque
mediante las instrucciones del modelo. Esa clasificación depende de la IA.

La función usa Gemini 3.5 Flash-Lite con una clave guardada en Secret Manager.
Firebase Auth verifica las dos cuentas autorizadas también en el servidor.
Una transacción de Firestore limita a 10 intentos diarios por usuario, según
America/Bogota. Los intentos fallidos también consumen cuota. El prompt se envía
a Gemini para generar el borrador.

Para activar el servidor, con facturación Blaze y acceso al proyecto:

```powershell
npm ci --prefix functions
firebase functions:secrets:set GEMINI_API_KEY --project gymos-b2e86
firebase deploy --only functions:generateRoutine --project gymos-b2e86
```

Crear la clave en Google AI Studio, habilitar el consumo de pago de Gemini en el
proyecto asociado a esa clave e introducirla cuando la terminal la solicite.
Después publicar los archivos web en el GitHub Pages existente.

Validación local:

```powershell
npm test --prefix functions
node --check app.js
```

## Ilustraciones compartidas de ejercicios

**Crear imágenes IA** está disponible en el editor y en el detalle de la rutina.
Cada ejercicio también tiene su propio botón. Las ilustraciones usan un estilo
plano con dos posturas y flechas de movimiento.

La biblioteca en `exerciseIllustrations` se comparte entre las dos cuentas
autorizadas. La identidad normaliza tildes, mayúsculas, puntuación y espacios del
nombre. Los nombres con variantes de equipo o postura siguen siendo distintos.
Las rutinas antiguas, el entrenamiento, el historial y los selectores consultan
esa biblioteca. Las ilustraciones compartidas tienen prioridad visual y los
enlaces guardados sirven de respaldo cuando falta una ilustración compartida.

La función `generateExerciseImage` usa la misma clave de Gemini y guarda los
archivos en `gymos/shared-exercise-images/` de Firebase Storage. Una transacción
reserva cada generación y evita llamadas simultáneas para el mismo nombre.
El límite es de 20 intentos nuevos por cuenta y día. La reutilización no consume
intentos ni llama al modelo. Un error conserva las imágenes ya completadas y
permite continuar con las pendientes.

Las ilustraciones son generadas por IA y requieren revisión de la postura.
El nombre y las indicaciones técnicas se envían a Gemini al solicitar una imagen.

```powershell
firebase deploy --only "functions:generateExerciseImage,firestore:rules" --project gymos-b2e86
```
