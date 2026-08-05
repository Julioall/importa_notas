# Importador de Notas 2.2.0

## Destaques

- Novo fluxo guiado de importação em três etapas: **Adicionar**, **Validar** e **Executar**.
- Resultado da validação exibido em uma tela própria, sem acumular conteúdo abaixo do formulário.
- Reinício completo do fluxo ao fechar o modal.
- Correção da rolagem do modal e manutenção das ações principais em área visível.
- Interface renovada para o modal e para o painel de configurações.
- Novo gerador de relatório de notas nas páginas **Meus cursos**.
- Seleção de unidades curriculares por checkbox.
- Relatório com uma aba por unidade e uma aba consolidada de situação.
- Melhorias na extração dos nomes das unidades e dos alunos.
- Compatibilidade com Moodle Goiás e Moodle Nacional.

## Fluxo de importação

1. Adicione um arquivo CSV, TSV, TXT ou XLSX.
2. Revise os registros encontrados, não encontrados e avisos.
3. Execute o preenchimento da página.
4. Revise os campos e utilize o botão nativo do Moodle para salvar.

Ao fechar o modal, o arquivo, a validação, o progresso e o resultado anterior são descartados. Uma nova abertura começa novamente na etapa **Adicionar**.

## Relatório de notas

Nas páginas `https://ead.fieg.com.br/my/courses.php` e `https://ead.senai.br/my/`, a extensão permite selecionar unidades e gerar um relatório consolidado a partir do relatório de notas do Moodle.

O arquivo gerado inclui:

- nome completo do aluno;
- valor de **Total do curso**;
- uma aba para cada unidade curricular;
- uma aba **Situação** com as faixas Sem Nota, Reprovados, Recuperação e Aprovados.

## Instalação

1. Baixe e extraia o arquivo ZIP da release.
2. Abra `chrome://extensions/` ou `edge://extensions/`.
3. Ative o modo do desenvolvedor.
4. Clique em **Carregar sem compactação**.
5. Selecione a pasta da extensão.

Ao atualizar uma instalação existente, recarregue a extensão e também as páginas abertas do Moodle.

## Validação recomendada

- importar um CSV e um XLSX;
- voltar da etapa Validar e trocar o arquivo;
- executar o preenchimento e reabrir o modal;
- confirmar que o fluxo retorna à etapa Adicionar;
- gerar um relatório com várias unidades no Moodle Goiás;
- gerar um relatório com várias unidades no Moodle Nacional;
- conferir alunos em páginas adicionais do relatório de notas;
- revisar as notas antes de salvar no Moodle.

## Observações

- A extensão não salva notas automaticamente.
- Os dados são processados no navegador e não são enviados para serviços externos.
- A geração do relatório depende da permissão do usuário para visualizar o relatório de notas de cada unidade.
