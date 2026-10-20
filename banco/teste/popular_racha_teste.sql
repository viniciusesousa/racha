-- =====================================================================
-- App do Racha — dados FICTÍCIOS para o projeto de teste (racha-teste)
-- =====================================================================
-- Só nomes inventados ("Jogador Teste N"): nenhum dado real.
-- Serve para testar a área do admin sem mexer no banco de verdade.
--
-- ORDEM no projeto racha-teste (SQL Editor):
--   01_estrutura.sql -> 03_visoes_rankings.sql -> 04_fotos_e_participacoes.sql
--   -> 06_ajustes_estrutura.sql -> 08_area_admin.sql -> ESTE ARQUIVO.
--
-- Trava de segurança: só roda se a tabela de jogadores estiver VAZIA
-- (impede rodar por engano no banco real).
-- Pode ser rodado de novo depois de "zerar" o banco de teste.
-- =====================================================================

begin;

do $$
declare
  v_r1 integer; v_p1 integer;   -- racha de 08/10/2026 (fictício)
  v_r2 integer; v_p2 integer;   -- racha de 15/10/2026 (fictício)
begin
  if exists (select 1 from public.jogadores) then
    raise exception 'A tabela de jogadores não está vazia: este script é só para o banco de TESTE vazio.';
  end if;

  -- Valor padrão do racha.
  update public.configuracoes set valor_padrao_racha = 15;

  -- 20 jogadores de linha, 2 goleiros e 1 "convidado" (agora jogador de linha).
  insert into public.jogadores (id, nome, posicao, tipo, ativo)
  select n, 'Jogador Teste ' || n,
         (array['Atacante', 'Meio Campo', 'Zagueiro'])[1 + n % 3], 'linha', true
  from generate_series(1, 20) as n;
  insert into public.jogadores (id, nome, posicao, tipo, ativo) values
    (21, 'Goleiro Teste 1', 'Goleiro', 'goleiro', true),
    (22, 'Goleiro Teste 2', 'Goleiro', 'goleiro', true),
    (23, 'Convidado Teste', null, 'linha', true);
  perform setval(pg_get_serial_sequence('public.jogadores', 'id'), 23);

  -- Dois rachas passados, com times e números, para testar rankings,
  -- devedores e caixa. (Os lances são testados ao vivo na área do admin.)
  insert into public.rachas (data_jogo, valor_cobrado, situacao, origem, tem_times)
  values ('2026-10-08', 15, 'realizado', 'app', true) returning id into v_r1;
  insert into public.partidas (racha_id, numero) values (v_r1, 1) returning id into v_p1;
  insert into public.rachas (data_jogo, valor_cobrado, situacao, origem, tem_times)
  values ('2026-10-15', 15, 'realizado', 'app', true) returning id into v_r2;
  insert into public.partidas (racha_id, numero) values (v_r2, 1) returning id into v_p2;

  -- Racha 1: jogadores 1–18 (A = 1..9, B = 10..18) + goleiros 21 (A) e 22 (B).
  insert into public.escalacoes (partida_id, jogador_id, equipe, gols, assistencias)
  select v_p1, n, case when n <= 9 then 'A' else 'B' end,
         case when n in (1, 2, 10) then 2 when n in (3, 11, 12) then 1 else 0 end,
         case when n in (4, 13) then 1 else 0 end
  from generate_series(1, 18) as n;
  insert into public.escalacoes (partida_id, jogador_id, equipe) values (v_p1, 21, 'A'), (v_p1, 22, 'B');
  insert into public.presencas (racha_id, jogador_id, atuou_como_goleiro)
  select v_r1, n, n in (21, 22) from unnest(array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,21,22]) as n;
  insert into public.cobrancas (racha_id, jogador_id, valor)
  select v_r1, n, 15 from generate_series(1, 18) as n;

  -- Racha 2: jogadores 3–20 + convidado 23 (A = 3..11, B = 12..20 e 23).
  insert into public.escalacoes (partida_id, jogador_id, equipe, gols, assistencias)
  select v_p2, n, case when n <= 11 then 'A' else 'B' end,
         case when n in (5, 14) then 2 when n in (6, 15, 23) then 1 else 0 end,
         case when n in (7, 16) then 1 else 0 end
  from unnest(array[3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,23]) as n;
  insert into public.presencas (racha_id, jogador_id, atuou_como_goleiro)
  select v_r2, n, false from unnest(array[3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,23]) as n;
  insert into public.cobrancas (racha_id, jogador_id, valor)
  select v_r2, n, 15 from unnest(array[3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,23]) as n;
  -- Jogador Teste 1 faltou de última hora no racha 2: cobrança sem presença.
  insert into public.cobrancas (racha_id, jogador_id, valor) values (v_r2, 1, 15);

  -- Pagamentos: a maioria pagou; alguns ficaram devendo; um pagou adiantado.
  insert into public.pagamentos (jogador_id, valor, forma, data_pagamento, observacao)
  select n, 15, (array['pix', 'dinheiro', 'cartao'])[1 + n % 3], '2026-10-08', 'Teste'
  from generate_series(1, 14) as n;
  insert into public.pagamentos (jogador_id, valor, forma, data_pagamento, observacao)
  select n, 15, 'pix', '2026-10-15', 'Teste'
  from generate_series(5, 16) as n;
  insert into public.pagamentos (jogador_id, valor, forma, data_pagamento, observacao)
  values (20, 45, 'pix', '2026-10-15', 'Teste: pagou adiantado');

  -- Uma despesa de exemplo no caixa.
  insert into public.despesas (data, descricao, categoria, valor)
  values ('2026-10-10', 'Aluguel da quadra (teste)', 'Quadra', 200);
end $$;

commit;
