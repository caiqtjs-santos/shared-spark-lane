package com.employeeexperience.meucelular

import android.content.Context

/**
 * Guarda localmente o que o app precisa para se autenticar como agente do
 * aparelho depois do enrollment: o id do aparelho e o segredo emitido por
 * POST /api/public/agent/enroll (ver src/routes/api/public/agent/enroll.ts
 * no painel). Nunca guarda a senha do profissional nem nada da conta dele -
 * o app só conhece o próprio aparelho.
 *
 * SharedPreferences simples por enquanto; para produção de verdade isso
 * deveria ir para o Android Keystore/EncryptedSharedPreferences, mas isso
 * exige uma dependência extra (androidx.security.crypto) que ainda não
 * validamos no CI - fica marcado como próximo passo, não escondido.
 */
class DeviceStore(context: Context) {
    private val prefs = context.getSharedPreferences("device_store", Context.MODE_PRIVATE)

    var deviceId: String?
        get() = prefs.getString(KEY_DEVICE_ID, null)
        set(value) = prefs.edit().putString(KEY_DEVICE_ID, value).apply()

    var deviceSecret: String?
        get() = prefs.getString(KEY_DEVICE_SECRET, null)
        set(value) = prefs.edit().putString(KEY_DEVICE_SECRET, value).apply()

    val isEnrolled: Boolean
        get() = deviceId != null && deviceSecret != null

    fun clear() {
        prefs.edit().clear().apply()
    }

    companion object {
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_SECRET = "device_secret"
    }
}
