package com.employeeexperience.meucelular

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * A parte que já dá para validar sem hardware nenhum além do próprio
 * celular: enquanto o app está enrolled, este serviço consulta
 * periodicamente GET /api/public/agent/session (ver ApiClient.fetchActiveSession)
 * e liga/desliga a notificação PERSISTENTE de "sessão ativa" de acordo com
 * a resposta real do backend - é o mecanismo de consentimento visível
 * funcionando de ponta a ponta, mesmo sem espelhar a tela ainda.
 *
 * O que ainda NÃO faz: se activeSession.mode == "controle", deveria também
 * pedir a permissão de MediaProjection (MainActivity.requestScreenCapturePermission)
 * e subir o ScreenCaptureService de verdade. Isso fica para quando a
 * captura de tela em si estiver implementada - hoje ligar isso sem o
 * pipeline de vídeo só criaria uma notificação a mais sem função.
 */
class SessionWatcherService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private lateinit var deviceStore: DeviceStore
    private val apiClient = ApiClient()
    private var lastSessionActive = false

    override fun onCreate() {
        super.onCreate()
        deviceStore = DeviceStore(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Notificação "de trabalho em segundo plano" enquanto não há sessão -
        // discreta, mas ainda assim visível (o app nunca fica totalmente
        // invisível ao usuário, mesmo fora de sessão).
        startForeground(NOTIFICATION_ID_IDLE, buildIdleNotification())

        scope.launch { pollLoop() }
        return START_STICKY
    }

    private suspend fun pollLoop() {
        while (scope.isActive) {
            val deviceId = deviceStore.deviceId
            val deviceSecret = deviceStore.deviceSecret
            if (deviceId == null || deviceSecret == null) {
                stopSelf()
                return
            }

            try {
                apiClient.heartbeat(deviceId, deviceSecret, readBatteryLevel())
                val session = apiClient.fetchActiveSession(deviceId, deviceSecret)
                updateNotification(session)
            } catch (e: Exception) {
                // Rede instável é esperado (celular fora do wifi, sem sinal
                // momentaneamente) - não derruba o serviço, só tenta de novo
                // no próximo ciclo.
            }

            delay(POLL_INTERVAL_MS)
        }
    }

    private fun updateNotification(session: ApiClient.ActiveSession?) {
        val manager = getSystemService(NotificationManager::class.java)
        if (session != null) {
            manager.notify(NOTIFICATION_ID_ACTIVE, buildActiveSessionNotification(session))
            manager.cancel(NOTIFICATION_ID_IDLE)
            lastSessionActive = true
        } else if (lastSessionActive) {
            manager.cancel(NOTIFICATION_ID_ACTIVE)
            manager.notify(NOTIFICATION_ID_IDLE, buildIdleNotification())
            lastSessionActive = false
        }
    }

    private fun readBatteryLevel(): Int? {
        val bm = getSystemService(BATTERY_SERVICE) as? BatteryManager ?: return null
        val level = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return if (level in 0..100) level else null
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    getString(R.string.notification_channel_session),
                    NotificationManager.IMPORTANCE_HIGH,
                ),
            )
        }
    }

    private fun openAppIntent(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        return PendingIntent.getActivity(this, 0, intent, flags)
    }

    private fun buildIdleNotification(): Notification {
        ensureChannel()
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Aparelho gerenciado pela empresa")
            .setContentText("Sem sessão de acesso remoto ativa no momento")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(openAppIntent())
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun buildActiveSessionNotification(session: ApiClient.ActiveSession): Notification {
        ensureChannel()
        val modo = if (session.mode == "controle") "controle" else "visualização"
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.notification_session_active_title))
            .setContentText("Modo $modo · motivo: ${session.reason}")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(openAppIntent())
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .build()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val CHANNEL_ID = "sessao_acesso_remoto"
        const val NOTIFICATION_ID_IDLE = 1000
        const val NOTIFICATION_ID_ACTIVE = 1001
        const val POLL_INTERVAL_MS = 15_000L
    }
}
