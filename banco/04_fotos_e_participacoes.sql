-- =====================================================================
-- App do Racha — fotos dos jogadores e visão de participações
-- =====================================================================
-- Este script faz três coisas:
--   1. Acrescenta à tabela jogadores os campos da foto (endereço da foto e
--      data/hora em que o jogador autorizou o uso da imagem).
--   2. Cria no Supabase Storage o "balde" (bucket) público onde as fotos
--      ficam guardadas, com regras: todos veem, só admin envia/troca/apaga.
--   3. Cria a visão v_participacoes: uma linha por jogador por partida,
--      base para filtros por período, últimos resultados e gols por mês.
--
-- Deve ser executado UMA VEZ no SQL Editor do Supabase, depois dos
-- scripts 01, 02 e 03 (que já foram carregados).
-- Tudo fica dentro de uma transação: se algo der erro, nada é criado.
-- =====================================================================

begin;


-- =====================================================================
-- 1. CAMPOS DE FOTO NA TABELA JOGADORES
-- =====================================================================
-- Os dois campos são opcionais: jogador sem foto aparece com as iniciais.
--   foto_url              = endereço público da foto no Storage;
--   foto_consentimento_em = quando o jogador autorizou o uso da foto
--                           (registro para a LGPD; vazio = sem autorização).
-- As permissões e regras de RLS da tabela jogadores já valem para as
-- colunas novas: todos podem ler, só admin pode alterar.
alter table public.jogadores
  add column foto_url              text,
  add column foto_consentimento_em timestamptz;

comment on column public.jogadores.foto_url is
  'Endereço público da foto do jogador no Storage (opcional).';
comment on column public.jogadores.foto_consentimento_em is
  'Data e hora em que o jogador autorizou o uso da foto (opcional).';


-- =====================================================================
-- 2. BUCKET "fotos-jogadores" NO SUPABASE STORAGE
-- =====================================================================
-- "public = true": qualquer pessoa consegue abrir uma foto pelo endereço
-- dela (é o que a área pública precisa para mostrar as fotos).
-- Limites de segurança: no máximo 2 MB por arquivo e só imagens
-- JPEG, PNG ou WebP.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fotos-jogadores',
  'fotos-jogadores',
  true,
  2097152,  -- 2 MB, em bytes
  array['image/jpeg', 'image/png', 'image/webp']
);

-- Regras de acesso aos arquivos (a tabela storage.objects é do Supabase
-- e já vem com RLS ligado). Cada regra vale SÓ para este bucket.

-- Leitura pública: qualquer pessoa pode ver/listar as fotos.
create policy "fotos-jogadores: leitura publica" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'fotos-jogadores');

-- Envio de foto nova: somente administradores.
create policy "fotos-jogadores: envio somente admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'fotos-jogadores' and public.eh_admin());

-- Troca de foto existente: somente administradores.
create policy "fotos-jogadores: alteracao somente admin" on storage.objects
  for update to authenticated
  using      (bucket_id = 'fotos-jogadores' and public.eh_admin())
  with check (bucket_id = 'fotos-jogadores' and public.eh_admin());

-- Exclusão de foto: somente administradores.
create policy "fotos-jogadores: exclusao somente admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'fotos-jogadores' and public.eh_admin());


-- =====================================================================
-- 3. v_participacoes — uma linha por jogador por partida
-- =====================================================================
-- Mostra cada participação de cada jogador, com a data do jogo e o
-- resultado DELE naquela partida:
--   'V' = vitória, 'E' = empate, 'D' = derrota,
--   vazio = sem resultado (racha sem times, ou jogador sem equipe).
--
-- Não soma os ajustes manuais (eles não têm partida). Quem precisar dos
-- totais com ajustes usa v_estatisticas_jogadores ou soma a tabela ajustes.
--
-- Usa "security_invoker = true" (respeita o RLS de quem consulta) e só
-- tabelas/visões públicas: escalacoes, jogadores e v_placar_partidas.
create view public.v_participacoes
with (security_invoker = true) as
select
  e.partida_id,
  pl.racha_id,
  pl.numero,
  pl.data_jogo,
  pl.origem,
  pl.tem_times,
  e.jogador_id,
  j.tipo,
  e.equipe,
  e.gols,
  e.assistencias,
  e.gols_contra,
  case
    when not pl.tem_times or e.equipe is null then null
    when pl.resultado = 'empate'              then 'E'
    when pl.resultado = e.equipe              then 'V'
    else 'D'
  end as resultado
from public.escalacoes e
join public.v_placar_partidas pl on pl.partida_id = e.partida_id
join public.jogadores j          on j.id = e.jogador_id;

comment on view public.v_participacoes is
  'Uma linha por jogador por partida, com data, equipe, números e resultado (V/E/D). Sem ajustes.';


-- =====================================================================
-- PERMISSÕES DA VISÃO
-- =====================================================================
-- Mesma segunda camada de proteção das tabelas e das outras visões:
-- primeiro tira todas as permissões, depois devolve só a LEITURA.
revoke all on public.v_participacoes from anon, authenticated;
grant select on public.v_participacoes to anon, authenticated;


commit;
