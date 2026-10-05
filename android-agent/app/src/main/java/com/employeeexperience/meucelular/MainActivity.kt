package com.employeeexperience.meucelular

import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Única tela visível do app no aparelho. Antes do enrollment, mostra o
 * campo para colar o link/token de ativação (o mesmo link que aparece no
 * painel web, em /instalar/<token>) e chama de verdade
 * POST /api/public/agent/enroll. Depois de ativado, mostra o status e sobe
 * o SessionWatcherService, que é quem mantém o aviso de sessão ativa
 * funcionando mesmo com o app em segundo plano.
 *
 * Também é trazida para frente automaticamente pela SessionWatcherService
 * (via EXTRA_AUTO_REQUEST_CAPTURE) quando existe sessão ativa e a captura
 * de tela ainda não está rodando - só uma Activity em primeiro plano pode
 * disparar o diálogo de permissão de MediaProjection, um Service sozinho
 * não consegue (ver handleAutoRequestCapture).
 */
class MainActivity : AppCompatActivity() {

    private lateinit var enrollmentManager: EnrollmentManager
    private lateinit var deviceStore: DeviceStore
    private val apiClient = ApiClient()
    private val scope = CoroutineScope(Dispatchers.Main + Job())

    private lateinit var textStatus: TextView
    private lateinit var groupEnroll: View
    private lateinit var groupEnrolled: View
    private lateinit var inputToken: EditText
    private lateinit var buttonActivate: Button
    private lateinit var textSessionStatus: TextView
    private lateinit var buttonDeactivate: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        enrollmentManager = EnrollmentManager(this)
        deviceStore = DeviceStore(this)

        textStatus = findViewById(R.id.textStatus)
        groupEnroll = findViewById(R.id.groupEnroll)
        groupEnrolled = findViewById(R.id.groupEnrolled)
        inputToken = findViewById(R.id.inputToken)
        buttonActivate = findViewById(R.id.buttonActivate)
        textSessionStatus = findViewById(R.id.textSessionStatus)
        buttonDeactivate = findViewById(R.id.buttonDeactivate)

        buttonActivate.setOnClickListener { onActivateClicked() }
        buttonDeactivate.setOnClickListener { onDeactivateClicked() }

        renderEnrollmentState()
        requestNotificationPermissionIfNeeded()

        if (deviceStore.isEnrolled) {
            startSessionWatcher()
        }

        handleActivationDeepLink(intent)
        handleAutoRequestCapture(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleActivationDeepLink(intent)
        handleAutoRequestCapture(intent)
    }

    /**
     * Atendido quando a SessionWatcherService traz esta tela para frente
     * (ver SessionWatcherService.requestCaptureViaMainActivity) porque
     * detectou uma sessão ativa e a captura de tela ainda não está rodando.
     * Dispara direto o diálogo de permissão do Android - é esse diálogo do
     * próprio sistema que serve de consentimento visível aqui.
     */
    private fun handleAutoRequestCapture(intent: Intent?) {
        if (intent?.getBooleanExtra(EXTRA_AUTO_REQUEST_CAPTURE, false) != true) return
        if (!deviceStore.isEnrolled) return
        requestScreenCapturePermission()
    }

    /**
     * Trata "meucelular://ativar?token=..." (ver AndroidManifest.xml). É o
     * segundo toque do fluxo de 2 toques: a página /instalar/<token> tenta
     * abrir esse link assim que carrega; se o app já estiver instalado,
     * cai aqui direto com o token, sem a pessoa precisar copiar/colar nada.
     * Se já estiver ativado, ignora silenciosamente (nada a fazer de novo).
     */
    private fun handleActivationDeepLink(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != "meucelular" || uri.host != "ativar") return
        val token = uri.getQueryParameter("token") ?: return
        if (deviceStore.isEnrolled) return

        inputToken.setText(token)
        onActivateClicked()
    }

    private fun renderEnrollmentState() {
        if (deviceStore.isEnrolled) {
            groupEnroll.visibility = View.GONE
            groupEnrolled.visibility = View.VISIBLE
            textStatus.text = "Aparelho ativado. Aparelho gerenciado pela empresa - a notificação " +
                "permanente mostra sempre que uma sessão de acesso está ativa."
            textSessionStatus.text = "Consultando status da sessão a cada 15s (ver notificação)."
        } else {
            groupEnroll.visibility = View.VISIBLE
            groupEnrolled.visibility = View.GONE
            textStatus.text = "Este aparelho ainda não foi ativado."
        }
    }

    /** Aceita tanto o link completo (https://.../instalar/TOKEN) quanto só o token colado. */
    private fun extractToken(input: String): String {
        val trimmed = input.trim()
        val marker = "/instalar/"
        val idx = trimmed.indexOf(marker)
        return if (idx >= 0) trimmed.substring(idx + marker.length).trim('/', ' ') else trimmed
    }

    private fun onActivateClicked() {
        val token = extractToken(inputToken.text.toString())
        if (token.length < 8) {
            Toast.makeText(this, "Cole o link ou token de ativação completo.", Toast.LENGTH_SHORT).show()
            return
        }

        buttonActivate.isEnabled = false
        buttonActivate.text = "Ativando..."

        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    apiClient.enroll(token, model = Build.MODEL ?: "desconhecido")
                }
                deviceStore.deviceId = result.deviceId
                deviceStore.deviceSecret = result.deviceSecret
                Toast.makeText(this@MainActivity, "Aparelho ativado.", Toast.LENGTH_SHORT).show()
                renderEnrollmentState()
                startSessionWatcher()
            } catch (e: Exception) {
                Toast.makeText(this@MainActivity, "Não foi possível ativar: ${e.message}", Toast.LENGTH_LONG).show()
            } finally {
                buttonActivate.isEnabled = true
                buttonActivate.text = "Ativar este aparelho"
            }
        }
    }

    private fun onDeactivateClicked() {
        stopService(Intent(this, SessionWatcherService::class.java))
        deviceStore.clear()
        renderEnrollmentState()
        Toast.makeText(this, "Gestão removida deste aparelho (apenas local, para teste).", Toast.LENGTH_SHORT).show()
    }

    private fun startSessionWatcher() {
        val intent = Intent(this, SessionWatcherService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        // Android 13+ exige permissão explícita para mostrar notificações -
        // sem ela, o aviso de sessão ativa (o mecanismo de consentimento
        // visível) não apareceria, então pedimos já na primeira tela.
        if (Build.VERSION.SDK_INT >= 33) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(android.Manifest.permission.POST_NOTIFICATIONS),
                REQUEST_CODE_NOTIFICATIONS,
            )
        }
    }

    /**
     * Mostra o diálogo nativo do Android pedindo permissão de captura de
     * tela. Chamado automaticamente por handleAutoRequestCapture quando a
     * SessionWatcherService detecta sessão ativa.
     */
    fun requestScreenCapturePermission() {
        val projectionManager =
            getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        @Suppress("DEPRECATION")
        startActivityForResult(
            projectionManager.createScreenCaptureIntent(),
            REQUEST_CODE_SCREEN_CAPTURE,
        )
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_CODE_SCREEN_CAPTURE && data != null) {
            val serviceIntent = Intent(this, ScreenCaptureService::class.java).apply {
                putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
                putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
            }
            startForegroundService(serviceIntent)
        }
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val REQUEST_CODE_SCREEN_CAPTURE = 100
        const val REQUEST_CODE_NOTIFICATIONS = 200
        const val EXTRA_AUTO_REQUEST_CAPTURE = "autoRequestCapture"
    }
}
