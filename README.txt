THE DEEP CUT — INTERNET ARCHIVE

O site agora é uma exploração aleatória de álbuns musicais hospedados no Internet Archive. A página mostra seis capas por edição, em um layout escuro inspirado nas referências enviadas: fundo quase preto, títulos editoriais, capas em destaque e uma faixa de cores no rodapé.

Como usar:
1. Instale o Node.js 18 ou mais recente. No PowerShell, nesta pasta, inicie o servidor com: node server.mjs (opcionalmente copie .env.example para .env para escolher a porta).
2. Abra http://127.0.0.1:4178 em um navegador com conexão à internet. Use o servidor local: ele entrega as capas pelo mesmo endereço do site, o que permite extrair a paleta de cores.
3. Aguarde a busca; seis álbuns elegíveis aparecem em uma grade responsiva.
4. Clique na capa ou no título para abrir o registro original no Internet Archive.
5. Passe o mouse sobre um álbum para ver sua descrição e os metadados disponíveis. O site não inventa artista, ano, região ou contexto. A faixa de áudio que aparece na capa reproduz até 15 segundos da primeira faixa.
6. Passe o mouse sobre a capa e clique em S para salvar. O botão Saved abre sua coleção local, guardada neste navegador por até 14 dias. É possível remover itens ou baixar a lista (botão Download list, arquivo .json).
7. Use Refresh para sortear outra seleção. Durante a busca, o site mostra a etapa atual e uma barra de progresso; as capas têm placeholders animados enquanto carregam. A página About explica de onde vêm os álbuns, como são verificados e onde ficam os dados do usuário.

Seleção de álbuns:
- A API Advanced Search é consultada apenas para registros de áudio, em coleções musicais como Jamendo Albums, Netlabels e Open Source Audio.
- Filtros de época: 60s a 00s cobrem uma década cada; 10s+ cobre 2010–2024; 25–26 (marcado NEW) traz os lançamentos mais recentes, de 2025 em diante, pelo campo year do Archive.
- Cada busca amostra páginas diferentes. A seleção é embaralhada e não usa downloads, popularidade, favoritos ou personalização.
- O site confere os metadados e a lista de arquivos do item. Um álbum ou EP precisa ter pelo menos quatro faixas distintas (MP3 e FLAC da mesma faixa contam uma vez) e evidência de lançamento em uma coleção musical ou no próprio registro. A falta de artista, data ou descrição não elimina sozinha um registro. Podcasts, rádio, sermões, palestras e audiolivros são descartados.
- Cada item precisa ter um arquivo de imagem original de tamanho útil associado ao registro; espectrogramas, formas de onda, miniaturas geradas pelo Archive e imagens derivadas das faixas não valem como capa. Se o arquivo da capa estiver indisponível ao carregar, aparece um placeholder no lugar da imagem; uma miniatura genérica não é usada como substituta.
- Filtro de IA (lançamentos de 2025 em diante): o álbum é descartado se declarar uso de IA no título, descrição ou tags (Suno, Udio, Stable Audio, "AI-generated" etc.; frases como "no AI" são ignoradas), se o MP3 trouxer a tag "made with suno", ou se a capa tiver o nome de arquivo padrão de um gerador de imagem (ChatGPT "file_0000…", Gemini_Generated_Image, ComfyUI, DALL·E). Sinais fracos (tags-SEO de palavras soltas, artista vazio, título-SEO com gêneros empilhados, séries numeradas tipo "Album 92-101", títulos de relaxamento/sono, temas religiosos) só descartam quando aparecem dois juntos. Pools salvos no navegador são revisados ao abrir a página.
- Um álbum por artista em cada filtro de época: a comparação usa o artista principal sem acentos, sem "The" e sem pontuação, ignorando participações ("Pink Floyd" e "Pink Floyd & David Gilmour" contam como o mesmo). Álbuns sem artista ou de "Various Artists" não entram nessa regra. A busca continua até reunir seis artistas diferentes, e pools salvos no navegador também são deduplicados.
- Identificadores repetidos são removidos e a página tenta evitar repetir itens das edições recentes quando há alternativas.
- A API recebe output=json. Não acrescente wt=json: esse parâmetro é rejeitado pelo Internet Archive e pode devolver uma resposta de erro com HTTP 200.
- Buscas bem-sucedidas ficam em cache por cinco minutos e metadados por trinta minutos. Respostas têm validação, timeout e repetição limitada para erros temporários. A última seleção fica em cache local por até sete dias, para continuar visível se uma atualização falhar.

Verificação manual:
1. Abra o site e espere a primeira seleção. A página deve encerrar a busca com seis capas ou exibir uma mensagem de erro recuperável; o botão Refresh deve voltar a funcionar.
2. No console do navegador, execute __deepCutsDiagnostics(). Confira count igual a 6, uniqueIdentifiers igual a true, tracks maior ou igual a 4 e coverLoaded igual a true em cada item. selection informa título, identificador e coleção consultada.
3. Pressione Refresh algumas vezes. Os identificadores devem mudar quando houver candidatos diferentes. Repetição só é possível quando o conjunto de candidatos amostrados for insuficiente.
4. Passe o mouse por uma capa; verifique descrição, artista, ano, região, selo, gênero, número de faixas e coleção quando o registro fornecer esses dados.
5. Clique em um título e numa capa e confirme que cada um abre archive.org/details/IDENTIFICADOR.
6. Salve um álbum, recarregue a página, abra Saved, remova um item e teste Download list.
7. Para testar imagens quebradas, use o bloqueio de requisições do navegador para archive.org/download/*. A busca deve continuar sem travar e o espaço da capa deve mostrar o placeholder sem quebrar a grade.
8. Para testar falhas da API, bloqueie archive.org/advancedsearch.php e use Refresh. O estado deve informar a falha, o botão deve se reativar e, se houver seleção anterior, ela deve continuar na tela.

Arquivos:
- index.html: layout, estilo, player, seleção, hover e salvos.
- albums.mjs: busca e verificação dos álbuns no Internet Archive, usada tanto pela página quanto pelo servidor.
- api/pool.mjs: monta no servidor os seis álbuns de cada filtro de época (/api/pool?decade=all|1960|...|2025). Na primeira visita a página usa essas listas prontas; na Vercel o resultado fica em cache por 5 minutos, e o cache antigo é servido enquanto um novo é montado. O botão Refresh continua buscando direto do navegador.
- api/thumb.mjs: cópia das capas do archive.org pelo mesmo endereço do site, para extrair a paleta.
- manifest.webmanifest, sw.js e assets/icons/: tornam o site instalável como app (PWA) no celular e no desktop. O service worker busca sempre a versão mais nova na rede e só usa o cache quando não há conexão; ele não guarda as respostas de /api nem do archive.org.
- vercel.json e .vercelignore: configuração do deploy na Vercel (site estático + as funções em api/).
- server.mjs: servidor local; entrega o site e roda as mesmas funções de api/.
- .env.example: configuração opcional da porta local.
- .gitignore: evita incluir .env em um repositório Git.
- assets/: logo, ícones e fonte Geist Pixel usada no site. Os arquivos Fraunces antigos permanecem disponíveis, mas já não são carregados pela página.

Instalar como app:
- Android (Chrome): menu ⋮ → Instalar app (ou Adicionar à tela inicial).
- iPhone/iPad (Safari): Compartilhar → Adicionar à Tela de Início.
- Windows/Mac (Chrome ou Edge): ícone de instalar na barra de endereço, ou menu → Instalar The Deep Cut.
O app mostra a faixa atual, o artista e a capa na tela de bloqueio, nas notificações e nas teclas de mídia, com play/pausa, anterior, próxima e busca na faixa.
