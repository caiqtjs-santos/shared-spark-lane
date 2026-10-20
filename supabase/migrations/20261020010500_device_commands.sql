-- Comandos remotos de aparelho (bloquear tela / reiniciar / apagar) - decisão
-- de 19/10/2026 no roadmap.md: o app já é Device Owner, então executa
-- DevicePolicyManager.lockNow()/reboot()/wipeData() localmente, sem depender
-- da Android Management API. Mesmo desenho de polling do session_inputs: o
-- painel (TI) grava a linha, o app busca via GET /api/public/agent/commands
-- (que já marca delivered_at) e executa na hora.
--
-- Diferente do controle de tela (que o próprio profissional pode iniciar),
-- estas são ações administrativas/destrutivas: só o TI insere. TI e dono do
-- aparelho podem ler, para o profissional ver que o aparelho dele foi
-- bloqueado/reiniciado/apagado.

create table public.device_commands (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id),
  kind text not null check (kind in ('lock', 'reboot', 'wipe')),
  requested_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

grant select, insert on public.device_commands to authenticated;
grant all on public.device_commands to service_role;
alter table public.device_commands enable row level security;

create policy "device_commands_insert_ti" on public.device_commands for insert to authenticated
  with check (
    public.has_role(auth.uid(), 'ti')
    and requested_by_user_id = auth.uid()
  );

create policy "device_commands_select_own_or_ti" on public.device_commands for select to authenticated
  using (
    public.has_role(auth.uid(), 'ti')
    or exists (
      select 1 from public.devices d
      where d.id = device_id and d.owner_user_id = auth.uid()
    )
  );

-- A entrega para o aparelho sempre passa pela rota do agente via
-- supabaseAdmin (service_role ignora RLS).
create index device_commands_pending_idx on public.device_commands (device_id, created_at)
  where delivered_at is null;
