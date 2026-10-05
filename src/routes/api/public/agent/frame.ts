import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * O app envia periodicamente (poucos frames por segundo) um JPEG da própria
 * tela, em base64. Guardamos só o ÚLTIMO frame de cada aparelho (sobrescrito
 * a cada chamada, nunca vira histórico) num bucket privado do Storage - ver
 * migração 20261005181500_screen_mirroring.sql para o porquê desse desenho
 * (espelhamento sem WebRTC/TURN, trocando fluidez por simplicidade).
 *
 * Só aceita frame quando existe sessão ativa para o aparelho - fora de
 * sessão, o app nem deveria estar chamando isso (ver SessionWatcherService),
 * mas a checagem aqui evita gravar lixo no Storage em qualquer cenário de
 * app desatualizado/bug.
 */
export const Route = createFileRoute("/api/public/agent/frame")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin, json, authenticateDevice } = await import("@/lib/agent.server");
        const device = await authenticateDevice(request);
        if (!device) return json({ error: "Aparelho não autorizado" }, 401);

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return json({ error: "Corpo inválido" }, 400);
        }

        const parsed = z
          .object({
            // JPEG em base64, sem o prefixo "data:image/jpeg;base64,".
            frameBase64: z.string().min(100),
          })
          .safeParse(body);
        if (!parsed.success) return json({ error: "Dados inválidos" }, 400);

        const { data: session } = await supabaseAdmin
          .from("access_sessions")
          .select("id")
          .eq("device_id", device.id)
          .eq("status", "ativa")
          .maybeSingle();
        if (!session) return json({ ok: true, active: false });

        let bytes: Uint8Array;
        try {
          const binary = atob(parsed.data.frameBase64);
          bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        } catch {
          return json({ error: "frameBase64 não é base64 válido" }, 400);
        }

        const { error } = await supabaseAdmin.storage
          .from("device-frames")
          .upload(`${device.id}.jpg`, bytes, { contentType: "image/jpeg", upsert: true });
        if (error) return json({ error: error.message }, 500);

        return json({ ok: true, active: true });
      },
    },
  },
});
