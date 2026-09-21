package com.employeeexperience.meucelular

import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

/**
 * Única tela visível do app no aparelho. Mostra o status de gestão
 * ("Gerenciado pela empresa") e, quando uma sessão pede modo "controle"
 * pela primeira vez, dispara o diálogo padrão do Android pedindo permissão
 * de captura de tela (MediaProjection) - esse diálogo é do próprio sistema
 * operacional e não pode ser pulado ou automatizado, por design do Android.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var enrollmentManager: EnrollmentManager

    companion object {
        const val REQUEST_CODE_SCREEN_CAPTURE = 100
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enrollmentManager = EnrollmentManager(this)

        // setContentView(R.layout.activity_main) - layout com o status do
        // aparelho (gerenciado/não), botão de "solicitar acesso remoto" e o
        // aviso de que a sessão fica registrada. Omitido aqui por ser
        // puramente visual; a lógica é o que importa neste esqueleto.

        if (!enrollmentManager.isDeviceOwner()) {
            // Aparelho ainda não passou pelo enrollment via QR code/ADB -
            // mostrar instruções, não o status normal de app ativo.
        }
    }

    /** Chamado quando o backend sinaliza que uma sessão em modo "controle" foi solicitada. */
    fun requestScreenCapturePermission() {
        val projectionManager =
            getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(
            projectionManager.createScreenCaptureIntent(),
            REQUEST_CODE_SCREEN_CAPTURE
        )
    }

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
}
