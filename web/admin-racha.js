// =====================================================================
// App do Racha — área do admin: RACHA DO DIA
// =====================================================================
// Pensado para usar na beira da quadra, no celular. Cada toque grava na
// hora (sem botão "salvar"); se a gravação falhar, aparece a faixa
// vermelha com "Tentar de novo" (função gravar, em admin.js).
//
// Partes desta tela:
//   1. Abrir racha: data (padrão: hoje) e valor (padrão das configurações).
//      Se já existir racha na data, avisa e abre o existente.
//   2. Lista do dia: jogadores ativos com busca; para cada um,
//      Presente / Goleiro (não paga) / Faltou de última hora (paga, sem
//      presença). Botão "+ novo jogador" (avisa nomes parecidos antes de
//      cadastrar, para evitar duplicatas).
//   3. Times: dividir os presentes em Time A e Time B com toque.
//   4. Lances: "Gol" e "Gol contra" — escolher o autor e, se quiser, a
//      assistência (no gol, só do mesmo time; no gol contra, só do time
//      adversário). Placar ao vivo no topo e "desfazer último lance".
//      O banco soma/subtrai os lances nas escalações automaticamente.
//   5. Fechamento financeiro: quem tem cobrança no dia, com o saldo
//      devedor ACUMULADO de cada um; botão "Pagou" com forma obrigatória
//      (Pix / Dinheiro / Cartão) e valor editável (para quitar dívidas
//      antigas); resumo do dia (cobrado, recebido por forma, quem ficou
//      devendo). "Não informado" não aparece aqui: é só para dados antigos.
//
// Usa as funções do banco (08_area_admin.sql): abrir_racha,
// definir_status_dia e definir_equipe — cada uma grava tudo ou nada.
// =====================================================================

window.SecaoRacha = (() => {
  // ---------------------------------------------------------------
  // Estado da tela (o que está carregado do banco)
  // ---------------------------------------------------------------
  const estado = {
    el: null,              // elemento onde a tela é desenhada
    racha: null,           // { id, data_jogo, valor_cobrado, partida_id }
    jogadores: new Map(),  // id -> { id, nome, apelido, tipo, ativo }
    status: new Map(),     // jogador id -> 'presente' | 'goleiro' | 'faltou'
    equipe: new Map(),     // jogador id -> 'A' | 'B' (escalações)
    parte: "lista",        // 'lista' | 'times' | 'lances' | 'fechamento'
    busca: "",
    gravando: new Set(),   // jogadores com gravação em andamento
    novoNome: "",          // texto digitado em "+ novo jogador"
    numeros: new Map(),    // jogador id -> { gols, assistencias, gols_contra } na partida
    lances: [],            // lances da partida, em ordem
    lance: null,           // lance sendo montado: { tipo: 'gol'|'gol_contra', autorId }
    ultimoAviso: "",       // confirmação do último lance gravado
    fin: null,             // financeiro do dia: { cobrancas, saldos, pagamentos }
    pagando: null,         // jogador com o formulário "Pagou" aberto: { id, forma, valor }
  };

  // ---------------------------------------------------------------
  // Funções auxiliares
  // ---------------------------------------------------------------
  function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function dataBR(iso) { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a}`; }
  function diaSemana(iso) {
    const [a, m, d] = iso.split("-").map(Number);
    return ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][new Date(a, m - 1, d).getDay()];
  }
  function reais(v) { return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  function normalizar(t) { return String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }
  const porNome = (a, b) => a.nome.localeCompare(b.nome, "pt-BR");

  // Distância entre dois textos (quantas letras trocar para virar o outro).
  function distancia(a, b) {
    const linha = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let anterior = linha[0]; linha[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const guardado = linha[j];
        linha[j] = Math.min(linha[j] + 1, linha[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
        anterior = guardado;
      }
    }
    return linha[b.length];
  }

  // Jogadores com nome parecido com o digitado (para evitar duplicatas).
  // Cada palavra digitada (com 3+ letras, ou número) é comparada com as
  // palavras do nome/apelido de cada jogador:
  //   igual = 3 pontos; começa igual = 2; até 2 letras diferentes = 1.
  // Aparecem primeiro os que combinam com MAIS palavras digitadas (de
  // preferência todas) e, entre eles, os de mais pontos. Assim "convidado
  // tste" acha "Convidado Teste" sem listar todo mundo que tem "Teste".
  function parecidos(texto) {
    const palavrasAlvo = normalizar(texto).split(/\s+/).filter((p) => p.length >= 3 || /^\d+$/.test(p));
    if (!palavrasAlvo.length) return [];
    const pontuados = [...estado.jogadores.values()].map((j) => {
      const palavras = normalizar(`${j.nome} ${j.apelido ?? ""}`).split(/\s+/).filter(Boolean);
      let pontos = 0, combinadas = 0;
      for (const pa of palavrasAlvo) {
        let melhor = 0;
        for (const p of palavras) {
          if (p === pa) melhor = Math.max(melhor, 3);
          else if (p.startsWith(pa) || (pa.length >= 3 && pa.startsWith(p) && p.length >= 3)) melhor = Math.max(melhor, 2);
          else if (p.length >= 4 && pa.length >= 4 && distancia(p, pa) <= 2) melhor = Math.max(melhor, 1);
        }
        pontos += melhor;
        if (melhor > 0) combinadas++;
      }
      return { j, pontos, combinadas };
    }).filter((x) => x.combinadas > 0);
    if (!pontuados.length) return [];
    const maisCombinadas = Math.max(...pontuados.map((x) => x.combinadas));
    return pontuados
      .filter((x) => x.combinadas === maisCombinadas)
      .sort((a, b) => b.pontos - a.pontos || porNome(a.j, b.j))
      .slice(0, 6)
      .map((x) => x.j);
  }

  // ---------------------------------------------------------------
  // Carregamento
  // ---------------------------------------------------------------
  async function carregarJogadores() {
    const { data, error } = await banco.from("jogadores")
      .select("id, nome, apelido, tipo, ativo").order("nome");
    if (error) throw error;
    estado.jogadores = new Map(data.map((j) => [j.id, j]));
  }

  // Lê presenças, cobranças e times do racha aberto e calcula o status de cada um.
  async function carregarDia() {
    const r = estado.racha;
    const [pres, cob, esc_, lan] = await Promise.all([
      banco.from("presencas").select("jogador_id, atuou_como_goleiro").eq("racha_id", r.id),
      banco.from("cobrancas").select("jogador_id").eq("racha_id", r.id),
      banco.from("escalacoes").select("jogador_id, equipe, gols, assistencias, gols_contra").eq("partida_id", r.partida_id),
      banco.from("lances").select("id, tipo, autor_id, assistencia_id, criado_em").eq("partida_id", r.partida_id).order("id"),
    ]);
    for (const resp of [pres, cob, esc_, lan]) if (resp.error) throw resp.error;
    estado.numeros = new Map(esc_.data.map((e) => [e.jogador_id, e]));
    estado.lances = lan.data;
    estado.status = new Map();
    for (const c of cob.data) estado.status.set(c.jogador_id, "faltou");         // cobrança sem presença
    for (const p of pres.data) estado.status.set(p.jogador_id, p.atuou_como_goleiro ? "goleiro" : "presente");
    estado.equipe = new Map(esc_.data.filter((e) => e.equipe).map((e) => [e.jogador_id, e.equipe]));
  }

  // Procura o racha de uma data (sem criar).
  async function buscarRacha(data) {
    const { data: rachas, error } = await banco.from("rachas")
      .select("id, data_jogo, valor_cobrado, partidas(id, numero)").eq("data_jogo", data);
    if (error) throw error;
    const r = rachas[0];
    if (!r) return null;
    const partida = (r.partidas || []).find((p) => p.numero === 1);
    return { id: r.id, data_jogo: r.data_jogo, valor_cobrado: r.valor_cobrado, partida_id: partida?.id ?? null };
  }

  async function valorPadrao() {
    const { data } = await banco.from("configuracoes").select("valor_padrao_racha").limit(1);
    return data && data[0] ? Number(data[0].valor_padrao_racha) : 15;
  }

  // ---------------------------------------------------------------
  // Desenho da tela
  // ---------------------------------------------------------------
  function desenhar() {
    if (!estado.racha) return desenharAbertura();
    const r = estado.racha;
    const contagem = { presente: 0, goleiro: 0, faltou: 0 };
    for (const s of estado.status.values()) contagem[s]++;
    const partes = [
      { id: "lista", nome: "Lista" },
      { id: "times", nome: "Times" },
      { id: "lances", nome: "Lances" },
      { id: "fechamento", nome: "Fechamento" },
    ];
    estado.el.innerHTML = `
      <div class="cartao racha-dia-topo">
        <div>
          <span class="racha-dia-data">${diaSemana(r.data_jogo)}, ${dataBR(r.data_jogo)}</span>
          <span class="racha-dia-sub">Valor: ${reais(r.valor_cobrado)} ·
            ${contagem.presente} presentes · ${contagem.goleiro} goleiro(s) · ${contagem.faltou} falta(s)</span>
          ${estado.equipe.size ? `<span class="racha-dia-placar">Placar: Time A <b class="num">${placar().a}</b> × <b class="num">${placar().b}</b> Time B</span>` : ""}
        </div>
        <button class="link-botao" type="button" data-acao="trocar-data">Outra data</button>
      </div>
      <div class="segmentado partes-racha" role="tablist" aria-label="Partes do racha">
        ${partes.map((p) => `<button type="button" class="segmento ${p.id === estado.parte ? "ativa" : ""}"
            data-parte="${p.id}" role="tab" aria-selected="${p.id === estado.parte}">${p.nome}</button>`).join("")}
      </div>
      <div id="parte-racha"></div>`;
    desenharParte();
  }

  function desenharParte() {
    const alvo = estado.el.querySelector("#parte-racha");
    if (estado.parte === "lista") alvo.innerHTML = htmlLista();
    else if (estado.parte === "times") alvo.innerHTML = htmlTimes();
    else if (estado.parte === "lances") alvo.innerHTML = htmlLances();
    else alvo.innerHTML = estado.fin ? htmlFechamento() : `<p class="vazio">Carregando…</p>`;
    if (estado.parte === "lista") {
      const busca = alvo.querySelector("#busca-dia");
      busca.addEventListener("input", () => {
        estado.busca = busca.value;
        alvo.querySelector("#lista-dia").innerHTML = htmlLinhasLista();
      });
      const novo = alvo.querySelector("#novo-nome");
      novo.addEventListener("input", () => {
        estado.novoNome = novo.value;
        alvo.querySelector("#novo-sugestoes").innerHTML = htmlSugestoes();
      });
    }
  }

  // --- 1. Abertura do racha
  async function desenharAbertura(mensagemAviso = "") {
    const valor = await valorPadrao().catch(() => 15);
    estado.el.innerHTML = `
      <div class="cartao">
        <h2 class="secao-titulo" style="margin-top:0">Abrir racha</h2>
        <form id="form-abrir" class="form-grade" novalidate>
          <label class="campo"><span>Data do jogo</span>
            <input type="date" id="abrir-data" value="${hojeISO()}" required></label>
          <label class="campo"><span>Valor por jogador (R$)</span>
            <input type="number" id="abrir-valor" min="0" step="0.5" value="${valor}" inputmode="decimal" required></label>
          ${mensagemAviso ? `<p class="mensagem mensagem-aviso">${esc(mensagemAviso)}</p>` : ""}
          <button class="botao botao-largo" type="submit">Abrir racha</button>
        </form>
        <p class="legenda">Se já existir um racha nessa data, ele é aberto (não cria outro).</p>
      </div>`;
    estado.el.querySelector("#form-abrir").addEventListener("submit", (e) => { e.preventDefault(); abrirRacha(); });
  }

  // --- 2. Lista do dia
  function htmlLista() {
    return `
      <div class="cartao novo-jogador">
        <label class="campo"><span>+ Novo jogador</span>
          <input type="text" id="novo-nome" value="${esc(estado.novoNome)}" placeholder="Nome de quem vai jogar"
                 autocomplete="off" autocapitalize="words"></label>
        <div id="novo-sugestoes">${htmlSugestoes()}</div>
      </div>
      <input class="busca" id="busca-dia" type="search" placeholder="Buscar jogador" value="${esc(estado.busca)}"
             autocomplete="off" aria-label="Buscar jogador na lista do dia">
      <ul class="lista lista-dia" id="lista-dia">${htmlLinhasLista()}</ul>
      <p class="legenda">Presente: joga e paga. Goleiro: joga e não paga. Faltou de última hora: paga e não
        ganha presença. Toque de novo no status marcado para tirar o jogador do dia.</p>`;
  }

  function htmlLinhasLista() {
    const busca = normalizar(estado.busca);
    // Ativos + quem já tem status no dia (mesmo inativo), em ordem alfabética,
    // com quem já está no dia primeiro.
    const lista = [...estado.jogadores.values()]
      .filter((j) => j.ativo || estado.status.has(j.id))
      .filter((j) => !busca || normalizar(`${j.nome} ${j.apelido ?? ""}`).includes(busca))
      .sort((a, b) => (estado.status.has(b.id) - estado.status.has(a.id)) || porNome(a, b));
    if (!lista.length) return `<li class="vazio">Ninguém encontrado.</li>`;
    const ROTULOS = [["presente", "Presente"], ["goleiro", "Goleiro"], ["faltou", "Faltou"]];
    return lista.map((j) => {
      const atual = estado.status.get(j.id);
      return `
        <li class="dia-linha ${estado.gravando.has(j.id) ? "gravando" : ""}">
          <span class="dia-nome">${esc(j.nome)}${j.apelido ? ` <small>“${esc(j.apelido)}”</small>` : ""}
            ${j.tipo === "goleiro" ? '<span class="selo selo-goleiro">goleiro</span>' : ""}</span>
          <span class="status-botoes" role="group" aria-label="Status de ${esc(j.nome)}">
            ${ROTULOS.map(([s, rotulo]) => `
              <button type="button" class="status status-${s} ${atual === s ? "ativa" : ""}"
                      data-jogador="${j.id}" data-status="${s}" aria-pressed="${atual === s}">${rotulo}</button>`).join("")}
          </span>
        </li>`;
    }).join("");
  }

  function htmlSugestoes() {
    const nome = estado.novoNome.trim();
    if (nome.length < 2) return "";
    const lista = parecidos(nome);
    const jaNoDia = (j) => estado.status.has(j.id);
    return `
      ${lista.length ? `<p class="legenda" style="margin-top:8px">Já existe? Toque para colocar na lista do dia:</p>
        <ul class="sugestoes">${lista.map((j) => `
          <li><button type="button" class="sugestao" data-acao="usar-existente" data-jogador="${j.id}" ${jaNoDia(j) ? "disabled" : ""}>
            ${esc(j.nome)}${j.apelido ? ` “${esc(j.apelido)}”` : ""}${!j.ativo ? " (inativo)" : ""}${jaNoDia(j) ? " — já está no dia" : ""}
          </button></li>`).join("")}</ul>` : ""}
      <button type="button" class="botao botao-largo botao-secundario" data-acao="cadastrar-novo">
        É outra pessoa: cadastrar “${esc(nome)}” e marcar presente</button>`;
  }

  // --- 3. Times
  function htmlTimes() {
    const presentes = [...estado.status.entries()]
      .filter(([, s]) => s === "presente" || s === "goleiro")
      .map(([id, s]) => ({ ...estado.jogadores.get(id), goleiro: s === "goleiro" }))
      .filter((j) => j.id);
    if (!presentes.length) {
      return `<div class="cartao"><p class="vazio" style="padding:8px 0">Marque os presentes na Lista primeiro.</p></div>`;
    }
    const grupo = (eq) => presentes.filter((j) => (estado.equipe.get(j.id) ?? null) === eq).sort(porNome);
    const semTime = grupo(null), timeA = grupo("A"), timeB = grupo("B");
    const linha = (j) => {
      const eq = estado.equipe.get(j.id);
      return `
        <li class="time-linha ${estado.gravando.has(j.id) ? "gravando" : ""}">
          <span class="dia-nome">${esc(j.nome)}${j.goleiro ? ' <span class="selo selo-goleiro">goleiro</span>' : ""}</span>
          <span class="status-botoes" role="group" aria-label="Time de ${esc(j.nome)}">
            <button type="button" class="status time-botao ${eq === "A" ? "ativa" : ""}" data-jogador="${j.id}" data-equipe="A" aria-pressed="${eq === "A"}">A</button>
            <button type="button" class="status time-botao ${eq === "B" ? "ativa" : ""}" data-jogador="${j.id}" data-equipe="B" aria-pressed="${eq === "B"}">B</button>
          </span>
        </li>`;
    };
    const bloco = (titulo, lista) => `
      <h3 class="secao-titulo">${titulo} <span class="contagem-time">${lista.length}</span></h3>
      ${lista.length ? `<ul class="lista lista-dia">${lista.map(linha).join("")}</ul>` : '<p class="vazio" style="padding:4px 0">Ninguém.</p>'}`;
    return `
      <div class="placar-times" aria-live="polite">
        <span>Time A <b class="num">${timeA.length}</b></span>
        <span>Time B <b class="num">${timeB.length}</b></span>
        <span>Sem time <b class="num">${semTime.length}</b></span>
      </div>
      ${semTime.length ? bloco("Sem time", semTime) : ""}
      ${bloco("Time A", timeA)}
      ${bloco("Time B", timeB)}
      <p class="legenda">Toque em A ou B para escolher o time. Toque de novo no time marcado para tirar do time.</p>`;
  }

  // --- 4. Lances e placar
  // Placar = gols do time + gols contra feitos pelo time adversário
  // (mesma regra da visão v_placar_partidas).
  function placar() {
    let a = 0, b = 0;
    for (const [id, n] of estado.numeros) {
      const eq = estado.equipe.get(id);
      if (eq === "A") { a += n.gols; b += n.gols_contra; }
      if (eq === "B") { b += n.gols; a += n.gols_contra; }
    }
    return { a, b };
  }

  const nomeDe = (id) => estado.jogadores.get(id)?.nome ?? "?";
  const outroTime = (eq) => (eq === "A" ? "B" : "A");

  // Texto de um lance, ex.: "Gol de Fulano (Time A) · assistência de Beltrano".
  function descreverLance(l) {
    const eq = estado.equipe.get(l.autor_id);
    const assist = l.assistencia_id ? ` · assistência de ${nomeDe(l.assistencia_id)}` : "";
    return l.tipo === "gol"
      ? `Gol de ${nomeDe(l.autor_id)} (Time ${eq})${assist}`
      : `Gol contra de ${nomeDe(l.autor_id)} (Time ${eq}) — conta para o Time ${outroTime(eq)}${assist}`;
  }

  // Jogadores escalados num time, em ordem alfabética.
  function doTime(eq) {
    return [...estado.equipe.entries()].filter(([, e]) => e === eq)
      .map(([id]) => estado.jogadores.get(id)).filter(Boolean).sort(porNome);
  }

  function htmlLances() {
    const { a, b } = placar();
    const telao = `
      <div class="telao telao-admin" aria-live="polite">
        <div class="telao-placar">
          <div class="telao-time"><span class="telao-rotulo">Time A</span><span class="telao-num num">${a}</span></div>
          <span class="telao-x">×</span>
          <div class="telao-time"><span class="telao-rotulo">Time B</span><span class="telao-num num">${b}</span></div>
        </div>
      </div>`;
    if (!estado.racha.partida_id) {
      return `<div class="cartao"><p class="vazio">Este racha não tem partida.</p></div>`;
    }
    if (!doTime("A").length || !doTime("B").length) {
      return telao + `<div class="cartao"><p class="vazio" style="padding:8px 0">Monte os dois times (aba Times) antes de lançar gols.</p></div>`;
    }
    if (estado.lance) return telao + htmlMontarLance();

    const historico = [...estado.lances].reverse().map((l) => `
      <li class="lance-linha">
        <span class="lance-hora">${new Date(l.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
        <span class="lance-icone" aria-hidden="true">${l.tipo === "gol" ? "⚽" : "↩︎"}</span>
        <span>${esc(descreverLance(l))}</span>
      </li>`).join("");
    return `
      ${telao}
      ${estado.ultimoAviso ? `<p class="mensagem mensagem-aviso" style="margin-bottom:12px">✔ ${esc(estado.ultimoAviso)}</p>` : ""}
      <div class="botoes-lance">
        <button type="button" class="botao botao-gol" data-acao="novo-lance" data-tipo="gol">⚽ Gol</button>
        <button type="button" class="botao botao-contra" data-acao="novo-lance" data-tipo="gol_contra">Gol contra</button>
      </div>
      <button type="button" class="botao botao-largo botao-secundario" data-acao="desfazer-lance"
              ${estado.lances.length ? "" : "disabled"}>↶ Desfazer último lance</button>
      <h3 class="secao-titulo">Lances (${estado.lances.length})</h3>
      ${historico ? `<ul class="lista lista-lances">${historico}</ul>` : `<p class="vazio" style="padding:4px 0">Nenhum lance ainda.</p>`}`;
  }

  // Passo a passo do lance: 1) autor; 2) assistência (opcional).
  function htmlMontarLance() {
    const l = estado.lance;
    const nomeTipo = l.tipo === "gol" ? "Gol" : "Gol contra";
    const botaoJogador = (j, acao) => `
      <button type="button" class="escolha-jogador" data-acao="${acao}" data-jogador="${j.id}">${esc(j.nome)}</button>`;
    if (!l.autorId) {
      const grupo = (eq) => `
        <div class="escolha-time">
          <h4>Time ${eq}</h4>
          ${doTime(eq).map((j) => botaoJogador(j, "lance-autor")).join("")}
        </div>`;
      return `
        <div class="cartao montar-lance">
          <h3>${nomeTipo}: ${l.tipo === "gol" ? "quem marcou?" : "quem fez o gol contra?"}</h3>
          <div class="escolha-times">${grupo("A")}${grupo("B")}</div>
          <button type="button" class="link-botao" data-acao="cancelar-lance">Cancelar</button>
        </div>`;
    }
    const eqAutor = estado.equipe.get(l.autorId);
    // Gol: assistência do mesmo time. Gol contra: do time adversário.
    const eqAssist = l.tipo === "gol" ? eqAutor : outroTime(eqAutor);
    const opcoes = doTime(eqAssist).filter((j) => j.id !== l.autorId);
    return `
      <div class="cartao montar-lance">
        <h3>${nomeTipo} de ${esc(nomeDe(l.autorId))} (Time ${eqAutor})</h3>
        <p class="legenda" style="margin-top:0">Assistência de quem? ${l.tipo === "gol" ? `(só do Time ${eqAutor})` : `(só do Time ${eqAssist}, o adversário)`}</p>
        <button type="button" class="botao botao-largo" data-acao="lance-assist" data-jogador="">Sem assistência</button>
        <div class="escolha-time escolha-unica">${opcoes.map((j) => botaoJogador(j, "lance-assist")).join("")}</div>
        <div class="montar-lance-rodape">
          <button type="button" class="link-botao" data-acao="voltar-lance">Voltar</button>
          <button type="button" class="link-botao" data-acao="cancelar-lance">Cancelar</button>
        </div>
      </div>`;
  }

  // Grava o lance montado. O banco valida times e soma nas escalações.
  function gravarLance(assistenciaId) {
    const l = estado.lance;
    const registro = {
      partida_id: estado.racha.partida_id,
      tipo: l.tipo,
      autor_id: l.autorId,
      assistencia_id: assistenciaId || null,
    };
    gravar(
      () => banco.from("lances").insert(registro).select("id").single(),
      async () => {
        estado.lance = null;
        estado.ultimoAviso = descreverLance(registro) + " — registrado.";
        await carregarDia();
        desenhar();
      });
  }

  function desfazerLance() {
    const ultimo = estado.lances[estado.lances.length - 1];
    if (!ultimo) return;
    if (!confirm(`Desfazer o último lance?\n\n${descreverLance(ultimo)}`)) return;
    gravar(
      () => banco.rpc("desfazer_ultimo_lance", { p_partida: estado.racha.partida_id }),
      async () => {
        estado.ultimoAviso = `Desfeito: ${descreverLance(ultimo)}.`;
        await carregarDia();
        desenhar();
      });
  }

  // --- 5. Fechamento financeiro
  const FORMAS = [["pix", "Pix"], ["dinheiro", "Dinheiro"], ["cartao", "Cartão"]];
  const NOME_FORMA = { pix: "Pix", dinheiro: "Dinheiro", cartao: "Cartão", nao_informado: "Não informado" };

  // Busca as cobranças do racha, o saldo acumulado de quem foi cobrado e
  // os pagamentos registrados na data do racha.
  async function carregarFinanceiro() {
    const r = estado.racha;
    const cob = await banco.from("cobrancas").select("jogador_id, valor").eq("racha_id", r.id);
    if (cob.error) throw cob.error;
    const ids = cob.data.map((c) => c.jogador_id);
    const [sal, pag] = await Promise.all([
      ids.length ? banco.from("v_saldos_jogadores").select("jogador_id, saldo").in("jogador_id", ids)
                 : Promise.resolve({ data: [], error: null }),
      banco.from("pagamentos").select("id, jogador_id, valor, forma, criado_em")
        .eq("data_pagamento", r.data_jogo).order("id"),
    ]);
    if (sal.error) throw sal.error;
    if (pag.error) throw pag.error;
    estado.fin = {
      cobrancas: new Map(cob.data.map((c) => [c.jogador_id, Number(c.valor)])),
      saldos: new Map(sal.data.map((x) => [x.jogador_id, Number(x.saldo)])),
      pagamentos: pag.data.map((x) => ({ ...x, valor: Number(x.valor) })),
    };
  }

  function htmlFechamento() {
    const fin = estado.fin;
    if (!fin.cobrancas.size) {
      return `<div class="cartao"><p class="vazio" style="padding:8px 0">Ninguém tem cobrança neste racha ainda.
        Marque os presentes (e quem faltou de última hora) na Lista.</p></div>`;
    }
    // --- Resumo do dia
    const totalCobrado = [...fin.cobrancas.values()].reduce((a, v) => a + v, 0);
    const porForma = {};
    for (const pg of fin.pagamentos) porForma[pg.forma] = (porForma[pg.forma] || 0) + pg.valor;
    const totalRecebido = Object.values(porForma).reduce((a, v) => a + v, 0);
    const devendo = [...fin.cobrancas.keys()]
      .filter((id) => (fin.saldos.get(id) ?? 0) > 0)
      .map((id) => ({ id, nome: nomeDe(id), saldo: fin.saldos.get(id) }))
      .sort((a, b) => b.saldo - a.saldo || a.nome.localeCompare(b.nome, "pt-BR"));
    const resumo = `
      <div class="cartao resumo-dia">
        <h3 class="secao-titulo" style="margin-top:0">Resumo do dia</h3>
        <div class="resumo-numeros">
          <div><span>Cobrado</span><b class="num">${reais(totalCobrado)}</b><small>${fin.cobrancas.size} jogador(es)</small></div>
          <div><span>Recebido</span><b class="num">${reais(totalRecebido)}</b><small>${fin.pagamentos.length} pagamento(s)</small></div>
        </div>
        <ul class="resumo-formas">
          ${[...FORMAS, ["nao_informado", "Não informado"]].filter(([f]) => f !== "nao_informado" || porForma[f])
            .map(([f, nome]) => `<li><span>${nome}</span><b>${reais(porForma[f] || 0)}</b></li>`).join("")}
        </ul>
        <p class="resumo-devendo"><b>Ficaram devendo (${devendo.length}):</b>
          ${devendo.length ? devendo.map((d) => `${esc(d.nome)} (${reais(d.saldo)})`).join(", ") : "ninguém 🎉"}</p>
      </div>`;

    // --- Lista de quem tem cobrança no dia
    const linhas = [...fin.cobrancas.keys()]
      .map((id) => ({ id, nome: nomeDe(id) }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      .map(({ id, nome }) => {
        const saldo = fin.saldos.get(id) ?? 0;
        const situacao = saldo > 0 ? `<span class="saldo saldo-deve">deve ${reais(saldo)}</span>`
          : saldo < 0 ? `<span class="saldo saldo-credito">crédito ${reais(-saldo)}</span>`
          : `<span class="saldo saldo-ok">em dia</span>`;
        const doDia = fin.pagamentos.filter((pg) => pg.jogador_id === id);
        const status = estado.status.get(id) === "faltou" ? ' <span class="selo selo-falta">faltou</span>' : "";
        return `
          <li class="fin-linha">
            <div class="fin-topo">
              <span class="dia-nome">${esc(nome)}${status}</span>
              ${situacao}
            </div>
            ${doDia.length ? `<div class="fin-pagos">${doDia.map((pg) => `
              <span class="pago-chip">${NOME_FORMA[pg.forma]} ${reais(pg.valor)}
                <button type="button" data-acao="excluir-pagamento" data-pagamento="${pg.id}" aria-label="Excluir pagamento de ${esc(nome)}">✕</button>
              </span>`).join("")}</div>` : ""}
            ${estado.pagando?.id === id ? htmlFormPagou(id) : `
              <button type="button" class="botao botao-pagou" data-acao="abrir-pagou" data-jogador="${id}">Pagou</button>`}
          </li>`;
      }).join("");
    return `
      ${resumo}
      <ul class="lista lista-fin">${linhas}</ul>
      <p class="legenda">Saldo acumulado = tudo o que já foi cobrado − tudo o que já foi pago (inclui rachas
        anteriores). O valor do "Pagou" pode ser maior que ${reais(estado.racha.valor_cobrado)} para quitar dívidas antigas.</p>`;
  }

  function htmlFormPagou(id) {
    const pg = estado.pagando;
    return `
      <div class="form-pagou">
        <span class="form-pagou-rotulo">Forma de pagamento (obrigatório)</span>
        <div class="status-botoes formas" role="group" aria-label="Forma de pagamento">
          ${FORMAS.map(([f, nome]) => `
            <button type="button" class="status ${pg.forma === f ? "ativa status-presente" : ""}" data-acao="forma" data-forma="${f}"
                    aria-pressed="${pg.forma === f}">${nome}</button>`).join("")}
        </div>
        <label class="campo"><span>Valor (R$)</span>
          <input type="number" id="pagou-valor" min="0.01" step="0.5" inputmode="decimal" value="${pg.valor}"></label>
        <div class="form-pagou-botoes">
          <button type="button" class="link-botao" data-acao="cancelar-pagou">Cancelar</button>
          <button type="button" class="botao" data-acao="confirmar-pagou" ${pg.forma ? "" : "disabled"}>Confirmar pagamento</button>
        </div>
      </div>`;
  }

  function abrirPagou(id) {
    // Valor sugerido: o do racha (editável).
    estado.pagando = { id, forma: null, valor: Number(estado.racha.valor_cobrado) || 15 };
    desenharParte();
    estado.el.querySelector("#pagou-valor")?.addEventListener("input", (e) => { estado.pagando.valor = e.target.value; });
  }

  function escolherForma(forma) {
    const valorDigitado = estado.el.querySelector("#pagou-valor")?.value;
    if (valorDigitado) estado.pagando.valor = valorDigitado;
    estado.pagando.forma = forma;
    desenharParte();
    estado.el.querySelector("#pagou-valor")?.addEventListener("input", (e) => { estado.pagando.valor = e.target.value; });
  }

  function confirmarPagou() {
    const pg = estado.pagando;
    const valor = Number(String(estado.el.querySelector("#pagou-valor")?.value ?? pg.valor).replace(",", "."));
    if (!pg.forma) return mostrarFalha("Escolha a forma de pagamento: Pix, Dinheiro ou Cartão.");
    if (!(valor > 0)) return mostrarFalha("Informe um valor maior que zero.");
    const registro = {
      jogador_id: pg.id, valor, forma: pg.forma,
      data_pagamento: estado.racha.data_jogo,
      observacao: `Racha de ${dataBR(estado.racha.data_jogo)}`,
    };
    gravar(
      () => banco.from("pagamentos").insert(registro).select("id").single(),
      async () => { estado.pagando = null; await carregarFinanceiro(); desenharParte(); });
  }

  function excluirPagamento(pagamentoId) {
    const pg = estado.fin.pagamentos.find((x) => x.id === pagamentoId);
    if (!pg) return;
    if (!confirm(`Excluir o pagamento de ${nomeDe(pg.jogador_id)}: ${NOME_FORMA[pg.forma]} ${reais(pg.valor)}?`)) return;
    gravar(
      () => banco.from("pagamentos").delete().eq("id", pagamentoId),
      async () => { await carregarFinanceiro(); desenharParte(); });
  }

  async function abrirFechamento() {
    estado.fin = null;
    estado.pagando = null;
    desenhar();
    await gravar(() => carregarFinanceiro(), () => desenharParte());
  }

  // ---------------------------------------------------------------
  // Ações (cada uma grava na hora)
  // ---------------------------------------------------------------
  async function abrirRacha() {
    const data = estado.el.querySelector("#abrir-data").value;
    const valor = Number(estado.el.querySelector("#abrir-valor").value);
    if (!data) return mostrarFalha("Escolha a data do jogo.");
    if (!(valor >= 0)) return mostrarFalha("Informe um valor válido (pode ser 0).");
    await gravar(
      () => banco.rpc("abrir_racha", { p_data: data, p_valor: valor }),
      async (linhas) => {
        const r = linhas[0];
        estado.racha = { id: r.racha_id, partida_id: r.partida_id, data_jogo: data, valor_cobrado: valor };
        // Busca o valor gravado de fato (no racha já existente, vale o dele).
        const gravado = await buscarRacha(data);
        if (gravado) estado.racha = gravado;
        await carregarDia();
        estado.parte = "lista";
        desenhar();
        if (r.ja_existia) {
          mostrarAviso(`Já existe um racha em ${dataBR(data)}: abri o existente (valor ${reais(estado.racha.valor_cobrado)}).`);
        }
      });
  }

  function definirStatus(jogadorId, status) {
    const atual = estado.status.get(jogadorId);
    const jogador = estado.jogadores.get(jogadorId);
    let novo = status;
    if (atual === status) {
      // Tocar de novo no status marcado = tirar do dia (pede confirmação).
      if (!confirm(`Tirar ${jogador.nome} da lista do dia? (Remove presença, cobrança e time.)`)) return;
      novo = "nenhum";
    }
    estado.gravando.add(jogadorId);
    redesenharLista();
    gravar(
      () => banco.rpc("definir_status_dia", { p_racha: estado.racha.id, p_jogador: jogadorId, p_status: novo }),
      () => {
        // Mesmas regras do banco, aplicadas na tela sem precisar recarregar.
        if (novo === "nenhum") { estado.status.delete(jogadorId); estado.equipe.delete(jogadorId); }
        else estado.status.set(jogadorId, novo);
        if (novo === "faltou") estado.equipe.delete(jogadorId);
        // Redesenha aqui também: se esta gravação vier do "Tentar de novo",
        // é este trecho que atualiza a tela.
        desenhar();
      }).finally(() => { estado.gravando.delete(jogadorId); desenhar(); });
  }

  function definirEquipe(jogadorId, equipe) {
    const atual = estado.equipe.get(jogadorId) ?? null;
    const novo = atual === equipe ? null : equipe;
    estado.gravando.add(jogadorId);
    desenharParte();
    gravar(
      () => banco.rpc("definir_equipe", { p_racha: estado.racha.id, p_jogador: jogadorId, p_equipe: novo }),
      () => {
        if (novo) estado.equipe.set(jogadorId, novo); else estado.equipe.delete(jogadorId);
        desenharParte();  // também atualiza a tela quando vier do "Tentar de novo"
      }
    ).finally(() => { estado.gravando.delete(jogadorId); desenharParte(); });
  }

  // "+ novo jogador": usar um cadastro existente (parecido) ou criar um novo.
  function usarExistente(jogadorId) {
    estado.novoNome = "";
    definirStatus(jogadorId, "presente");
  }

  async function cadastrarNovo() {
    const nome = estado.novoNome.trim().replace(/\s+/g, " ");
    if (nome.length < 2) return mostrarFalha("Digite o nome do novo jogador.");
    if (!confirm(`Cadastrar "${nome}" como novo jogador (linha, ativo) e marcar presente?`)) return;
    await gravar(
      () => banco.from("jogadores").insert({ nome, tipo: "linha", ativo: true }).select("id, nome, apelido, tipo, ativo").single(),
      (jogador) => {
        estado.jogadores.set(jogador.id, jogador);
        estado.novoNome = "";
        definirStatus(jogador.id, "presente");
      });
  }

  function redesenharLista() {
    const lista = estado.el.querySelector("#lista-dia");
    if (lista) lista.innerHTML = htmlLinhasLista();
  }

  function mostrarAviso(texto) {
    const topo = estado.el.querySelector(".racha-dia-topo");
    if (!topo) return;
    const aviso = document.createElement("p");
    aviso.className = "mensagem mensagem-aviso";
    aviso.style.marginBottom = "12px";
    aviso.textContent = texto;
    topo.after(aviso);
  }

  // Um único "ouvinte" de toques para a tela toda (os botões são redesenhados).
  function aoTocar(evento) {
    const b = evento.target.closest("button");
    if (!b || b.disabled) return;
    if (b.dataset.parte) {
      estado.parte = b.dataset.parte; estado.lance = null;
      if (estado.parte === "fechamento") abrirFechamento(); else desenhar();
      return;
    }
    if (b.dataset.status) { definirStatus(Number(b.dataset.jogador), b.dataset.status); return; }
    if (b.dataset.equipe) { definirEquipe(Number(b.dataset.jogador), b.dataset.equipe); return; }
    if (b.dataset.acao === "trocar-data") { estado.racha = null; desenharAbertura(); return; }
    if (b.dataset.acao === "usar-existente") { usarExistente(Number(b.dataset.jogador)); return; }
    if (b.dataset.acao === "cadastrar-novo") { cadastrarNovo(); return; }
    if (b.dataset.acao === "novo-lance") { estado.lance = { tipo: b.dataset.tipo, autorId: null }; estado.ultimoAviso = ""; desenharParte(); return; }
    if (b.dataset.acao === "lance-autor") { estado.lance.autorId = Number(b.dataset.jogador); desenharParte(); return; }
    if (b.dataset.acao === "lance-assist") { gravarLance(b.dataset.jogador ? Number(b.dataset.jogador) : null); return; }
    if (b.dataset.acao === "voltar-lance") { estado.lance.autorId = null; desenharParte(); return; }
    if (b.dataset.acao === "cancelar-lance") { estado.lance = null; desenharParte(); return; }
    if (b.dataset.acao === "desfazer-lance") { desfazerLance(); return; }
    if (b.dataset.acao === "abrir-pagou") { abrirPagou(Number(b.dataset.jogador)); return; }
    if (b.dataset.acao === "forma") { escolherForma(b.dataset.forma); return; }
    if (b.dataset.acao === "cancelar-pagou") { estado.pagando = null; desenharParte(); return; }
    if (b.dataset.acao === "confirmar-pagou") { confirmarPagou(); return; }
    if (b.dataset.acao === "excluir-pagamento") { excluirPagamento(Number(b.dataset.pagamento)); return; }
  }

  // ---------------------------------------------------------------
  // Entrada da seção
  // ---------------------------------------------------------------
  async function abrir(painel) {
    // Cria uma área só desta seção (os toques são ouvidos só aqui dentro).
    painel.innerHTML = `<div id="secao-racha"></div>`;
    const el = painel.querySelector("#secao-racha");
    estado.el = el;
    el.addEventListener("click", aoTocar);
    el.innerHTML = `<p class="vazio">Carregando…</p>`;
    try {
      await carregarJogadores();
      // Se já há racha aberto nesta sessão, continua nele; senão, tenta o de hoje.
      if (!estado.racha) estado.racha = await buscarRacha(hojeISO());
      if (estado.racha) await carregarDia();
      desenhar();
    } catch (erro) {
      el.innerHTML = "";
      mostrarFalha(explicarErro(erro), () => abrir(painel));
    }
  }

  return { abrir };
})();
