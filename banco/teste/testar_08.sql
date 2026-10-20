-- =====================================================================
-- App do Racha — teste automático do 08_area_admin.sql (SÓ NO racha-teste)
-- =====================================================================
-- Simula o administrador logado e confere, uma a uma, as regras do 08:
-- lances, validações de time, soma/subtração nas escalações, bloqueios e
-- permissões. Ao final mostra "TODOS OS TESTES PASSARAM".
--
-- NADA FICA GRAVADO: tudo roda dentro de uma transação que termina em
-- ROLLBACK (desfazer).
--
-- Pré-requisitos no racha-teste: 01, 03, 04, 06, 08, popular_racha_teste.sql
-- e o seu usuário de teste incluído na tabela administradores.
-- =====================================================================

begin;

-- Simula o admin logado (o primeiro usuário da tabela administradores).
select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id from public.administradores limit 1), 'role', 'authenticated')::text,
  true);
set local role authenticated;

do $$
declare
  v_racha integer; v_partida integer; v_existia boolean;
  v_ok boolean;
  v_num integer;
  v_a integer; v_b integer;
begin
  if not public.eh_admin() then
    raise exception 'Pré-requisito: inclua seu usuário de teste na tabela administradores.';
  end if;

  -- 1. Abrir racha (novo) e abrir de novo (já existe)
  select racha_id, partida_id, ja_existia into v_racha, v_partida, v_existia
  from public.abrir_racha('2026-10-22');
  if v_existia then raise exception 'FALHOU 1a: racha novo veio como existente'; end if;
  select ja_existia into v_existia from public.abrir_racha('2026-10-22');
  if not v_existia then raise exception 'FALHOU 1b: data repetida não foi detectada'; end if;
  if (select valor_cobrado from public.rachas where id = v_racha) <> 15 then
    raise exception 'FALHOU 1c: valor padrão não veio das configurações'; end if;
  raise notice 'ok 1: abrir racha';

  -- 2. Status do dia
  perform public.definir_status_dia(v_racha, n, 'presente') from generate_series(1, 4) n;
  perform public.definir_status_dia(v_racha, 21, 'goleiro');
  perform public.definir_status_dia(v_racha, 5, 'faltou');
  if (select count(*) from public.presencas where racha_id = v_racha) <> 5 then raise exception 'FALHOU 2a: presenças'; end if;
  if (select count(*) from public.cobrancas where racha_id = v_racha) <> 5 then raise exception 'FALHOU 2b: cobranças (4 presentes + 1 faltou)'; end if;
  if exists (select 1 from public.cobrancas where racha_id = v_racha and jogador_id = 21) then raise exception 'FALHOU 2c: goleiro foi cobrado'; end if;
  perform public.definir_status_dia(v_racha, 4, 'goleiro');
  if exists (select 1 from public.cobrancas where racha_id = v_racha and jogador_id = 4) then raise exception 'FALHOU 2d: presente->goleiro manteve cobrança'; end if;
  perform public.definir_status_dia(v_racha, 4, 'presente');
  raise notice 'ok 2: presente / goleiro / faltou';

  -- 3. Times
  perform public.definir_equipe(v_racha, 1, 'A');
  perform public.definir_equipe(v_racha, 2, 'A');
  perform public.definir_equipe(v_racha, 21, 'A');
  perform public.definir_equipe(v_racha, 3, 'B');
  perform public.definir_equipe(v_racha, 4, 'B');
  v_ok := false;
  begin perform public.definir_equipe(v_racha, 5, 'A'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 3a: quem faltou entrou num time'; end if;
  raise notice 'ok 3: times';

  -- 4. Lances válidos e inválidos
  insert into public.lances (partida_id, tipo, autor_id, assistencia_id) values (v_partida, 'gol', 1, 2);
  if (select gols from public.escalacoes where partida_id = v_partida and jogador_id = 1) <> 1 then raise exception 'FALHOU 4a: gol não somou'; end if;
  if (select assistencias from public.escalacoes where partida_id = v_partida and jogador_id = 2) <> 1 then raise exception 'FALHOU 4b: assistência não somou'; end if;
  v_ok := false;
  begin insert into public.lances (partida_id, tipo, autor_id, assistencia_id) values (v_partida, 'gol', 1, 3); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 4c: aceitou assistência do outro time no gol'; end if;
  v_ok := false;
  begin insert into public.lances (partida_id, tipo, autor_id) values (v_partida, 'gol', 6); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 4d: aceitou gol de quem não está escalado'; end if;
  insert into public.lances (partida_id, tipo, autor_id, assistencia_id) values (v_partida, 'gol_contra', 3, 1);
  v_ok := false;
  begin insert into public.lances (partida_id, tipo, autor_id, assistencia_id) values (v_partida, 'gol_contra', 3, 4); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 4e: aceitou assistência do mesmo time no gol contra'; end if;
  select gols_a, gols_b into v_a, v_b from public.v_placar_partidas where partida_id = v_partida;
  if v_a <> 2 or v_b <> 0 then raise exception 'FALHOU 4f: placar % x % (esperado 2 x 0)', v_a, v_b; end if;
  raise notice 'ok 4: lances e placar (A 2 x 0 B)';

  -- 5. Bloqueios para quem tem lances
  v_ok := false;
  begin perform public.definir_equipe(v_racha, 3, 'A'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 5a: trocou de time quem tem lances'; end if;
  v_ok := false;
  begin perform public.definir_status_dia(v_racha, 1, 'nenhum'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 5b: removeu do dia quem tem lances'; end if;
  v_ok := false;
  begin perform public.definir_status_dia(v_racha, 1, 'faltou'); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 5c: marcou falta em quem tem lances'; end if;
  v_ok := false;
  begin update public.lances set autor_id = 2 where partida_id = v_partida; exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 5d: permitiu editar lance'; end if;
  raise notice 'ok 5: bloqueios';

  -- 6. Desfazer
  perform public.desfazer_ultimo_lance(v_partida);  -- tira o gol contra
  if (select gols_contra from public.escalacoes where partida_id = v_partida and jogador_id = 3) <> 0 then raise exception 'FALHOU 6a: gol contra não subtraiu'; end if;
  perform public.desfazer_ultimo_lance(v_partida);  -- tira o gol
  if (select sum(gols + assistencias) from public.escalacoes where partida_id = v_partida and jogador_id in (1, 2)) <> 0 then
    raise exception 'FALHOU 6b: gol/assistência não subtraíram'; end if;
  v_ok := false;
  begin perform public.desfazer_ultimo_lance(v_partida); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 6c: desfez sem haver lances'; end if;
  -- Depois de desfazer, já pode remover/trocar.
  perform public.definir_equipe(v_racha, 3, 'A');
  perform public.definir_status_dia(v_racha, 1, 'nenhum');
  raise notice 'ok 6: desfazer e liberar';

  -- 7. Saldos
  select saldo into v_num from public.v_saldos_jogadores where jogador_id = 5;
  if v_num is null or v_num < 15 then raise exception 'FALHOU 7: saldo do jogador 5 não inclui a falta de última hora'; end if;
  raise notice 'ok 7: saldos';

  raise notice '=== TODOS OS TESTES DE ADMIN PASSARAM ===';
end $$;

-- 8. Sem login (anon) não executa as funções nem vê saldos.
reset role;
set local role anon;
do $$
declare v_ok boolean := false;
begin
  begin perform public.abrir_racha('2026-10-29'); exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 8a: anon executou abrir_racha'; end if;
  v_ok := false;
  begin perform 1 from public.v_saldos_jogadores; exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 8b: anon leu os saldos'; end if;
  raise notice 'ok 8: sem login não acessa';
  raise notice '=== TODOS OS TESTES PASSARAM ===';
end $$;

rollback;  -- desfaz tudo: o banco de teste volta ao que era
