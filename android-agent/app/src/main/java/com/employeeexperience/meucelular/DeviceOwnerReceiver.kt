package com.employeeexperience.meucelular

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Recebe o evento de ativação como Device Owner (disparado depois do
 * provisionamento via QR code no primeiro boot do aparelho, ou via ADB em
 * ambiente de teste: `adb shell dpm set-device-owner
 * com.employeeexperience.meucelular/.DeviceOwnerReceiver`).
 *
 * Device Owner só pode ser concedido em um aparelho recém-resetado, sem
 * conta Google configurada ainda - por isso o enrollment corporativo
 * precisa acontecer ANTES de o aparelho ser entregue ao profissional,
 * exatamente como desenhado na tela de onboarding do TI.
 */
class DeviceOwnerReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Log.i("DeviceOwnerReceiver", "App ativado como Device Owner")
        // A partir daqui, EnrollmentManager.completeEnrollment() pode ser
        // chamado para registrar o token de reset de senha e notificar o
        // backend de que o enrollment foi concluído.
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Log.w("DeviceOwnerReceiver", "Device Owner desativado - gestão do aparelho perdida")
        // Em produção: notificar o backend imediatamente (evento de auditoria
        // crítico - o aparelho saiu do controle da empresa).
    }
}
