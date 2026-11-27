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
 * Enquanto o app está enrolled, este serviço consulta periodicamente
 * GET /api/public/agent/session (ver ApiClient.fetchActiveSession) e
 * liga/desliga a notificação PERSISTENTE de "sessão ativa" de acordo com a
 * resposta real do backend - é o mecanismo de consentimento visível
 * funcionando de ponta a ponta.
 *
 * Quando aparece uma sessão ativa (visualização OU controle - os dois
 * modos precisam de captura de tela; só o modo controle usa o
 * RemoteAccessibilityService além disso) e a captura ainda não está
 * rodando, mostra uma notificação de ALTA prioridade "Toque para liberar o
 * acesso à tela". Tocar nela abre a MainActivity, que dispara o diálogo de
 * permissão de MediaProjection. ANTES o serviço tentava abrir a Activity
 * sozinho (startActivity em segundo plano), mas o Android 10+ BLOQUEIA isso
 * silenciosamente - por isso a tela de captura nunca aparecia. A notificação
 * (que a pessoa toca) é o caminho permitido e continua sendo o consentimento
 * visível do próprio sistema, consistente com o princípio de transparência.
 */
class SessionWatcherService : Service() {

    private val scope = CoroutineScope(Dispatchers.IO + Job())
    private lateinit var deviceStore: DeviceStore
    private val apiClient = ApiClient()
    private lateinit var commandExecutor: DeviceCommandExecutor
    private var lastState = ""

    override fun onCreate() {
        super.onCreate()
        deviceStore = DeviceStore(this)
        commandExecutor = DeviceCommandExecutor(this)
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

            // Comandos do TI (bloquear/reiniciar/apagar) em bloco próprio: rodam
            // com ou sem sessão ativa (aparelho perdido = sem sessão aberta) e
            // uma falha acima não impede de buscá-los.
            try {
                val commands = apiClient.fetchPendingCommands(deviceId, deviceSecret)
                for (kind in commands) commandExecutor.execute(kind)
            } catch (e: Exception) {
                // Mesmo tratamento: tenta de novo no próximo ciclo.
            }

            delay(POLL_INTERVAL_MS)
        }
    }

    /**
     * PendingIntent que abre a MainActivity já pedindo a permissão de captura
     * (EXTRA_AUTO_REQUEST_CAPTURE). É disparado quando a PESSOA toca a
     * notificação "Toque para liberar o acesso à tela" - um toque é um gesto
     * do usuário, então o Android deixa abrir a Activity e mostrar o diálogo
     * de MediaProjection (ao contrário de startActivity em segundo plano).
     */
    private fun captureRequestPendingIntent(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java).apply {
            putExtra(MainActivity.EXTRA_AUTO_REQUEST_CAPTURE, true)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        return PendingIntent.getActivity(this, 1, intent, flags)
    }

    private fun updateNotification(session: ApiClient.ActiveSession?) {
        val manager = getSystemService(NotificationManager::class.java)
        val state = when {
            session == null -> "idle"
            ScreenCaptureService.isRunning -> "capturando"
            else -> "precisa_captura"
        }
        when (state) {
            "idle" -> {
                manager.cancel(NOTIFICATION_ID_ACTIVE)
                manager.notify(NOTIFICATION_ID_IDLE, buildIdleNotification())
            }
            "capturando" -> {
                manager.cancel(NOTIFICATION_ID_IDLE)
                manager.notify(NOTIFICATION_ID_ACTIVE, buildActiveSessionNotification(session!!))
            }
            "precisa_captura" -> {
                manager.cancel(NOTIFICATION_ID_IDLE)
                // Re-emite o alerta (heads-up) só ao ENTRAR neste estado, para
                // não incomodar a cada 15s. A notificação é ongoing, então
                // continua visível para a pessoa tocar quando puder.
                if (lastState != "precisa_captura") {
                    manager.notify(NOTIFICATION_ID_ACTIVE, buildCaptureNeededNotification(session!!))
                }
            }
        }
        lastState = state
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

    private fun buildCaptureNeededNotification(session: ApiClient.ActiveSession): Notification {
        ensureChannel()
        val pi = captureRequestPendingIntent()
        val modo = if (session.mode == "controle") "controle" else "visualização"
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Toque para liberar o acesso à tela")
            .setContentText("Pedido de acesso ($modo). Toque para permitir a captura de tela.")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pi)
            .setFullScreenIntent(pi, true)
            .addAction(0, "Liberar acesso à tela", pi)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .setAutoCancel(false)
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
