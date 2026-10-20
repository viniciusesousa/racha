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

// Iniciais do nome para o avatar: "Jogador Exemplo" -> "JE", "Exemplo" -> "EX".
function iniciais(nome) {
  const partes = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// Cores dos círculos de iniciais (todas com contraste AA para letra branca).
// A cor é escolhida pelo id do jogador, então cada um mantém sempre a sua.
const CORES_AVATAR = ["#3a650f", "#1f5f7a", "#5b4b8a", "#8a4b2a", "#6b2f5a", "#2f5d50", "#7a4f0e"];

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
        .select("partida_id, racha_id, data_jogo, tem_times, jogador_id, equipe, gols, assistencias, gols_contra, resultado")
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
  const [rota, parametro] = (location.hash.replace("#", "") || "inicio").split("/");

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
