-- =====================================================================
-- App do Racha — estrutura para a área do administrador
-- =====================================================================
-- O que este script faz:
--   1. Acaba com o tipo "convidado": quem jogou uma vez é jogador "linha".
--   2. Cria a tabela "lances" (cada gol ou gol contra lançado na beira da
--      quadra), com as validações no próprio banco e a soma automática
--      nas escalações (inclusive ao desfazer um lance).
--   3. Impede trocar de time um jogador que já tem lances na partida.
--   4. Cria funções que gravam várias coisas de uma vez (tudo ou nada):
--      abrir racha, status do jogador no dia, time do jogador e desfazer
--      o último lance.
--   5. Cria a visão de saldos (cobrado − pago) de cada jogador.
--
-- Segurança:
--   * as funções chamadas pelo app conferem public.eh_admin() logo no
--     início; as funções de gatilho não (ver nota na seção 2);
--   * as funções rodam com as permissões de QUEM CHAMA (security invoker),
--     então o RLS das tabelas continua valendo; mesmo assim usam
--     "set search_path = ''" (boa prática contra truques de nomes);
--   * ninguém sem login executa as funções (revoke de public e anon).
--
-- Deve ser executado UMA VEZ no SQL Editor do Supabase, depois do 06.
-- Tudo dentro de uma transação: se algo der erro, nada muda.
-- =====================================================================

begin;


-- =====================================================================
-- 1. FIM DO TIPO "CONVIDADO"
-- =====================================================================
-- Quem estava como convidado passa a ser jogador de linha, e a regra do
-- tipo passa a aceitar só 'linha' e 'goleiro'.
update public.jogadores set tipo = 'linha' where tipo = 'convidado';

alter table public.jogadores drop constraint if exists jogadores_tipo_check;
alter table public.jogadores
  add constraint jogadores_tipo_check check (tipo in ('linha', 'goleiro'));

comment on column public.jogadores.tipo is
  'linha ou goleiro. (O tipo "convidado" deixou de existir: quem jogou uma vez é jogador.)';


-- =====================================================================
-- 2. LANCES
-- =====================================================================
-- Por que os gatilhos não conferem eh_admin():
--   As funções de GATILHO (validar_lance, somar_lance_nas_escalacoes,
--   impedir_edicao_lance e proteger_time_com_lances) rodam sempre que uma
--   tabela muda — inclusive quando o próprio administrador roda scripts de
--   manutenção no SQL Editor do Supabase. Lá não há usuário logado
--   (auth.uid() vazio), então eh_admin() daria falso e bloquearia, por
--   exemplo, apagar um racha de teste com lances ou corrigir times.
--   Quem impede não-admins de escrever nessas tabelas é o RLS (regras de
--   acesso). Já as funções chamadas pelo APP (abrir_racha,
--   definir_status_dia, definir_equipe e desfazer_ultimo_lance) continuam
--   conferindo eh_admin() logo no início.
-- Cada linha é um gol ou um gol contra, na ordem em que aconteceu.
-- O banco garante que:
--   * o autor (e a assistência, se houver) está ESCALADO na partida
--     (chaves estrangeiras para escalacoes);
--   * no gol, a assistência é do MESMO time do autor;
--   * no gol contra, a assistência (se houver) é do time ADVERSÁRIO do
--     autor — ou seja, de quem se beneficiou do lance;
--   * ninguém dá assistência para si mesmo.
create table public.lances (
  id              bigint generated always as identity primary key,
  partida_id      integer not null references public.partidas(id) on delete cascade,
  tipo            text not null check (tipo in ('gol', 'gol_contra')),
  autor_id        integer not null,
  assistencia_id  integer,
  criado_em       timestamptz not null default now(),
  criado_por      uuid default auth.uid() references auth.users(id) on delete set null,
  -- Autor e assistência precisam estar escalados nesta partida.
  -- ("no action": a conferência acontece no fim do comando, o que permite
  --  apagar uma partida inteira — lances e escalações saem juntos.)
  constraint lances_autor_escalado
    foreign key (partida_id, autor_id)
    references public.escalacoes (partida_id, jogador_id) on delete no action,
  constraint lances_assistencia_escalada
    foreign key (partida_id, assistencia_id)
    references public.escalacoes (partida_id, jogador_id) on delete no action,
  constraint lances_sem_autoassistencia
    check (assistencia_id is null or assistencia_id <> autor_id)
);

comment on table public.lances is
  'Gols e gols contra lançados na área do admin, em ordem. Somam automaticamente nas escalações.';

-- Busca rápida dos lances de uma partida e de um jogador.
create index lances_partida_idx on public.lances (partida_id, id);
create index lances_autor_idx on public.lances (partida_id, autor_id);
create index lances_assistencia_idx on public.lances (partida_id, assistencia_id);

-- Leitura pública (são dados de jogo, como as escalações); escrita só admin.
alter table public.lances enable row level security;
create policy "leitura publica" on public.lances
  for select to anon, authenticated using (true);
create policy "escrita somente admin" on public.lances
  for all to authenticated using (public.eh_admin()) with check (public.eh_admin());

revoke all on table public.lances from anon;
grant select on table public.lances to anon;
grant select, insert, update, delete on table public.lances to authenticated;
grant usage, select on sequence public.lances_id_seq to authenticated;


-- ---------------------------------------------------------------------
-- 2a. Validação de times antes de gravar um lance
-- ---------------------------------------------------------------------
create or replace function public.validar_lance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_time_autor  char(1);
  v_time_assist char(1);
begin
  -- (Função de GATILHO: não confere eh_admin() de propósito — veja a nota
  --  "Por que os gatilhos não conferem eh_admin()" no topo da seção 2.)

  select equipe into v_time_autor from public.escalacoes
  where partida_id = new.partida_id and jogador_id = new.autor_id;
  if v_time_autor is null then
    raise exception 'O autor do lance precisa estar em um time (A ou B).';
  end if;

  if new.assistencia_id is not null then
    select equipe into v_time_assist from public.escalacoes
    where partida_id = new.partida_id and jogador_id = new.assistencia_id;
    if v_time_assist is null then
      raise exception 'Quem deu a assistência precisa estar em um time (A ou B).';
    end if;
    if new.tipo = 'gol' and v_time_assist <> v_time_autor then
      raise exception 'No gol, a assistência precisa ser do mesmo time do autor.';
    end if;
    if new.tipo = 'gol_contra' and v_time_assist = v_time_autor then
      raise exception 'No gol contra, a assistência precisa ser do time adversário do autor.';
    end if;
  end if;

  return new;
end;
$$;

create trigger lances_validar
  before insert or update on public.lances
  for each row execute function public.validar_lance();


-- ---------------------------------------------------------------------
-- 2b. Soma e subtração automáticas nas escalações
-- ---------------------------------------------------------------------
-- Inserir lance:  gol        -> autor +1 gol;        assistência +1
--                 gol contra -> autor +1 gol contra; assistência +1
-- Excluir lance (desfazer): o contrário (-1). Se algum número fosse ficar
-- negativo, o banco recusa (sinal de dado inconsistente) e nada muda.
-- (Lances não podem ser alterados: para corrigir, desfaz e lança de novo.)
create or replace function public.somar_lance_nas_escalacoes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lance public.lances;
  v_sinal integer;
begin
  -- (Função de GATILHO: não confere eh_admin() de propósito — veja a nota
  --  "Por que os gatilhos não conferem eh_admin()" no topo da seção 2.)

  if tg_op = 'INSERT' then
    v_lance := new; v_sinal := 1;
  else
    v_lance := old; v_sinal := -1;
    -- Se a escalação do autor já não existe, a partida inteira está sendo
    -- apagada (lances e escalações saem juntos): não há o que subtrair.
    if not exists (select 1 from public.escalacoes
                   where partida_id = v_lance.partida_id and jogador_id = v_lance.autor_id) then
      return null;
    end if;
  end if;

  -- Autor: gol ou gol contra.
  if v_lance.tipo = 'gol' then
    update public.escalacoes set gols = gols + v_sinal
    where partida_id = v_lance.partida_id and jogador_id = v_lance.autor_id
      and gols + v_sinal >= 0;
  else
    update public.escalacoes set gols_contra = gols_contra + v_sinal
    where partida_id = v_lance.partida_id and jogador_id = v_lance.autor_id
      and gols_contra + v_sinal >= 0;
  end if;
  if not found then
    raise exception 'Não foi possível atualizar os números do autor (ficariam negativos ou ele não está escalado).';
  end if;

  -- Assistência, se houver.
  if v_lance.assistencia_id is not null and (v_sinal = 1 or exists (
       select 1 from public.escalacoes
       where partida_id = v_lance.partida_id and jogador_id = v_lance.assistencia_id)) then
    update public.escalacoes set assistencias = assistencias + v_sinal
    where partida_id = v_lance.partida_id and jogador_id = v_lance.assistencia_id
      and assistencias + v_sinal >= 0;
    if not found then
      raise exception 'Não foi possível atualizar as assistências (ficariam negativas ou o jogador não está escalado).';
    end if;
  end if;

  return null;  -- gatilho "depois": o valor de retorno não é usado
end;
$$;

create trigger lances_somar
  after insert or delete on public.lances
  for each row execute function public.somar_lance_nas_escalacoes();

-- Lances não são editados: corrigir = desfazer e lançar de novo.
create or replace function public.impedir_edicao_lance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- (Função de gatilho: sem conferência de eh_admin(); vale para todos.)
  raise exception 'Lances não podem ser alterados: desfaça o lance e lance de novo.';
end;
$$;

create trigger lances_sem_edicao
  before update on public.lances
  for each row execute function public.impedir_edicao_lance();


-- =====================================================================
-- 3. NÃO TROCAR DE TIME QUEM JÁ TEM LANCES
-- =====================================================================
-- Se o jogador já marcou, deu assistência ou fez gol contra na partida,
-- mudar o time dele deixaria os lances incoerentes.
create or replace function public.proteger_time_com_lances()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- (Função de GATILHO: não confere eh_admin() de propósito — veja a nota
  --  "Por que os gatilhos não conferem eh_admin()" no topo da seção 2.)
  if new.equipe is distinct from old.equipe and exists (
       select 1 from public.lances l
       where l.partida_id = old.partida_id
         and (l.autor_id = old.jogador_id or l.assistencia_id = old.jogador_id)) then
    raise exception 'Este jogador já tem lances nesta partida: desfaça os lances dele antes de trocar o time.';
  end if;
  return new;
end;
$$;

create trigger escalacoes_proteger_time
  before update of equipe on public.escalacoes
  for each row execute function public.proteger_time_com_lances();


-- =====================================================================
-- 4. FUNÇÕES DA ÁREA DO ADMIN
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4a. Abrir racha: cria o racha e a partida 1 juntos.
-- Se já existir racha nessa data, NÃO cria outro: devolve o existente
-- (ja_existia = true), para o app avisar e abrir o que já está lá.
-- Valor: o informado ou, se vazio, o padrão das configurações.
-- ---------------------------------------------------------------------
create or replace function public.abrir_racha(p_data date, p_valor numeric default null)
returns table (racha_id integer, partida_id integer, ja_existia boolean)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_racha   integer;
  v_partida integer;
  v_valor   numeric;
begin
  if not public.eh_admin() then
    raise exception 'Acesso negado: somente administradores.' using errcode = '42501';
  end if;

  select r.id into v_racha from public.rachas r where r.data_jogo = p_data;
  if v_racha is not null then
    select p.id into v_partida from public.partidas p where p.racha_id = v_racha and p.numero = 1;
    if v_partida is null then
      insert into public.partidas (racha_id, numero) values (v_racha, 1) returning id into v_partida;
    end if;
    return query select v_racha, v_partida, true;
    return;
  end if;

  v_valor := coalesce(p_valor, (select c.valor_padrao_racha from public.configuracoes c limit 1), 0);
  insert into public.rachas (data_jogo, valor_cobrado, situacao, origem, tem_times)
  values (p_data, v_valor, 'realizado', 'app', true)
  returning id into v_racha;
  insert into public.partidas (racha_id, numero) values (v_racha, 1) returning id into v_partida;
  return query select v_racha, v_partida, false;
end;
$$;

-- ---------------------------------------------------------------------
-- 4b. Status do jogador no dia (um toque grava tudo de uma vez):
--   'presente' -> presença (jogador de linha) + cobrança do valor do racha
--   'goleiro'  -> presença como goleiro, SEM cobrança (goleiro não paga)
--   'faltou'   -> faltou de última hora: cobrança, SEM presença e fora dos times
--   'nenhum'   -> remove do dia: sem presença, sem cobrança, fora dos times
-- "faltou" e "nenhum" são bloqueados se o jogador já tiver lances.
-- ---------------------------------------------------------------------
create or replace function public.definir_status_dia(p_racha integer, p_jogador integer, p_status text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_partida integer;
  v_valor   numeric;
begin
  if not public.eh_admin() then
    raise exception 'Acesso negado: somente administradores.' using errcode = '42501';
  end if;
  if p_status not in ('presente', 'goleiro', 'faltou', 'nenhum') then
    raise exception 'Status inválido: %', p_status;
  end if;

  select r.valor_cobrado into v_valor from public.rachas r where r.id = p_racha;
  if v_valor is null then
    raise exception 'Racha não encontrado.';
  end if;
  select p.id into v_partida from public.partidas p where p.racha_id = p_racha and p.numero = 1;

  -- Quem já tem lances jogou: não pode virar "faltou" nem sair do dia.
  if p_status in ('faltou', 'nenhum') and exists (
       select 1 from public.lances l
       where l.partida_id = v_partida and (l.autor_id = p_jogador or l.assistencia_id = p_jogador)) then
    raise exception 'Este jogador tem lances nesta partida: desfaça os lances dele antes de removê-lo ou marcá-lo como falta.';
  end if;
  -- Proteção do histórico: números já gravados (ex.: vindos de anotações
  -- antigas, sem lances) também impedem tirar o jogador do dia.
  if p_status in ('faltou', 'nenhum') and exists (
       select 1 from public.escalacoes e
       where e.partida_id = v_partida and e.jogador_id = p_jogador
         and (e.gols > 0 or e.assistencias > 0 or e.gols_contra > 0)) then
    raise exception 'Este jogador tem estatísticas registradas nesta partida; remova-as antes.';
  end if;

  if p_status in ('presente', 'goleiro') then
    insert into public.presencas (racha_id, jogador_id, atuou_como_goleiro)
    values (p_racha, p_jogador, p_status = 'goleiro')
    on conflict (racha_id, jogador_id) do update set atuou_como_goleiro = excluded.atuou_como_goleiro;
  else
    delete from public.escalacoes where partida_id = v_partida and jogador_id = p_jogador;
    delete from public.presencas  where racha_id = p_racha and jogador_id = p_jogador;
  end if;

  if p_status in ('presente', 'faltou') then
    insert into public.cobrancas (racha_id, jogador_id, valor)
    values (p_racha, p_jogador, v_valor)
    on conflict (racha_id, jogador_id) do nothing;
  else
    delete from public.cobrancas where racha_id = p_racha and jogador_id = p_jogador;
  end if;

  return p_status;
end;
$$;

-- ---------------------------------------------------------------------
-- 4c. Time do jogador: 'A', 'B' ou null (tirar do time).
-- Só quem está presente no dia pode entrar num time.
-- ---------------------------------------------------------------------
create or replace function public.definir_equipe(p_racha integer, p_jogador integer, p_equipe text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_partida integer;
begin
  if not public.eh_admin() then
    raise exception 'Acesso negado: somente administradores.' using errcode = '42501';
  end if;
  if p_equipe is not null and p_equipe not in ('A', 'B') then
    raise exception 'Time inválido: use A, B ou vazio.';
  end if;
  select p.id into v_partida from public.partidas p where p.racha_id = p_racha and p.numero = 1;
  if v_partida is null then
    raise exception 'Partida do racha não encontrada.';
  end if;

  if p_equipe is null then
    -- Tirar do time: bloqueado se tiver lances (as chaves dos lances impedem).
    if exists (select 1 from public.lances l
               where l.partida_id = v_partida and (l.autor_id = p_jogador or l.assistencia_id = p_jogador)) then
      raise exception 'Este jogador tem lances nesta partida: desfaça os lances dele antes de tirá-lo do time.';
    end if;
    -- Proteção do histórico: não apaga escalação que tenha números.
    if exists (select 1 from public.escalacoes e
               where e.partida_id = v_partida and e.jogador_id = p_jogador
                 and (e.gols > 0 or e.assistencias > 0 or e.gols_contra > 0)) then
      raise exception 'Este jogador tem estatísticas registradas nesta partida; remova-as antes.';
    end if;
    delete from public.escalacoes where partida_id = v_partida and jogador_id = p_jogador;
    return null;
  end if;

  if not exists (select 1 from public.presencas pr where pr.racha_id = p_racha and pr.jogador_id = p_jogador) then
    raise exception 'Marque o jogador como presente (ou goleiro) antes de colocá-lo num time.';
  end if;

  insert into public.escalacoes (partida_id, jogador_id, equipe)
  values (v_partida, p_jogador, p_equipe)
  on conflict (partida_id, jogador_id) do update set equipe = excluded.equipe;
  return p_equipe;
end;
$$;

-- ---------------------------------------------------------------------
-- 4d. Desfazer o último lance da partida (devolve o id apagado).
-- O gatilho 2b subtrai os números nas escalações.
-- ---------------------------------------------------------------------
create or replace function public.desfazer_ultimo_lance(p_partida integer)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not public.eh_admin() then
    raise exception 'Acesso negado: somente administradores.' using errcode = '42501';
  end if;
  select l.id into v_id from public.lances l where l.partida_id = p_partida order by l.id desc limit 1;
  if v_id is null then
    raise exception 'Não há lances para desfazer nesta partida.';
  end if;
  delete from public.lances where id = v_id;
  return v_id;
end;
$$;

-- Permissões das funções: só quem fez login pode chamar (e a própria
-- função recusa quem não é admin). Ninguém sem login executa.
revoke execute on function public.validar_lance()                          from public, anon;
revoke execute on function public.somar_lance_nas_escalacoes()             from public, anon;
revoke execute on function public.impedir_edicao_lance()                   from public, anon;
revoke execute on function public.proteger_time_com_lances()               from public, anon;
revoke execute on function public.abrir_racha(date, numeric)               from public, anon;
revoke execute on function public.definir_status_dia(integer, integer, text) from public, anon;
revoke execute on function public.definir_equipe(integer, integer, text)   from public, anon;
revoke execute on function public.desfazer_ultimo_lance(integer)           from public, anon;

grant execute on function public.validar_lance()                          to authenticated;
grant execute on function public.somar_lance_nas_escalacoes()             to authenticated;
grant execute on function public.impedir_edicao_lance()                   to authenticated;
grant execute on function public.proteger_time_com_lances()               to authenticated;
grant execute on function public.abrir_racha(date, numeric)               to authenticated;
grant execute on function public.definir_status_dia(integer, integer, text) to authenticated;
grant execute on function public.definir_equipe(integer, integer, text)   to authenticated;
grant execute on function public.desfazer_ultimo_lance(integer)           to authenticated;


-- =====================================================================
-- 5. SALDOS DOS JOGADORES (financeiro — só admin)
-- =====================================================================
-- saldo = total cobrado − total pago (positivo = deve; negativo = crédito).
-- "security_invoker": obedece ao RLS de quem consulta. Como cobrancas e
-- pagamentos só são visíveis para admin, qualquer outra pessoa vê zeros.
create view public.v_saldos_jogadores
with (security_invoker = true) as
with cobrado as (
  select jogador_id, sum(valor) as total from public.cobrancas group by jogador_id
),
pago as (
  select jogador_id, sum(valor) as total from public.pagamentos group by jogador_id
)
select
  j.id   as jogador_id,
  j.nome,
  j.apelido,
  j.tipo,
  j.ativo,
  coalesce(c.total, 0)                       as total_cobrado,
  coalesce(p.total, 0)                       as total_pago,
  coalesce(c.total, 0) - coalesce(p.total, 0) as saldo
from public.jogadores j
left join cobrado c on c.jogador_id = j.id
left join pago    p on p.jogador_id = j.id;

comment on view public.v_saldos_jogadores is
  'Saldo financeiro por jogador (cobrado − pago). Só admin enxerga valores (RLS das tabelas).';

revoke all on public.v_saldos_jogadores from anon, authenticated;
grant select on public.v_saldos_jogadores to authenticated;


commit;
