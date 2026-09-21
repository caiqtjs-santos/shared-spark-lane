package com.employeeexperience.meucelular

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Recebe o push (FCM) que o backend dispara quando alguém inicia uma sessão
 * (ver comentário em backend/src/routes/sessions.ts). É isso que "acorda"
 * o app mesmo se ele não estiver em primeiro plano, sem precisar manter
 * uma conexão permanente aberta (o que gastaria bateria).
 *
 * Requer um projeto Firebase real (google-services.json) para funcionar -
 * não pode ser configurado neste ambiente.
 */
class FcmListenerService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        val sessionId = message.data["sessionId"] ?: return
        val mode = message.data["mode"] ?: "visualizacao"

        // TODO: iniciar ScreenCaptureService / SignalingClient com este
        // sessionId. Se mode == "controle", também verificar se a permissão
        // de Acessibilidade já foi concedida antes de aceitar a sessão.
    }

    override fun onNewToken(token: String) {
        // TODO: enviar este token ao backend (endpoint ainda não criado:
        // POST /api/devices/:id/push-token) para que ele saiba para onde
        // mandar o push da próxima sessão.
    }
}
