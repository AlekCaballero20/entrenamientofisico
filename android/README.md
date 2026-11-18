# GymOS para Android

La app empaqueta los archivos de la web y usa el mismo proyecto Firebase. El
inicio de sesión usa Google Credential Manager. Los recordatorios se programan
en el dispositivo y abren el ejercicio pendiente cuando se toca el aviso.
Android puede retrasar el aviso para ahorrar batería.

Para compilar, abre esta carpeta en Android Studio o ejecuta
`gradlew.bat :app:assembleRelease` con JDK 17 o 21 y Android SDK 35.
Si Gradle detecta caracteres especiales en la ruta de Windows, copia el
repositorio a una ruta corta sin tildes que conserve `android/` junto a los
archivos web. La primera compilación descarga el SDK web de Firebase.

La compilación firmada lee `gymos.p12` y `gymos-password.txt` de
`%LOCALAPPDATA%\GymOS\Signing` o de la carpeta indicada en `GYMOS_SIGNING_DIR`.
Conserva esa firma para las actualizaciones. El APK se genera en
`app/build/outputs/apk/release/app-release.apk`.
