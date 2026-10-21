package com.employeeexperience.meucelular

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Recebe o evento de ativação como Device Owner. DECISÃO (21/10/2026, ver
 * roadmap.md): o caminho principal agora é o próprio MainActivity chamando
 * ACTION_PROVISION_MANAGED_DEVICE depois do instalar normal pelo link (sem
 * QR, sem ADB, sem computador) - ver
 * MainActivity.requestDeviceOwnerProvisioning(). Os caminhos antigos
 * continuam existindo e disparam o mesmo evento: provisionamento via QR
 * code no primeiro boot (Android Enterprise) ou via ADB em ambiente de
 * teste (`adb shell dpm set-device-owner
 * com.employeeexperience.meucelular/.DeviceOwnerReceiver`).
 *
 * Em qualquer um dos três caminhos, Device Owner só pode ser concedido
 * enquanto o aparelho não tem nenhuma conta configurada - por isso precisa
 * acontecer antes de qualquer conta Google ser adicionada ao aparelho.
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
