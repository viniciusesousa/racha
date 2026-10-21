-- =====================================================================
-- App do Racha — teste automático do 09_caixa_contas.sql (SÓ NO racha-teste)
-- =====================================================================
-- Simula o administrador logado e confere as regras do 09: despesa da
-- quadra ao abrir racha, conta de cada forma de pagamento, transferência,
-- regras da tabela movimentos_conta, saldos por conta e permissões.
-- Ao final mostra uma TABELA com 6 itens "OK" (só aparece se todos
-- passarem; qualquer falha mostra um erro vermelho "FALHOU ...").
--
-- NADA FICA GRAVADO: tudo termina em ROLLBACK (desfazer).
-- Pré-requisitos no racha-teste: 01, 03, 04, 06, 08, 09 e popular_racha_teste.sql.
-- =====================================================================

begin;

select set_config('request.jwt.claims',
  json_build_object('sub', (select user_id from public.administradores limit 1), 'role', 'authenticated')::text,
  true);
set local role authenticated;

do $$
declare
  v_racha integer; v_partida integer; v_existia boolean;
  v_banco0 numeric; v_quadra0 numeric; v_banco numeric; v_quadra numeric;
  v_n integer; v_ok boolean; v_jog integer;
begin
  if not public.eh_admin() then
    raise exception 'Pré-requisito: inclua seu usuário de teste na tabela administradores.';
  end if;
  select saldo into v_banco0 from public.v_saldo_contas where conta = 'banco';
  select saldo into v_quadra0 from public.v_saldo_contas where conta = 'quadra';
  select min(id) into v_jog from public.jogadores;

  -- 1. Abrir racha novo lança a quadra (R$ 185, conta quadra, ligada ao racha);
  --    abrir de novo a mesma data não lança outra.
  select racha_id, partida_id, ja_existia into v_racha, v_partida, v_existia from public.abrir_racha('2030-01-03');
  select count(*) into v_n from public.despesas
   where racha_id = v_racha and conta = 'quadra' and categoria = 'Quadra' and valor = 185;
  if v_n <> 1 then raise exception 'FALHOU 1a: despesa da quadra não foi lançada (achou %)', v_n; end if;
  perform public.abrir_racha('2030-01-03');
  select count(*) into v_n from public.despesas where racha_id = v_racha;
  if v_n <> 1 then raise exception 'FALHOU 1b: abrir de novo lançou outra quadra'; end if;
  select saldo into v_quadra from public.v_saldo_contas where conta = 'quadra';
  if v_quadra <> v_quadra0 - 185 then raise exception 'FALHOU 1c: crédito na quadra não caiu R$ 185'; end if;
  -- valor_quadra = 0: não lança nada
  update public.configuracoes set valor_quadra = 0;
  select racha_id into v_racha from public.abrir_racha('2030-01-10');
  if exists (select 1 from public.despesas where racha_id = v_racha) then raise exception 'FALHOU 1d: lançou quadra com valor 0'; end if;
  update public.configuracoes set valor_quadra = 185;
  -- não deixa excluir racha com despesa ligada (on delete restrict)
  select racha_id into v_racha from public.abrir_racha('2030-01-03');
  v_ok := false;
  begin delete from public.rachas where id = v_racha; exception when foreign_key_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 1e: excluiu racha que tinha despesa da quadra'; end if;
  raise notice 'ok 1';

  -- 2. Conta de cada forma: pix -> banco; dinheiro, cartão e dinheiro_ou_cartao -> quadra.
  select saldo into v_banco0 from public.v_saldo_contas where conta = 'banco';
  select saldo into v_quadra0 from public.v_saldo_contas where conta = 'quadra';
  insert into public.pagamentos (jogador_id, valor, forma, data_pagamento) values
    (v_jog, 15, 'pix', '2030-01-03'), (v_jog, 10, 'dinheiro', '2030-01-03'),
    (v_jog, 7, 'cartao', '2030-01-03'), (v_jog, 5, 'dinheiro_ou_cartao', '2030-01-03');
  select saldo into v_banco from public.v_saldo_contas where conta = 'banco';
  select saldo into v_quadra from public.v_saldo_contas where conta = 'quadra';
  if v_banco <> v_banco0 + 15 or v_quadra <> v_quadra0 + 22 then
    raise exception 'FALHOU 2: banco +% (esperado +15), quadra +% (esperado +22)', v_banco - v_banco0, v_quadra - v_quadra0;
  end if;
  raise notice 'ok 2';

  -- 3. Despesa no banco (padrão) e na quadra; transferência banco -> quadra
  --    (não muda o total); entrada avulsa, rendimento e saldo inicial.
  select saldo into v_banco0 from public.v_saldo_contas where conta = 'banco';
  select saldo into v_quadra0 from public.v_saldo_contas where conta = 'quadra';
  insert into public.despesas (data, descricao, categoria, valor) values ('2030-01-03', 'Goleiro de aluguel', 'Goleiro de aluguel', 37.49);
  insert into public.despesas (data, descricao, categoria, valor, conta) values ('2030-01-03', 'Coletes', 'Material', 20, 'quadra');
  insert into public.movimentos_conta (data, tipo, conta_origem, conta_destino, valor, descricao) values
    ('2030-01-04', 'transferencia', 'banco', 'quadra', 100, 'Adiantamento'),
    ('2030-01-04', 'entrada_avulsa', null, 'banco', 30, 'Reembolso'),
    ('2030-01-04', 'rendimento', null, 'banco', 2.51, 'Rendimento');
  select saldo into v_banco from public.v_saldo_contas where conta = 'banco';
  select saldo into v_quadra from public.v_saldo_contas where conta = 'quadra';
  if v_banco <> v_banco0 - 37.49 - 100 + 30 + 2.51 or v_quadra <> v_quadra0 - 20 + 100 then
    raise exception 'FALHOU 3a: banco %, quadra % (variação errada)', v_banco - v_banco0, v_quadra - v_quadra0;
  end if;
  if (select count(*) from public.v_extrato_caixa where origem = 'movimento' and detalhe = 'transferencia') <> 2 then
    raise exception 'FALHOU 3b: transferência deve aparecer 2 vezes no extrato (− origem, + destino)';
  end if;
  -- saldo inicial negativo é aceito (crédito na quadra usado a mais)
  insert into public.movimentos_conta (data, tipo, conta_destino, valor, descricao)
  values ('2026-07-01', 'saldo_inicial', 'quadra', -50, 'Saldo inicial de teste');
  if (select saldo from public.v_saldo_contas where conta = 'quadra') <> v_quadra - 50 then
    raise exception 'FALHOU 3c: saldo inicial negativo não entrou no saldo';
  end if;
  raise notice 'ok 3';

  -- 4. Regras da tabela movimentos_conta (cada uma deve ser RECUSADA).
  v_ok := false;
  begin insert into public.movimentos_conta (tipo, conta_destino, valor, descricao) values ('transferencia', 'quadra', 10, 'x');
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 4a: transferência sem conta de origem foi aceita'; end if;
  v_ok := false;
  begin insert into public.movimentos_conta (tipo, conta_origem, conta_destino, valor, descricao) values ('transferencia', 'banco', 'banco', 10, 'x');
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 4b: transferência para a mesma conta foi aceita'; end if;
  v_ok := false;
  begin insert into public.movimentos_conta (tipo, conta_origem, conta_destino, valor, descricao) values ('rendimento', 'banco', 'quadra', 10, 'x');
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 4c: rendimento com conta de origem foi aceito'; end if;
  v_ok := false;
  begin insert into public.movimentos_conta (tipo, conta_destino, valor, descricao) values ('rendimento', 'banco', -5, 'x');
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 4d: rendimento negativo foi aceito'; end if;
  v_ok := false;
  begin insert into public.movimentos_conta (tipo, conta_destino, valor, descricao) values ('saldo_inicial', 'quadra', 10, 'segundo');
  exception when unique_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 4e: segundo saldo inicial da mesma conta foi aceito'; end if;
  v_ok := false;
  begin insert into public.despesas (descricao, valor, conta) values ('x', 1, 'caixinha');
  exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 4f: despesa com conta inválida foi aceita'; end if;
  raise notice 'ok 4';

  -- 5. Saldo por conta = soma do extrato (as duas contas sempre aparecem).
  if (select count(*) from public.v_saldo_contas) <> 2 then raise exception 'FALHOU 5a: v_saldo_contas deve ter 2 linhas'; end if;
  if exists (
    select 1 from public.v_saldo_contas s
    where s.saldo <> (select coalesce(sum(e.valor), 0) from public.v_extrato_caixa e where e.conta = s.conta)
  ) then raise exception 'FALHOU 5b: saldo diferente da soma do extrato'; end if;
  raise notice 'ok 5';
end $$;

-- 6. Sem login (anon) não vê movimentos, extrato nem saldos.
reset role;
set local role anon;
do $$
declare v_ok boolean;
begin
  v_ok := false;
  begin perform 1 from public.movimentos_conta; exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 6a: anon leu movimentos_conta'; end if;
  v_ok := false;
  begin perform 1 from public.v_saldo_contas; exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 6b: anon leu v_saldo_contas'; end if;
  v_ok := false;
  begin perform 1 from public.v_extrato_caixa; exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FALHOU 6c: anon leu v_extrato_caixa'; end if;
end $$;

reset role;
select item, resultado from (values
  (1, '1. Abrir racha lança a quadra (R$ 185, crédito na quadra); repetir a data não duplica; valor 0 não lança; racha com despesa não pode ser excluído', 'OK'),
  (2, '2. Pix entra no Banco; dinheiro, cartão e dinheiro/cartão entram no Crédito na quadra', 'OK'),
  (3, '3. Despesas por conta, transferência (− origem, + destino), entrada avulsa, rendimento e saldo inicial negativo', 'OK'),
  (4, '4. Regras recusam: transferência sem origem/mesma conta, rendimento negativo ou com origem, 2º saldo inicial, conta inválida', 'OK'),
  (5, '5. Saldo de cada conta = soma do extrato', 'OK'),
  (6, '6. Sem login: movimentos, extrato e saldos recusados', 'OK')
) as t(ordem, item, resultado) order by ordem;

rollback;  -- desfaz tudo: o banco de teste volta ao que era
