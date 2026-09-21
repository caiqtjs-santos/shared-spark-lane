package com.employeeexperience.meucelular

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Serviço central de acesso remoto. Fica em foreground com notificação
 * PERSISTENTE enquanto uma sessão está ativa - isto não é configurável e
 * não deve ser removido ou escondido em nenhuma circunstância: é o que
 * torna esta ferramenta uma ferramenta de suporte remoto legítima e não um
 * spyware, tanto tecnicamente (exigência do próprio Android) quanto
 * eticamente (é o princípio definido desde o início deste projeto).
 *
 * A integração real de captura de vídeo (MediaProjection -> VirtualDisplay
 * -> frames -> encoder -> WebRTC track) e a conexão com o SignalingClient
 * ainda precisam ser implementadas e testadas em um aparelho físico; aqui
 * está a estrutura do serviço e o ciclo de vida correto.
 */
class ScreenCaptureService : Service() {

    companion object {
        const val CHANNEL_ID = "sessao_acesso_remoto"
        // 1002: 1000/1001 já são usados pelo SessionWatcherService (idle/ativa),
        // que continua rodando quando este serviço de captura sobe junto.
        const val NOTIFICATION_ID = 1002
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
    }

    private var mediaProjection: MediaProjection? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildActiveSessionNotification())

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, -1) ?: -1
        val resultData = intent?.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)

        if (resultCode != -1 && resultData != null) {
            val projectionManager =
                getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = projectionManager.getMediaProjection(resultCode, resultData)

            // TODO (precisa de dispositivo real para validar):
            // 1. Criar um VirtualDisplay a partir de mediaProjection
            // 2. Capturar frames e alimentar uma VideoSource do WebRTC
            // 3. Conectar ao SignalingClient com o sessionId desta sessão
            // 4. Encerrar tudo de forma limpa em onDestroy()
        }

        return START_NOT_STICKY
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
        mediaProjection?.stop()
        mediaProjection = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
