// The phone <-> Wear OS contract (AVE-145): Data Layer paths, capabilities and
// payloads, plus the watch palette. Compiled into :app and :wear so both sides
// read and write the same bytes. Pure Kotlin, no Play services.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "co.inboxies.watchshared"
    compileSdk = 35

    defaultConfig {
        minSdk = 33
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}
