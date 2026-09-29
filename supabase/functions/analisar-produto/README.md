# Deploy da função `analisar-produto`

> **Atualização:** a partir de agora a "IA Fiscal" do site chama a API do
> Google Gemini **diretamente do navegador** (Configurações → "IA Fiscal
> (Google Gemini)"), sem depender mais desta Edge Function — isso evita o
> erro recorrente de "falha de rede/CORS" quando a função ficava desatualizada
> ou fora do ar. Os passos abaixo (seções 2 a 4) não são mais necessários
> para a IA funcionar; a **seção 1** (tabela `analises_ia`, usada só para
> guardar o histórico de análises) continua valendo.

## 1. Criar a tabela de histórico

No Supabase, **SQL Editor → New query**, rode:

```sql
create table public.analises_ia (
  id uuid primary key default gen_random_uuid(),
  produto_key text not null,
  sheet text not null,
  row_idx integer not null,
  codigo text,
  descricao text,
  usuario text,
  ncm_anterior text,
  ncm_sugerido text,
  resultado jsonb not null,
  aplicado boolean not null default false,
  criado_em timestamptz not null default now()
);

alter table public.analises_ia enable row level security;

create policy "leitura publica" on public.analises_ia for select using (true);
create policy "insercao publica" on public.analises_ia for insert with check (true);
```

## 2. Publicar a função

No Supabase, **Edge Functions → Deploy a new function**:

- Nome: `analisar-produto`
- Cole o conteúdo de `index.ts` (nesta mesma pasta)
- Deploy

## 3. Gerar uma chave gratuita do Google Gemini

1. Acesse https://aistudio.google.com/apikey
2. Faça login com uma conta Google
3. Clique em **Create API key** (não pede cartão de crédito — tem cota gratuita)
4. Copie a chave gerada (começa com `AIza...`)

## 4. Configurar a chave da IA

Em **Edge Functions → analisar-produto → Manage secrets** (ou Settings → Edge Functions), adicione:

- Nome: `GEMINI_API_KEY`
- Valor: a chave copiada do Google AI Studio

Nunca coloque essa chave em nenhum arquivo do repositório — ela fica só como secret da função.

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já são injetadas automaticamente pelo Supabase em toda Edge Function — não precisa configurar nada extra para elas.

A função já tem um limite de 20 análises/minuto (proteção básica contra abuso). A cota gratuita do Gemini também tem seus próprios limites por minuto/dia — se bater no limite, a IA retorna erro até renovar.

## Se você já publicou uma versão anterior da função

Sempre que `index.ts` for atualizado neste repositório, é preciso **colar o novo conteúdo e clicar em Deploy de novo** no Supabase — o código daqui não se sincroniza sozinho com o que está publicado lá.

## 5. Tabela de atribuição de tarefas (distribuição por usuário)

Usada nas abas "NCM Mesma Descrição" e "Descrições Duplicadas" para marcar de qual responsável (Guilherme/Caio/Karolayne/João) é cada produto. Rode no **SQL Editor**:

```sql
create table public.atribuicoes (
  key text primary key,
  sheet text not null,
  row_idx integer not null,
  responsavel text,
  atribuido_por text,
  atribuido_em timestamptz,
  historico jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table public.atribuicoes enable row level security;

create policy "leitura publica" on public.atribuicoes for select using (true);
create policy "insercao publica" on public.atribuicoes for insert with check (true);
create policy "atualizacao publica" on public.atribuicoes for update using (true);

alter publication supabase_realtime add table public.atribuicoes;
```

## 6. Registrar o nome do usuário em toda edição/exclusão/validação

Adiciona uma coluna `usuario` na tabela `validacoes` (já criada antes, em outro passo). Rode no **SQL Editor**:

```sql
alter table public.validacoes add column if not exists usuario text;
```

A partir dessa mudança, toda ação que altera um registro (editar, excluir, validar, desfazer) pede o nome de quem está fazendo e grava junto — visível para todos os usuários.

## 7. Ativar tempo real na tabela `validacoes` (corrige o atraso de até 20s)

A tabela `validacoes` foi criada sem entrar na publicação de Realtime do Supabase — por isso as atualizações de outros usuários só apareciam pela revalidação periódica (a cada 20s), em vez de instantâneas. Rode no **SQL Editor**:

```sql
alter publication supabase_realtime add table public.validacoes;
```

Depois disso, validar/editar/excluir um produto aparece pros outros usuários quase instantaneamente, sem esperar o ciclo de 20s.

## 8. Compartilhar o Relatório de Desativação entre usuários

Até aqui, o "Relatório de Desativação" (aba de produtos separados para desativar) ficava salvo só no navegador de quem fez a seleção. Rode no **SQL Editor** para criar a tabela compartilhada:

```sql
create table public.desativacoes (
  key text primary key,
  idx integer not null,
  codigo text,
  codigo_item text,
  descricao text,
  filial text,
  ncm text,
  tipo text,
  unidade text,
  grupo text,
  criado_em_origem text,
  motivo text,
  selecionado_em timestamptz,
  usuario text,
  status text not null,
  concluido_em timestamptz,
  atualizado_em timestamptz not null default now()
);

alter table public.desativacoes enable row level security;

create policy "leitura publica" on public.desativacoes for select using (true);
create policy "insercao publica" on public.desativacoes for insert with check (true);
create policy "atualizacao publica" on public.desativacoes for update using (true);
create policy "exclusao publica" on public.desativacoes for delete using (true);

alter publication supabase_realtime add table public.desativacoes;
```

A partir dessa migração, toda vez que alguém clicar em "Separar para Desativação", informar o motivo e confirmar, o registro (com nome de quem separou e o motivo) aparece em tempo real no Relatório de Desativação de todos os usuários — e desfazer/concluir a desativação também sincroniza.

## 9. Compartilhar o Histórico de ações entre usuários

O painel "Histórico desta análise" (nas telas de comparação de produtos) também ficava salvo só no navegador de quem fez a ação. Rode no **SQL Editor**:

```sql
create table public.historico_acoes (
  id text primary key,
  usuario text,
  criado_em timestamptz not null default now(),
  filial text,
  acao text,
  descricao text,
  detalhe text
);

alter table public.historico_acoes enable row level security;

create policy "leitura publica" on public.historico_acoes for select using (true);
create policy "insercao publica" on public.historico_acoes for insert with check (true);

alter publication supabase_realtime add table public.historico_acoes;
```

A partir dessa migração, qualquer ação registrada no histórico (validar, editar, excluir, separar para desativação, desfazer etc.) de qualquer usuário aparece para todos, em tempo real.

## 10. Relatório de Produtos Validados (histórico de validações/alterações por campo)

Alimenta a aba "🧾 Produtos Validados": para cada produto, registra se foi validado sem alteração ou com alteração de campo (com valor anterior e novo), por usuário e data. Rode no **SQL Editor**:

```sql
create table public.historico_validacao_produtos (
  id text primary key,
  validacao_id text,
  produto_key text not null,
  codigo text,
  descricao text,
  filial text,
  ncm text,
  usuario text,
  sofreu_alteracao boolean not null default false,
  campo_alterado text,
  valor_anterior text,
  valor_novo text,
  criado_em timestamptz not null default now()
);

alter table public.historico_validacao_produtos enable row level security;

create policy "leitura publica" on public.historico_validacao_produtos for select using (true);
create policy "insercao publica" on public.historico_validacao_produtos for insert with check (true);

alter publication supabase_realtime add table public.historico_validacao_produtos;
```

A partir dessa migração, a aba "Produtos Validados" mostra em tempo real, para todos os usuários: quantos produtos foram validados sem alteração, quantos tiveram algum campo alterado, o total de alterações e o histórico completo (campo, valor anterior, valor novo, usuário e data) de cada produto.
