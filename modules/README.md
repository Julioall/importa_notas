# Arquitetura modular

A extensão passa a ser uma suíte de ferramentas educacionais.

## Módulos

- `modules/drive-pdf`: prepara as páginas carregadas no visualizador do Google Drive e abre o diálogo de impressão para salvar em PDF.
- `modules/kahoot`: importa perguntas de um arquivo CSV para o editor do Kahoot.
- Moodle: os pontos de entrada atuais permanecem na raiz durante a migração para preservar compatibilidade com as funções de importação, relatórios, pendências e downloads.

## Regras de manutenção

Cada módulo deve manter sua própria interface, automação e recursos. O `popup.html` principal atua somente como painel de navegação e configurações compartilhadas. Novos recursos devem ser adicionados em uma pasta própria dentro de `modules/`.

## Próxima etapa de migração

Mover gradualmente os arquivos Moodle da raiz para `modules/moodle`, mantendo pequenos arquivos de compatibilidade na raiz até a conclusão dos testes nos ambientes Goiás e Nacional.
