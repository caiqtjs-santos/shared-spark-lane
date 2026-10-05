-- Espelhamento de tela SEM WebRTC/TURN (decisão registrada em roadmap.md):
-- o aparelho envia frames (JPEG) periodicamente pro nosso próprio backend,
-- que guarda só o ÚLTIMO frame de cada aparelho num bucket privado do
-- Storage (sobrescrito a cada envio - não vira histórico); o painel web
-- busca uma URL assinada de curta duração e fica atualizando uma <img>.
-- Toque/arraste no painel viram linhas em session_inputs, que o app
-- consome via polling e injeta via RemoteAccessibilityService.
--
-- Trade-off deliberado: menos fluido que WebRTC de verdade (pensa em poucos
-- frames por segundo), mas os dois lados só falam com o NOSSO servidor via
-- HTTPS comum - sem conexão direta entre aparelhos, logo sem precisar
-- atravessar NAT, logo sem STUN/TURN nem biblioteca nativa nova no app.

insert into storage.buckets (id, name, public)
values ('device-frames', 'device-frames', false)
on conflict (id) do nothing;

-- Resolução de tela do aparelho, reportada uma vez no enrollment. É o que
-- permite ao app converter o toque normalizado (0..1) que o painel manda de
-- volta em coordenadas de pixel reais para o gesto (ver RemoteAccessibilityService).
-- Não cobre rotação de tela em tempo real - ver TODO no app Android.
alter table public.devices
  add column if not exists screen_width integer,
  add column if not exists screen_height integer;

create table public.session_inputs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.access_sessions(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  kind text not null check (kind in ('tap', 'swipe')),
  -- Coordenadas normalizadas (0 a 1, relativas ao frame mostrado no painel),
  -- não pixels - o app é quem sabe a resolução real do próprio aparelho.
  x numeric not null check (x >= 0 and x <= 1),
  y numeric not null check (y >= 0 and y <= 1),
  x2 numeric check (x2 >= 0 and x2 <= 1),
  y2 numeric check (y2 >= 0 and y2 <= 1),
  duration_ms integer,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
grant select, insert on public.session_inputs to authenticated;
grant all on public.session_inputs to service_role;
alter table public.session_inputs enable row level security;

-- Só quem pediu a sessão (ou TI) pode mandar toque, e só enquanto ela está
-- mesmo ativa em modo "controle". A entrega para o aparelho sempre passa
-- pela rota do agente via supabaseAdmin (service_role ignora RLS).
create policy "session_inputs_insert_own_or_ti" on public.session_inputs for insert to authenticated
  with check (
    exists (
      select 1 from public.access_sessions s
      where s.id = session_id
        and s.device_id = device_id
        and s.status = 'ativa'
        and s.mode = 'controle'
        and (s.requested_by_user_id = auth.uid() or public.has_role(auth.uid(), 'ti'))
    )
  );

create policy "session_inputs_select_own_or_ti" on public.session_inputs for select to authenticated
  using (
    exists (
      select 1 from public.access_sessions s
      where s.id = session_id
        and (s.requested_by_user_id = auth.uid() or public.has_role(auth.uid(), 'ti'))
    )
  );

create index session_inputs_pending_idx on public.session_inputs (device_id, created_at)
  where delivered_at is null;
