# App do Racha — contexto do projeto

## Objetivo
App web para controlar o racha semanal de futebol (quintas-feiras), substituindo um app antigo feito no Mocha (descontinuado). O usuário principal não é programador: explique cada passo em português simples e peça confirmação antes de ações importantes.

## Situação atual
- Todos os scripts de 01 a 08 já foram executados no Supabase (banco real):
  - em 19/10/2026:
    - `banco/01_estrutura.sql`: tabelas, regras e permissões;
    - `banco/dados/02_dados_historicos.sql`: histórico da planilha do Mocha (fora do git);
    - `banco/03_visoes_rankings.sql`: visões `v_placar_partidas`, `v_estatisticas_jogadores` e `v_sequencias`;
    - `banco/04_fotos_e_participacoes.sql`: colunas de foto, bucket `fotos-jogadores` e visão `v_participacoes`;
    - `banco/dados/05_racha_2026-10-15.sql`: racha de 15/10/2026, 2 jogadores novos, cobranças e pagamentos (fora do git);
  - em 20/10/2026 (saneamento de jul–out/2026, a partir das listas e anotações do WhatsApp; placares conferidos pelo usuário):
    - `banco/06_ajustes_estrutura.sql`: permite `situacao = 'sem_informacao'` em rachas e `forma = 'nao_informado'` em pagamentos;
    - `banco/dados/07_saneamento_jul_out.sql` (fora do git, gerado por `banco/dados/gerar_07_saneamento.py`): rachas de 02/07 a 08/10 corrigidos/incluídos, cadastros novos, cobranças e pagamentos desde 02/07;
    - `banco/08_area_admin.sql`: fim do tipo "convidado", tabela `lances` (com gatilhos que somam/subtraem nas escalações), funções do admin (`abrir_racha`, `definir_status_dia`, `definir_equipe`, `desfazer_ultimo_lance`) e visão `v_saldos_jogadores`;
    - `banco/dados/08_dados_correcao_cadastro.sql` (fora do git): correção de nome de um cadastro.
- **Nenhum desses scripts (01 a 08) deve ser rodado de novo** no banco real: o banco já tem as tabelas, os dados e as visões, e rodar de novo daria erro ou duplicaria registros.
- **Banco de teste:** projeto Supabase separado **"racha-teste"**, só com dados fictícios ("Jogador Teste N"). Nele rodaram 01, 03, 04, 06, 08 e `banco/teste/popular_racha_teste.sql`; cadastro aberto desligado; um usuário admin de teste. Os testes automáticos do 08 ficam em `banco/teste/testar_08.sql` e `banco/teste/testar_limpeza.sql` (rodar só no racha-teste). Todo script novo de estrutura roda primeiro no racha-teste.
- Mudanças futuras devem ser feitas em novos scripts numerados (próximo: `09_...sql`), com confirmação do usuário antes de executar. Scripts com dados reais vão para `banco/dados/`.
- A área pública (pasta `web/`) foi redesenhada em 6 etapas: identidade visual (paleta grená, sem verde), Início, Rankings, Rachas, Ficha do jogador e app instalável (PWA).
- **Área do admin** feita em 8 etapas (out/2026) e ensaiada no racha-teste simulando uma quinta inteira; não precisou de script novo no banco (usa só 01–08). Guia de uso para quem lança o racha: `docs/guia-do-admin.md`.
- **Site no ar desde 20/10/2026:** https://viniciusesousa.github.io/racha/ (marcado como `noindex, nofollow`, não aparece no Google; o link circula só no grupo).

## Publicação (GitHub Pages)
- Repositório público: https://github.com/viniciusesousa/racha (branch `main`).
- **Cada push na branch `main` publica o site automaticamente** pelo workflow `.github/workflows/publicar-site.yml` (GitHub Actions), que envia só a pasta `web/`. O andamento aparece na aba "Actions" do repositório (leva 1 a 2 minutos).
- O site fica numa subpasta (`/racha/`): todos os caminhos em `web/` devem ser relativos (sem `/` no início).
- **Escolha automática do banco** (`web/config.js`): página aberta em `localhost`, `127.0.0.1`, `[::1]` ou `*.localhost` usa o banco de teste (racha-teste) e mostra a faixa "AMBIENTE DE TESTE"; qualquer outro endereço usa o banco real. As duas chaves no `config.js` são públicas (publishable).
- Área do admin: `web/admin.html`, sem link na área pública e com `noindex`. Login por e-mail e senha (Supabase Auth); quem não é admin (`eh_admin()` falso) vê "acesso não autorizado" e nada é carregado.
  - Arquivos: `admin.js` (login, abas e funções comuns: `gravar`, `mostrarFalha`, `lerValor`, `nomesParecidos`) e uma seção por arquivo: `admin-racha.js` (abrir racha, lista do dia, times, lances com placar ao vivo, fechamento), `admin-devedores.js`, `admin-caixa.js`, `admin-jogadores.js` (cadastro, foto 512×512 com consentimento, ajustes) e `admin-config.js` (valor padrão do racha). Os estilos ficam em `estilos.css`.
  - Cada toque grava na hora (sem fila offline). Se falhar, aparece a faixa vermelha com "Tentar de novo"; depois de gravar, a tela é redesenhada a partir do banco.
  - Valores em dinheiro usam campo de texto com `lerValor` (aceita vírgula). "Não informado" (`nao_informado`) só existe nos dados antigos e não aparece como opção.
  - Para testar: abrir `http://localhost:8000/admin.html` (servidor local na pasta `web/`), que usa o racha-teste.
- Antes de enviar ao GitHub, pedir confirmação ao usuário. Nunca enviar dados reais (`banco/dados/`, planilhas, relatórios) nem chaves secretas; só a chave `sb_publishable_` pode ficar no código.
- Commits usam o e-mail privado ("noreply") do GitHub, já configurado só neste repositório (`git config user.email`), para o e-mail pessoal não ficar público. Não escrever e-mails em arquivos versionados.
- **Ao publicar qualquer mudança na pasta `web/`, aumente `VERSAO` em `web/sw.js`** (v1 -> v2...). Assim o celular troca o cache e apaga o antigo. Arquivos novos da pasta `web/` que devam abrir sem internet entram na lista `ARQUIVOS_DO_APP` do `sw.js`. Os dados do Supabase nunca passam pelo cache.

## Identidade visual
- Escudo em `web/img/escudo.png` (transparente, gerado por `scripts/gerar_imagens.py`; o original `escudo.png.jfif` fica intacto).
- **Sem nenhum tom de verde** na interface (pedido do usuário), nem nos cinzas. Cores principais: grená `#6d1f2f` e vinho `#8a2a3d`; no modo escuro, rosado claro `#f0a3b1`.
- Dourado `#e1ab11` para destaques (1º lugar, medalhas, recordes, vitória). Nunca como cor de texto sobre fundo claro; texto sobre dourado sempre preto `#0e120d`. 2º e 3º lugares em prata e bronze neutros.
- Modo escuro automático: fundo `#0e120d`, textos creme `#f8f8e3`.
- Fontes: Barlow Condensed (números) e Inter (textos). Todo texto deve passar no contraste WCAG AA.

## Perfis de acesso
- **Jogador:** acessa pelo link, sem login. Vê rankings, histórico de rachas e fichas dos jogadores.
- **Administrador:** login com e-mail e senha (poucas pessoas). Lança dados e é o único que vê financeiro e caixa.
- A proteção do financeiro deve ser feita no banco (Row Level Security do Supabase), não só escondendo na tela.

## Módulos da Fase 1
1. **Jogadores:** nome, apelido, posição, tipo (**linha ou goleiro**), ativo. **Não existe mais a categoria "convidado": quem jogou uma vez é jogador** (cadastrado como linha/ativo). No admin, o botão "+ novo jogador" mostra nomes parecidos já cadastrados (para evitar duplicatas) antes de criar um novo.
2. **Racha do dia:** data do jogo (única por dia), presença, montagem manual dos times A e B, botão rápido "+ novo jogador", placar, gols, assistências e gol contra. O banco aceita mais de uma partida por racha, mas a área do admin trabalha com uma partida por racha.
3. **Financeiro (só admin):** valor fixo e configurável por racha, igual para todos (R$ 15 em 2026); quem atua como goleiro naquele dia não paga; **quem falta de última hora paga o racha (cobrança sem presença); quem avisa com antecedência não paga** — a área do admin deve ter a opção "faltou de última hora" na lista do dia; o controle financeiro começa em 02/07/2026 (antes disso, saldo zero); formas de pagamento Pix, dinheiro e cartão; dívida acumula por jogador e pode ser quitada total ou parcialmente; tela "quem está devendo".
4. **Caixa (só admin):** entradas (pagamentos) e saídas lançadas manualmente (quadra, bola etc.), com saldo e extrato.
5. **Rankings (público):** artilharia, assistências, vitórias, presença e sequências. Sempre calculados a partir dos lançamentos, nunca guardados como total fixo.
6. **Histórico:** importado da planilha `BASE_RACHA_CONSOLIDADA_2026.xlsx`.

## Regras de dados
- **Scripts com dados reais de jogadores ou financeiros ficam em `banco/dados/` e nunca entram no git** (o repositório será público). Só scripts de estrutura (tabelas, visões, regras) são versionados. O `.gitignore` já bloqueia `banco/dados/`, `banco/*_dados*.sql` e `banco/0[2-9]_racha_*.sql`.
- Impedir duplicidade no banco: um racha por data; um jogador por partida.
- Ajustes manuais viram registros com motivo, data e autor (auditáveis).
- Rachas recuperados de anotações têm `origem = 'recuperado'` e mostram o selo "recuperado". Os que têm print dos times no grupo ficam com `tem_times = true` e placar normal; só os sem times mostram o aviso "sem times e sem placar".
- Datas sem nenhum registro ficam como racha com `situacao = 'sem_informacao'` (sem partida).

## Decisões sobre a migração da planilha
- A partida 22 é duplicata da 21 (erro do Mocha): considerar só a 21.
- Os campos `manual_goals`, `manual_assists` e `manual_wins` são ajustes válidos e devem somar aos totais.
- A data de criação dos registros nem sempre é a data do jogo (houve lançamentos posteriores); o app novo guarda a data do jogo separadamente.
- Antes de carregar qualquer dado no banco, gerar relatório de conferência para validação do usuário.

## Fases futuras
- Divisão automática de times por critérios objetivos.
- Resumo da rodada para colar no WhatsApp.
- Confirmação de presença antecipada.
