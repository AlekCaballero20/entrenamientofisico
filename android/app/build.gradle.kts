import java.net.URI

plugins {
    id("com.android.application") version "8.7.3"
}

val gymosSigning = file(System.getenv("GYMOS_SIGNING_DIR") ?: "${System.getenv("LOCALAPPDATA")}/GymOS/Signing")
val webRoot = rootProject.projectDir.parentFile
val bundledAssets = layout.buildDirectory.dir("generated/gymosAssets")
val firebaseAssets = layout.buildDirectory.dir("firebaseSdk")

val downloadFirebaseSdk by tasks.registering {
    val modules = listOf("app", "auth", "firestore", "functions", "storage")
    val version = "10.13.2"
    inputs.property("firebaseVersion", version)
    outputs.dir(firebaseAssets)
    doLast {
        val folder = firebaseAssets.get().asFile
        folder.mkdirs()
        for (module in modules) {
            val name = "firebase-$module-compat.js"
            val url = URI("https://www.gstatic.com/firebasejs/$version/$name").toURL()
            val connection = url.openConnection().apply { connectTimeout = 15000; readTimeout = 30000 }
            val target = folder.resolve(name)
            connection.getInputStream().use { source -> target.outputStream().use { source.copyTo(it) } }
        }
    }
}

val bundleGymos by tasks.registering(Sync::class) {
    dependsOn(downloadFirebaseSdk)
    into(bundledAssets)
    from(webRoot) {
        include("index.html", "app.js", "styles.css", "db.js", "seed.js", "firebase-sync.js",
            "workout-reminders.js", "manifest.webmanifest", "icons/**", "music/**",
            "functions/exercise-catalog.js", "functions/exercise-identity.js")
        filesMatching("index.html") {
            filter { line -> line.replace("https://www.gstatic.com/firebasejs/10.13.2/", "./firebase-sdk/") }
        }
    }
    from(firebaseAssets) { into("firebase-sdk") }
}

android {
    namespace = "com.gymos.entrenamiento"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.gymos.entrenamiento"
        minSdk = 26
        targetSdk = 34
        versionCode = 7
        versionName = "0.15.4"
    }
    signingConfigs {
        create("gymos") {
            storeFile = gymosSigning.resolve("gymos.p12")
            storeType = "PKCS12"
            keyAlias = "gymos"
            storePassword = gymosSigning.resolve("gymos-password.txt").takeIf { it.isFile }?.readText()?.trim()
            keyPassword = storePassword
        }
    }
    buildTypes {
        release { signingConfig = signingConfigs.getByName("gymos") }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets.getByName("main").assets.srcDir(bundledAssets)
}

tasks.named("preBuild") { dependsOn(bundleGymos) }

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.credentials:credentials:1.2.0-rc01")
    implementation("androidx.credentials:credentials-play-services-auth:1.2.0-rc01")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.0")
}
