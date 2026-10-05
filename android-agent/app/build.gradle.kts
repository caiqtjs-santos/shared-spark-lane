import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Chave de assinatura de release. NUNCA fica commitada no repositório (ver
// .gitignore) - o build assinado lê a chave de uma destas duas formas:
//
//  1) Variáveis de ambiente (usado no GitHub Actions - ver build-apk.yml):
//     KEYSTORE_FILE (caminho para o .jks já decodificado no runner),
//     KEYSTORE_STORE_PASSWORD, KEYSTORE_KEY_ALIAS, KEYSTORE_KEY_PASSWORD.
//  2) Um keystore.properties LOCAL (gitignored) para quem quiser gerar um
//     build assinado na própria máquina - mesmo formato de antes:
//     storeFile / storePassword / keyAlias / keyPassword.
//
// Sem nenhuma das duas, o build de release sai sem assinatura própria
// (útil para compilar e checar erros, mas não é o artefato para instalar/
// atualizar em produção - ver comentário no workflow sobre o Play Protect).
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
}

val envKeystoreFile = System.getenv("KEYSTORE_FILE")
val hasEnvReleaseKey = !envKeystoreFile.isNullOrBlank()
val hasPropsReleaseKey = keystoreProps.getProperty("storeFile") != null
val hasReleaseKey = hasEnvReleaseKey || hasPropsReleaseKey

fun releaseSigningStoreFile() =
    if (hasEnvReleaseKey) rootProject.file(envKeystoreFile!!) else rootProject.file(keystoreProps.getProperty("storeFile"))

fun releaseSigningProperty(envName: String, propsKey: String): String =
    System.getenv(envName) ?: keystoreProps.getProperty(propsKey)
    ?: error("Faltando $envName (ou $propsKey no keystore.properties local)")

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
                storeFile = releaseSigningStoreFile()
                storePassword = releaseSigningProperty("KEYSTORE_STORE_PASSWORD", "storePassword")
                keyAlias = releaseSigningProperty("KEYSTORE_KEY_ALIAS", "keyAlias")
                keyPassword = releaseSigningProperty("KEYSTORE_KEY_PASSWORD", "keyPassword")
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

    // Cliente HTTP usado por ApiClient para TODA a comunicacao com o backend,
    // inclusive o espelhamento de tela (envio de frame JPEG e polling de
    // toque - ver ScreenCaptureService).
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // DECISAO (05/10/2026): espelhamento de tela SEM WebRTC por enquanto.
    // Em vez de uma conexao de video ponto-a-ponto (que exigiria uma lib
    // nativa WebRTC - risco de build ja visto no passado com
    // "org.webrtc:google-webrtc", cujo mirror no Jitpack e instavel - e um
    // servidor TURN para funcionar fora de wifi), o aparelho manda frames
    // JPEG periodicos para o nosso proprio backend (ver ApiClient.sendFrame
    // e ScreenCaptureService), que o painel busca em polling. Mais simples,
    // zero dependencia nativa nova, funciona em qualquer rede - a troca e
    // fluidez (poucos frames por segundo em vez de video continuo). Se um
    // dia precisarmos de video de verdade, a lib recomendada e
    // io.github.webrtc-sdk:android (mantida ativamente, no Maven Central).

    // Push notifications (Firebase Cloud Messaging) para acordar o app
    // quando uma sessao e solicitada e o app nao esta em primeiro plano.
    // Requer o arquivo google-services.json de um projeto Firebase real,
    // que nao pode ser gerado aqui.
    implementation("com.google.firebase:firebase-messaging-ktx:24.0.1")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
