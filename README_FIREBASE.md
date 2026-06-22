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
