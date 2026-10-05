package com.employeeexperience.meucelular

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.Base64
import android.util.DisplayMetrics
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream

/**
 * Serviço central de acesso remoto: captura a tela (MediaProjection) e manda
 * frames JPEG para o backend em loop, além de consultar e aplicar os
 * toques/arrastos que o painel mandou (ver roadmap.md e a migração
 * 20261005181500_screen_mirroring.sql - DECISÃO 05/10/2026: sem WebRTC/TURN,
 * frames via HTTPS normal para o nosso próprio backend).
 *
 * Fica em foreground com notificação PERSISTENTE enquanto a captura está
 * ativa - isto não é configurável e não deve ser removido ou escondido em
 * nenhuma circunstância: é o que torna esta ferramenta uma ferramenta de
 * suporte remoto legítima e não um spyware, tanto tecnicamente (exigência
 * do próprio Android) quanto eticamente (princípio definido desde o início
 * deste projeto).
 *
 * IMPORTANTE: este pipeline (ImageReader -> Bitmap -> JPEG -> upload, e a
 * injeção de gesto em RemoteAccessibilityService) nunca foi validado em um
 * aparelho físico - só revisado contra a documentação do Android. Pontos
 * prováveis de precisar de ajuste ao testar de verdade: o stride/padding do
 * ImageReader em telas com largura não múltipla de 64px (tratado abaixo, mas
 * sem hardware para confirmar), e o tempo de resposta do
 * createVirtualDisplay em alguns fabricantes.
 */
class ScreenCaptureService : Service() {

    companion object {
        const val CHANNEL_ID = "sessao_acesso_remoto"
        // 1002: 1000/1001 já são usados pelo SessionWatcherService (idle/ativa),
        // que continua rodando quando este serviço de captura sobe junto.
        const val NOTIFICATION_ID = 1002
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"

        // Poucos frames por segundo é o trade-off deliberado por não usar
        // WebRTC (ver build.gradle.kts) - mais que isso só gasta dados e
        // bateria sem ganho perceptível dado que o painel também só faz
        // polling a cada 800ms.
        private const val FRAME_INTERVAL_MS = 400L
        private const val JPEG_QUALITY = 40
        // Tela reduzida antes de virar JPEG - a resolução real do aparelho
        // não ajuda em nada quem está olhando num notebook, e encarece
        // banda/CPU à toa.
        private const val MAX_FRAME_WIDTH = 480

        /** true enquanto a captura está rodando - evita a SessionWatcherService disparar duas vezes. */
        @Volatile
        var isRunning: Boolean = false
            private set
    }

    private var mediaProjection: MediaProjection? = null
    private var mediaProjectionCallback: MediaProjection.Callback? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var screenWidth = 0
    private var screenHeight = 0

    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private lateinit var deviceStore: DeviceStore
    private val apiClient = ApiClient()

    override fun onCreate() {
        super.onCreate()
        deviceStore = DeviceStore(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildActiveSessionNotification())

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, -1) ?: -1
        val resultData = intent?.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)

        if (resultCode != -1 && resultData != null && mediaProjection == null) {
            startCapture(resultCode, resultData)
        }

        return START_NOT_STICKY
    }

    private fun startCapture(resultCode: Int, resultData: Intent) {
        val deviceId = deviceStore.deviceId
        val deviceSecret = deviceStore.deviceSecret
        if (deviceId == null || deviceSecret == null) {
            stopSelf()
            return
        }

        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        (getSystemService(WINDOW_SERVICE) as android.view.WindowManager).defaultDisplay.getRealMetrics(metrics)

        val scale = if (metrics.widthPixels > MAX_FRAME_WIDTH) MAX_FRAME_WIDTH.toFloat() / metrics.widthPixels else 1f
        screenWidth = (metrics.widthPixels * scale).toInt().coerceAtLeast(1)
        screenHeight = (metrics.heightPixels * scale).toInt().coerceAtLeast(1)

        val projectionManager = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val projection = projectionManager.getMediaProjection(resultCode, resultData)
        mediaProjection = projection

        // Exigido a partir do Android 14 (API 34): o MediaProjection precisa
        // de um callback registrado ANTES de createVirtualDisplay, mesmo que
        // a gente não precise reagir a nada além de limpar o próprio estado
        // quando o sistema revoga a permissão (ex.: usuário trocou de app).
        val callback = object : MediaProjection.Callback() {
            override fun onStop() {
                stopSelf()
            }
        }
        mediaProjectionCallback = callback
        projection.registerCallback(callback, null)

        val reader = ImageReader.newInstance(screenWidth, screenHeight, PixelFormat.RGBA_8888, 2)
        imageReader = reader

        virtualDisplay = projection.createVirtualDisplay(
            "meucelular-captura",
            screenWidth,
            screenHeight,
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            null,
        )

        // Reporta a resolução REAL (não a reduzida para o JPEG) para o
        // backend guardar em devices.screen_width/height - é isso que
        // permite converter o toque normalizado (0..1) vindo do painel em
        // pixel de verdade (ver applyPendingInputs abaixo e input.ts).
        scope.launch {
            try {
                apiClient.heartbeat(deviceId, deviceSecret, null, metrics.widthPixels, metrics.heightPixels)
            } catch (_: Exception) {
                // heartbeat de bateria já roda via SessionWatcherService; se
                // este falhar não é crítico, só atrasa a 1a conversão de toque.
            }
        }

        isRunning = true
        scope.launch { captureLoop(deviceId, deviceSecret, metrics.widthPixels, metrics.heightPixels) }
    }

    private suspend fun captureLoop(deviceId: String, deviceSecret: String, realWidth: Int, realHeight: Int) {
        while (scope.isActive) {
            try {
                sendNextFrame(deviceId, deviceSecret)
                applyPendingInputs(deviceId, deviceSecret, realWidth, realHeight)
            } catch (e: Exception) {
                // Rede instável é esperado - não derruba o serviço, só tenta
                // de novo no próximo ciclo. Se o motivo for "sessão acabou",
                // sendNextFrame já chama stopSelf() antes de chegar aqui.
            }
            delay(FRAME_INTERVAL_MS)
        }
    }

    private fun sendNextFrame(deviceId: String, deviceSecret: String) {
        val image = imageReader?.acquireLatestImage() ?: return
        val bitmap = try {
            imageToBitmap(image)
        } finally {
            image.close()
        }

        val output = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, output)
        bitmap.recycle()
        val base64 = Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)

        val active = apiClient.sendFrame(deviceId, deviceSecret, base64)
        if (!active) stopSelf()
    }

    /** Converte o Image (RGBA_8888, possivelmente com padding de linha) num Bitmap exato. */
    private fun imageToBitmap(image: android.media.Image): Bitmap {
        val plane = image.planes[0]
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * image.width

        val bitmap = Bitmap.createBitmap(
            image.width + rowPadding / pixelStride,
            image.height,
            Bitmap.Config.ARGB_8888,
        )
        bitmap.copyPixelsFromBuffer(plane.buffer)

        return if (bitmap.width == image.width) {
            bitmap
        } else {
            val cropped = Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height)
            bitmap.recycle()
            cropped
        }
    }

    private fun applyPendingInputs(deviceId: String, deviceSecret: String, realWidth: Int, realHeight: Int) {
        val inputs = apiClient.fetchPendingInputs(deviceId, deviceSecret)
        val accessibility = RemoteAccessibilityService.instance ?: return
        for (input in inputs) {
            when (input.kind) {
                "tap" -> accessibility.performTap(input.x * realWidth, input.y * realHeight)
                "swipe" -> {
                    val x2 = input.x2 ?: input.x
                    val y2 = input.y2 ?: input.y
                    accessibility.performSwipe(
                        input.x * realWidth,
                        input.y * realHeight,
                        x2 * realWidth,
                        y2 * realHeight,
                        input.durationMs ?: 200L,
                    )
                }
            }
        }
    }

    private fun buildActiveSessionNotification(): Notification {
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                getString(R.string.notification_channel_session),
                NotificationManager.IMPORTANCE_HIGH // alta importância: não deve passar despercebida
            )
            manager.createNotificationChannel(channel)
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_session_active_title))
            .setContentText(getString(R.string.notification_session_active_text))
            // android.R.drawable.ic_lock_idle_lock foi removido do framework a
            // partir do Android 8 (API 26) - usar o próprio ícone do app até
            // termos um ícone de notificação (monocromático) desenhado de verdade.
            .setSmallIcon(R.mipmap.ic_launcher)
            .setOngoing(true) // usuário não consegue descartar a notificação enquanto a sessão dura
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .build()
    }

    override fun onDestroy() {
        isRunning = false
        scope.cancel()
        virtualDisplay?.release()
        imageReader?.close()
        mediaProjectionCallback?.let { mediaProjection?.unregisterCallback(it) }
        mediaProjection?.stop()
        mediaProjection = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
