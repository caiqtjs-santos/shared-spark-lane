-- Separa o LINK DE INSTALAÇÃO do LINK DE ACESSO (decisão de 27/11/2026).
--
-- Antes: um token só (enrollment_token) servia para instalar no celular E,
-- depois de ativo, para acessar/ver a tela. Isso confundia a jornada e deixava
-- o mesmo segredo no aparelho gerenciado e nas mãos de quem acessa.
--
-- Agora:
--   enrollment_token -> link que vai para o CELULAR (instalar e ativar).
--   access_token     -> link que fica com o DONO (ver/controlar o aparelho).
-- Quem tem o access_token é quem acessa; ele nunca é exposto no celular.
alter table public.devices add column if not exists access_token text;

-- Gera um token de acesso para todo aparelho que ainda não tem (inclui os já
-- cadastrados, para o TI poder distribuir o novo link de acesso deles).
update public.devices
  set access_token = gen_random_uuid()::text
  where access_token is null;

alter table public.devices alter column access_token set not null;

create unique index if not exists devices_access_token_key
  on public.devices (access_token);
