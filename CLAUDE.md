# App do Racha — contexto do projeto

## Objetivo
App web para controlar o racha semanal de futebol (quintas-feiras), substituindo um app antigo feito no Mocha (descontinuado). O usuário principal não é programador: explique cada passo em português simples e peça confirmação antes de ações importantes.

## Tecnologia
- Telas: HTML, CSS e JavaScript puro, pensadas primeiro para celular.
- Banco de dados: Supabase (plano gratuito, região São Paulo).
- Hospedagem: GitHub Pages (link público).
- Python apenas para scripts de bastidor (migração e conferência de dados).
- Todo código deve ter comentários em português.
- Soluções simples e modulares; evitar dependências sem justificativa.

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
