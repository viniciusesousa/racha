-- =====================================================================
-- App do Racha — teste de limpeza (SÓ NO racha-teste)
-- =====================================================================
-- Confere que o administrador consegue, pelo SQL Editor (sem login),
-- apagar um racha de teste que tem lances.
--
-- PARTE 1 (simulando o admin logado): cria o racha de 29/10/2026 com
--          presenças, times, um gol com assistência e um gol contra, e GRAVA.
-- PARTE 2 (sem login, como no SQL Editor): apaga as cobranças e o racha.
--          Lances, escalações, presenças e a partida saem junto.
--
-- Rode o arquivo inteiro de uma vez. No fim deve aparecer:
--   "LIMPEZA OK: racha de teste com lances apagado sem login".
-- =====================================================================

-- ---------------------------------------------------------------------
-- PARTE 1: criar o racha de teste (como admin)
-- ---------------------------------------------------------------------
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id from public.administradores limit 1), 'role', 'authenticated')::text,
  true);
set local role authenticated;

do $$
declare v_racha integer; v_partida integer;
begin
  if not public.eh_admin() then
    raise exception 'Pré-requisito: inclua seu usuário de teste na tabela administradores.';
  end if;
  select racha_id, partida_id into v_racha, v_partida from public.abrir_racha('2026-10-29');
  perform public.definir_status_dia(v_racha, n, 'presente') from generate_series(1, 4) n;
  perform public.definir_equipe(v_racha, 1, 'A');
  perform public.definir_equipe(v_racha, 2, 'A');
  perform public.definir_equipe(v_racha, 3, 'B');
  perform public.definir_equipe(v_racha, 4, 'B');
  insert into public.lances (partida_id, tipo, autor_id, assistencia_id) values (v_partida, 'gol', 1, 2);
  insert into public.lances (partida_id, tipo, autor_id) values (v_partida, 'gol_contra', 3);
  raise notice 'parte 1 ok: racha 29/10 criado com % lances', (select count(*) from public.lances where partida_id = v_partida);
end $$;
commit;

-- ---------------------------------------------------------------------
-- PARTE 2: apagar pelo SQL Editor, sem login
-- ---------------------------------------------------------------------
begin;
do $$
declare v_racha integer;
begin
  if auth.uid() is not null then
    raise exception 'A parte 2 deve rodar SEM usuário logado.';
  end if;
  select id into v_racha from public.rachas where data_jogo = '2026-10-29';
  if v_racha is null then
    raise exception 'Racha de 29/10 não encontrado (a parte 1 falhou?).';
  end if;

  -- Cobranças protegem o histórico financeiro (não deixam apagar o racha):
  -- numa limpeza consciente, elas saem primeiro.
  delete from public.cobrancas where racha_id = v_racha;
  delete from public.rachas where id = v_racha;

  if exists (select 1 from public.rachas where id = v_racha)
     or exists (select 1 from public.partidas where racha_id = v_racha)
     or exists (select 1 from public.presencas where racha_id = v_racha) then
    raise exception 'FALHOU: sobrou algo do racha de teste.';
  end if;
  raise notice 'LIMPEZA OK: racha de teste com lances apagado sem login';
end $$;
commit;
