THE DEEP CUT — INTERNET ARCHIVE

O site agora é uma exploração aleatória de álbuns musicais hospedados no Internet Archive. A página mostra seis capas por edição, em um layout escuro inspirado nas referências enviadas: fundo quase preto, títulos editoriais, capas em destaque e uma faixa de cores no rodapé.

Como usar:
1. Instale o Node.js 18 ou mais recente. No PowerShell, nesta pasta, copie o exemplo de configuração com: Copy-Item .env.example .env. Em seguida, inicie o servidor com: node server.mjs
2. Abra http://127.0.0.1:4178 em um navegador com conexão à internet. Use o servidor local para habilitar a consulta ao YouTube Music; abrir index.html diretamente não oferece essa consulta.
3. Aguarde a busca; seis álbuns elegíveis aparecem em uma grade responsiva.
4. Clique na capa ou no título para abrir o registro original no Internet Archive.
5. Passe o mouse sobre um álbum para ver sua descrição e os metadados disponíveis. O site não inventa artista, ano, região ou contexto. A faixa de áudio que aparece na capa reproduz até 15 segundos da primeira faixa.
6. Passe o mouse sobre a capa e clique em S para salvar. O botão Saved abre sua coleção local, guardada neste navegador por até 14 dias. É possível remover itens ou exportar a lista em JSON.
7. Na lista Saved, aparece apenas o YouTube Music. O ícone fica colorido e clicável quando uma playlist correspondente é encontrada; ausências e estados que não puderam ser verificados ficam apagados. Passe o mouse sobre o ícone para ver o motivo.
8. Use Refresh para sortear outra seleção. Durante a busca, o site mostra a etapa atual e uma barra de progresso; as capas têm placeholders animados enquanto carregam. A página About contém um texto provisório e um espaço reservado para imagem.

YouTube Music:
- A integração exige YOUTUBE_DATA_API_KEY de um projeto com YouTube Data API v3 habilitada. A API pública retorna vídeos, canais e playlists, não um catálogo próprio de álbuns do YouTube Music. A busca procura uma playlist com título e artista compatíveis e o link é rotulado como playlist correspondente, não como confirmação de um álbum oficial.
- Para configurar a chave, copie .env.example para .env e preencha YOUTUBE_DATA_API_KEY. O servidor lê o arquivo em cada consulta e invalida os resultados antigos quando a configuração muda, então basta abrir Saved novamente ou recarregar a página; não coloque a chave no index.html nem publique o arquivo .env.
- Resultados confirmados e negativos ficam em cache local por até sete dias. Estados incertos não ficam salvos no navegador e expiram no servidor em 30 segundos; assim, após adicionar credenciais, a busca pode tentar novamente imediatamente.

Seleção de álbuns:
- A API Advanced Search é consultada apenas para registros de áudio, em coleções musicais como Jamendo Albums, Netlabels e Open Source Audio.
- Cada busca amostra páginas diferentes. A seleção é embaralhada e não usa downloads, popularidade, favoritos ou personalização.
- O site confere os metadados e a lista de arquivos do item. Um álbum ou EP precisa ter pelo menos quatro faixas distintas (MP3 e FLAC da mesma faixa contam uma vez) e evidência de lançamento em uma coleção musical ou no próprio registro. A falta de artista, data ou descrição não elimina sozinha um registro. Podcasts, rádio, sermões, palestras e audiolivros são descartados.
- Cada item precisa ter um arquivo de imagem original de tamanho útil associado ao registro; espectrogramas, formas de onda, miniaturas geradas pelo Archive e imagens derivadas das faixas não valem como capa. Se o arquivo da capa estiver indisponível ao carregar, aparece um placeholder no lugar da imagem; uma miniatura genérica não é usada como substituta.
- Identificadores repetidos são removidos e a página tenta evitar repetir itens das edições recentes quando há alternativas.
- A API recebe output=json. Não acrescente wt=json: esse parâmetro é rejeitado pelo Internet Archive e pode devolver uma resposta de erro com HTTP 200.
- Buscas bem-sucedidas ficam em cache por cinco minutos e metadados por trinta minutos. Respostas têm validação, timeout e repetição limitada para erros temporários. A última seleção fica em cache local por até sete dias, para continuar visível se uma atualização falhar.

Verificação manual:
1. Abra o site e espere a primeira seleção. A página deve encerrar a busca com seis capas ou exibir uma mensagem de erro recuperável; o botão Refresh deve voltar a funcionar.
2. No console do navegador, execute __deepCutsDiagnostics(). Confira count igual a 6, uniqueIdentifiers igual a true, tracks maior ou igual a 4 e coverLoaded igual a true em cada item. selection informa título, identificador e coleção consultada.
3. Pressione Refresh algumas vezes. Os identificadores devem mudar quando houver candidatos diferentes. Repetição só é possível quando o conjunto de candidatos amostrados for insuficiente.
4. Passe o mouse por uma capa; verifique descrição, artista, ano, região, selo, gênero, número de faixas e coleção quando o registro fornecer esses dados.
5. Clique em um título e numa capa e confirme que cada um abre archive.org/details/IDENTIFICADOR.
6. Salve um álbum, recarregue a página, abra Saved, remova um item e teste Export JSON.
7. Para testar imagens quebradas, use o bloqueio de requisições do navegador para archive.org/download/*. A busca deve continuar sem travar e o espaço da capa deve mostrar o placeholder sem quebrar a grade.
8. Para testar falhas da API, bloqueie archive.org/advancedsearch.php e use Refresh. O estado deve informar a falha, o botão deve se reativar e, se houver seleção anterior, ela deve continuar na tela.

Arquivos:
- index.html: layout, estilo, integração com a API, seleção, hover e salvos.
- server.mjs: servidor local e endpoint privado de busca de links de plataformas; as chaves ficam no servidor.
- .env.example: nomes das configurações necessárias, sem credenciais.
- .gitignore: evita incluir .env em um repositório Git.
- assets/: logo, ícones e fonte Geist Pixel usada no site. Os arquivos Fraunces antigos permanecem disponíveis, mas já não são carregados pela página.
