plugins { id("com.android.application") }

android {
    namespace = "com.frieve.effetune"
    compileSdk = 37
    ndkVersion = "28.2.13676358"
    defaultConfig {
        applicationId = "com.frieve.effetune"
        minSdk = 29
        targetSdk = 37
        versionCode = 21600
        versionName = "2.16.0"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
        externalNativeBuild { cmake { arguments += listOf("-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON", "-DANDROID_STL=c++_shared") } }
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    signingConfigs {
        providers.environmentVariable("EFFETUNE_ANDROID_KEYSTORE").orNull?.let { location ->
            create("distribution") {
                storeFile = file(location)
                storePassword = providers.environmentVariable("EFFETUNE_ANDROID_STORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("EFFETUNE_ANDROID_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("EFFETUNE_ANDROID_KEY_PASSWORD").get()
            }
        }
    }
    buildTypes {
        debug { applicationIdSuffix = ".development" }
        release {
            isMinifyEnabled = false
            if (providers.gradleProperty("candidate").orNull == "true") {
                applicationIdSuffix = ".candidate"
                signingConfig = signingConfigs.getByName("debug")
            } else signingConfig = signingConfigs.findByName("distribution")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    externalNativeBuild { cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.31.6" } }
    buildFeatures { prefab = true }
    sourceSets["main"].assets.srcDir("../../out/android/assets")
    packaging {
        jniLibs { useLegacyPackaging = false }
        resources {
            excludes += "META-INF/INDEX.LIST"
            merges += listOf("META-INF/LICENSE", "META-INF/NOTICE", "META-INF/io.netty.versions.properties")
        }
    }
}

dependencies {
    implementation("androidx.core:core:1.19.1")
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("com.google.oboe:oboe:1.11.0")
    implementation("io.netty:netty-codec-http:4.2.19.Final")
    implementation("io.netty:netty-handler:4.2.19.Final")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
