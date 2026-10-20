import { useQuery, useMutation } from "@tanstack/react-query";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

/**
 * Espelho do celular, compartilhado entre as telas que mostram o acesso
 * remoto. Só a parte visual vive aqui; de onde vêm os dados (frame e envio de
 * toque) entra por `source`, para cada tela usar a sua forma de autenticar:
 * hoje a página pública /instalar/$token (por token do link), e quem for
 * autenticado no painel pode usar getDeviceFrameUrl/sendDeviceInput.
 */

export type MirrorMode = "visualizacao" | "controle";

export interface MirrorSource {
  /** Chave de cache do polling de frames (uma por aparelho). */
  queryKey: readonly unknown[];
  fetchFrameUrl: () => Promise<{ found: boolean; url: string | null }>;
  sendInput: (input: {
    kind: "tap" | "swipe";
    x: number;
    y: number;
    x2?: number;
    y2?: number;
    durationMs?: number;
  }) => Promise<unknown>;
}

export interface MirrorSession {
  id: string;
  mode: MirrorMode;
  started_at: string;
}

/**
 * Reproduz o design combinado — banner de consentimento sempre visível
 * durante a sessão, aviso de "aparelho gerenciado pela empresa" e o gesto de
 * arrastar para desbloquear em vez de um botão comum. Sem sessão ativa,
 * mostra a tela de bloqueio; a sessão real só começa quando o arraste chega
 * ao fim.
 *
 * Enquanto há sessão ativa, mostra o último frame que o aparelho mandou
 * (poucos por segundo - ver o roadmap para o porquê de não ser um vídeo
 * WebRTC de verdade) e, em modo "controle", converte toque/arraste sobre a
 * imagem em comandos enviados para o aparelho.
 */
export function PhoneMirror({
  source,
  deviceName,
  activeSession,
  onStart,
  onEndSession,
  starting,
  stopping,
}: {
  source: MirrorSource;
  deviceName: string;
  activeSession: MirrorSession | null | undefined;
  onStart: (input: { reason: string; mode: MirrorMode }) => void;
  onEndSession: () => void;
  starting: boolean;
  stopping: boolean;
}) {
  const [reason, setReason] = useState("Esqueci o celular em casa e preciso liberar um pagamento.");
  const [mode, setMode] = useState<MirrorMode>("controle");
  const [slide, setSlide] = useState(0);
  const [showForm, setShowForm] = useState(false);

  function handleSlideChange(value: number) {
    setSlide(value);
    if (value >= 96 && !starting) {
      onStart({ reason, mode });
      // A tela real vira "sessão ativa" assim que a mutação confirmar;
      // isso só reseta a alça visual do gesto.
      setTimeout(() => setSlide(0), 300);
    }
  }

  return (
    <div className="mt-6 overflow-hidden rounded-[28px] border border-border bg-foreground/[0.03]">
      {/* Aviso de consentimento — visível sempre que a sessão está ativa, nunca opcional. */}
      {activeSession && (
        <div className="flex items-center gap-2 bg-primary/10 px-4 py-2 text-xs font-medium text-primary">
          <span className="h-2 w-2 rounded-full bg-primary" />
          Você está acessando o seu próprio celular
        </div>
      )}

      <div className="border-b border-border/60 bg-card/60 px-4 py-2 text-center text-[11px] text-muted-foreground">
        Aparelho gerenciado pela empresa
      </div>

      <div className="flex min-h-[380px] flex-col justify-between p-5">
        {activeSession ? (
          <>
            <div className="flex-1">
              <ScreenView source={source} mode={activeSession.mode} />
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                {deviceName} · modo {activeSession.mode === "controle" ? "controle" : "visualização"}{" "}
                · iniciada às{" "}
                {new Date(activeSession.started_at).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <Button variant="outline" className="w-full" onClick={onEndSession} disabled={stopping}>
              {stopping ? "Encerrando..." : "Encerrar sessão"}
            </Button>
          </>
        ) : showForm ? (
          <div className="flex-1 space-y-3">
            <div className="space-y-1">
              <Label>Motivo do acesso</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1">
              <Label>Modo</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["visualizacao", "controle"] as const).map((m) => (
                  <Button
                    key={m}
                    type="button"
                    variant={mode === m ? "default" : "outline"}
                    onClick={() => setMode(m)}
                    className="w-full"
                  >
                    {m === "visualizacao" ? "Ver tela" : "Controlar"}
                  </Button>
                ))}
              </div>
            </div>

            <SlideToUnlock value={slide} onChange={handleSlideChange} disabled={starting} />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-foreground/5 text-2xl">
              🔒
            </div>
            <p className="text-sm text-muted-foreground">
              Aparelho bloqueado. Informe o motivo do acesso para desbloquear remotamente.
            </p>
            <Button onClick={() => setShowForm(true)}>Iniciar acesso ao meu celular</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Busca em polling o último frame da tela do aparelho e, em modo "controle",
 * converte toque/arraste feito sobre a imagem em coordenadas normalizadas (0
 * a 1) enviadas por `source.sendInput`. 800ms de intervalo é um meio-termo -
 * mais rápido que isso só aumenta custo de Storage sem ganho visível, dado
 * que o aparelho também só captura poucos frames por segundo do lado dele.
 */
function ScreenView({ source, mode }: { source: MirrorSource; mode: MirrorMode }) {
  const frame = useQuery({
    queryKey: source.queryKey,
    queryFn: source.fetchFrameUrl,
    refetchInterval: 800,
    refetchIntervalInBackground: true,
  });

  const sendInput = useMutation({
    mutationFn: source.sendInput,
    onError: (e: Error) => toast.error(e.message),
  });

  const pointerStart = useRef<{ x: number; y: number; t: number } | null>(null);

  // Proporção (largura/altura) do frame recebido. A moldura acompanha essa
  // proporção para a imagem ocupar a área inteira, sem faixas laterais: é o
  // que garante que a fração do toque calculada sobre a moldura seja a mesma
  // fração sobre a tela do aparelho. Com a moldura fixa em 9:16, telas mais
  // altas (a maioria dos celulares atuais) deslocavam o toque na horizontal.
  const [frameAspect, setFrameAspect] = useState<number | null>(null);

  function fractionFromEvent(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { x, y };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (mode !== "controle") return;
    const { x, y } = fractionFromEvent(e);
    pointerStart.current = { x, y, t: Date.now() };
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (mode !== "controle" || !pointerStart.current) return;
    const start = pointerStart.current;
    pointerStart.current = null;
    const end = fractionFromEvent(e);
    const durationMs = Date.now() - start.t;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);

    if (distance < 0.02) {
      sendInput.mutate({ kind: "tap", x: start.x, y: start.y });
    } else {
      sendInput.mutate({
        kind: "swipe",
        x: start.x,
        y: start.y,
        x2: end.x,
        y2: end.y,
        durationMs: Math.min(5000, Math.max(50, durationMs)),
      });
    }
  }

  return (
    <div
      className="relative mx-auto w-full max-w-[220px] overflow-hidden rounded-2xl bg-black/90 select-none"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      style={{
        aspectRatio: frameAspect ?? 9 / 16,
        touchAction: mode === "controle" ? "none" : undefined,
        cursor: mode === "controle" ? "crosshair" : "default",
      }}
    >
      {frame.data?.found && frame.data.url ? (
        <img
          src={frame.data.url}
          alt="Tela do aparelho"
          className="pointer-events-none h-full w-full object-contain"
          draggable={false}
          onLoad={(e) => {
            const { naturalWidth, naturalHeight } = e.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) {
              setFrameAspect(naturalWidth / naturalHeight);
            }
          }}
        />
      ) : (
        <div className="flex h-full items-center justify-center p-4 text-center text-[11px] text-white/60">
          Aguardando o aparelho começar a enviar a tela... (ele precisa estar com a permissão de
          captura de tela concedida)
        </div>
      )}
    </div>
  );
}

/** Gesto de arrastar para desbloquear — substitui o botão comum de início de sessão. */
function SlideToUnlock({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="relative mt-2 h-12 w-full overflow-hidden rounded-full border border-border bg-foreground/5">
      <div
        className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-primary/20 transition-[width]"
        style={{ width: `${value}%` }}
      />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-muted-foreground">
        {disabled ? "Desbloqueando..." : "Arraste para desbloquear e iniciar o acesso"}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        aria-label="Arraste para desbloquear e iniciar o acesso ao celular"
      />
    </div>
  );
}
