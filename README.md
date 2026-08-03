# Moodle Importador de Notas e Feedback

Extensão simples para Chrome/Edge que adiciona o botão **Importar notas** na tela de correção rápida de atividades do Moodle.

**Versão atual: 2.0.0**

## O que ela faz

- Lê a tabela `#submissions` da página atual do Moodle.
- Encontra o aluno na coluna `td.username`.
- Encontra a nota pelo campo `quickgrade_IDDOUSUARIO`.
- Encontra o feedback pelo campo `quickgrade_comments_IDDOUSUARIO`.
- Importa CSV, TSV ou XLSX com `nome` e ao menos uma coluna entre `nota`, `feedback` ou `situacao`.
- Valida cabeçalhos e linhas úteis. A coluna `nota` é opcional e pode ser omitida.
- Oferece um modelo CSV para download e um prompt de correção copiável.
- Preenche os campos da página, mas **não salva automaticamente**.

Depois de revisar, use o botão nativo do Moodle para salvar as alterações.

O botão de importação é exibido somente na tela de correção rápida da atividade:
`/mod/assign/view.php?action=grading`. O botão fica ativo quando **Avaliação rápida** está marcada e a tabela contém ao menos um campo editável de **Nota** ou **Comentários de feedback**.

## Formato da planilha

O único cabeçalho obrigatório é `nome`. Inclua ao menos uma coluna de ação. Exemplo sem nota:

```csv
nome;feedback;situacao
tiao do abacate;Texto do feedback aqui;Corrigido
```

O formato completo `nome;nota;feedback;situacao` continua aceito.

Também são aceitos cabeçalhos equivalentes:

- Nome: `nome`, `aluno`, `estudante`, `discente`, `nome do aluno`, `nome completo`
- Nota opcional: `nota`, `nota sugerida`, `nota final`, `pontuação`, `score`, `grade`
- Feedback: `feedback`, `comentário`, `comentários`, `comentários de feedback`, `observação`, `retorno`, `devolutiva`

### Tags de correção

A coluna `situacao` deve usar somente estas tags:

- `Corrigido`: o arquivo pode ser lido e contém conteúdo relevante para a correção.
- `Atensão`: o arquivo é válido e pode ser lido, mas não apresenta o conteúdo solicitado na atividade.
- `Perigo`: o arquivo não pode ser lido, está inválido ou não é uma entrega válida.

Os feedbacks devem ser baseados somente em fatos verificáveis no arquivo, nos critérios ou nas instruções da atividade. Não invente respostas, trechos, fontes, esforço, intenção, nota ou resultados. Se algo não puder ser confirmado, informe que não foi possível identificar ou avaliar.

Exemplos de feedback:

- `Corrigido`: “Olá, Ana! Obrigado pelo envio. No seu arquivo, você apresentou as etapas de identificação do problema conforme o critério solicitado. Para fortalecer a resposta, detalhe como chegou ao resultado final. Continue se dedicando!”
- `Atensão`: “Olá, Bruno! Obrigado pelo envio. O arquivo foi aberto, mas não localizei nele a análise solicitada. Acrescente essa etapa e envie o arquivo novamente.”
- `Perigo`: “Olá, Carla! Recebi seu envio, mas não foi possível abrir o arquivo para verificar o conteúdo. Reenvie-o em um formato válido para que eu possa realizar a avaliação.”

## Uso

1. Abra a tela de correção rápida da atividade no Moodle.
2. Marque **Avaliação rápida** para exibir os campos editáveis.
3. Clique em **Importar**.
4. Se precisar, clique em **baixar modelo** para gerar um CSV de exemplo.
5. Escolha o arquivo CSV/XLSX.
6. Revise a validação exibida no painel.
7. A extensão verifica automaticamente os registros e as correspondências de nomes.
8. Clique em **Preencher página**.
9. Revise nota e feedback na tabela.
10. Clique no botão nativo do Moodle para salvar.

O bloco **Prompt de correção** no painel pode ser aberto para copiar uma instrução pronta para gerar o CSV no formato aceito pela extensão.

## Opções

- **Sobrescrever nota existente**: marcada por padrão, porque o Moodle pode exibir `0,00` mesmo quando você deseja importar uma nova nota.
- **Sobrescrever feedback existente**: marcada por padrão, para substituir rascunhos anteriores.
- **Permitir comparação flexível de nomes**: ajuda quando há diferença de acentos, maiúsculas/minúsculas ou pequenas variações. Se houver ambiguidade, a extensão não preenche o aluno.

## Instalação no Chrome/Edge

1. Extraia o ZIP.
2. Acesse `chrome://extensions/` ou `edge://extensions/`.
3. Ative o modo do desenvolvedor.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta extraída.
6. Abra a tela de correção rápida do Moodle.

## Observações

- A extensão atua apenas na página atual. Se a turma estiver paginada, importe página por página.
- A busca ignora acentos, maiúsculas e minúsculas.
- O CSV é o formato mais estável. XLSX simples funciona usando a primeira aba.
- A extensão usa apenas a sessão autenticada dos Moodles SENAI/FIEG. A permissão de downloads serve para salvar os arquivos em pastas organizadas dentro da pasta Downloads do navegador. Nenhum conteúdo é enviado para serviços externos.


## Versão 0.5.2

- Torna a coluna e o campo de nota opcionais.
- Permite importar e preencher feedback mesmo em atividades sem campo de nota.
- Mantém o download individual usando o nome do aluno e o crédito “By Julio” com link para o LinkedIn.


## Versão 0.6.0

- Substitui as abas do modal por sessões recolhíveis. A sessão **Importação** permanece sempre aberta; **Instruções** e **Lançamento em massa** podem ser minimizadas.
- Atua também nas páginas `/course/view.php`, independentemente do parâmetro `section`.
- Localiza todas as atividades Moodle do tipo `assign` exibidas na página do curso.
- Consulta cada atividade usando a sessão já autenticada do navegador e lê o valor **Precisa de avaliação** no sumário da tarefa.
- Exibe uma notificação numérica vermelha sobre o ícone de cada atividade que possui envios aguardando avaliação.
- Mostra um resumo do total de envios e atividades pendentes, com botão para atualizar a consulta.
- Faz no máximo quatro consultas simultâneas e mantém cache de sessão por 90 segundos para reduzir carga no Moodle.


## Versão 0.7.0

- Reduz a largura do modal e volta a organizar **Importação** e **Lançamento em massa** em abas.
- Remove os botões **Cancelar** e **Verificar**; o fechamento é feito pelo X e a validação acontece automaticamente ao selecionar o arquivo.
- Remove a sessão separada de instruções e mostra o prompt de correção diretamente na aba de importação, com botão **Copiar prompt**.
- Atua também em `/course/index.php?categoryid=...`.
- Identifica os cursos visíveis na categoria, consulta as tarefas `assign` usando a sessão autenticada e mostra, junto ao nome de cada curso, o total de envios que ainda precisam de avaliação.
- Mostra um resumo da categoria com total de envios pendentes, atividades afetadas e cursos afetados.
- Limita a leitura simultânea e usa cache temporário de sessão para reduzir carga no Moodle.


## Versão 0.7.1

- Posiciona o resumo de correções sempre no topo do conteúdo principal, tanto no Moodle Goiás quanto no Moodle Nacional.
- Move a notificação numérica para uma camada externa ao contêiner recortado do ícone, corrigindo a exibição no Moodle Nacional.
- Mantém a etiqueta sobre o canto superior do ícone da atividade e preserva a compatibilidade com o tema do Moodle Goiás.


## Versão 0.7.2

- Mantém a detecção genérica para qualquer rota `/course/index.php?categoryid=...`, sem fixar o identificador da categoria.
- Exibe uma etiqueta verde com `✓` ao lado de cada unidade que foi consultada com sucesso e não possui correções pendentes.
- Mantém a etiqueta vermelha numérica quando existem envios aguardando avaliação e `!` quando a leitura é parcial ou falha.
- O texto de ajuda da etiqueta informa quantas atividades foram verificadas na unidade.


## Versão 0.8.0

- Adiciona o primeiro fluxo de download organizado por curso e categoria.


## Versão 0.8.1

- Substitui **Baixar envios** por **Baixar pendentes** nas páginas de curso e categoria.
- Consulta somente atividades cujo campo **Precisa de avaliação** é maior que zero.
- Abre a tela de avaliação com o filtro `status=requiregrading`, percorre as páginas e coleta os identificadores dos alunos pendentes.
- Usa a operação nativa `gradingbatchoperation` com `operation=downloadselected`, enviando apenas os alunos ainda não avaliados.
- Não inclui no ZIP estudantes que já aparecem como avaliados.
- Gera um ZIP por atividade e organiza os arquivos em `Moodle - Pendentes de correção/Categoria/Curso/Atividade - N pendentes.zip`. Na página do curso, a estrutura começa em `Moodle - Pendentes de correção/Curso`.
- Interrompe o download de uma atividade quando a quantidade de alunos encontrada é menor que o total de pendências informado pelo Moodle, evitando arquivo parcial silencioso.
- Processa os ZIPs em sequência e mantém somente um arquivo em preparação por vez para reduzir uso de memória.


## Versão 0.8.2

- Adiciona um menu de configurações no ícone da extensão.
- Permite ativar ou desativar a consulta de pendências nas páginas de curso e de categorias.
- Permite ocultar os ícones de pendências sem desativar a consulta agregada.
- Permite ocultar e bloquear os botões **Baixar pendentes**.
- As preferências ficam salvas no navegador e são aplicadas ao recarregar a página do Moodle.


## Versão 0.8.3

- Remove o compartilhamento persistente das contagens entre páginas de curso e categorias.
- Faz uma nova consulta ao Moodle ao carregar cada página, evitando falsos positivos por dados antigos.
- Mantém a validação por comentário de feedback e pela coluna Nota quando disponíveis.

## Versão 2.0.0

- Consolida o fluxo de importação de notas, feedbacks e tags na tela de correção rápida do Moodle.
- Ajusta o prompt de correção para gerar feedbacks mais humanos, acolhedores, claros e orientados pelos critérios do Guia do Tutor.
- Exige que os feedbacks sejam baseados em fatos verificáveis no arquivo, nos critérios ou nas instruções da atividade.
- Proíbe a invenção de respostas, trechos, fontes, esforço, intenção, critérios, notas ou resultados.
- Limita as tags de correção a `Corrigido`, `Atensão` e `Perigo`.
- Inclui exemplos de feedback para as três tags e mantém a compatibilidade com variações antigas na importação.
