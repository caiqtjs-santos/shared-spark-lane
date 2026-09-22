import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Chave de assinatura de release. O arquivo keystore.properties (e o .jks que
// ele aponta) é criado uma única vez pelo workflow do GitHub Actions e
// reutilizado em todos os builds seguintes, para que o Android reconheça
// sempre o mesmo app (atualizações + menos chance de bloqueio do Play
// Protect, que apaga silenciosamente APKs de debug).
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
}
val hasReleaseKey = keystoreProps.getProperty("storeFile") != null

android {
    namespace = "com.employeeexperience.meucelular"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.employeeexperience.meucelular"
        minSdk = 26 // Device Owner + AccessibilityService modernos exigem 8.0+
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (hasReleaseKey) signingConfig = signingConfigs.getByName("release")
        }
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
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")

    // Cliente WebSocket para o canal de sinalizacao WebRTC com o backend
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // WebRTC real (video + dados) fica para quando formos implementar a
    // captura de tela de fato. Removido por enquanto: nenhum codigo usa
    // org.webrtc.* ainda (SignalingClient so troca mensagens de texto pelo
    // WebSocket), e o artefato "org.webrtc:google-webrtc" e o principal
    // risco de quebrar a build no CI - o ecossistema de builds
    // pre-compilados do libwebrtc para Android muda com frequencia e varios
    // mirrors ja saíram do ar. Confirmar o artefato certo (ex.:
    // io.github.webrtc-sdk:android) antes de reintroduzir.
    // implementation("org.webrtc:google-webrtc:1.0.32006")

    // Push notifications (Firebase Cloud Messaging) para acordar o app
    // quando uma sessao e solicitada e o app nao esta em primeiro plano.
    // Requer o arquivo google-services.json de um projeto Firebase real,
    // que nao pode ser gerado aqui.
    implementation("com.google.firebase:firebase-messaging-ktx:24.0.1")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
