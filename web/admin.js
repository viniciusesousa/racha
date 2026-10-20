// =====================================================================
// App do Racha — área do administrador (admin.html)
// =====================================================================
// Etapa 1: acesso.
//   * Login com e-mail e senha (Supabase Auth). A sessão fica guardada no
//     celular: na próxima vez, já entra direto.
//   * "Esqueci a senha": envia um link por e-mail; ao abrir o link, esta
//     página pede a nova senha.
//   * Depois do login, pergunta ao banco se o usuário é administrador
//     (função eh_admin). Se não for: "acesso não autorizado" e NENHUM dado
//     é carregado.
//   * Sem login, esta página não consulta dado nenhum do banco.
//
// Segurança: só a chave PÚBLICA é usada. Quem decide o que cada um pode
// ver ou gravar é o próprio banco (RLS e permissões).
// =====================================================================

const banco = window.supabase.createClient(
  window.CONFIG.SUPABASE_URL,
  window.CONFIG.SUPABASE_CHAVE_PUBLICA,
  {
    auth: {
      persistSession: true,      // mantém a sessão no celular
      autoRefreshToken: true,    // renova o acesso sozinho
      detectSessionInUrl: true,  // entende o link de recuperação de senha
    },
  }
);

// ---------------------------------------------------------------------
// Elementos da página
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const TELAS = ["tela-carregando", "tela-login", "tela-nova-senha", "tela-nao-autorizado", "tela-painel"];

// Mostra uma tela e esconde as outras.
function mostrarTela(id) {
  TELAS.forEach((t) => { $(t).hidden = t !== id; });
  const logado = id === "tela-painel" || id === "tela-nao-autorizado" || id === "tela-nova-senha";
  $("botao-sair").hidden = !logado;
  $("abas-admin").hidden = id !== "tela-painel";
  document.body.classList.toggle("com-abas", id === "tela-painel");
}

// Mostra uma mensagem (erro ou aviso) num parágrafo da página.
function mensagem(id, texto, tipo = "erro") {
  const el = $(id);
  el.textContent = texto;
  el.className = `mensagem mensagem-${tipo}`;
  el.hidden = !texto;
}

// Protege contra textos com símbolos especiais.
function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}


// =====================================================================
// CONTROLE DE ACESSO
// =====================================================================

// Indica que estamos no meio da troca de senha (não sair dessa tela).
let trocandoSenha = window.location.hash.includes("type=recovery");

// Decide o que mostrar a partir da sessão atual.
async function verificarAcesso(sessao) {
  if (trocandoSenha) { mostrarTela("tela-nova-senha"); return; }
  if (!sessao) { mostrarTela("tela-login"); return; }

  // Pergunta ao banco se este usuário é administrador.
  const { data: ehAdmin, error } = await banco.rpc("eh_admin");
  if (error) {
    mostrarTela("tela-login");
    mensagem("login-mensagem", "Não foi possível conferir seu acesso agora. Verifique a internet e tente de novo.");
    return;
  }
  if (!ehAdmin) {
    // Logado, mas sem permissão: não carrega NADA.
    mostrarTela("tela-nao-autorizado");
    return;
  }

  $("admin-email").textContent = sessao.user.email;
  mostrarTela("tela-painel");
  abrirSecao(secaoAtual());
}

// Reage a mudanças de login (entrou, saiu, link de recuperação...).
banco.auth.onAuthStateChange((evento, sessao) => {
  if (evento === "PASSWORD_RECOVERY") {
    trocandoSenha = true;
    mostrarTela("tela-nova-senha");
  } else if (evento === "SIGNED_OUT") {
    mostrarTela("tela-login");
  }
});

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------
$("form-login").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const email = $("login-email").value.trim();
  const senha = $("login-senha").value;
  if (!email || !senha) {
    mensagem("login-mensagem", "Preencha o e-mail e a senha.");
    return;
  }
  $("login-botao").disabled = true;
  mensagem("login-mensagem", "");
  const { data, error } = await banco.auth.signInWithPassword({ email, password: senha });
  $("login-botao").disabled = false;
  if (error) {
    const texto = /invalid login credentials/i.test(error.message)
      ? "E-mail ou senha incorretos."
      : "Não foi possível entrar agora. Verifique a internet e tente de novo.";
    mensagem("login-mensagem", texto);
    return;
  }
  $("login-senha").value = "";
  verificarAcesso(data.session);
});

// ---------------------------------------------------------------------
// Esqueci a senha: envia o link de recuperação por e-mail
// ---------------------------------------------------------------------
$("botao-esqueci").addEventListener("click", async () => {
  const email = $("login-email").value.trim();
  if (!email) {
    mensagem("login-mensagem", "Digite seu e-mail no campo acima e toque de novo em \"Esqueci a senha\".", "aviso");
    return;
  }
  // O link volta para esta mesma página (admin.html).
  const voltarPara = window.location.origin + window.location.pathname;
  const { error } = await banco.auth.resetPasswordForEmail(email, { redirectTo: voltarPara });
  mensagem("login-mensagem", error
    ? "Não foi possível enviar o e-mail agora. Tente de novo em alguns minutos."
    : "Se este e-mail for de um administrador, você vai receber um link para criar uma nova senha.",
    error ? "erro" : "aviso");
});

// ---------------------------------------------------------------------
// Nova senha (depois de abrir o link do e-mail)
// ---------------------------------------------------------------------
$("form-nova-senha").addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const senha = $("nova-senha").value;
  if (senha.length < 8) {
    mensagem("nova-senha-mensagem", "A senha precisa ter pelo menos 8 caracteres.");
    return;
  }
  if (senha !== $("nova-senha-2").value) {
    mensagem("nova-senha-mensagem", "As duas senhas não são iguais.");
    return;
  }
  const { error } = await banco.auth.updateUser({ password: senha });
  if (error) {
    mensagem("nova-senha-mensagem", "Não foi possível salvar a nova senha. Abra o link do e-mail de novo.");
    return;
  }
  trocandoSenha = false;
  history.replaceState(null, "", window.location.pathname);  // limpa o endereço
  const { data } = await banco.auth.getSession();
  verificarAcesso(data.session);
});

// ---------------------------------------------------------------------
// Sair
// ---------------------------------------------------------------------
async function sair() {
  await banco.auth.signOut();
  $("painel-conteudo").innerHTML = "";  // apaga da tela tudo o que foi carregado
  mostrarTela("tela-login");
}
$("botao-sair").addEventListener("click", sair);
$("botao-sair-nao-autorizado").addEventListener("click", sair);


// =====================================================================
// AVISO DE FALHA NA GRAVAÇÃO (usado por todas as seções)
// =====================================================================
// Tudo é gravado na hora. Se uma gravação falhar (ex.: internet caiu),
// aparece uma faixa vermelha bem visível com o motivo e o botão
// "Tentar de novo", que repete exatamente a mesma gravação.

let repetirUltimaGravacao = null;

function mostrarFalha(texto, tentarDeNovo) {
  repetirUltimaGravacao = tentarDeNovo || null;
  $("falha-texto").textContent = texto;
  $("falha-repetir").hidden = !tentarDeNovo;
  $("faixa-falha").hidden = false;
}
function esconderFalha() {
  $("faixa-falha").hidden = true;
  repetirUltimaGravacao = null;
}
$("falha-repetir").addEventListener("click", () => {
  const repetir = repetirUltimaGravacao;
  esconderFalha();
  if (repetir) repetir();
});
$("falha-fechar").addEventListener("click", esconderFalha);

// Explica um erro do banco em português simples.
function explicarErro(erro) {
  const texto = String(erro?.message || erro || "");
  if (/Failed to fetch|NetworkError|tempo esgotado|Load failed/i.test(texto)) {
    return "Sem conexão com o banco. Confira a internet e toque em \"Tentar de novo\".";
  }
  if (/duplicate key|already exists/i.test(texto)) return "Esse registro já existe.";
  if (/permission denied|Acesso negado|42501/i.test(texto)) return "Sem permissão. Saia e entre de novo como administrador.";
  // As regras do banco já escrevem mensagens em português: mostra como veio.
  return texto || "Não foi possível gravar.";
}

// Executa uma gravação no banco.
//   acao       = função que faz a gravação (devolve { data, error } do Supabase)
//   aoDarCerto = função chamada com os dados quando a gravação dá certo
// Se falhar, mostra a faixa vermelha; "Tentar de novo" repete a mesma
// gravação e, dando certo, chama aoDarCerto do mesmo jeito.
async function gravar(acao, aoDarCerto) {
  try {
    const resultado = await acao();
    if (resultado && resultado.error) throw resultado.error;
    esconderFalha();
    const dados = resultado ? resultado.data : null;
    if (aoDarCerto) await aoDarCerto(dados);
    return { ok: true, data: dados };
  } catch (erro) {
    mostrarFalha(explicarErro(erro), () => gravar(acao, aoDarCerto));
    return { ok: false, erro };
  }
}


// =====================================================================
// PAINEL (seções do admin)
// =====================================================================
// Cada seção que já existe fica num arquivo próprio (ex.: admin-racha.js)
// e se apresenta como um objeto com a função abrir(elemento). As que ainda
// não foram feitas mostram "em construção". A seção aberta fica lembrada
// no celular (só a preferência; nenhum dado é guardado).

const SECOES = {
  racha:     { titulo: "Racha do dia",   etapa: "etapas 2 a 4", modulo: () => window.SecaoRacha },
  devedores: { titulo: "Devedores",      etapa: "etapa 5" },
  caixa:     { titulo: "Caixa",          etapa: "etapa 6" },
  jogadores: { titulo: "Jogadores",      etapa: "etapa 7" },
  config:    { titulo: "Configurações",  etapa: "etapa 8" },
};

function secaoAtual() {
  try { return SECOES[localStorage.getItem("admin-secao")] ? localStorage.getItem("admin-secao") : "racha"; }
  catch { return "racha"; }
}

function abrirSecao(id) {
  try { localStorage.setItem("admin-secao", id); } catch { /* sem armazenamento: tudo bem */ }
  document.querySelectorAll("#abas-admin .aba").forEach((aba) =>
    aba.classList.toggle("ativa", aba.dataset.secao === id));
  $("titulo-tela").textContent = SECOES[id].titulo;
  esconderFalha();
  const modulo = SECOES[id].modulo && SECOES[id].modulo();
  if (modulo) {
    modulo.abrir($("painel-conteudo"));
    return;
  }
  $("painel-conteudo").innerHTML = `
    <div class="cartao">
      <h2 class="secao-titulo" style="margin-top:0">${esc(SECOES[id].titulo)}</h2>
      <p class="vazio" style="padding:8px 0">Em construção (${esc(SECOES[id].etapa)}).</p>
    </div>`;
}

document.querySelectorAll("#abas-admin .aba").forEach((aba) =>
  aba.addEventListener("click", () => abrirSecao(aba.dataset.secao)));


// =====================================================================
// INÍCIO
// =====================================================================
// Lê a sessão guardada no celular (não consulta dados do banco).
banco.auth.getSession().then(({ data }) => verificarAcesso(data.session));
