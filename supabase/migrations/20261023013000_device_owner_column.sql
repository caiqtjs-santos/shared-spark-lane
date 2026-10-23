-- Decisão de 23/10/2026 (ver roadmap.md): nem todo aparelho ativado consegue
-- virar "dono do aparelho" (Device Owner) - só é possível em aparelho sem
-- nenhuma conta configurada ainda (aparelho novo). Aparelho já em uso ativa
-- normalmente, mas sem essa condição, e por isso não pode receber os
-- comandos remotos administrativos (bloquear/reiniciar/apagar), que exigem
-- Device Owner no Android. Esta coluna é o que o painel usa para
-- mostrar/esconder esses botões por aparelho, em vez de mandar um comando
-- que o app silenciosamente ignora sem nenhuma explicação visível.
alter table public.devices
  add column if not exists device_owner boolean not null default false;

comment on column public.devices.device_owner is
  'Preenchido pelo app no enrollment: true quando o Android concedeu "dono do aparelho" a este app neste aparelho (exigido para lock/reboot/wipe remotos). false em aparelho que já tinha conta configurada antes de instalar (não dá pra conseguir sem reset de fábrica).';
