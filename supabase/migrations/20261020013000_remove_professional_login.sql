-- Decisão de 20/10/2026 (roadmap.md): o login do profissional foi eliminado.
-- Só o TI tem conta; o profissional usa apenas o link gerado no cadastro
-- (devices.enrollment_token), que serve para ativar o aparelho e, depois de
-- ativo, para abrir o painel de acesso remoto - autenticado pela posse do
-- próprio token, o mesmo modelo de confiança do device_secret do app.

-- Nome do profissional: texto livre, sem conta ligada a ele.
alter table public.devices
  add column if not exists professional_name text;

-- Sessão iniciada pelo profissional via link não tem usuário autenticado:
-- fica null nesse caso. Quando é o TI quem inicia, continua preenchido.
alter table public.access_sessions
  alter column requested_by_user_id drop not null;

comment on column public.devices.owner_user_id is
  'DEPRECATED: não é mais preenchido - o profissional não tem conta. Use professional_name.';
comment on column public.devices.enrollment_token is
  'Segredo do link /instalar/<token>: ativa o aparelho e, depois, dá acesso ao painel remoto. Permanente (não é apagado no enrollment).';
