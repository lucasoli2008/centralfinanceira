# Sugestões futuras (não implementadas)

Ideias que surgiram durante a construção e que foram **deliberadamente não implementadas** por
estarem fora do escopo definido (ver `PRODUCT_SPEC.md` §2 e o prompt mestre §48).

Nada aqui deve ser construído sem uma decisão explícita da imobiliária.

## Dentro do espírito do produto (ampliações naturais)

| Ideia | Por que pode fazer sentido | Por que ficou de fora |
| --- | --- | --- |
| Comissão recebida em parcelas com vínculo formal | Hoje usa-se a mesma `reference` em lançamentos separados | Módulo de parcelamento foi explicitamente barrado na v1 |
| Metas mensais de receita líquida | Daria contexto às comparações do dashboard | Não pedido; exige nova tabela e regra de acompanhamento |
| Exportação em CSV/Excel | Facilitaria enviar dados ao contador | Escopo definiu PDF como formato oficial |
| Segundo nível de comparação no dashboard (trimestre) | Leitura sazonal do mercado | Filtro atual já cobre os períodos pedidos |
| Anexar comprovante ao lançamento | Rastreabilidade do recebimento | Vira gestão documental — proibido no escopo |
| Modo escuro | Conforto visual | Escopo define paleta clara; dobraria a superfície visual |
| Múltiplas organizações na mesma conta | O schema já está preparado (`organization_id`) | Hoje existe uma imobiliária; UI de troca não é necessária |
| Notificação de mês pronto para fechar | Disciplina de fechamento | Sem canal de notificação no escopo |

## Fora do escopo por definição (não implementar)

Registrado apenas para deixar claro que foi considerado e recusado:

CRM, leads, pipeline comercial, cadastro de clientes, proprietários ou inquilinos, cadastro
imobiliário completo, fotos de imóveis, portais externos (proprietário, corretor, inquilino),
contratos, assinaturas, agenda, mensagens, automação de WhatsApp, administração mensal de aluguel,
IPTU, condomínio, água e energia, controle de inadimplência, reajuste de aluguel, vistorias,
recibos, boletos, contas bancárias, Open Finance, conciliação bancária, fluxo de caixa completo,
contas a pagar e a receber, folha de pagamento, contabilidade, estoque e módulos genéricos de ERP.

O valor do produto está em ser **pequeno em escopo e profundo em execução**. Cada item acima
transformaria a central financeira em um ERP genérico.

## Módulo Obras — ampliações naturais (não implementadas)

| Ideia | Por que pode fazer sentido | Por que ficou de fora |
| --- | --- | --- |
| Gráfico "gastos por mês" no dashboard de Obras | `recharts` já é dependência; dado já existe (`getWorkMonthlySpending`) | Deliberadamente deixado por último no plano de implementação; pode ser adicionado depois sem migração nova |
| Cadastro estruturado de imóveis/proprietários | Evitaria digitar o mesmo imóvel em obras diferentes | Proibido em `CLAUDE.md`; Obras usa texto livre de propósito |
| Vínculo automático entre obra e lançamento financeiro | "Quanto uma reforma custou" apareceria no financeiro principal | Explicitamente fora de escopo (seção 27 do pedido): Obras não gera postagem financeira |

## Módulo Obras — fora do escopo por definição (não implementar)

Registrado apenas para deixar claro que foi considerado e recusado (seção 27 do pedido original):

Login/domínio separado para Obras, portal de proprietário ou prestador, aprovação/assinatura
digital de orçamentos, chat interno, automação de WhatsApp/e-mail, contas a pagar/receber,
postagens financeiras automáticas, conciliação bancária, módulo completo de fornecedores/
prestadores (cadastro, avaliação, contrato), leitura automática de nota fiscal por IA/OCR, análise
automática de fotos, previsão de custo, manutenção preventiva automática, controle de estoque/
ferramentas, mapas/geolocalização, aplicativo separado, notificações push.
