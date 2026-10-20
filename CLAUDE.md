# App do Racha — contexto do projeto

## Objetivo
App web para controlar o racha semanal de futebol (quintas-feiras), substituindo um app antigo feito no Mocha (descontinuado). O usuário principal não é programador: explique cada passo em português simples e peça confirmação antes de ações importantes.

## Situação atual
- Em 19/10/2026, a estrutura do banco (`banco/01_estrutura.sql`) e o histórico da planilha (`banco/02_dados_historicos.sql`) já foram carregados no Supabase.
- Também em 19/10/2026, as visões de ranking (`banco/03_visoes_rankings.sql`: `v_placar_partidas`, `v_estatisticas_jogadores` e `v_sequencias`) foram criadas no Supabase.
- O script `banco/04_fotos_e_participacoes.sql` (colunas de foto, bucket `fotos-jogadores` e visão `v_participacoes`) também foi executado no Supabase.
- **Esses quatro scripts (01, 02, 03 e 04) NÃO devem ser rodados de novo** no Supabase: o banco já tem as tabelas, os dados e as visões, e rodar de novo daria erro ou duplicaria registros.
- A área pública (pasta `web/`) está sendo redesenhada por etapas (identidade do escudo, Início, Rankings, Rachas, Ficha, PWA) e ainda não foi publicada no GitHub Pages.
- Mudanças futuras na estrutura devem ser feitas em novos scripts numerados (ex.: `banco/03_...sql`), com confirmação do usuário antes de executar.

## Tecnologia
- Telas: HTML, CSS e JavaScript puro, pensadas primeiro para celular.
- Banco de dados: Supabase (plano gratuito, região São Paulo).
- Hospedagem: GitHub Pages (link público).
- Python apenas para scripts de bastidor (migração e conferência de dados).
- Todo código deve ter comentários em português.
- Soluções simples e modulares; evitar dependências sem justificativa.

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
1. **Jogadores:** nome, apelido, posição, tipo (linha, goleiro ou convidado), ativo.
2. **Racha do dia:** data do jogo (única por dia), presença, montagem manual dos times A e B, botão rápido "+ convidado", placar, gols, assistências e gol contra. Pode haver mais de uma partida por racha.
3. **Financeiro (só admin):** valor fixo e configurável por racha, igual para todos; quem atua como goleiro naquele dia não paga; formas de pagamento Pix, dinheiro e cartão; dívida acumula por jogador e pode ser quitada total ou parcialmente; tela "quem está devendo".
4. **Caixa (só admin):** entradas (pagamentos) e saídas lançadas manualmente (quadra, bola etc.), com saldo e extrato.
5. **Rankings (público):** artilharia, assistências, vitórias, presença e sequências. Sempre calculados a partir dos lançamentos, nunca guardados como total fixo. Convidados aparecem nos rankings, identificados como convidados.
6. **Histórico:** importado da planilha `BASE_RACHA_CONSOLIDADA_2026.xlsx`.

## Regras de dados
- Impedir duplicidade no banco: um racha por data; um jogador por partida.
- Ajustes manuais viram registros com motivo, data e autor (auditáveis).
- Rachas recuperados de anotações (agosto e setembro de 2026) não têm times nem placar e devem ser sinalizados assim.

## Decisões sobre a migração da planilha
- A partida 22 é duplicata da 21 (erro do Mocha): considerar só a 21.
- Os campos `manual_goals`, `manual_assists` e `manual_wins` são ajustes válidos e devem somar aos totais.
- A data de criação dos registros nem sempre é a data do jogo (houve lançamentos posteriores); o app novo guarda a data do jogo separadamente.
- Antes de carregar qualquer dado no banco, gerar relatório de conferência para validação do usuário.

## Fases futuras
- Divisão automática de times por critérios objetivos.
- Resumo da rodada para colar no WhatsApp.
- Confirmação de presença antecipada.
