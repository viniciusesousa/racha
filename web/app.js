// =====================================================================
// App do Racha — área pública (sem login)
// =====================================================================
// Este arquivo busca os dados no Supabase e desenha as telas:
//   * Início    (#inicio — tela inicial)
//   * Rankings  (#rankings, #rankings/<categoria>)
//   * Rachas    (#rachas, e o detalhe em #racha/<id>)
//   * Jogadores (#jogadores, e a ficha em #jogador/<id>)
//
// A "rota" fica no endereço depois do # (ex.: index.html#racha/12).
// Assim o botão "voltar" do celular funciona normalmente.
//
// IMPORTANTE: a área pública só consulta tabelas e visões públicas
// (jogadores, escalacoes, presencas, ajustes e as visões de ranking e de
// participações). Nunca toca no financeiro.
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


// ---------------------------------------------------------------------
// Categorias do ranking
// ---------------------------------------------------------------------
// Cada categoria diz qual número ordenar, como mostrar e quem entra.
//   media: true = a categoria permite ver a "média por jogo".
const CATEGORIAS = [
  { id: "artilharia", nome: "Artilharia", campo: "gols", unidade: "gols", media: true },
  { id: "assistencias", nome: "Assistências", campo: "assistencias", unidade: "assist.", media: true },
  {
    id: "participacoes", nome: "Participações em gol", campo: "participacoes_em_gol", unidade: "G + A",
    media: true,
    detalhe: (e) => `${e.gols} gols · ${e.assistencias} assist.`,
  },
  {
    id: "vitorias", nome: "Vitórias", campo: "vitorias", unidade: "vitórias", media: true,
    detalhe: (e) => `${e.vitorias}V · ${e.empates}E · ${e.derrotas}D`,
  },
  {
    id: "aproveitamento", nome: "Aproveitamento", campo: "aproveitamento", unidade: "%",
    // Só quem tem o mínimo de partidas com times (inclui quem tem 0%).
    filtro: (e) => e.partidas_com_times >= MINIMO_APROVEITAMENTO && e.aproveitamento !== null,
    formato: (v) => `${formatarDecimal(v)}%`,
    detalhe: (e) => `${e.vitorias}V · ${e.empates}E · ${e.derrotas}D`,
    nota: `Pontos ganhos ÷ pontos possíveis (vitória = 3, empate = 1). ` +
          `Só entra quem tem ${MINIMO_APROVEITAMENTO} ou mais partidas com times.`,
  },
  { id: "jogos", nome: "Jogos", campo: "presencas", unidade: "jogos" },
  {
    id: "sequencia", nome: "Sequência", campo: "melhor_sequencia", unidade: "melhor",
    fonte: "sequencias",
    // Desempate: quem tem a maior sequência atual fica na frente.
    desempate: "sequencia_atual",
    detalhe: (s) => `Atual: ${s.sequencia_atual} ${s.sequencia_atual === 1 ? "vitória" : "vitórias"}`,
    nota: "Vitórias seguidas, só em partidas com times. Empate ou derrota quebram a sequência.",
  },
];

// Períodos do filtro do ranking.
const PERIODOS = [
  { id: "geral", nome: "Geral" },
  { id: "ano", nome: "Este ano" },
  { id: "mes", nome: "Este mês" },
];

// Mínimo de jogos para entrar no ranking de média por jogo.
const MINIMO_MEDIA = 5;

const NOMES_MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
  "agosto", "setembro", "outubro", "novembro", "dezembro"];


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

// Iniciais do nome para o avatar: "Jogador Exemplo" -> "JE", "Exemplo" -> "EX".
function iniciais(nome) {
  const partes = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// Cores dos círculos de iniciais (todas com contraste AA para letra branca).
// A cor é escolhida pelo id do jogador, então cada um mantém sempre a sua.
const CORES_AVATAR = ["#6d1f2f", "#1f5f7a", "#5b4b8a", "#8a4b2a", "#6b2f5a", "#44506b", "#7a4f0e"];

// Foto do jogador (se houver) ou círculo colorido com as iniciais.
function avatar(jogador, classe = "") {
  if (jogador?.foto_url) {
    return `<img class="avatar ${classe}" src="${esc(jogador.foto_url)}" alt="" loading="lazy">`;
  }
  const cor = CORES_AVATAR[(jogador?.id ?? 0) % CORES_AVATAR.length];
  return `<span class="avatar ${classe}" style="background:${cor}" aria-hidden="true">${esc(iniciais(jogador?.nome))}</span>`;
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

// O Supabase entrega no máximo 1000 linhas por pedido. Para listas que vão
// crescer com o tempo (participações, presenças...), pede "página por página"
// até acabar. `montarConsulta` deve devolver a consulta já ordenada.
async function buscarTodas(montarConsulta) {
  const TAMANHO_PAGINA = 1000;
  const todas = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const pagina = await consultar(montarConsulta().range(inicio, inicio + TAMANHO_PAGINA - 1));
    todas.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA) return todas;
  }
}

// Data de hoje no celular de quem está vendo, no formato "2026-10-19".
function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
    consultar(banco.from("jogadores").select("id, nome, apelido, posicao, tipo, ativo, foto_url")),
    consultar(banco.from("v_estatisticas_jogadores").select("*")),
    consultar(banco.from("v_sequencias").select("jogador_id, sequencia_atual, melhor_sequencia")),
    buscarTodas(() => banco.from("v_placar_partidas").select("*").order("partida_id")),
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

// =====================================================================
// NÚMEROS POR PERÍODO (este ano, este mês...)
// =====================================================================
// As visões de ranking dão os totais de SEMPRE. Para um período, o app
// soma as participações (v_participacoes) daquele intervalo de datas.
//
// Regra "Este ano" (usada no ranking e nos destaques da aba Início, para
// os números baterem): participações do ano + ajustes manuais cuja data
// esteja no ano. Regra "Este mês": só participações, sem ajustes.
//
// "Jogos" segue a mesma regra das visões: conta os rachas diferentes em que
// o jogador jogou OU está na lista de presença (+ ajustes de presença).

const dadosPeriodo = { participacoes: [], presencas: [], ajustes: [] };
let buscaPeriodo = null;

// Busca (uma vez só) as listas necessárias para os cálculos por período.
function carregarDadosPeriodo() {
  if (!buscaPeriodo) {
    buscaPeriodo = Promise.all([
      buscarTodas(() => banco.from("v_participacoes")
        .select("partida_id, racha_id, numero, data_jogo, tem_times, jogador_id, equipe, gols, assistencias, gols_contra, resultado")
        .order("partida_id").order("jogador_id")),
      buscarTodas(() => banco.from("presencas").select("racha_id, jogador_id")
        .order("racha_id").order("jogador_id")),
      buscarTodas(() => banco.from("ajustes").select("id, jogador_id, tipo, quantidade, data")
        .order("id")),
    ]).then(([participacoes, presencas, ajustes]) => {
      Object.assign(dadosPeriodo, { participacoes, presencas, ajustes });
    }).catch((erro) => {
      buscaPeriodo = null;  // permite tentar de novo depois de um erro
      throw erro;
    });
  }
  return buscaPeriodo;
}

// Primeiro e último dia de um ano ou de um mês ("2026-01-01" a "2026-12-31").
function intervaloAno(ano) {
  return [`${ano}-01-01`, `${ano}-12-31`];
}
function intervaloMes(ano, mes) {
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const mm = String(mes).padStart(2, "0");
  return [`${ano}-${mm}-01`, `${ano}-${mm}-${ultimoDia}`];
}

// Calcula os números de cada jogador entre duas datas (inclusive).
// Devolve um Map com os mesmos nomes de campo de v_estatisticas_jogadores,
// para as telas poderem usar um ou outro sem diferença.
function estatisticasPeriodo(de, ate, comAjustes) {
  const noPeriodo = (data) => data >= de && data <= ate;
  const dataDoRacha = new Map(dados.rachas.map((r) => [r.id, r.data_jogo]));
  const porJogador = new Map();
  const doJogador = (id) => {
    if (!porJogador.has(id)) {
      porJogador.set(id, {
        jogador_id: id, rachas: new Set(), aj_presencas: 0,
        partidas_jogadas: 0, gols: 0, assistencias: 0, gols_contra: 0,
        partidas_com_times: 0, vitorias: 0, empates: 0, derrotas: 0, vitorias_em_partidas: 0,
      });
    }
    return porJogador.get(id);
  };

  // Participações nas partidas do período.
  for (const p of dadosPeriodo.participacoes) {
    if (!noPeriodo(p.data_jogo)) continue;
    const j = doJogador(p.jogador_id);
    j.rachas.add(p.racha_id);
    j.partidas_jogadas += 1;
    j.gols += p.gols;
    j.assistencias += p.assistencias;
    j.gols_contra += p.gols_contra;
    if (p.resultado) {
      j.partidas_com_times += 1;
      if (p.resultado === "V") { j.vitorias += 1; j.vitorias_em_partidas += 1; }
      if (p.resultado === "E") j.empates += 1;
      if (p.resultado === "D") j.derrotas += 1;
    }
  }

  // Presenças sem escalação (ex.: estava lá mas não entrou na lista do jogo).
  for (const pr of dadosPeriodo.presencas) {
    const data = dataDoRacha.get(pr.racha_id);
    if (data && noPeriodo(data)) doJogador(pr.jogador_id).rachas.add(pr.racha_id);
  }

  // Ajustes manuais com data no período (só quando a regra pede).
  if (comAjustes) {
    for (const a of dadosPeriodo.ajustes) {
      if (!noPeriodo(a.data)) continue;
      const j = doJogador(a.jogador_id);
      if (a.tipo === "gols") j.gols += a.quantidade;
      if (a.tipo === "assistencias") j.assistencias += a.quantidade;
      if (a.tipo === "vitorias") j.vitorias += a.quantidade;
      if (a.tipo === "presencas") j.aj_presencas += a.quantidade;
    }
  }

  // Campos finais, no mesmo formato da visão.
  for (const j of porJogador.values()) {
    j.presencas = j.rachas.size + j.aj_presencas;
    j.participacoes_em_gol = j.gols + j.assistencias;
    // Aproveitamento só com jogos de verdade (igual à visão).
    j.aproveitamento = j.partidas_com_times > 0
      ? Math.round(1000 * (3 * j.vitorias_em_partidas + j.empates) / (3 * j.partidas_com_times)) / 10
      : null;
    delete j.rachas;
  }
  return porJogador;
}

// Sequências de vitórias dentro de um período (mesma regra da visão
// v_sequencias, mas só com os jogos entre as duas datas):
//   melhor_sequencia = maior série de vitórias seguidas no período;
//   sequencia_atual  = vitórias seguidas nos últimos jogos do período.
// Só contam partidas com times; empate ou derrota quebram a série.
function sequenciasPeriodo(de, ate) {
  const jogos = dadosPeriodo.participacoes
    .filter((p) => p.resultado && p.data_jogo >= de && p.data_jogo <= ate)
    .sort((a, b) => a.data_jogo.localeCompare(b.data_jogo) || a.numero - b.numero);
  const porJogador = new Map();
  for (const p of jogos) {
    if (!porJogador.has(p.jogador_id)) {
      porJogador.set(p.jogador_id, { jogador_id: p.jogador_id, sequencia_atual: 0, melhor_sequencia: 0 });
    }
    const j = porJogador.get(p.jogador_id);
    j.sequencia_atual = p.resultado === "V" ? j.sequencia_atual + 1 : 0;
    j.melhor_sequencia = Math.max(j.melhor_sequencia, j.sequencia_atual);
  }
  return porJogador;
}

// Números da temporada (ano atual) — mesma regra do ranking "Este ano".
function estatisticasTemporada() {
  const ano = Number(hojeISO().slice(0, 4));
  return { ano, numeros: estatisticasPeriodo(...intervaloAno(ano), true) };
}


// =====================================================================
// TELA: INÍCIO
// =====================================================================

// Próxima quinta-feira a partir de hoje (data do celular).
// Devolve a data ("2026-10-22") e quantos dias faltam (0 = hoje).
function proximaQuinta() {
  const hoje = new Date();
  const dias = (4 - hoje.getDay() + 7) % 7;  // 4 = quinta-feira
  const alvo = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + dias);
  const iso = `${alvo.getFullYear()}-${String(alvo.getMonth() + 1).padStart(2, "0")}-${String(alvo.getDate()).padStart(2, "0")}`;
  return { iso, dias };
}

// Quem tem o maior valor de um campo (pode haver empate).
// Devolve { valor, ids } — ids em ordem alfabética do nome.
function lideres(mapa, campo) {
  let valor = 0;
  for (const item of mapa.values()) valor = Math.max(valor, Number(item[campo]) || 0);
  if (valor <= 0) return { valor: 0, ids: [] };
  const ids = [...mapa.values()]
    .filter((item) => Number(item[campo]) === valor)
    .map((item) => item.jogador_id)
    .sort((a, b) => (dados.jogadores.get(a)?.nome ?? "")
      .localeCompare(dados.jogadores.get(b)?.nome ?? "", "pt-BR"));
  return { valor, ids };
}

// Nomes de quem empatou: "Fulano", "Fulano e Beltrano", "Fulano e mais 2".
function nomesEmpatados(ids) {
  const nomes = ids.map((id) => esc(dados.jogadores.get(id)?.nome ?? ""));
  if (nomes.length <= 2) return nomes.join(" e ");
  return `${nomes[0]} e mais ${nomes.length - 1}`;
}

// Card de destaque da temporada (artilheiro, garçom, sequência).
function cardDestaque(rotulo, lider, unidade) {
  if (!lider.ids.length) {
    return `
      <div class="destaque">
        <span class="destaque-rotulo">${rotulo}</span>
        <span class="avatar avatar-medio avatar-vazio" aria-hidden="true">–</span>
        <span class="destaque-nome">Ninguém ainda</span>
      </div>`;
  }
  const primeiro = dados.jogadores.get(lider.ids[0]);
  const empate = lider.ids.length > 1 ? `<span class="destaque-empate">${lider.ids.length} empatados</span>` : "";
  return `
    <a class="destaque" href="#jogador/${primeiro?.id}">
      <span class="destaque-rotulo">${rotulo}</span>
      ${avatar(primeiro, "avatar-medio")}
      <span class="destaque-nome">${nomesEmpatados(lider.ids)}</span>
      <span class="destaque-valor"><b class="num">${lider.valor}</b> ${unidade(lider.valor)}</span>
      ${empate}
    </a>`;
}

async function telaInicio() {
  await carregarDadosPeriodo();
  const hoje = hojeISO();

  // --- Próximo racha -------------------------------------------------
  const quinta = proximaQuinta();
  const contagem = quinta.dias === 0
    ? `<span class="contagem-hoje">Hoje!</span>`
    : `<span class="contagem-numero num">${quinta.dias}</span>
       <span class="contagem-texto">${quinta.dias === 1 ? "dia" : "dias"}</span>`;

  // --- Último racha (o mais recente até hoje) -------------------------
  const ultimo = dados.rachas.find((r) => r.data_jogo <= hoje);
  let telao = `<p class="vazio">Nenhum racha registrado ainda.</p>`;
  if (ultimo) {
    const escalacoes = await carregarEscalacoesRacha(ultimo);

    // Artilheiro da rodada: soma os gols de todas as partidas do racha.
    const golsPorJogador = new Map();
    for (const e of escalacoes) {
      golsPorJogador.set(e.jogador_id, (golsPorJogador.get(e.jogador_id) ?? 0) + e.gols);
    }
    const artilheiro = lideres(
      new Map([...golsPorJogador].map(([id, gols]) => [id, { jogador_id: id, gols }])), "gols");
    const linhaArtilheiro = artilheiro.ids.length
      ? `<p class="telao-artilheiro">⚽ Artilheiro da rodada:
           <b>${nomesEmpatados(artilheiro.ids)}</b>
           (${artilheiro.valor} ${artilheiro.valor === 1 ? "gol" : "gols"})</p>`
      : "";

    // Placar estilo telão (ou o aviso, se for um racha recuperado).
    const miolo = ultimo.tem_times
      ? ultimo.partidas.map((p) => `
          <div class="telao-placar">
            <div class="telao-time">
              <span class="telao-rotulo">Time A</span>
              <span class="telao-num num ${p.resultado === "A" ? "telao-vence" : ""}">${p.gols_a}</span>
            </div>
            <span class="telao-x">×</span>
            <div class="telao-time">
              <span class="telao-rotulo">Time B</span>
              <span class="telao-num num ${p.resultado === "B" ? "telao-vence" : ""}">${p.gols_b}</span>
            </div>
          </div>
          <p class="telao-resultado">${p.resultado === "empate" ? "Empate" : `Vitória do Time ${p.resultado}`}</p>`).join("")
      : `<p class="telao-aviso">Reconstruído de anotações — sem times e placar</p>`;

    telao = `
      <a class="telao" href="#racha/${ultimo.id}">
        <div class="telao-topo">
          <span>Último racha</span>
          <span>${diaSemana(ultimo.data_jogo)}, ${dataBR(ultimo.data_jogo)}</span>
        </div>
        ${miolo}
        ${linhaArtilheiro}
      </a>`;
  }

  // --- Destaques da temporada (mesma regra do ranking "Este ano") -----
  const temporada = estatisticasTemporada();
  const artilheiro = lideres(temporada.numeros, "gols");
  const garcom = lideres(temporada.numeros, "assistencias");
  const sequencia = lideres(dados.sequencias, "sequencia_atual");

  return {
    titulo: "Início",
    html: `
      <section class="inicio-topo">
        <img class="inicio-escudo" src="img/escudo-256.png" alt="Escudo do Racha de Quinta">
        <h2 class="inicio-nome">Racha de Quinta</h2>
      </section>

      <section class="cartao proximo">
        <div>
          <span class="proximo-rotulo">Próximo racha</span>
          <span class="proximo-data">${quinta.dias === 0 ? "Hoje" : "Quinta"}, ${dataBR(quinta.iso).slice(0, 5)}</span>
        </div>
        <div class="contagem" aria-label="${quinta.dias === 0 ? "O racha é hoje" : `Faltam ${quinta.dias} dias`}">
          ${quinta.dias === 0 ? "" : '<span class="contagem-faltam">faltam</span>'}
          ${contagem}
        </div>
      </section>

      ${telao}

      <h2 class="secao-titulo">Destaques de ${temporada.ano}</h2>
      <div class="destaques">
        ${cardDestaque("Artilheiro", artilheiro, (v) => (v === 1 ? "gol" : "gols"))}
        ${cardDestaque("Garçom", garcom, () => "assist.")}
        ${cardDestaque("Sequência", sequencia, (v) => (v === 1 ? "vitória" : "vitórias"))}
      </div>
      <p class="legenda">Artilheiro e garçom: jogos de ${temporada.ano}, já com os ajustes lançados no ano
        (mesma regra do ranking "Este ano"). Sequência: vitórias seguidas atuais.</p>`,
  };
}


// =====================================================================
// TELA: RANKINGS
// =====================================================================

// Números do período escolhido, no formato das visões.
//   Geral    = visões do banco (com todos os ajustes);
//   Este ano = participações do ano + ajustes com data no ano;
//   Este mês = só participações do mês (sem ajustes).
async function numerosDoPeriodo(periodo) {
  if (periodo === "geral") {
    return {
      estatisticas: dados.estatisticas,
      sequencias: dados.sequencias,
      nota: "Todos os jogos, já com os ajustes manuais do histórico.",
    };
  }
  await carregarDadosPeriodo();
  const hoje = hojeISO();
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7));
  if (periodo === "ano") {
    const [de, ate] = intervaloAno(ano);
    return {
      estatisticas: estatisticasPeriodo(de, ate, true),
      sequencias: sequenciasPeriodo(de, ate),
      nota: `Jogos de ${ano}, com os ajustes manuais lançados no ano.`,
    };
  }
  const [de, ate] = intervaloMes(ano, mes);
  return {
    estatisticas: estatisticasPeriodo(de, ate, false),
    sequencias: sequenciasPeriodo(de, ate),
    nota: `Só jogos de ${NOMES_MESES[mes - 1]} de ${ano}, sem os ajustes manuais.`,
  };
}

// Endereço de uma combinação de filtros: #rankings/<categoria>/<período>/<modo>.
function linkRanking(categoria, periodo, modo) {
  return `#rankings/${categoria}/${periodo}/${modo}`;
}

// Grupo de botões "um ou outro" (período, total/média).
function segmentado(rotulo, opcoes, ativo) {
  return `
    <div class="segmentado" role="group" aria-label="${rotulo}">
      ${opcoes.map((o) => `
        <a class="segmento ${o.id === ativo ? "ativa" : ""}" href="${o.link}"
           ${o.id === ativo ? 'aria-current="true"' : ""}>${esc(o.nome)}</a>`).join("")}
    </div>`;
}

async function telaRankings(idCategoria, idPeriodo, idModo) {
  const categoria = CATEGORIAS.find((c) => c.id === idCategoria) ?? CATEGORIAS[0];
  const periodo = PERIODOS.find((p) => p.id === idPeriodo)?.id ?? "geral";
  // Média só existe nas categorias que permitem.
  const modo = categoria.media && idModo === "media" ? "media" : "total";

  const numeros = await numerosDoPeriodo(periodo);

  // Botões de categoria (rolam para o lado no celular), mantendo os filtros.
  const botoes = CATEGORIAS.map((c) => `
    <a class="categoria ${c.id === categoria.id ? "ativa" : ""}" href="${linkRanking(c.id, periodo, modo)}"
       ${c.id === categoria.id ? 'aria-current="true"' : ""}>${esc(c.nome)}</a>`).join("");

  const filtros = `
    <div class="filtros">
      ${segmentado("Período", PERIODOS.map((p) => ({ ...p, link: linkRanking(categoria.id, p.id, modo) })), periodo)}
      ${categoria.media ? segmentado("Total ou média", [
        { id: "total", nome: "Total", link: linkRanking(categoria.id, periodo, "total") },
        { id: "media", nome: "Média", link: linkRanking(categoria.id, periodo, "media") },
      ], modo) : ""}
    </div>`;

  // Monta a lista: cada linha com o número usado para ordenar ("valor").
  const fonte = categoria.fonte === "sequencias" ? numeros.sequencias : numeros.estatisticas;
  let linhas = [...fonte.values()].map((item) => {
    const total = Number(item[categoria.campo]);
    if (modo === "media") {
      // Média por jogo: total ÷ jogos, com 2 casas (só quem tem o mínimo de jogos).
      const jogos = Number(item.presencas) || 0;
      return { item, valor: jogos ? Math.round((total / jogos) * 100) / 100 : 0, jogos };
    }
    return { item, valor: total };
  }).filter(({ item, valor, jogos }) => {
    if (modo === "media") return jogos >= MINIMO_MEDIA && valor > 0;
    return categoria.filtro ? categoria.filtro(item) : valor > 0;
  });

  // Ordena: maior valor primeiro; empate pelo critério extra e depois pelo nome.
  const nomeDe = (l) => dados.jogadores.get(l.item.jogador_id)?.nome ?? "";
  linhas.sort((a, b) =>
    b.valor - a.valor ||
    (categoria.desempate ? b.item[categoria.desempate] - a.item[categoria.desempate] : 0) ||
    nomeDe(a).localeCompare(nomeDe(b), "pt-BR"));

  // Posição: quem empata no número principal divide a mesma posição (1, 1, 3...).
  linhas.forEach((l, i) => {
    l.posicao = i > 0 && l.valor === linhas[i - 1].valor ? linhas[i - 1].posicao : i + 1;
  });

  // Como mostrar o número e o texto de apoio de cada linha.
  const textoValor = (l) => (modo === "media"
    ? l.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : categoria.formato ? categoria.formato(l.valor) : String(l.valor));
  const unidade = modo === "media" ? "por jogo" : (categoria.unidade === "%" ? "" : categoria.unidade);
  const textoApoio = (l) => {
    if (modo === "media") return `${l.item[categoria.campo]} em ${l.jogos} jogos`;
    return categoria.detalhe ? categoria.detalhe(l.item) : "";
  };

  // --- Pódio: 1º no centro e mais alto, 2º à esquerda, 3º à direita ---
  const podio = linhas.slice(0, 3).map((l, i) => {
    const jogador = dados.jogadores.get(l.item.jogador_id);
    return `
      <a class="podio-item podio-lugar-${i + 1}" href="#jogador/${l.item.jogador_id}">
        ${avatar(jogador, i === 0 ? "avatar-grande" : "avatar-medio")}
        <span class="podio-nome">${esc(jogador?.nome)}</span>
        ${jogador?.tipo === "convidado" ? '<span class="selo selo-convidado">convidado</span>' : ""}
        <span class="podio-valor num">${esc(textoValor(l))}</span>
        <span class="podio-unidade">${esc(unidade)}</span>
        <span class="podio-base podio-base-${Math.min(l.posicao, 3)}"><b class="num">${l.posicao}º</b></span>
      </a>`;
  }).join("");

  // --- Lista compacta a partir do 4º ---
  const resto = linhas.slice(3).map((l) => {
    const jogador = dados.jogadores.get(l.item.jogador_id);
    const apoio = textoApoio(l);
    return `
      <li>
        <a class="linha" href="#jogador/${l.item.jogador_id}">
          <span class="posicao">${l.posicao}º</span>
          ${avatar(jogador, "avatar-pequeno")}
          <span class="linha-principal">
            <span class="linha-nome">${esc(jogador?.nome)}${selosJogador(jogador)}</span>
            ${apoio ? `<span class="linha-sub">${apoio}</span>` : ""}
          </span>
          <span class="linha-valor">${esc(textoValor(l))}<small>${esc(unidade)}</small></span>
        </a>
      </li>`;
  }).join("");

  // Notas discretas: regra do período, da categoria e da média.
  const notas = [
    numeros.nota,
    categoria.nota,
    modo === "media" ? `Média por jogo: só quem tem ${MINIMO_MEDIA} ou mais jogos.` : "",
  ].filter(Boolean).map((n) => `<p class="nota">${esc(n)}</p>`).join("");

  return {
    titulo: "Rankings",
    html: `
      <nav class="categorias" aria-label="Categorias do ranking">${botoes}</nav>
      ${filtros}
      ${notas}
      ${linhas.length ? `
        <div class="podio-visual">${podio}</div>
        ${resto ? `<ol class="lista compacta" start="4">${resto}</ol>` : ""}`
        : `<p class="vazio">${modo === "media"
            ? `Ninguém com ${MINIMO_MEDIA} ou mais jogos ${periodo === "geral" ? "ainda" : "neste período"}.`
            : `Ninguém nesta categoria ${periodo === "geral" ? "ainda" : "neste período"}.`}</p>`}`,
  };
}


// =====================================================================
// TELA: LISTA DE RACHAS
// =====================================================================
// Rachas agrupados por mês ("Outubro 2026"), do mais recente ao mais
// antigo. Cada racha é um card com o placar em destaque. Os times mudam a
// cada racha, então não usam cores fixas: o placar do vencedor só fica mais
// forte que o do perdedor.

// "2026-10" -> "Outubro 2026"
function tituloMes(anoMes) {
  const [ano, mes] = anoMes.split("-").map(Number);
  const nome = NOMES_MESES[mes - 1];
  return `${nome[0].toUpperCase()}${nome.slice(1)} ${ano}`;
}

// Placar de uma partida em linha: "Time A 11 × 13 Time B".
function placarLinha(p) {
  const forteA = p.resultado === "A" || p.resultado === "empate";
  const forteB = p.resultado === "B" || p.resultado === "empate";
  return `
    <span class="racha-placar" aria-label="Time A ${p.gols_a} a ${p.gols_b} Time B">
      <span class="time-nome">Time A</span>
      <b class="num ${forteA ? "" : "perdeu"}">${p.gols_a}</b>
      <span class="x">×</span>
      <b class="num ${forteB ? "" : "perdeu"}">${p.gols_b}</b>
      <span class="time-nome">Time B</span>
    </span>`;
}

function telaRachas() {
  if (!dados.rachas.length) {
    return { titulo: "Rachas", html: `<p class="vazio">Nenhum racha registrado ainda.</p>` };
  }

  // Agrupa por mês, mantendo a ordem (mais recente primeiro).
  const meses = new Map();
  for (const r of dados.rachas) {
    const chave = r.data_jogo.slice(0, 7);
    if (!meses.has(chave)) meses.set(chave, []);
    meses.get(chave).push(r);
  }

  const html = [...meses].map(([anoMes, rachas]) => {
    // Um único aviso por mês que tenha rachas recuperados SEM times.
    // (Recuperados que têm times pelo print do grupo mostram o placar normal.)
    const temRecuperadoSemTimes = rachas.some((r) => r.origem === "recuperado" && !r.tem_times);
    const aviso = temRecuperadoSemTimes
      ? `<p class="aviso aviso-mes">Os rachas <b>recuperado</b> sem placar foram reconstruídos das
           anotações do grupo: têm a lista de presença (e às vezes gols e assistências), mas não
           têm a divisão dos times.</p>`
      : "";

    const cards = rachas.map((r) => {
      const varias = r.partidas.length > 1;
      const miolo = r.tem_times
        ? r.partidas.map((p) => `
            <div class="racha-partida">
              ${varias ? `<span class="racha-numero">Partida ${p.numero}</span>` : ""}
              ${placarLinha(p)}
            </div>`).join("")
        : `<div class="racha-partida"><span class="racha-sem-placar">Sem times e sem placar</span></div>`;
      return `
        <li>
          <a class="racha-card" href="#racha/${r.id}">
            <span class="racha-card-topo">
              <span class="racha-data">${diaSemana(r.data_jogo)}, ${dataBR(r.data_jogo).slice(0, 5)}</span>
              ${r.origem === "recuperado" ? '<span class="selo selo-origem">recuperado</span>' : ""}
            </span>
            ${miolo}
          </a>
        </li>`;
    }).join("");

    return `
      <section class="mes">
        <h2 class="secao-titulo">${tituloMes(anoMes)}</h2>
        ${aviso}
        <ul class="racha-lista">${cards}</ul>
      </section>`;
  }).join("");

  return { titulo: "Rachas", html };
}


// =====================================================================
// TELA: DETALHE DO RACHA
// =====================================================================

// Números de um jogador na partida, com ícones:
//   ⚽ = gols, 👟 = assistências, "gol contra" em selo.
// O texto escondido (classe "so-leitor") é lido pelos leitores de tela.
function numerosComIcones(e) {
  const partes = [];
  if (e.gols) partes.push(`<span class="so-leitor">${e.gols} ${e.gols === 1 ? "gol" : "gols"}</span><span aria-hidden="true">⚽ ${e.gols}</span>`);
  if (e.assistencias) partes.push(`<span class="so-leitor">${e.assistencias} ${e.assistencias === 1 ? "assistência" : "assistências"}</span><span aria-hidden="true">👟 ${e.assistencias}</span>`);
  if (e.gols_contra) partes.push(`<span class="selo selo-contra">${e.gols_contra > 1 ? `${e.gols_contra} gols contra` : "gol contra"}</span>`);
  return partes.length ? partes.join(" ") : `<span class="sem-numeros">–</span>`;
}

// Uma linha de jogador dentro da coluna do time.
function linhaJogadorTime(e) {
  const jogador = dados.jogadores.get(e.jogador_id);
  return `
    <li>
      <a class="jogador-time" href="#jogador/${e.jogador_id}">
        <span class="jogador-time-nome">${esc(jogador?.nome)}${selosJogador(jogador)}</span>
        <span class="jogador-time-numeros">${numerosComIcones(e)}</span>
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

// Coluna de um time: título com placar e a lista de jogadores.
function colunaTime(nome, gols, venceu, jogadores) {
  return `
    <section class="coluna-time">
      <h3 class="coluna-time-titulo">
        <span>${nome}${venceu ? ' <span class="selo selo-venceu">venceu</span>' : ""}</span>
        <b class="num">${gols}</b>
      </h3>
      <ul class="coluna-time-lista">
        ${jogadores.map(linhaJogadorTime).join("") || '<li class="vazio">Sem jogadores</li>'}
      </ul>
    </section>`;
}

async function telaRacha(id) {
  const racha = dados.rachas.find((r) => r.id === id);
  if (!racha) return { titulo: "Racha", html: `<p class="vazio">Racha não encontrado.</p>` };

  const escalacoes = await carregarEscalacoesRacha(racha);
  const titulo = `Racha de ${dataBR(racha.data_jogo)}`;
  const seloRecuperado = racha.origem === "recuperado" ? '<span class="selo selo-origem">recuperado</span>' : "";
  const quando = `${diaSemana(racha.data_jogo)}, ${dataBR(racha.data_jogo)} ${seloRecuperado}`;

  let html = "";
  for (const p of racha.partidas) {
    const desta = escalacoes.filter((e) => e.partida_id === p.partida_id);
    const rotulo = racha.partidas.length > 1 ? `<h2 class="secao-titulo">Partida ${p.numero}</h2>` : "";

    if (!racha.tem_times) {
      // Racha sem times (ex.: recuperado): aviso e uma lista só, com TODOS os
      // presentes — quem não teve gol nem assistência aparece com "–".
      await carregarDadosPeriodo();
      const comNumeros = new Set(desta.map((e) => e.jogador_id));
      const soPresentes = dadosPeriodo.presencas
        .filter((pr) => pr.racha_id === racha.id && !comNumeros.has(pr.jogador_id))
        .map((pr) => ({ jogador_id: pr.jogador_id, gols: 0, assistencias: 0, gols_contra: 0 }));
      const todos = ordenarEscalacao([...desta, ...soPresentes]);
      const explicacao = desta.length
        ? "Racha reconstruído das anotações do grupo: os gols e assistências foram recuperados, mas não se sabe quem jogou em cada time."
        : "Racha reconstruído da lista de presença do grupo: não há times, placar nem estatísticas.";
      html += `
        ${rotulo}
        <div class="cartao placar-cabecalho">
          <span class="placar-quando">${quando}</span>
          <p class="placar-sem">Sem times e sem placar</p>
        </div>
        ${racha.origem === "recuperado" ? `<p class="aviso aviso-mes">${explicacao}</p>` : ""}
        <section class="coluna-time coluna-unica">
          <h3 class="coluna-time-titulo"><span>Presentes</span><b class="num">${todos.length}</b></h3>
          <ul class="coluna-time-lista">${todos.map(linhaJogadorTime).join("") || '<li class="vazio">Sem registro</li>'}</ul>
        </section>`;
      continue;
    }

    const resultado = p.resultado === "empate" ? "Empate" : `Vitória do Time ${p.resultado}`;
    html += `
      ${rotulo}
      <div class="cartao placar-cabecalho">
        <span class="placar-quando">${quando}</span>
        <div class="placar-grande" aria-label="Time A ${p.gols_a} a ${p.gols_b} Time B">
          <div><div class="rotulo">Time A</div><div class="numero ${p.resultado === "B" ? "perdeu" : ""}">${p.gols_a}</div></div>
          <div class="x">×</div>
          <div><div class="rotulo">Time B</div><div class="numero ${p.resultado === "A" ? "perdeu" : ""}">${p.gols_b}</div></div>
        </div>
        <p class="resultado-texto">${resultado}</p>
      </div>
      <div class="colunas-times">
        ${colunaTime("Time A", p.gols_a, p.resultado === "A", ordenarEscalacao(desta.filter((e) => e.equipe === "A")))}
        ${colunaTime("Time B", p.gols_b, p.resultado === "B", ordenarEscalacao(desta.filter((e) => e.equipe === "B")))}
      </div>`;
  }

  html += `<p class="legenda">⚽ gols · 👟 assistências · O gol contra conta no placar do time adversário.</p>`;

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
          <span class="linha-valor">${e?.presencas ?? 0}<small>jogos</small></span>
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
// Os TOTAIS (gols, assistências, jogos...) vêm das visões e já incluem os
// ajustes manuais. O gráfico, os últimos resultados e as medalhas são
// calculados jogo a jogo (v_participacoes), sem os ajustes.

const NOMES_MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez"];

// Líderes de gols e de assistências de cada mês (calculado uma vez só).
// Devolve Map "2026-08" -> { gols: {valor, ids}, assistencias: {valor, ids} }.
let cacheLideresMensais = null;
function lideresMensais() {
  if (cacheLideresMensais) return cacheLideresMensais;
  const porMes = new Map();  // "2026-08" -> Map(jogador -> {gols, assistencias})
  for (const p of dadosPeriodo.participacoes) {
    const mes = p.data_jogo.slice(0, 7);
    if (!porMes.has(mes)) porMes.set(mes, new Map());
    const doMes = porMes.get(mes);
    const j = doMes.get(p.jogador_id) ?? { jogador_id: p.jogador_id, gols: 0, assistencias: 0 };
    j.gols += p.gols;
    j.assistencias += p.assistencias;
    doMes.set(p.jogador_id, j);
  }
  cacheLideresMensais = new Map([...porMes].map(([mes, doMes]) =>
    [mes, { gols: lideres(doMes, "gols"), assistencias: lideres(doMes, "assistencias") }]));
  return cacheLideresMensais;
}

// "2026-08" -> "agosto de 2026"
function mesPorExtenso(anoMes) {
  const [ano, mes] = anoMes.split("-").map(Number);
  return `${NOMES_MESES[mes - 1]} de ${ano}`;
}

// Medalhas do jogador, calculadas a partir dos jogos.
function medalhasDoJogador(id) {
  const medalhas = [];
  const mesAtual = hojeISO().slice(0, 7);
  for (const [mes, lider] of [...lideresMensais()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const parcial = mes === mesAtual ? " (mês em andamento)" : "";
    if (lider.gols.ids.includes(id)) {
      medalhas.push({ icone: "⚽", texto: `Artilheiro de ${mesPorExtenso(mes)}${parcial}`,
        detalhe: `${lider.gols.valor} ${lider.gols.valor === 1 ? "gol" : "gols"}${lider.gols.ids.length > 1 ? ", empatado" : ""}` });
    }
    if (lider.assistencias.ids.includes(id)) {
      medalhas.push({ icone: "👟", texto: `Garçom de ${mesPorExtenso(mes)}${parcial}`,
        detalhe: `${lider.assistencias.valor} ${lider.assistencias.valor === 1 ? "assistência" : "assistências"}${lider.assistencias.ids.length > 1 ? ", empatado" : ""}` });
    }
  }
  // Recorde: a maior sequência de vitórias de todo o histórico.
  const recorde = lideres(dados.sequencias, "melhor_sequencia");
  if (recorde.ids.includes(id)) {
    medalhas.unshift({ icone: "🔥", texto: "Recorde de sequência",
      detalhe: `${recorde.valor} vitórias seguidas${recorde.ids.length > 1 ? ", empatado" : ""}` });
  }
  return medalhas;
}

// Gráfico de barras de gols por mês, feito só com HTML e CSS.
// Vai do primeiro mês em que o jogador jogou até o mês atual (meses sem
// gols aparecem com barra zerada).
function graficoGolsPorMes(jogos) {
  if (!jogos.length) return `<p class="vazio">Nenhum jogo registrado.</p>`;
  const golsPorMes = new Map();
  for (const j of jogos) {
    const mes = j.data_jogo.slice(0, 7);
    golsPorMes.set(mes, (golsPorMes.get(mes) ?? 0) + j.gols);
  }
  // Lista de meses contínua (sem buracos).
  const primeiro = [...golsPorMes.keys()].sort()[0];
  const ultimo = hojeISO().slice(0, 7);
  const meses = [];
  let [ano, mes] = primeiro.split("-").map(Number);
  while (`${ano}-${String(mes).padStart(2, "0")}` <= ultimo) {
    meses.push(`${ano}-${String(mes).padStart(2, "0")}`);
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
  }
  const maximo = Math.max(1, ...golsPorMes.values());
  const barras = meses.map((m) => {
    const gols = golsPorMes.get(m) ?? 0;
    const altura = Math.round((gols / maximo) * 100);
    const [a, mm] = m.split("-").map(Number);
    return `
      <div class="barra" role="listitem" aria-label="${NOMES_MESES[mm - 1]} de ${a}: ${gols} ${gols === 1 ? "gol" : "gols"}">
        <span class="barra-valor num">${gols}</span>
        <span class="barra-trilho"><span class="barra-cheia" style="height:${altura}%"></span></span>
        <span class="barra-mes">${NOMES_MESES_CURTOS[mm - 1]}</span>
      </div>`;
  }).join("");
  return `<div class="grafico" role="list" aria-label="Gols por mês">${barras}</div>`;
}

async function telaJogador(id) {
  const jogador = dados.jogadores.get(id);
  if (!jogador) return { titulo: "Jogador", html: `<p class="vazio">Jogador não encontrado.</p>` };

  await carregarDadosPeriodo();
  const e = dados.estatisticas.get(id) ?? {};
  const s = dados.sequencias.get(id) ?? {};

  // Jogos do jogador, do mais recente ao mais antigo.
  const partidasPorId = new Map(dados.partidas.map((p) => [p.partida_id, p]));
  const jogos = dadosPeriodo.participacoes
    .filter((p) => p.jogador_id === id)
    .sort((a, b) => b.data_jogo.localeCompare(a.data_jogo) || b.numero - a.numero);

  // --- Cabeçalho ------------------------------------------------------
  const descricao = [
    jogador.apelido ? `“${esc(jogador.apelido)}”` : "",
    esc(jogador.posicao ?? ""),
  ].filter(Boolean).join(" · ");

  // --- Números: 3 principais em destaque e os demais menores ---------
  const principal = (valor, rotulo) =>
    `<div class="numero-principal"><b class="num">${esc(valor ?? 0)}</b><span>${rotulo}</span></div>`;
  const menor = (valor, rotulo) =>
    `<div class="numero-menor"><b class="num">${esc(valor ?? 0)}</b><span>${rotulo}</span></div>`;
  const aproveitamento = e.aproveitamento === null || e.aproveitamento === undefined
    ? "–" : `${formatarDecimal(e.aproveitamento)}%`;

  // --- Últimos 5 resultados (só partidas com times) -------------------
  const NOMES_RESULTADO = { V: "Vitória", E: "Empate", D: "Derrota" };
  const ultimos = jogos.filter((j) => j.resultado).slice(0, 5).reverse();  // antigo -> recente
  const bolinhas = ultimos.length
    ? `<div class="ultimos" role="list" aria-label="Últimos resultados, do mais antigo ao mais recente">
         ${ultimos.map((j) => `
           <span class="bolinha res-${j.resultado}" role="listitem"
                 title="${NOMES_RESULTADO[j.resultado]} em ${dataBR(j.data_jogo)}"
                 aria-label="${NOMES_RESULTADO[j.resultado]} em ${dataBR(j.data_jogo)}">${j.resultado}</span>`).join("")}
       </div>
       <p class="legenda">Do mais antigo para o mais recente.</p>`
    : `<p class="vazio">Ainda sem jogos com times.</p>`;

  // --- Medalhas -------------------------------------------------------
  const medalhas = medalhasDoJogador(id);
  const listaMedalhas = medalhas.length
    ? `<ul class="medalhas">${medalhas.map((m) => `
        <li class="medalha">
          <span class="medalha-icone" aria-hidden="true">${m.icone}</span>
          <span><b>${esc(m.texto)}</b><span class="medalha-detalhe">${esc(m.detalhe)}</span></span>
        </li>`).join("")}</ul>`
    : `<p class="vazio">Nenhuma medalha ainda.</p>`;

  // --- Lista dos rachas em que jogou ----------------------------------
  const itens = jogos.map((j) => {
    const p = partidasPorId.get(j.partida_id);
    if (!p) return "";
    const res = j.resultado ?? "sem";
    const letra = j.resultado ?? "–";
    const placar = p.tem_times
      ? `Time ${esc(j.equipe ?? "?")} · ${p.gols_a} × ${p.gols_b}`
      : "Sem times";
    return `
      <li>
        <a class="linha" href="#racha/${p.racha_id}">
          <span class="res res-${res}" title="${NOMES_RESULTADO[res] ?? "Sem resultado"}">${letra}</span>
          <span class="linha-principal">
            <span class="racha-data">${dataBR(p.data_jogo)}</span>
            <span class="linha-sub">${placar}</span>
          </span>
          <span class="jogador-time-numeros">${numerosComIcones(j)}</span>
        </a>
      </li>`;
  }).join("");

  return {
    titulo: jogador.nome,
    voltar: "#jogadores",
    html: `
      <section class="ficha-topo">
        ${avatar(jogador, "avatar-gigante")}
        <h2 class="ficha-nome">${esc(jogador.nome)}</h2>
        ${descricao ? `<p class="ficha-descricao">${descricao}</p>` : ""}
        ${jogador.tipo === "convidado" ? '<span class="selo selo-convidado">convidado</span>' : ""}
        ${jogador.tipo === "goleiro" ? '<span class="selo selo-goleiro">goleiro</span>' : ""}
      </section>

      <div class="numeros-principais">
        ${principal(e.gols, "Gols")}
        ${principal(e.assistencias, "Assistências")}
        ${principal(e.presencas, "Jogos")}
      </div>
      <div class="cartao numeros-menores">
        ${menor(e.vitorias, "Vitórias")}
        ${menor(e.empates, "Empates")}
        ${menor(e.derrotas, "Derrotas")}
        ${menor(aproveitamento, "Aproveit.")}
        ${menor(s.sequencia_atual, "Sequência atual")}
        ${menor(s.melhor_sequencia, "Melhor sequência")}
        ${menor(e.gols_contra, "Gols contra")}
      </div>
      <p class="legenda">Totais com os ajustes manuais do histórico. Aproveitamento e sequências
        consideram só partidas com times.</p>

      <h2 class="secao-titulo">Últimos resultados</h2>
      <div class="cartao">${bolinhas}</div>

      <h2 class="secao-titulo">Gols por mês</h2>
      <div class="cartao">
        ${graficoGolsPorMes(jogos)}
        <p class="legenda">Contados jogo a jogo, sem os ajustes manuais.</p>
      </div>

      <h2 class="secao-titulo">Medalhas</h2>
      ${listaMedalhas}

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
  const [rota, parametro, ...extras] = (location.hash.replace("#", "") || "inicio").split("/");

  // Marca a aba ativa (as telas de detalhe ficam com a aba "mãe" acesa).
  const abaAtiva = { racha: "rachas", jogador: "jogadores" }[rota] ?? rota;
  document.querySelectorAll(".aba").forEach((aba) =>
    aba.classList.toggle("ativa", aba.dataset.aba === abaAtiva));

  try {
    if (!dados.carregado) conteudo.innerHTML = esqueleto({ chips: rota === "rankings" });
    await carregarDadosBase();

    let tela;
    if (rota === "inicio") {
      if (!dadosPeriodo.participacoes.length) conteudo.innerHTML = esqueleto({ linhas: 4 });
      tela = await telaInicio();
    } else if (rota === "rachas") tela = telaRachas();
    else if (rota === "racha") {
      conteudo.innerHTML = esqueleto();
      tela = await telaRacha(Number(parametro));
    } else if (rota === "jogadores") tela = telaJogadores();
    else if (rota === "jogador") {
      conteudo.innerHTML = esqueleto();
      tela = await telaJogador(Number(parametro));
    } else {
      // Ranking: os filtros de período/média podem precisar de dados extras.
      if (extras[0] && extras[0] !== "geral" && !dadosPeriodo.participacoes.length) {
        conteudo.innerHTML = esqueleto({ chips: true });
      }
      tela = await telaRankings(parametro, extras[0], extras[1]);
    }

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

// App instalável: registra o "service worker" (sw.js), que guarda os
// arquivos do app no celular para abrir rápido. Os dados do banco nunca
// ficam guardados: sempre vêm da internet (veja os comentários no sw.js).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((erro) =>
      console.warn("Não foi possível ativar o modo app:", erro));
  });
}

// Redesenha sempre que o endereço (#...) mudar, e na primeira abertura.
window.addEventListener("hashchange", () => { navegouNoApp = true; desenharTela(); });
desenharTela();
