// =====================================================================
// App do Racha — "service worker" (o que faz o app abrir rápido)
// =====================================================================
// Um service worker é um pequeno programa que o navegador guarda junto
// com o app instalado no celular. Aqui ele faz só uma coisa: guarda uma
// cópia dos ARQUIVOS ESTÁTICOS do app (HTML, CSS, JavaScript, ícones e
// fontes), para a tela abrir na hora, mesmo com internet lenta.
//
// REGRAS IMPORTANTES
//   1. Os DADOS do banco (Supabase) NUNCA passam pelo cache: toda consulta
//      vai direto à internet, então os rankings estão sempre atualizados.
//   2. O cache tem um NÚMERO DE VERSÃO no nome (ex.: "racha-estatico-v1").
//      Ao publicar uma versão nova do app, AUMENTE o número em VERSAO
//      (v1 -> v2). Quando o celular baixar o sw.js novo, ele cria o cache
//      novo e APAGA AUTOMATICAMENTE os caches das versões antigas.
//   3. Arquivos do PRÓPRIO APP (HTML, CSS, JavaScript, manifest): com
//      internet, sempre busca a versão mais nova no servidor (e atualiza a
//      cópia); só usa a cópia guardada quando está sem internet. Assim uma
//      publicação nova vale na hora e nunca se mistura arquivo novo com
//      arquivo velho (ex.: config.js antigo apontando para outro banco).
//   4. Imagens, ícones, fontes e a biblioteca do CDN mudam pouco: abrem
//      da cópia guardada (rápido) e são atualizados "por trás".
// =====================================================================

// >>> Aumente este número a cada publicação de mudanças na pasta web/ <<<
const VERSAO = "v7";
const NOME_CACHE = `racha-estatico-${VERSAO}`;

// Arquivos do próprio app guardados já na instalação.
const ARQUIVOS_DO_APP = [
  "./",
  "index.html",
  "estilos.css",
  "app.js",
  "config.js",
  "manifest.json",
  "img/escudo-256.png",
  "img/icone-192.png",
  "img/icone-512.png",
  "img/icone-maskable-512.png",
  "img/icone-apple-180.png",
];

// Endereços externos que também são arquivos estáticos (podem ir ao cache):
// fontes do Google e a biblioteca do Supabase no CDN (só o arquivo .js dela).
const SITES_ESTATICOS = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"];


// ---------------------------------------------------------------------
// Instalação: guarda os arquivos do app no cache desta versão.
// ---------------------------------------------------------------------
self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(NOME_CACHE)
      .then((cache) => cache.addAll(ARQUIVOS_DO_APP))
      .then(() => self.skipWaiting())  // a versão nova assume sem esperar
  );
});


// ---------------------------------------------------------------------
// Ativação: apaga os caches de versões antigas do app.
// ---------------------------------------------------------------------
self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(
        nomes
          .filter((nome) => nome.startsWith("racha-estatico-") && nome !== NOME_CACHE)
          .map((nome) => caches.delete(nome))
      ))
      .then(() => self.clients.claim())  // passa a cuidar das abas já abertas
  );
});


// ---------------------------------------------------------------------
// Pedidos de rede: decide o que pode vir do cache.
// ---------------------------------------------------------------------
self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  if (pedido.method !== "GET") return;  // só leitura de arquivos passa por aqui

  const url = new URL(pedido.url);

  // REGRA 1: nada do Supabase passa pelo cache. Sem "respondWith", o
  // navegador faz o pedido normalmente, direto na internet.
  if (url.hostname.endsWith(".supabase.co")) return;

  const doProprioApp = url.origin === self.location.origin;
  const estaticoExterno = SITES_ESTATICOS.includes(url.hostname);
  if (!doProprioApp && !estaticoExterno) return;  // qualquer outra coisa: rede

  // Arquivos do app são guardados pelo endereço SEM o "?..." do final:
  // index.html?v=2 e index.html usam a mesma cópia (evita cópias repetidas).
  const chave = doProprioApp ? url.origin + url.pathname : pedido;

  // É código/página do app? (HTML, CSS, JS, manifest ou a raiz "/racha/")
  const codigoDoApp = doProprioApp && /(\/|\.html|\.css|\.js|\.json)$/.test(url.pathname);

  evento.respondWith(
    caches.open(NOME_CACHE).then(async (cache) => {
      if (codigoDoApp) {
        // REGRA 3: primeiro a rede ("no-cache" = conferir com o servidor);
        // sem internet, a cópia guardada.
        try {
          const resposta = await fetch(pedido, { cache: "no-cache" });
          if (resposta.ok) cache.put(chave, resposta.clone());
          return resposta;
        } catch {
          return (await cache.match(chave)) || Response.error();
        }
      }
      // REGRA 4: usa a cópia guardada (se houver) e atualiza em seguida.
      const guardado = await cache.match(chave);
      const daRede = fetch(pedido)
        .then((resposta) => {
          if (resposta.ok) cache.put(chave, resposta.clone());
          return resposta;
        })
        .catch(() => guardado);  // sem internet: fica com o guardado
      return guardado || daRede;
    })
  );
});
