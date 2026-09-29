# Correção da verificação de benefícios

Um registro antigo podia combinar créditos de mundo com uma data futura de acesso. A importação para a conta Google recusava esse registro porque somente passes de tempo podem usar essa data. Assim, `Minha conta` e o checkout recebiam `ENTITLEMENT_UNAVAILABLE` antes da compra.

A importação agora preserva créditos e projetos válidos, ignora a data incompatível e nunca a transforma em passe. A leitura da conta também ignora datas antigas sem um plano de tempo reconhecido. IDs e valores de pagamento continuam validados no servidor. A reconciliação agendada da Depix passa a marcar pagamentos já liquidados para evitar gravá-los de novo a cada execução.

O site mostra o motivo útil da falha quando a consulta realmente falhar. O checkout segue bloqueado nesse caso, antes de criar qualquer cobrança.

Validação: testes de Worker cobrindo migração, saldo sem duplicação e ausência de acesso de tempo indevido; testes do checkout InfinitePay; conta afetada exibiu novamente seu crédito ativo em produção. Nenhum pagamento novo foi criado durante a verificação.
