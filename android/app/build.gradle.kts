import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

val googleServicesFile = file("google-services.json")
val hasGoogleServices = googleServicesFile.exists()
if (hasGoogleServices) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    namespace = "co.inboxies.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "co.inboxies.app"
        minSdk = 34
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("boolean", "HAS_GOOGLE_SERVICES", hasGoogleServices.toString())

        val localProps = Properties()
        rootProject.file("local.properties").takeIf { it.exists() }?.reader()?.use { localProps.load(it) }
        // local.properties, then a Gradle property (-P or ~/.gradle/gradle.properties), then
        // an env var, so release and CI builds can set it too. It's a public OAuth client id.
        val webClientId = localProps.getProperty("GOOGLE_WEB_CLIENT_ID")?.takeIf { it.isNotBlank() }
            ?: (project.findProperty("GOOGLE_WEB_CLIENT_ID") as String?)?.takeIf { it.isNotBlank() }
            ?: System.getenv("GOOGLE_WEB_CLIENT_ID")?.takeIf { it.isNotBlank() }
            ?: ""
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$webClientId\"")
    }

    // Upload-key signing for release, from Gradle properties (~/.gradle/gradle.properties
    // or -P) or env vars. Applied only when all four are set, so local / CI builds without
    // secrets still assemble an unsigned release APK/AAB. See android/README.md.
    fun signingValue(name: String): String? =
        (project.findProperty(name) as String?)?.takeIf { it.isNotBlank() }
            ?: System.getenv(name)?.takeIf { it.isNotBlank() }
    val uploadStoreFile = signingValue("INBOXIES_UPLOAD_STORE_FILE")
    val uploadStorePassword = signingValue("INBOXIES_UPLOAD_STORE_PASSWORD")
    val uploadKeyAlias = signingValue("INBOXIES_UPLOAD_KEY_ALIAS")
    val uploadKeyPassword = signingValue("INBOXIES_UPLOAD_KEY_PASSWORD")
    val hasUploadKey = listOf(uploadStoreFile, uploadStorePassword, uploadKeyAlias, uploadKeyPassword)
        .all { it != null }

    signingConfigs {
        if (hasUploadKey) {
            create("release") {
                storeFile = file(uploadStoreFile!!)
                storePassword = uploadStorePassword
                keyAlias = uploadKeyAlias
                keyPassword = uploadKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "DEFAULT_API_BASE", "\"https://inboxies.email\"")
            isMinifyEnabled = false
        }
        release {
            buildConfigField("String", "DEFAULT_API_BASE", "\"https://inboxies.email\"")
            isMinifyEnabled = true
            isShrinkResources = true
            if (hasUploadKey) signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.process)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.okhttp)
    implementation(libs.okhttp.logging)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)

    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.autofill)
    implementation(libs.androidx.glance.appwidget)

    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play)
    implementation(libs.googleid)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)

    implementation(libs.jsoup)
    testImplementation(libs.junit)
}

tasks.register("printApkPath") {
    doLast {
        println(layout.buildDirectory.file("outputs/apk/debug/app-debug.apk").get().asFile.absolutePath)
    }
}
