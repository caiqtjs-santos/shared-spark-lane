-- Corrige a política de INSERT de session_inputs criada em
-- 20261005181500_screen_mirroring.sql.
--
-- Lá o WITH CHECK usava `s.device_id = device_id` sem qualificar a segunda
-- coluna. Dentro do subselect o Postgres resolve `device_id` para a própria
-- access_sessions, então a condição virava `s.device_id = s.device_id`
-- (sempre verdadeira). Resultado: quem tivesse uma sessão de controle ativa
-- no próprio aparelho conseguia gravar um toque apontando para o device_id
-- de OUTRO aparelho - e a rota /api/public/agent/input entrega os toques
-- filtrando só por device_id.
--
-- Aqui as colunas da linha nova são qualificadas com o nome da tabela, para
-- o aparelho do toque ter de ser o mesmo aparelho da sessão.

drop policy if exists "session_inputs_insert_own_or_ti" on public.session_inputs;

create policy "session_inputs_insert_own_or_ti" on public.session_inputs for insert to authenticated
  with check (
    exists (
      select 1 from public.access_sessions s
      where s.id = session_inputs.session_id
        and s.device_id = session_inputs.device_id
        and s.status = 'ativa'
        and s.mode = 'controle'
        and (s.requested_by_user_id = auth.uid() or public.has_role(auth.uid(), 'ti'))
    )
  );
