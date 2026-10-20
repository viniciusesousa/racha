-- =====================================================================
-- App do Racha — visões de placar, estatísticas e sequências
-- =====================================================================
-- Uma "visão" (view) é uma consulta salva no banco com nome próprio.
-- Ela não guarda números: cada vez que alguém consulta, o banco recalcula
-- tudo a partir dos lançamentos (escalações, presenças e ajustes).
-- Assim os rankings estão sempre certos, sem nenhum total fixo guardado.
--
-- Regras seguidas aqui:
--   * Todas as visões usam "security_invoker = true": a visão obedece às
--     regras de acesso (RLS) de QUEM CONSULTA, e não às de quem a criou.
--   * Só usam tabelas públicas: jogadores, rachas, partidas, escalacoes,
--     presencas e ajustes. Nunca tocam no financeiro.
--
-- Deve ser executado UMA VEZ no SQL Editor do Supabase, depois dos
-- scripts 01 e 02 (que já foram carregados).
-- Tudo fica dentro de uma transação: se algo der erro, nada é criado.
-- =====================================================================

begin;


-- =====================================================================
-- 1. v_placar_partidas — placar e resultado de cada partida
-- =====================================================================
-- Placar de uma equipe = gols dos seus jogadores
--                      + gols contra feitos pelos jogadores da equipe adversária.
-- Rachas sem times (os recuperados) ficam com placar e resultado vazios.
-- Resultado: 'A' (vitória da equipe A), 'B' (vitória da B) ou 'empate'.
create view public.v_placar_partidas
with (security_invoker = true) as
with somas as (
  -- Soma, por partida, os gols e gols contra de cada equipe.
  select
    p.id         as partida_id,
    p.racha_id,
    p.numero,
    r.data_jogo,
    r.origem,
    r.tem_times,
    coalesce(sum(e.gols)        filter (where e.equipe = 'A'), 0) as gols_equipe_a,
    coalesce(sum(e.gols)        filter (where e.equipe = 'B'), 0) as gols_equipe_b,
    coalesce(sum(e.gols_contra) filter (where e.equipe = 'A'), 0) as contra_feitos_por_a,
    coalesce(sum(e.gols_contra) filter (where e.equipe = 'B'), 0) as contra_feitos_por_b
  from public.partidas p
  join public.rachas r          on r.id = p.racha_id
  left join public.escalacoes e on e.partida_id = p.id
  group by p.id, p.racha_id, p.numero, r.data_jogo, r.origem, r.tem_times
),
placar as (
  -- Monta o placar final. Sem times, o placar fica vazio (null).
  select
    partida_id, racha_id, numero, data_jogo, origem, tem_times,
    case when tem_times then gols_equipe_a + contra_feitos_por_b end as gols_a,
    case when tem_times then gols_equipe_b + contra_feitos_por_a end as gols_b
  from somas
)
select
  partida_id, racha_id, numero, data_jogo, origem, tem_times, gols_a, gols_b,
  case
    when not tem_times  then null
    when gols_a > gols_b then 'A'
    when gols_b > gols_a then 'B'
    else 'empate'
  end as resultado
from placar;

comment on view public.v_placar_partidas is
  'Placar e resultado de cada partida (vazio nos rachas sem times).';


-- =====================================================================
-- 2. v_estatisticas_jogadores — números de cada jogador
-- =====================================================================
-- Uma linha por jogador cadastrado (inclusive convidados e quem ainda não
-- jogou, com zeros). A coluna "tipo" permite identificar os convidados.
--
-- Os ajustes manuais da tabela ajustes já vêm somados, por tipo:
--   presenças, gols, assistências e vitórias.
--
-- Vitórias, empates, derrotas e aproveitamento só contam partidas COM times
-- (nas outras não existe resultado). Aproveitamento segue o padrão do
-- futebol: pontos ganhos ÷ pontos possíveis, com vitória = 3 e empate = 1.
-- O aproveitamento usa só os jogos de verdade (sem os ajustes de vitórias),
-- porque um ajuste não tem jogo correspondente e distorceria a conta.
create view public.v_estatisticas_jogadores
with (security_invoker = true) as
with jogos as (
  -- Cada participação do jogador em uma partida, já com o resultado.
  select
    e.jogador_id,
    e.gols,
    e.assistencias,
    e.gols_contra,
    -- Só é "jogo com resultado" se o racha tem times e o jogador tem equipe.
    (pl.tem_times and e.equipe is not null) as com_times,
    case
      when not pl.tem_times or e.equipe is null then null
      when pl.resultado = 'empate'              then 'E'
      when pl.resultado = e.equipe              then 'V'
      else 'D'
    end as resultado
  from public.escalacoes e
  join public.v_placar_partidas pl on pl.partida_id = e.partida_id
),
por_jogador as (
  -- Totais vindos das partidas.
  select
    jogador_id,
    count(*)                                  as partidas_jogadas,
    sum(gols)                                 as gols,
    sum(assistencias)                         as assistencias,
    sum(gols_contra)                          as gols_contra,
    count(*) filter (where com_times)         as partidas_com_times,
    count(*) filter (where resultado = 'V')   as vitorias,
    count(*) filter (where resultado = 'E')   as empates,
    count(*) filter (where resultado = 'D')   as derrotas
  from jogos
  group by jogador_id
),
presencas_jogador as (
  -- Em quantos rachas DIFERENTES o jogador esteve presente.
  -- Conta como presente quem:
  --   (a) está na tabela presencas daquele racha, OU
  --   (b) tem escalação em alguma partida daquele racha — se jogou
  --       (fez gol, assistência, gol contra ou apenas entrou em campo),
  --       é porque estava lá.
  -- Isso recupera a presença nos rachas reconstruídos de anotações, que
  -- só têm a lista de quem jogou. O "union" junta as duas listas e
  -- descarta repetições, então quem aparece nas duas conta uma vez só.
  select jogador_id, count(distinct racha_id) as presencas
  from (
    select pr.jogador_id, pr.racha_id
    from public.presencas pr
    union
    select e.jogador_id, p.racha_id
    from public.escalacoes e
    join public.partidas p on p.id = e.partida_id
  ) as presentes
  group by jogador_id
),
ajustes_jogador as (
  -- Soma dos ajustes manuais, separada por tipo.
  select
    jogador_id,
    coalesce(sum(quantidade) filter (where tipo = 'presencas'),    0) as aj_presencas,
    coalesce(sum(quantidade) filter (where tipo = 'gols'),         0) as aj_gols,
    coalesce(sum(quantidade) filter (where tipo = 'assistencias'), 0) as aj_assistencias,
    coalesce(sum(quantidade) filter (where tipo = 'vitorias'),     0) as aj_vitorias
  from public.ajustes
  group by jogador_id
),
totais as (
  -- Junta tudo por jogador. "coalesce(x, 0)" troca vazio por zero.
  select
    j.id   as jogador_id,
    j.nome,
    j.apelido,
    j.tipo,
    j.ativo,
    coalesce(pr.presencas, 0)    + coalesce(a.aj_presencas, 0)    as presencas,
    coalesce(pj.partidas_jogadas, 0)                              as partidas_jogadas,
    coalesce(pj.gols, 0)         + coalesce(a.aj_gols, 0)         as gols,
    coalesce(pj.assistencias, 0) + coalesce(a.aj_assistencias, 0) as assistencias,
    coalesce(pj.gols_contra, 0)                                   as gols_contra,
    coalesce(pj.partidas_com_times, 0)                            as partidas_com_times,
    coalesce(pj.vitorias, 0)     + coalesce(a.aj_vitorias, 0)     as vitorias,
    coalesce(pj.empates, 0)                                       as empates,
    coalesce(pj.derrotas, 0)                                      as derrotas,
    -- Vitórias só das partidas (sem ajuste), para o aproveitamento.
    coalesce(pj.vitorias, 0)                                      as vitorias_em_partidas
  from public.jogadores j
  left join por_jogador pj on pj.jogador_id = j.id
  left join presencas_jogador pr on pr.jogador_id = j.id
  left join ajustes_jogador   a  on a.jogador_id  = j.id
)
select
  jogador_id, nome, apelido, tipo, ativo,
  presencas,
  partidas_jogadas,
  gols,
  assistencias,
  gols + assistencias as participacoes_em_gol,
  gols_contra,
  partidas_com_times,
  vitorias,
  empates,
  derrotas,
  -- Aproveitamento em %, com 1 casa decimal. Vazio para quem não jogou
  -- nenhuma partida com times (evita divisão por zero).
  case
    when partidas_com_times > 0 then
      round(100.0 * (3 * vitorias_em_partidas + empates) / (3 * partidas_com_times), 1)
  end as aproveitamento
from totais;

comment on view public.v_estatisticas_jogadores is
  'Presenças, gols, assistências, vitórias, empates, derrotas e aproveitamento por jogador, já com os ajustes.';


-- =====================================================================
-- 3. v_sequencias — vitórias seguidas
-- =====================================================================
-- Para cada jogador, olhando só as partidas com times, em ordem de data:
--   * sequencia_atual: quantas vitórias seguidas ele tem nos seus jogos
--     mais recentes (zera ao empatar ou perder);
--   * melhor_sequencia: a maior sequência de vitórias seguidas que ele já teve.
-- A sequência conta os jogos DO JOGADOR: faltar a um racha não quebra a sequência.
-- Empate quebra a sequência (não é vitória).
-- Ajustes manuais de vitórias não entram aqui, porque não têm data de jogo.
create view public.v_sequencias
with (security_invoker = true) as
with jogos as (
  -- Partidas com times do jogador, numeradas em ordem de data.
  select
    e.jogador_id,
    (pl.resultado = e.equipe) as venceu,
    row_number() over (partition by e.jogador_id
                       order by pl.data_jogo, pl.numero) as ordem
  from public.escalacoes e
  join public.v_placar_partidas pl on pl.partida_id = e.partida_id
  where pl.tem_times and e.equipe is not null
),
blocos as (
  -- Truque para agrupar vitórias seguidas: dentro de um bloco de vitórias
  -- consecutivas, "ordem − posição entre as vitórias" dá sempre o mesmo número.
  select
    jogador_id, venceu, ordem,
    ordem - row_number() over (partition by jogador_id, venceu order by ordem) as bloco
  from jogos
),
tamanhos as (
  -- Tamanho de cada bloco de vitórias seguidas e o último jogo dele.
  select jogador_id, bloco, count(*) as tamanho, max(ordem) as ultimo_jogo
  from blocos
  where venceu
  group by jogador_id, bloco
),
ultimo as (
  -- Último jogo com times de cada jogador.
  select jogador_id, max(ordem) as ultimo_jogo
  from jogos
  group by jogador_id
)
select
  j.id   as jogador_id,
  j.nome,
  j.apelido,
  j.tipo,
  -- Sequência atual: o bloco de vitórias que termina no último jogo dele.
  coalesce((select t.tamanho from tamanhos t
            where t.jogador_id = j.id and t.ultimo_jogo = u.ultimo_jogo), 0)
    as sequencia_atual,
  -- Melhor sequência: o maior bloco de vitórias que ele já teve.
  coalesce((select max(t.tamanho) from tamanhos t where t.jogador_id = j.id), 0)
    as melhor_sequencia
from public.jogadores j
left join ultimo u on u.jogador_id = j.id;

comment on view public.v_sequencias is
  'Sequência atual e melhor sequência de vitórias seguidas de cada jogador.';


-- =====================================================================
-- PERMISSÕES
-- =====================================================================
-- Qualquer pessoa (com ou sem login) pode consultar as três visões.
-- Como elas usam "security_invoker", o banco continua aplicando o RLS
-- das tabelas por trás — e todas elas já são de leitura pública.

-- Primeiro tira TODAS as permissões das visões, para começar do zero.
-- É a mesma segunda camada de proteção usada nas tabelas (01_estrutura.sql):
-- assim ninguém fica com alguma permissão a mais que o Supabase dê por padrão
-- (por exemplo, tentar alterar dados através de uma visão).
revoke all on public.v_placar_partidas        from anon, authenticated;
revoke all on public.v_estatisticas_jogadores from anon, authenticated;
revoke all on public.v_sequencias             from anon, authenticated;

-- Depois devolve somente a permissão de LEITURA.
grant select on public.v_placar_partidas        to anon, authenticated;
grant select on public.v_estatisticas_jogadores to anon, authenticated;
grant select on public.v_sequencias             to anon, authenticated;


commit;
