// =====================================================================
// App do Racha — área pública (sem login)
// =====================================================================
// Este arquivo busca os dados no Supabase e desenha as telas:
//   * Rankings  (#rankings, #rankings/<categoria>)
//   * Rachas    (#rachas, e o detalhe em #racha/<id>)
//   * Jogadores (#jogadores, e a ficha em #jogador/<id>)
//
// A "rota" fica no endereço depois do # (ex.: index.html#racha/12).
// Assim o botão "voltar" do celular funciona normalmente.
//
// IMPORTANTE: a área pública só consulta tabelas e visões públicas
// (jogadores, escalacoes e as visões de ranking). Nunca toca no financeiro.
// =====================================================================


// ---------------------------------------------------------------------
// Conexão com o banco
// ---------------------------------------------------------------------
const banco = window.supabase.createClient(
  window.CONFIG.SUPABASE_URL,
  window.CONFIG.SUPABASE_CHAVE_PUBLICA
);

// Tempo máximo de espera por uma resposta do banco (em milissegundos).
const TEMPO_LIMITE = 15000;

// Mínimo de partidas com times para entrar no ranking de aproveitamento.
const MINIMO_APROVEITAMENTO = 5;


// ---------------------------------------------------------------------
// Dados carregados uma vez só (são pequenos) e reaproveitados nas telas
// ---------------------------------------------------------------------
const dados = {
  carregado: false,
  jogadores: new Map(),     // id -> cadastro (nome, apelido, posição, tipo, ativo)
  estatisticas: new Map(),  // id -> números da visão v_estatisticas_jogadores
  sequencias: new Map(),    // id -> sequência atual e melhor
  partidas: [],             // todas as partidas, com placar (v_placar_partidas)
  rachas: [],               // partidas agrupadas por racha, do mais recente ao mais antigo
};

// Escalações já buscadas, para não perguntar de novo ao banco.
const cacheEscalacoesRacha = new Map();    // racha id -> escalações
const cacheEscalacoesJogador = new Map();  // jogador id -> escalações


// ---------------------------------------------------------------------
// Categorias do ranking
// ---------------------------------------------------------------------
// Cada categoria diz qual número ordenar, como mostrar e quem entra.
const CATEGORIAS = [
  { id: "artilharia", nome: "Artilharia", campo: "gols", unidade: "gols" },
  { id: "assistencias", nome: "Assistências", campo: "assistencias", unidade: "assist." },
  {
    id: "participacoes", nome: "Participações em gol", campo: "participacoes_em_gol", unidade: "G + A",
    detalhe: (e) => `${e.gols} gols · ${e.assistencias} assist.`,
  },
  {
    id: "vitorias", nome: "Vitórias", campo: "vitorias", unidade: "vitórias",
    detalhe: (e) => `${e.vitorias}V · ${e.empates}E · ${e.derrotas}D`,
  },
  {
    id: "aproveitamento", nome: "Aproveitamento", campo: "aproveitamento", unidade: "%",
    // Só quem tem o mínimo de partidas com times (inclui quem tem 0%).
    filtro: (e) => e.partidas_com_times >= MINIMO_APROVEITAMENTO && e.aproveitamento !== null,
    formato: (v) => `${formatarDecimal(v)}%`,
    detalhe: (e) => `${e.partidas_com_times} jogos · ${e.vitorias}V ${e.empates}E ${e.derrotas}D`,
    nota: `Pontos ganhos ÷ pontos possíveis (vitória = 3, empate = 1). ` +
          `Só entra quem tem ${MINIMO_APROVEITAMENTO} ou mais partidas com times.`,
  },
  { id: "presenca", nome: "Presença", campo: "presencas", unidade: "rachas" },
  {
    id: "sequencia", nome: "Sequência", campo: "melhor_sequencia", unidade: "melhor",
    fonte: "sequencias",
    // Desempate: quem tem a maior sequência atual fica na frente.
    desempate: "sequencia_atual",
    detalhe: (s) => `Sequência atual: ${s.sequencia_atual} ${s.sequencia_atual === 1 ? "vitória" : "vitórias"}`,
    nota: "Vitórias seguidas, só em partidas com times. Empate ou derrota quebram a sequência.",
  },
];


// =====================================================================
// FUNÇÕES AUXILIARES
// =====================================================================

// Protege contra textos com símbolos especiais (evita "quebrar" a página).
function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// "2026-08-20" -> "20/08/2026" (sem usar fuso horário, para não mudar o dia).
function dataBR(iso) {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

// "2026-08-20" -> "quinta"
function diaSemana(iso) {
  const [ano, mes, dia] = iso.split("-").map(Number);
  const nomes = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  return nomes[new Date(ano, mes - 1, dia).getDay()];
}

// 58.3 -> "58,3"
function formatarDecimal(valor) {
  return Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

// Remove acentos e deixa minúsculo, para a busca achar "joao" em "João".
function normalizar(texto) {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Nome da origem do racha, para mostrar na tela.
function nomeOrigem(origem) {
  return { mocha: "Mocha", recuperado: "Recuperado", app: "App" }[origem] ?? origem;
}

// Selos ao lado do nome: convidado, goleiro, inativo.
function selosJogador(jogador) {
  if (!jogador) return "";
  let html = "";
  if (jogador.tipo === "convidado") html += `<span class="selo selo-convidado">convidado</span>`;
  if (jogador.tipo === "goleiro") html += `<span class="selo selo-goleiro">goleiro</span>`;
  if (jogador.ativo === false) html += `<span class="selo selo-origem">inativo</span>`;
  return html;
}

// Esqueleto de carregamento: linhas "fantasma" no formato da lista que vai
// aparecer. Com chips = também desenha os botões de categoria do ranking.
function esqueleto({ linhas = 6, chips = false } = {}) {
  const linha = `
    <li class="esqueleto-linha">
      <span class="esqueleto esqueleto-circulo"></span>
      <span class="esqueleto-textos">
        <span class="esqueleto esqueleto-texto"></span>
        <span class="esqueleto esqueleto-texto curto"></span>
      </span>
      <span class="esqueleto esqueleto-valor"></span>
    </li>`;
  const botoes = chips
    ? `<div class="esqueleto-chips">${'<span class="esqueleto esqueleto-chip"></span>'.repeat(4)}</div>`
    : "";
  return `<div aria-busy="true" aria-label="Carregando">${botoes}
    <ul class="lista">${linha.repeat(linhas)}</ul></div>`;
}

// Espera a resposta do banco, mas desiste depois do tempo limite.
async function consultar(promessa) {
  const limite = new Promise((_, rejeitar) =>
    setTimeout(() => rejeitar(new Error("tempo esgotado")), TEMPO_LIMITE));
  const { data, error } = await Promise.race([promessa, limite]);
  if (error) throw error;
  return data;
}


// =====================================================================
// CARREGAMENTO DOS DADOS
// =====================================================================

// Busca, de uma vez, tudo que as listas precisam.
// Se várias telas pedirem ao mesmo tempo, todas esperam a MESMA busca.
let buscaEmAndamento = null;
function carregarDadosBase() {
  if (!buscaEmAndamento) {
    buscaEmAndamento = buscarDadosBase().catch((erro) => {
      buscaEmAndamento = null;  // permite tentar de novo depois de um erro
      throw erro;
    });
  }
  return buscaEmAndamento;
}

async function buscarDadosBase() {

  const [jogadores, estatisticas, sequencias, partidas] = await Promise.all([
    consultar(banco.from("jogadores").select("id, nome, apelido, posicao, tipo, ativo")),
    consultar(banco.from("v_estatisticas_jogadores").select("*")),
    consultar(banco.from("v_sequencias").select("jogador_id, sequencia_atual, melhor_sequencia")),
    consultar(banco.from("v_placar_partidas").select("*")),
  ]);

  jogadores.forEach((j) => dados.jogadores.set(j.id, j));
  estatisticas.forEach((e) => dados.estatisticas.set(e.jogador_id, e));
  sequencias.forEach((s) => dados.sequencias.set(s.jogador_id, s));
  dados.partidas = partidas;

  // Agrupa as partidas por racha (um racha pode ter várias partidas).
  const porRacha = new Map();
  for (const p of partidas) {
    if (!porRacha.has(p.racha_id)) {
      porRacha.set(p.racha_id, {
        id: p.racha_id, data_jogo: p.data_jogo, origem: p.origem,
        tem_times: p.tem_times, partidas: [],
      });
    }
    porRacha.get(p.racha_id).partidas.push(p);
  }
  dados.rachas = [...porRacha.values()]
    .sort((a, b) => b.data_jogo.localeCompare(a.data_jogo));
  dados.rachas.forEach((r) => r.partidas.sort((a, b) => a.numero - b.numero));

  dados.carregado = true;
}

// Escalações de todas as partidas de um racha.
async function carregarEscalacoesRacha(racha) {
  if (cacheEscalacoesRacha.has(racha.id)) return cacheEscalacoesRacha.get(racha.id);
  const ids = racha.partidas.map((p) => p.partida_id);
  const lista = await consultar(
    banco.from("escalacoes")
      .select("partida_id, jogador_id, equipe, gols, assistencias, gols_contra")
      .in("partida_id", ids)
  );
  cacheEscalacoesRacha.set(racha.id, lista);
  return lista;
}

// Todas as escalações de um jogador.
async function carregarEscalacoesJogador(jogadorId) {
  if (cacheEscalacoesJogador.has(jogadorId)) return cacheEscalacoesJogador.get(jogadorId);
  const lista = await consultar(
    banco.from("escalacoes")
      .select("partida_id, equipe, gols, assistencias, gols_contra")
      .eq("jogador_id", jogadorId)
  );
  cacheEscalacoesJogador.set(jogadorId, lista);
  return lista;
}


// =====================================================================
// TELA: RANKINGS
// =====================================================================

function telaRankings(idCategoria) {
  const categoria = CATEGORIAS.find((c) => c.id === idCategoria) ?? CATEGORIAS[0];

  // Botões de categoria (rolam para o lado no celular).
  const botoes = CATEGORIAS.map((c) => `
    <a class="categoria ${c.id === categoria.id ? "ativa" : ""}" href="#rankings/${c.id}"
       ${c.id === categoria.id ? 'aria-current="true"' : ""}>${esc(c.nome)}</a>`).join("");

  // Monta a lista de quem entra no ranking.
  const fonte = categoria.fonte === "sequencias" ? dados.sequencias : dados.estatisticas;
  let linhas = [...fonte.values()].filter((item) =>
    categoria.filtro ? categoria.filtro(item) : Number(item[categoria.campo]) > 0);

  // Ordena: maior valor primeiro; empate pelo critério extra e depois pelo nome.
  const nomeDe = (item) => dados.jogadores.get(item.jogador_id)?.nome ?? "";
  linhas.sort((a, b) =>
    Number(b[categoria.campo]) - Number(a[categoria.campo]) ||
    (categoria.desempate ? b[categoria.desempate] - a[categoria.desempate] : 0) ||
    nomeDe(a).localeCompare(nomeDe(b), "pt-BR"));

  // Posição: quem empata no número principal divide a mesma posição (1, 1, 3...).
  let posicao = 0;
  const itens = linhas.map((item, i) => {
    if (i === 0 || Number(item[categoria.campo]) !== Number(linhas[i - 1][categoria.campo])) {
      posicao = i + 1;
    }
    const jogador = dados.jogadores.get(item.jogador_id);
    const valor = categoria.formato ? categoria.formato(item[categoria.campo]) : item[categoria.campo];
    const sub = categoria.detalhe ? categoria.detalhe(item)
      : (jogador?.apelido ? `“${esc(jogador.apelido)}”` : "");
    const podio = posicao <= 3 ? `podio podio-${posicao}` : "";
    return `
      <li class="${podio}">
        <a class="linha" href="#jogador/${item.jogador_id}">
          <span class="posicao">${posicao}º</span>
          <span class="linha-principal">
            <span class="linha-nome">${esc(jogador?.nome)}${selosJogador(jogador)}</span>
            ${sub ? `<span class="linha-sub">${sub}</span>` : ""}
          </span>
          <span class="linha-valor">${esc(valor)}<small>${esc(categoria.unidade === "%" ? "" : categoria.unidade)}</small></span>
        </a>
      </li>`;
  }).join("");

  return {
    titulo: "Rankings",
    html: `
      <nav class="categorias" aria-label="Categorias do ranking">${botoes}</nav>
      ${categoria.nota ? `<p class="nota">${esc(categoria.nota)}</p>` : ""}
      ${itens ? `<ol class="lista">${itens}</ol>` : `<p class="vazio">Ninguém nesta categoria ainda.</p>`}
      <p class="legenda">Totais calculados a partir dos jogos, já com os ajustes manuais do histórico.</p>`,
  };
}


// =====================================================================
// TELA: LISTA DE RACHAS
// =====================================================================

// Placar curto de uma partida, ex.: "A 13 x 7 B" (com o vencedor em verde).
function placarCurto(p) {
  const a = p.resultado === "A" ? "vencedor" : "";
  const b = p.resultado === "B" ? "vencedor" : "";
  return `<span class="equipe">A</span> <span class="${a}">${p.gols_a}</span> x
          <span class="${b}">${p.gols_b}</span> <span class="equipe">B</span>`;
}

function telaRachas() {
  if (!dados.rachas.length) {
    return { titulo: "Rachas", html: `<p class="vazio">Nenhum racha registrado ainda.</p>` };
  }

  const itens = dados.rachas.map((r) => {
    const varias = r.partidas.length > 1;
    // Com times: mostra o placar de cada partida. Sem times: aviso.
    const placares = r.tem_times
      ? r.partidas.map((p) =>
          `<div class="placar">${varias ? `<span class="equipe">P${p.numero}</span> ` : ""}${placarCurto(p)}</div>`).join("")
      : "";
    return `
      <li>
        <a class="linha" href="#racha/${r.id}">
          <span class="linha-principal">
            <span class="racha-data">${dataBR(r.data_jogo)}</span>
            <span class="selo selo-origem">${esc(nomeOrigem(r.origem))}</span>
            <span class="linha-sub">${diaSemana(r.data_jogo)}${varias ? ` · ${r.partidas.length} partidas` : ""}</span>
            ${r.tem_times ? "" : `<p class="aviso">Reconstruído de anotações — sem times e placar</p>`}
          </span>
          ${placares ? `<span>${placares}</span>` : ""}
        </a>
      </li>`;
  }).join("");

  return { titulo: "Rachas", html: `<ul class="lista">${itens}</ul>` };
}


// =====================================================================
// TELA: DETALHE DO RACHA
// =====================================================================

// Uma linha de jogador com seus números na partida.
function linhaJogadorPartida(e) {
  const jogador = dados.jogadores.get(e.jogador_id);
  const gc = e.gols_contra > 0 ? `<span>GC <b>${e.gols_contra}</b></span>` : "";
  return `
    <li>
      <a class="linha" href="#jogador/${e.jogador_id}">
        <span class="linha-principal">
          <span class="linha-nome">${esc(jogador?.nome)}${selosJogador(jogador)}</span>
        </span>
        <span class="numeros">
          <span>G <b>${e.gols}</b></span>
          <span>A <b>${e.assistencias}</b></span>
          ${gc}
        </span>
      </a>
    </li>`;
}

// Ordena jogadores da partida: mais gols, depois mais assistências, depois nome.
function ordenarEscalacao(lista) {
  return [...lista].sort((a, b) =>
    b.gols - a.gols || b.assistencias - a.assistencias ||
    (dados.jogadores.get(a.jogador_id)?.nome ?? "")
      .localeCompare(dados.jogadores.get(b.jogador_id)?.nome ?? "", "pt-BR"));
}

async function telaRacha(id) {
  const racha = dados.rachas.find((r) => r.id === id);
  if (!racha) return { titulo: "Racha", html: `<p class="vazio">Racha não encontrado.</p>` };

  const escalacoes = await carregarEscalacoesRacha(racha);
  const titulo = `Racha de ${dataBR(racha.data_jogo)}`;

  let html = `
    <p class="linha-sub">${diaSemana(racha.data_jogo)} ·
      <span class="selo selo-origem" style="margin-left:0">${esc(nomeOrigem(racha.origem))}</span></p>`;

  for (const p of racha.partidas) {
    const desta = escalacoes.filter((e) => e.partida_id === p.partida_id);
    const rotulo = racha.partidas.length > 1 ? `Partida ${p.numero}` : "";

    if (!racha.tem_times) {
      // Racha recuperado: sem times e sem placar, só a lista de quem jogou.
      html += `
        ${rotulo ? `<h2 class="secao-titulo">${rotulo}</h2>` : ""}
        <p class="aviso" style="margin-bottom:16px">Reconstruído de anotações — sem times e placar</p>
        <h2 class="secao-titulo">Jogadores (${desta.length})</h2>
        <ul class="lista">${ordenarEscalacao(desta).map(linhaJogadorPartida).join("")}</ul>`;
      continue;
    }

    const resultado = p.resultado === "empate" ? "Empate"
      : `Vitória do time ${p.resultado}`;
    const timeA = ordenarEscalacao(desta.filter((e) => e.equipe === "A"));
    const timeB = ordenarEscalacao(desta.filter((e) => e.equipe === "B"));

    html += `
      ${rotulo ? `<h2 class="secao-titulo">${rotulo}</h2>` : ""}
      <div class="cartao">
        <div class="placar-grande">
          <div><div class="rotulo">TIME A</div><div class="numero ${p.resultado === "A" ? "vencedor" : ""}">${p.gols_a}</div></div>
          <div class="x">x</div>
          <div><div class="rotulo">TIME B</div><div class="numero ${p.resultado === "B" ? "vencedor" : ""}">${p.gols_b}</div></div>
        </div>
        <p class="resultado-texto">${resultado}</p>
      </div>
      <h2 class="secao-titulo">Time A ${p.resultado === "A" ? '<span class="vencedor">· venceu</span>' : ""}</h2>
      <ul class="lista">${timeA.map(linhaJogadorPartida).join("") || '<li class="linha">Sem jogadores</li>'}</ul>
      <h2 class="secao-titulo">Time B ${p.resultado === "B" ? '<span class="vencedor">· venceu</span>' : ""}</h2>
      <ul class="lista">${timeB.map(linhaJogadorPartida).join("") || '<li class="linha">Sem jogadores</li>'}</ul>`;
  }

  html += `<p class="legenda">G = gols · A = assistências · GC = gols contra.
    O gol contra conta no placar do time adversário.</p>`;

  return { titulo, html, voltar: "#rachas" };
}


// =====================================================================
// TELA: LISTA DE JOGADORES (com busca)
// =====================================================================

// Desenha só a lista (é chamada de novo a cada letra digitada na busca).
function listaJogadoresHTML(termo) {
  const busca = normalizar(termo).trim();
  const lista = [...dados.jogadores.values()]
    .filter((j) => !busca || normalizar(j.nome).includes(busca) || normalizar(j.apelido).includes(busca))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  if (!lista.length) return `<p class="vazio">Nenhum jogador encontrado.</p>`;

  return `<ul class="lista">${lista.map((j) => {
    const e = dados.estatisticas.get(j.id);
    const sub = [j.apelido ? `“${esc(j.apelido)}”` : "", esc(j.posicao ?? "")].filter(Boolean).join(" · ");
    return `
      <li>
        <a class="linha" href="#jogador/${j.id}">
          <span class="linha-principal">
            <span class="linha-nome">${esc(j.nome)}${selosJogador(j)}</span>
            ${sub ? `<span class="linha-sub">${sub}</span>` : ""}
          </span>
          <span class="linha-valor">${e?.partidas_jogadas ?? 0}<small>jogos</small></span>
        </a>
      </li>`;
  }).join("")}</ul>`;
}

// Último texto digitado na busca (mantido ao voltar da ficha).
let termoBusca = "";

function telaJogadores() {
  return {
    titulo: "Jogadores",
    html: `
      <input class="busca" id="busca" type="search" placeholder="Buscar por nome ou apelido"
             value="${esc(termoBusca)}" autocomplete="off" aria-label="Buscar jogador">
      <div id="lista-jogadores">${listaJogadoresHTML(termoBusca)}</div>`,
    // Depois de desenhar, liga a busca: a cada letra, redesenha só a lista.
    depois: () => {
      document.getElementById("busca").addEventListener("input", (evento) => {
        termoBusca = evento.target.value;
        document.getElementById("lista-jogadores").innerHTML = listaJogadoresHTML(termoBusca);
      });
    },
  };
}


// =====================================================================
// TELA: FICHA DO JOGADOR
// =====================================================================

async function telaJogador(id) {
  const jogador = dados.jogadores.get(id);
  if (!jogador) return { titulo: "Jogador", html: `<p class="vazio">Jogador não encontrado.</p>` };

  const e = dados.estatisticas.get(id) ?? {};
  const s = dados.sequencias.get(id) ?? {};
  const escalacoes = await carregarEscalacoesJogador(id);

  // Caixinhas com os números.
  const caixa = (valor, rotulo) =>
    `<div class="numero-caixa"><b>${esc(valor ?? 0)}</b><span>${rotulo}</span></div>`;
  const aproveitamento = e.aproveitamento === null || e.aproveitamento === undefined
    ? "–" : `${formatarDecimal(e.aproveitamento)}%`;

  const descricao = [
    jogador.apelido ? `“${esc(jogador.apelido)}”` : "",
    esc(jogador.posicao ?? ""),
  ].filter(Boolean).join(" · ");

  // Lista dos rachas em que jogou, do mais recente ao mais antigo.
  const partidasPorId = new Map(dados.partidas.map((p) => [p.partida_id, p]));
  const jogos = escalacoes
    .map((escalacao) => ({ ...escalacao, partida: partidasPorId.get(escalacao.partida_id) }))
    .filter((j) => j.partida)
    .sort((a, b) => b.partida.data_jogo.localeCompare(a.partida.data_jogo) ||
                    b.partida.numero - a.partida.numero);

  const itens = jogos.map((j) => {
    const p = j.partida;
    // Resultado do jogador: V, E ou D (sem times = "–").
    let res = "sem", letra = "–";
    if (p.tem_times && j.equipe) {
      letra = p.resultado === "empate" ? "E" : p.resultado === j.equipe ? "V" : "D";
      res = letra;
    }
    const placar = p.tem_times ? ` · A ${p.gols_a} x ${p.gols_b} B · time ${esc(j.equipe ?? "?")}` : " · sem times";
    const gc = j.gols_contra > 0 ? `<span>GC <b>${j.gols_contra}</b></span>` : "";
    return `
      <li>
        <a class="linha" href="#racha/${p.racha_id}">
          <span class="res res-${res}" title="${{ V: "Vitória", E: "Empate", D: "Derrota", sem: "Sem resultado" }[res]}">${letra}</span>
          <span class="linha-principal">
            <span class="racha-data">${dataBR(p.data_jogo)}</span>
            <span class="linha-sub">${esc(nomeOrigem(p.origem))}${placar}</span>
          </span>
          <span class="numeros"><span>G <b>${j.gols}</b></span><span>A <b>${j.assistencias}</b></span>${gc}</span>
        </a>
      </li>`;
  }).join("");

  return {
    titulo: jogador.nome,
    voltar: "#jogadores",
    html: `
      <div class="cartao ficha-cabecalho">
        <h2>${esc(jogador.nome)}${selosJogador(jogador)}</h2>
        ${descricao ? `<p>${descricao}</p>` : ""}
      </div>

      <h2 class="secao-titulo">Números</h2>
      <div class="cartao">
        <div class="grade-numeros">
          ${caixa(e.presencas, "Presenças")}
          ${caixa(e.partidas_jogadas, "Partidas")}
          ${caixa(e.gols, "Gols")}
          ${caixa(e.assistencias, "Assistências")}
          ${caixa(e.participacoes_em_gol, "Part. em gol")}
          ${caixa(e.gols_contra, "Gols contra")}
          ${caixa(e.vitorias, "Vitórias")}
          ${caixa(e.empates, "Empates")}
          ${caixa(e.derrotas, "Derrotas")}
          ${caixa(aproveitamento, "Aproveitamento")}
          ${caixa(s.sequencia_atual, "Sequência atual")}
          ${caixa(s.melhor_sequencia, "Melhor sequência")}
        </div>
        <p class="legenda">Os totais incluem ajustes manuais do histórico, por isso podem
          ser maiores que a soma dos jogos abaixo. Aproveitamento considera só partidas com times.</p>
      </div>

      <h2 class="secao-titulo">Rachas em que jogou (${jogos.length})</h2>
      ${itens ? `<ul class="lista">${itens}</ul>` : `<p class="vazio">Nenhum jogo registrado.</p>`}`,
  };
}


// =====================================================================
// NAVEGAÇÃO ENTRE TELAS
// =====================================================================

const conteudo = document.getElementById("conteudo");
const tituloTela = document.getElementById("titulo-tela");
const botaoVoltar = document.getElementById("botao-voltar");
const escudoTopo = document.getElementById("topo-escudo");
let destinoVoltar = null;
// Fica verdadeiro depois da primeira troca de tela dentro do app.
let navegouNoApp = false;

// Mostra uma mensagem amigável quando o banco não responde.
function mostrarErro(erro) {
  console.error("Erro ao falar com o banco:", erro);
  tituloTela.textContent = "Ops!";
  conteudo.innerHTML = `
    <div class="erro">
      <h2>Não conseguimos carregar os dados</h2>
      <p>O banco do racha não respondeu agora. Verifique sua internet e tente de novo em instantes.</p>
      <button class="botao" type="button" id="tentar-de-novo">Tentar de novo</button>
    </div>`;
  document.getElementById("tentar-de-novo").addEventListener("click", desenharTela);
}

// Conta os pedidos de tela: se a pessoa trocar de tela antes da anterior
// terminar de carregar, a resposta atrasada é ignorada.
let pedidoAtual = 0;
// Última tela desenhada (para não animar ao só trocar de categoria).
let ultimaRota = null;

// Lê o endereço (#...) e desenha a tela correspondente.
async function desenharTela() {
  const meuPedido = ++pedidoAtual;
  const [rota, parametro] = (location.hash.replace("#", "") || "rankings").split("/");

  // Marca a aba ativa (as telas de detalhe ficam com a aba "mãe" acesa).
  const abaAtiva = { racha: "rachas", jogador: "jogadores" }[rota] ?? rota;
  document.querySelectorAll(".aba").forEach((aba) =>
    aba.classList.toggle("ativa", aba.dataset.aba === abaAtiva));

  try {
    if (!dados.carregado) conteudo.innerHTML = esqueleto({ chips: rota === "rankings" || !rota });
    await carregarDadosBase();

    let tela;
    if (rota === "rachas") tela = telaRachas();
    else if (rota === "racha") {
      conteudo.innerHTML = esqueleto();
      tela = await telaRacha(Number(parametro));
    } else if (rota === "jogadores") tela = telaJogadores();
    else if (rota === "jogador") {
      conteudo.innerHTML = esqueleto();
      tela = await telaJogador(Number(parametro));
    } else tela = telaRankings(parametro);

    if (meuPedido !== pedidoAtual) return;  // já pediram outra tela

    tituloTela.textContent = tela.titulo;
    document.title = `${tela.titulo} · Racha de Quinta`;
    conteudo.innerHTML = tela.html;
    // Reinicia a animação de entrada (transição suave entre telas).
    // Ao só trocar de categoria no ranking, não anima (fica mais calmo).
    if (rota !== ultimaRota) {
      conteudo.classList.remove("entrando");
      void conteudo.offsetWidth;  // força o navegador a "esquecer" a animação anterior
      conteudo.classList.add("entrando");
    }
    ultimaRota = rota;

    // Telas de detalhe mostram a seta de voltar no lugar do escudo.
    destinoVoltar = tela.voltar ?? null;
    botaoVoltar.hidden = !destinoVoltar;
    escudoTopo.hidden = Boolean(destinoVoltar);
    if (tela.depois) tela.depois();

    // Ao trocar de tela (não de categoria), volta para o topo.
    if (rota !== "rankings") window.scrollTo(0, 0);
  } catch (erro) {
    if (meuPedido === pedidoAtual) mostrarErro(erro);
  }
}

// Botão "voltar" do topo: volta no histórico se veio de dentro do app.
botaoVoltar.addEventListener("click", () => {
  if (navegouNoApp) history.back();
  else location.hash = destinoVoltar;  // abriu direto pelo link do detalhe
});

// Redesenha sempre que o endereço (#...) mudar, e na primeira abertura.
window.addEventListener("hashchange", () => { navegouNoApp = true; desenharTela(); });
desenharTela();
