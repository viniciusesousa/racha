-- =====================================================================
-- App do Racha — ajustes de estrutura para o saneamento de jul–out/2026
-- =====================================================================
-- Este script NÃO mexe em dados: só amplia duas regras de valores
-- permitidos, para o script de saneamento (07) poder gravar:
--
--   1. rachas.situacao: novo valor 'sem_informacao' — para datas em que
--      sabemos que houve (ou poderia ter havido) racha, mas não há nenhum
--      registro (ex.: 30/04 e 14/05/2026).
--
--   2. pagamentos.forma: novo valor 'nao_informado' — para pagamentos
--      marcados com ✅ nas listas do WhatsApp, que não dizem se foi Pix,
--      dinheiro ou cartão.
--
-- Os valores que já existiam continuam valendo. Nenhum registro muda.
--
-- Deve ser executado UMA VEZ no SQL Editor do Supabase, ANTES do 07.
-- Tudo fica dentro de uma transação: se algo der erro, nada muda.
-- =====================================================================

begin;


-- ---------------------------------------------------------------------
-- 1. Situação do racha: realizado, sem jogo ou sem informação
-- ---------------------------------------------------------------------
-- A regra antiga foi criada no 01 com o nome automático
-- "rachas_situacao_check". Ela é trocada por uma nova com o valor extra.
alter table public.rachas drop constraint if exists rachas_situacao_check;
alter table public.rachas
  add constraint rachas_situacao_check
  check (situacao in ('realizado', 'sem_jogo', 'sem_informacao'));

comment on column public.rachas.situacao is
  'realizado = teve jogo; sem_jogo = cancelado; sem_informacao = não há registro do que aconteceu.';


-- ---------------------------------------------------------------------
-- 2. Forma de pagamento: pix, dinheiro, cartão ou não informado
-- ---------------------------------------------------------------------
alter table public.pagamentos drop constraint if exists pagamentos_forma_check;
alter table public.pagamentos
  add constraint pagamentos_forma_check
  check (forma in ('pix', 'dinheiro', 'cartao', 'nao_informado'));

comment on column public.pagamentos.forma is
  'pix, dinheiro, cartao ou nao_informado (quando a lista não diz a forma).';


commit;
