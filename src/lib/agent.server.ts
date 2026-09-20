import { supabaseAdmin } from "@/integrations/supabase/client.server";

export { supabaseAdmin };

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Autentica o app do celular pelo par id + segredo emitido no enrollment.
 * Enviados nos cabeçalhos x-device-id e x-device-secret.
 */
export async function authenticateDevice(request: Request) {
  const deviceId = request.headers.get("x-device-id");
  const secret = request.headers.get("x-device-secret");
  if (!deviceId || !secret) return null;

  const { data } = await supabaseAdmin
    .from("devices")
    .select("id, owner_user_id, device_secret, enrollment_status")
    .eq("id", deviceId)
    .maybeSingle();

  if (!data || !data.device_secret || data.device_secret !== secret) return null;
  if (data.enrollment_status !== "ativo") return null;
  return data;
}

export async function logAgentEvent(entry: {
  event_type: string;
  device_id?: string | null;
  user_id?: string | null;
  session_id?: string | null;
  details?: Record<string, unknown> | null;
}) {
  await supabaseAdmin.from("audit_log").insert(entry);
}
