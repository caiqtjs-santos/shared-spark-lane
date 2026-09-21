package com.employeeexperience.meucelular

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.Response

/**
 * Cliente do canal de sinalização WebRTC descrito em backend/src/signaling.ts.
 * Conecta em ws://<backend>/ws/signaling?sessionId=<id>&role=agent - o mesmo
 * protocolo que o painel web usa do lado "viewer". As mensagens trocadas são
 * SDP offer/answer e ICE candidates; o vídeo em si não passa por aqui.
 */
class SignalingClient(
    private val baseWsUrl: String,
    private val sessionId: String,
    private val onMessage: (String) -> Unit
) {
    private val client = OkHttpClient()
    private var socket: WebSocket? = null

    fun connect() {
        val request = Request.Builder()
            .url("$baseWsUrl/ws/signaling?sessionId=$sessionId&role=agent")
            .build()

        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                onMessage(text)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                // TODO: reconexão com backoff - rede móvel cai com frequência,
                // isso precisa ser robusto para o caso de uso real
            }
        })
    }

    fun send(message: String) {
        socket?.send(message)
    }

    fun close() {
        socket?.close(1000, "Sessão encerrada")
    }
}
