package com.employeeexperience.meucelular

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.view.accessibility.AccessibilityEvent

/**
 * Injeta toques/gestos recebidos do painel web quando a sessão está em
 * modo "controle". Só existe enquanto o usuário concede a permissão de
 * Acessibilidade explicitamente pela tela do sistema Android (que mostra
 * um aviso claro do que essa permissão permite) - não pode ser ativada
 * silenciosamente por código.
 *
 * Quem chama performTap/performSwipe é o ScreenCaptureService, que faz o
 * polling de GET /api/public/agent/input e já converte as coordenadas
 * normalizadas (0..1) vindas do painel em pixels reais antes de chamar
 * aqui (ver applyPendingInputs em ScreenCaptureService.kt).
 */
class RemoteAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Este serviço não precisa reagir a eventos de acessibilidade da
        // tela (não lê conteúdo - note que canRetrieveWindowContent está
        // "false" na configuração) - ele só injeta gestos recebidos.
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    /** Chamado pelo ScreenCaptureService quando chega um toque do painel. */
    fun performTap(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 50))
            .build()
        dispatchGesture(gesture, null, null)
    }

    /** Gesto de arrastar - usado, por exemplo, pelo "arrastar para desbloquear". */
    fun performSwipe(startX: Float, startY: Float, endX: Float, endY: Float, durationMs: Long) {
        val path = Path().apply {
            moveTo(startX, startY)
            lineTo(endX, endY)
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
            .build()
        dispatchGesture(gesture, null, null)
    }

    companion object {
        /** null enquanto o usuário não concedeu a permissão de Acessibilidade. */
        @Volatile
        var instance: RemoteAccessibilityService? = null
            private set
    }
}
