// =====================================================================
// Configuração de acesso ao Supabase
// =====================================================================
// A chave abaixo é a chave PÚBLICA ("publishable") do projeto: ela foi
// feita para ficar no navegador e pode aparecer no código sem problema.
// Quem protege os dados é o próprio banco (RLS + permissões): com esta
// chave, sem login, só dá para LER as tabelas e visões públicas.
//
// Atenção: a URL é só o endereço do projeto, SEM o "/rest/v1/" no final
// (a biblioteca do Supabase acrescenta esse pedaço sozinha).

window.CONFIG = {
  SUPABASE_URL: "https://javfqneviqtcmhaamxkb.supabase.co",
  SUPABASE_CHAVE_PUBLICA: "sb_publishable_6hkbT9Ha5CQeDRP-JE4Ppw_f8rrTQNR",
};
