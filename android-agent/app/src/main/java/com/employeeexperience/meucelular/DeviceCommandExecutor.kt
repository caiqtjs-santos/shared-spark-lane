package com.employeeexperience.meucelular

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.util.Log

/**
 * Executa localmente os comandos administrativos que o TI mandou pelo painel
 * (ver ApiClient.fetchPendingCommands e src/routes/api/public/agent/commands.ts).
 *
 * Tudo via DevicePolicyManager - o app só consegue isso por ser Device Owner
 * (ver EnrollmentManager / DeviceOwnerReceiver). Sem ser Device Owner, o
 * comando é ignorado e registrado no log, nunca falha em silêncio total.
 *
 * ATENÇÃO: nunca testado em aparelho físico, só revisado contra a
 * documentação do Android (mesmo status do espelhamento de tela).
 */
class DeviceCommandExecutor(private val context: Context) {

    private val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val adminComponent = ComponentName(context, DeviceOwnerReceiver::class.java)

    fun execute(kind: String) {
        if (!dpm.isDeviceOwnerApp(context.packageName)) {
            Log.w(TAG, "Comando '$kind' ignorado: o app não é Device Owner neste aparelho")
            return
        }

        try {
            when (kind) {
                // Bloqueia a tela agora, como se o botão de energia fosse apertado.
                "lock" -> dpm.lockNow()

                // Reinicia o aparelho. Exige Device Owner e Android 7.0 (API 24)+.
                "reboot" ->
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        dpm.reboot(adminComponent)
                    } else {
                        Log.w(TAG, "Reiniciar exige Android 7.0+; comando ignorado")
                    }

                // IRREVERSÍVEL: apaga todos os dados e devolve o aparelho de fábrica.
                // O painel só deixa mandar depois de confirmação explícita.
                "wipe" -> dpm.wipeData(0)

                else -> Log.w(TAG, "Comando desconhecido ignorado: $kind")
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "Sem permissão para executar '$kind'", e)
        }
    }

    companion object {
        private const val TAG = "DeviceCommandExecutor"
    }
}
