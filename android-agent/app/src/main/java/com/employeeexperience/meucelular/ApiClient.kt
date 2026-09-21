package com.employeeexperience.meucelular

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Cliente HTTP simples para o backend descrito em /backend. Em produção,
 * baseUrl viria de configuração remota (definida no momento do enrollment,
 * não hardcoded), e o deviceToken seria armazenado no Android Keystore, não
 * em memória simples como este esqueleto faz.
 */
class ApiClient(private val baseUrl: String) {

    private val client = OkHttpClient()
    private val jsonMediaType = "application/json".toMediaType()

    fun sendHeartbeat(deviceId: String, batteryLevel: Int) {
        val body = JSONObject().apply { put("batteryLevel", batteryLevel) }
            .toString()
            .toRequestBody(jsonMediaType)

        val request = Request.Builder()
            .url("$baseUrl/api/devices/$deviceId/heartbeat")
            .post(body)
            .build()

        // Fire-and-forget: heartbeat não deve travar nem crashar o app se a
        // rede cair (aparelho pode estar sem sinal, é um cenário esperado).
        client.newCall(request).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: okhttp3.Call, e: java.io.IOException) {
                // TODO: registrar em log local para diagnóstico, sem expor dados sensíveis
            }
            override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                response.close()
            }
        })
    }
}
