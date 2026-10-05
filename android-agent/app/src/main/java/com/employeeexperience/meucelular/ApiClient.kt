package com.employeeexperience.meucelular

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Cliente HTTP real para as rotas públicas do agente, descritas em
 * src/routes/api/public/agent/{enroll,heartbeat,session}.ts do painel.
 * BASE_URL aponta para o mesmo domínio onde o painel web está publicado -
 * é o mesmo backend (TanStack Start + Supabase), então não existe um
 * "backend separado" para o app: tudo conversa com o mesmo projeto.
 *
 * Métodos são bloqueantes (chamada de rede síncrona via OkHttp .execute())
 * e devem ser chamados de fora da thread principal (o MainActivity e o
 * SessionWatcherService já cuidam disso).
 */
class ApiClient(private val baseUrl: String = BASE_URL) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()
    private val jsonMediaType = "application/json".toMediaType()

    class ApiException(message: String) : Exception(message)

    /** Troca o token de ativação (do link /instalar/<token>) por um segredo permanente do aparelho. */
    @Throws(IOException::class, ApiException::class)
    fun enroll(enrollmentToken: String, model: String): EnrollResult {
        val body = JSONObject().apply {
            put("enrollmentToken", enrollmentToken)
            put("model", model)
        }.toString().toRequestBody(jsonMediaType)

        val request = Request.Builder()
            .url("$baseUrl/api/public/agent/enroll")
            .post(body)
            .build()

        client.newCall(request).execute().use { response ->
            val json = JSONObject(response.body?.string() ?: "{}")
            if (!response.isSuccessful) throw ApiException(json.optString("error", "Falha ao ativar (${response.code})"))
            return EnrollResult(
                deviceId = json.getString("deviceId"),
                deviceSecret = json.getString("deviceSecret"),
            )
        }
    }

    /**
     * Avisa que o app está vivo, com o nível de bateria atual. screenWidth/
     * screenHeight são opcionais e só mandados quando a captura de tela
     * acabou de começar (ver ScreenCaptureService.startCapture) - é o jeito
     * mais confiável de saber a resolução real, já que pode diferir do que
     * foi reportado no enrollment (rotação, densidade, etc.).
     */
    @Throws(IOException::class)
    fun heartbeat(
        deviceId: String,
        deviceSecret: String,
        batteryLevel: Int?,
        screenWidth: Int? = null,
        screenHeight: Int? = null,
    ) {
        val body = JSONObject().apply {
            if (batteryLevel != null) put("batteryLevel", batteryLevel)
            if (screenWidth != null) put("screenWidth", screenWidth)
            if (screenHeight != null) put("screenHeight", screenHeight)
        }.toString().toRequestBody(jsonMediaType)

        val request = Request.Builder()
            .url("$baseUrl/api/public/agent/heartbeat")
            .header("x-device-id", deviceId)
            .header("x-device-secret", deviceSecret)
            .post(body)
            .build()

        client.newCall(request).execute().use { response -> response.body?.close() }
    }

    /** Pergunta se existe sessão de acesso ativa - é essa checagem que liga o aviso visível na tela. */
    @Throws(IOException::class, ApiException::class)
    fun fetchActiveSession(deviceId: String, deviceSecret: String): ActiveSession? {
        val request = Request.Builder()
            .url("$baseUrl/api/public/agent/session")
            .header("x-device-id", deviceId)
            .header("x-device-secret", deviceSecret)
            .get()
            .build()

        client.newCall(request).execute().use { response ->
            val json = JSONObject(response.body?.string() ?: "{}")
            if (!response.isSuccessful) throw ApiException(json.optString("error", "Falha ao consultar sessão (${response.code})"))
            val session = json.optJSONObject("activeSession") ?: return null
            return ActiveSession(
                id = session.getString("id"),
                mode = session.getString("mode"),
                reason = session.getString("reason"),
                startedAt = session.getString("started_at"),
            )
        }
    }

    /** Encerra a sessão ativa a partir do próprio aparelho (ex: usuário cancela pela notificação). */
    @Throws(IOException::class)
    fun endSessionFromDevice(deviceId: String, deviceSecret: String) {
        val body = JSONObject().apply { put("action", "encerrar") }
            .toString().toRequestBody(jsonMediaType)

        val request = Request.Builder()
            .url("$baseUrl/api/public/agent/session")
            .header("x-device-id", deviceId)
            .header("x-device-secret", deviceSecret)
            .post(body)
            .build()

        client.newCall(request).execute().use { response -> response.body?.close() }
    }

    /**
     * Envia um frame (JPEG) da tela - ver src/routes/api/public/agent/frame.ts.
     * `active=false` na resposta quer dizer que não há mais sessão ativa
     * para este aparelho; quem chama deve parar o loop de captura.
     */
    @Throws(IOException::class, ApiException::class)
    fun sendFrame(deviceId: String, deviceSecret: String, frameBase64: String): Boolean {
        val body = JSONObject().apply { put("frameBase64", frameBase64) }
            .toString().toRequestBody(jsonMediaType)

        val request = Request.Builder()
            .url("$baseUrl/api/public/agent/frame")
            .header("x-device-id", deviceId)
            .header("x-device-secret", deviceSecret)
            .post(body)
            .build()

        client.newCall(request).execute().use { response ->
            val json = JSONObject(response.body?.string() ?: "{}")
            if (!response.isSuccessful) throw ApiException(json.optString("error", "Falha ao enviar frame (${response.code})"))
            return json.optBoolean("active", true)
        }
    }

    /** Toques/arrastos pendentes do painel - ver src/routes/api/public/agent/input.ts. */
    @Throws(IOException::class, ApiException::class)
    fun fetchPendingInputs(deviceId: String, deviceSecret: String): List<PendingInput> {
        val request = Request.Builder()
            .url("$baseUrl/api/public/agent/input")
            .header("x-device-id", deviceId)
            .header("x-device-secret", deviceSecret)
            .get()
            .build()

        client.newCall(request).execute().use { response ->
            val json = JSONObject(response.body?.string() ?: "{}")
            if (!response.isSuccessful) throw ApiException(json.optString("error", "Falha ao consultar toques (${response.code})"))
            val arr = json.optJSONArray("inputs") ?: return emptyList()
            return (0 until arr.length()).map { i ->
                val item = arr.getJSONObject(i)
                PendingInput(
                    kind = item.getString("kind"),
                    x = item.getDouble("x").toFloat(),
                    y = item.getDouble("y").toFloat(),
                    x2 = if (item.isNull("x2")) null else item.getDouble("x2").toFloat(),
                    y2 = if (item.isNull("y2")) null else item.getDouble("y2").toFloat(),
                    durationMs = if (item.isNull("durationMs")) null else item.getLong("durationMs"),
                )
            }
        }
    }

    data class EnrollResult(val deviceId: String, val deviceSecret: String)
    data class ActiveSession(val id: String, val mode: String, val reason: String, val startedAt: String)
    data class PendingInput(
        val kind: String,
        val x: Float,
        val y: Float,
        val x2: Float?,
        val y2: Float?,
        val durationMs: Long?,
    )

    companion object {
        // Mesmo domínio onde o painel (TI/profissional) está publicado.
        // Se o Lovable publicar em outro domínio/slug no futuro, só isso
        // precisa mudar - não há nenhum outro lugar com a URL hardcoded.
        const val BASE_URL = "https://shared-spark-lane.lovable.app"
    }
}
