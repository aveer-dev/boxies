// Inboxies for Wear OS (AVE-145, docs/watch-companion-plan.md phase 2): the active
// mailbox's Inbox, a plain-text message, the phone notification actions and quick
// reply, with a `watch`-scoped session the phone hands over on the Data Layer.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "co.inboxies.wear"
    compileSdk = 35

    defaultConfig {
        // Same applicationId (and signing key) as the phone app: the Wearable Data Layer
        // only connects apps with the same package name and signature.
        applicationId = "co.inboxies.app"
        // Wear OS 4.
        minSdk = 33
        targetSdk = 35
        // Play needs a version code no phone build uses (both ship under one listing).
        versionCode = 1_000_001
        versionName = "0.1.0"
    }

    // Same upload key as `:app` (see its build file and android/README.md). Applied only
    // when all four are set, so local / CI builds without secrets still assemble.
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
                // Relative paths resolve from android/app, as they do for the phone build.
                storeFile = rootProject.file("app").resolve(uploadStoreFile!!)
                storePassword = uploadStorePassword
                keyAlias = uploadKeyAlias
                keyPassword = uploadKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
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
    implementation(project(":watch-shared"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material.icons)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.wear.compose.material)
    implementation(libs.androidx.wear.compose.foundation)
    // SwipeDismissableNavHost: swipe-to-dismiss is the platform's back gesture. Allowed in
    // :wear only (plan Q8); the phone app keeps its no-NavHost rule.
    implementation(libs.androidx.wear.compose.navigation)
    implementation(libs.androidx.wear.compose.ui.tooling)
    implementation(libs.androidx.wear.input)

    implementation(libs.play.services.wearable)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.androidx.security.crypto)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
