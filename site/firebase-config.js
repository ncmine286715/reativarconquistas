/* ReativaConquistas — configuração do Firebase (PÚBLICA, sem segredo).
   A apiKey do Firebase NÃO é segredo (vai no JS mesmo): a segurança vem das
   regras + domínios autorizados no console do Firebase.
   Passos (1x):
   1. https://console.firebase.google.com/ -> criar projeto -> Authentication ->
      Sign-in method -> ativar "Google" e "E-mail/senha".
   2. Project settings -> "Seus apps" (web </>) -> copiar os valores p/ baixo.
   3. Authentication -> Settings -> Authorized domains -> adicionar seu domínio
      (ex.: seudominio.com.br) e localhost p/ teste.
   Enquanto estiver vazio, o login fica desligado e o site funciona normal.
*/
window.RC_FIREBASE = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: ""
};
