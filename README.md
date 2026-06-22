# Moodle Importador de Notas e Feedback

Extensão simples para Chrome/Edge que adiciona o botão **Importar notas** na tela de correção rápida de atividades do Moodle.

## O que ela faz

- Lê a tabela `#submissions` da página atual do Moodle.
- Encontra o aluno na coluna `td.username`.
- Encontra a nota pelo campo `quickgrade_IDDOUSUARIO`.
- Encontra o feedback pelo campo `quickgrade_comments_IDDOUSUARIO`.
- Importa CSV, TSV ou XLSX com as colunas `nome`, `nota` e `feedback`.
- Valida cabeçalhos, linhas úteis e notas antes de liberar a importação.
- Oferece um modelo CSV para download e um prompt de correção copiável.
- Preenche os campos da página, mas **não salva automaticamente**.

Depois de revisar, use o botão nativo do Moodle para salvar as alterações.

A extensão só exibe o botão na tela de correção rápida da atividade:
`/mod/assign/view.php?action=grading`. O botão fica ativo apenas quando **Avaliação rápida** está marcada e a tabela contém campos editáveis de **Nota** e **Comentários de feedback**.

## Formato da planilha

Use cabeçalhos na primeira linha:

```csv
nome;nota;feedback
tiao do abacate;18;Texto do feedback aqui
```

Também são aceitos cabeçalhos equivalentes:

- Nome: `nome`, `aluno`, `estudante`, `discente`, `nome do aluno`, `nome completo`
- Nota: `nota`, `nota sugerida`, `nota final`, `pontuação`, `score`, `grade`
- Feedback: `feedback`, `comentário`, `comentários`, `comentários de feedback`, `observação`, `retorno`, `devolutiva`

## Uso

1. Abra a tela de correção rápida da atividade no Moodle.
2. Marque **Avaliação rápida** para exibir os campos editáveis.
3. Clique em **Importar**.
4. Se precisar, clique em **baixar modelo** para gerar um CSV de exemplo.
5. Escolha o arquivo CSV/XLSX.
6. Revise a validação exibida no painel.
7. Clique em **Verificar** para conferir quantos alunos foram encontrados.
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
- A extensão não tem permissão de rede e não envia dados para fora do navegador.
