package com.employeeexperience.meucelular

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build

/**
 * Concentra a lógica do "único aceite" da tela de onboarding do TI:
 * ao ser chamado, gera e registra o token de reset de senha (nunca a senha
 * em si) e sinaliza para o backend que o enrollment foi concluído.
 *
 * IMPORTANTE - limitação real de plataforma: a API pública
 * `setResetPasswordToken` / `resetPasswordWithToken` do
 * DevicePolicyManager foi restringida pela Google em versões recentes do
 * Android (a partir do Android 14, em muitos casos só funciona com
 * `LockTask` ou perfis gerenciados específicos). Isso PRECISA ser validado
 * na versão exata do Android dos aparelhos usados antes de prometer esse
 * recurso para o produto - é exatamente o tipo de coisa que só se descobre
 * testando em hardware real, como já conversamos.
 */
class EnrollmentManager(private val context: Context) {

    private val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val adminComponent = ComponentName(context, DeviceOwnerReceiver::class.java)

    fun isDeviceOwner(): Boolean = dpm.isDeviceOwnerApp(context.packageName)

    /**
     * Chamado depois que o Device Owner foi ativado. Gera um token
     * aleatório local, tenta registrá-lo via DevicePolicyManager, e retorna
     * se o recurso está de fato disponível neste aparelho/versão de Android.
     */
    fun setupPasswordResetToken(): ByteArray? {
        if (!isDeviceOwner()) return null

        val token = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }

        return try {
            val ok = dpm.setResetPasswordToken(adminComponent, token)
            if (ok) token else null
        } catch (e: SecurityException) {
            // Esperado em algumas versões/fabricantes - a feature não está
            // disponível e o produto precisa de um plano B (ex: reset de
            // fábrica assistido, ou não oferecer desbloqueio remoto nesses
            // aparelhos).
            null
        }
    }

    fun androidVersionSupportsPasswordReset(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
}
