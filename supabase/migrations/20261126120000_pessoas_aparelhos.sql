-- Modelo POR PESSOA (lembrete do responsável: "um funcionário pode ter mais de
-- um aparelho"). O cofre de senhas é por pessoa — 1 conta sincroniza em todos os
-- aparelhos dela. Aqui modelamos a pessoa como entidade principal e os aparelhos
-- como lista filha (1 pessoa -> N aparelhos).
--
-- ADITIVO: não altera nem remove nenhuma tabela existente (devices, etc.).
-- NÃO aplicado automaticamente — aplicar com autorização do responsável.
-- Mesmo padrão de RLS do projeto: só o TI gerencia (public.has_role(uid,'ti')).

-- ---------------------------------------------------------------------------
-- PESSOAS — os funcionários. A conta do cofre (Vaultwarden) vive AQUI, não no
-- aparelho: é isso que faz esquecer o celular não travar ninguém.
-- ---------------------------------------------------------------------------
create table if not exists public.pessoas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  codigo text unique,                       -- matrícula/código interno (opcional)
  cofre_conta text,                         -- e-mail/login no Vaultwarden (quando houver)
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

grant select, insert, update, delete on public.pessoas to authenticated;
grant all on public.pessoas to service_role;
alter table public.pessoas enable row level security;

create policy "pessoas_ti_all" on public.pessoas for all to authenticated
  using (public.has_role(auth.uid(), 'ti'))
  with check (public.has_role(auth.uid(), 'ti'));

-- ---------------------------------------------------------------------------
-- APARELHOS — os aparelhos de cada pessoa (1 pessoa -> N aparelhos).
-- Serve para auditoria e para o acesso remoto da Fase 2 (só Android; iPhone
-- não entra no controle, por trava da Apple). O cofre NÃO depende disto:
-- funciona só com a pessoa e a conta dela.
-- ---------------------------------------------------------------------------
create table if not exists public.aparelhos (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  apelido text not null,                    -- ex: "iPhone do trabalho", "Android 2"
  plataforma text not null default 'android'
    check (plataforma in ('android', 'ios', 'outro')),
  identificador text,                       -- id do aparelho (opcional, p/ Fase 2)
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

grant select, insert, update, delete on public.aparelhos to authenticated;
grant all on public.aparelhos to service_role;
alter table public.aparelhos enable row level security;

create policy "aparelhos_ti_all" on public.aparelhos for all to authenticated
  using (public.has_role(auth.uid(), 'ti'))
  with check (public.has_role(auth.uid(), 'ti'));

create index if not exists aparelhos_pessoa_idx on public.aparelhos (pessoa_id);
