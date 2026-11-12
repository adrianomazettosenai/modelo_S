# Armazém — Gestão de estoque

Aplicação web para acompanhar o estoque de um almoxarifado, registrar movimentações e consultar relatórios. A interface é servida pelo Express e consome a API REST do próprio projeto, que persiste os dados no Supabase.

## Funcionalidades

- Painel com valor total do estoque, quantidade de produtos e alertas de estoque mínimo e máximo.
- Consulta e busca de produtos cadastrados.
- Cadastro de produtos com categoria, unidade de medida e limites de estoque.
- Registro de entradas e saídas, com atualização do saldo pelo banco de dados.
- Consulta das saídas recentes.
- Relatórios de movimentações e de produtos com maior volume de saída por período.

## Requisitos

- Node.js 18 ou superior.
- Um projeto Supabase configurado com as tabelas, relacionamentos, view e regras de banco de dados utilizadas pela aplicação.

## Configuração

1. Instale as dependências:

   ```sh
   npm install
   ```

2. Crie seu arquivo local de configuração a partir do exemplo:

   ```sh
   cp .env.example .env
   ```

   No Windows PowerShell, use `Copy-Item .env.example .env`.

3. Configure `SUPABASE_URL` e `SUPABASE_KEY` no `.env` com os dados do seu projeto Supabase. A chave é usada somente pelo servidor: não a inclua no frontend, em commits ou em repositórios públicos.

4. Inicie o servidor:

   ```sh
   npm start
   ```

5. Acesse [http://localhost:3000](http://localhost:3000). Para usar outra porta, defina `PORT` no ambiente antes de iniciar.

## Banco de dados

A aplicação espera encontrar no Supabase:

- A tabela `categorias`, com `id` e `nome`.
- A tabela `produtos`, incluindo categoria, denominação, unidade de medida, valor unitário, quantidade e limites mínimo e máximo de estoque.
- A tabela `movimentacoes`, com tipo, produto, quantidade, valor unitário registrado, data e observação.
- A view `vw_estoque`, com valores totais e status de estoque calculados.
- Os relacionamentos e regras de banco necessários para manter o saldo dos produtos atualizado ao registrar movimentações.

Este repositório não inclui migrações ou criação do schema. Configure a estrutura do banco antes de usar a aplicação.

## API

As respostas são JSON. As rotas disponíveis incluem:

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/estoque/valor-total` | Valores e quantidades por produto |
| `GET` | `/api/estoque/limites` | Produtos nos limites mínimo e máximo |
| `GET` | `/api/produtos` | Lista produtos |
| `POST` | `/api/produtos` | Cadastra um produto |
| `GET` | `/api/categorias` | Lista categorias para cadastro |
| `GET` | `/api/movimentacoes/saidas` | Lista saídas mais recentes |
| `POST` | `/api/movimentacoes/entradas` | Registra uma entrada |
| `POST` | `/api/movimentacoes/saidas` | Registra uma saída |
| `GET` | `/api/relatorios/movimentacoes?data_inicial=AAAA-MM-DD&data_final=AAAA-MM-DD` | Relatório de movimentações por período |
| `GET` | `/api/relatorios/maior-saida?data_inicial=AAAA-MM-DD&data_final=AAAA-MM-DD` | Ranking de saídas por período |

## Estrutura

```text
.
├── index.js           # Servidor Express, API e integração com Supabase
├── public/
│   ├── index.html     # Interface
│   ├── styles.css     # Estilos responsivos
│   └── app.js         # Integração do frontend com a API
├── .env.example       # Modelo de configuração local
└── package.json
```
