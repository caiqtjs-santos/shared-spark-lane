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
 * A conexão com o canal de dados do WebRTC (recebendo os eventos de toque
 * do painel) ainda precisa ser implementada; aqui está a parte de injeção
 * de gesto, que é a API pública do Android para isso.
 */
class RemoteAccessibilityService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Este serviço não precisa reagir a eventos de acessibilidade da
        // tela (não lê conteúdo - note que canRetrieveWindowContent está
        // "false" na configuração) - ele só injeta gestos recebidos.
    }

    override fun onInterrupt() {}

    /** Chamado pelo cliente WebRTC quando chega um evento de toque do painel. */
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
}
