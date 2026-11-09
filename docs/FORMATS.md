# Cosmos-Scintillation file formats

Everything the app offers (database engines, API languages, visual-script nodes, launcher services, themes) is a YAML file.
The built-in ones live in `scripts/defaults/`. On first run they are copied to the user's config folder, and after that they
belong to the user. **Extensions** are folders of the same files (see the end of this page).

Types are in `scripts/common/CommonInterface.ts`. Shared constants are in `scripts/common/projects/CosmosContract.ts`.

---------------------------------------------------------------------------------------------------

## 1. Engines  (`engines/<id>.yaml`)

```yaml
id: postgresql
name: PostgreSQL
description: ...
family: relational          # relational | document | keyvalue
exporter: sql               # sql | mongo | redis
defaultPort: 5432
scriptExtension: sql
terms: { container: Table, containers: Tables, row: Row, rows: Rows, field: Column, fields: Columns }
relations: true             # tables can point at each other
defaultType: text
keyType: uuid               # type of a new primary key column
types: [ { id: text, label: text }, ... ]
sql:                        # only for exporter: sql
  quote: '"'                # '"' | '`' | '['
  autoIncrement: serial     # none | serial | auto_increment | identity | autoincrement
  tableSuffix: ""
  header: ""                # e.g. "CREATE DATABASE {db};\nUSE {db};"
  trueLiteral: "TRUE"
  falseLiteral: "FALSE"
```

---------------------------------------------------------------------------------------------------

## 2. Languages  (`languages/<id>.yaml`)  — read by the API code generator

```yaml
id: typescript
name: TypeScript (Express)
description: ...
capabilities: [rest, websocket]     # what the language file can generate
runtime: "Node.js 20+"
runCommand: "npm install && npm start"
stringStyle: default                # default | ruby | rust   (how string literals are escaped)
indent: "  "                         # one level of indentation in generated code
literals: { null: "null", true: "true", false: "false", object: "{}", list: "[]" }
dependencies:                       # always needed
  - { name: express, version: "^4.21.2" }
  - { name: ws, version: "^8.18.0", when: websocket }
  - { name: typescript, version: "^5.6.3", dev: true }
dependencyFormat: '    "{{name}}": "{{version}}"'      # one line per dependency (dev: false)
devDependencyFormat: '    "{{name}}": "{{version}}"'   # one line per dependency (dev: true)
dependencySeparator: ",\n"                              # between the lines
packages:                           # add-ons the user can tick
  - id: compression
    name: Compression
    description: gzip responses
    dependencies: [ { name: compression, version: "^1.7.5" } ]
    imports: [ 'import compression from "compression";' ]   # added to {{imports}}
    setup: [ "app.use(compression());" ]                    # added to {{setup}}
websocket:                          # used only when the API contains WebSocket nodes
  imports: [ 'import {WebSocketServer} from "ws";' ]        # added to {{wsImports}}
  setup: |                                                  # becomes {{wsSetup}}, may contain {{wsHandlers}}
    ...
files:                              # the files written into the exported folder
  - path: package.json
    template: |
      { "name": "{{appSlug}}", "dependencies": { {{dependencies}} } }
  - path: src/store.ts
    template: ...
  - path: src/ws.ts
    when: websocket                 # only written when the API has WebSocket nodes
    template: ...
```

### Placeholders in `files[].template` and `files[].path`

| Placeholder          | Value                                                                                   |
|----------------------|-----------------------------------------------------------------------------------------|
| `{{appName}}`        | The API's name as typed                                                                 |
| `{{appSlug}}`        | `my-api`                                                                                |
| `{{appPascal}}`      | `MyApi`                                                                                 |
| `{{appSnake}}`       | `my_api`                                                                                |
| `{{port}}`           | Default port                                                                            |
| `{{maxBodyKb}}`      | Largest request body in kilobytes                                                       |
| `{{maxBodyBytes}}`   | Same in bytes                                                                           |
| `{{rateLimit}}`      | Requests per minute per client                                                          |
| `{{requireApiKey}}`  | The language's `true` or `false` literal                                                |
| `{{imports}}`        | Lines from the selected packages' `imports`                                             |
| `{{setup}}`          | Lines from the selected packages' `setup`                                               |
| `{{routes}}`         | Code of every route node (REST)                                                         |
| `{{wsImports}}`      | `websocket.imports` (empty when there are no WebSocket nodes)                           |
| `{{wsSetup}}`        | `websocket.setup` with `{{wsHandlers}}` already filled in (empty without WebSocket nodes)|
| `{{wsHandlers}}`     | Code of every WebSocket event node                                                      |
| `{{dependencies}}`   | Non-dev dependencies, each rendered with `dependencyFormat`, joined by `dependencySeparator` |
| `{{devDependencies}}`| The same for dev dependencies                                                           |
| `{{schemaJson}}`     | The database schema as JSON, already written as a string literal in the language        |

A placeholder alone on a line is replaced by several lines, and each gets that line's indentation.

### The files every language must write
`.env.example` is not enough. A language must produce: the manifest (package.json, go.mod, requirements.txt, Gemfile,
Cargo.toml, .csproj), the main file, a **runtime helper file** and a **data store file**. The exporter adds `.env`
(with a freshly generated `API_KEY`), `.gitignore`, `README.md` and `openapi.yaml` itself.

### Security every generated API must have (the exporter's checklist)
* Security headers on every response (nosniff, frame deny, no referrer, `default-src 'none'`), no "powered by" header.
* CORS only for the origins in `ALLOWED_ORIGINS` (env, comma separated). Empty means no cross-origin access.
* Request body limit (`MAX_BODY_KB`), request timeouts.
* Per-client rate limit (`RATE_LIMIT_PER_MIN`).
* `X-API-Key` check against `API_KEY` (env) using a constant-time compare. If auth is on and `API_KEY` is empty the server refuses to start.
* Errors never leak internals: unknown failures answer `{"error":"internal_error"}` with status 500.
* WebSocket: origin check against `ALLOWED_ORIGINS`, key check (`x-api-key` header or `?key=` query), max message size, JSON only, a per-connection message rate limit.
* The data store only accepts columns that exist in the schema (no mass assignment) and table names from the schema.
* Log text is stripped of line breaks (no log injection).

---------------------------------------------------------------------------------------------------

## 3. Nodes  (`nodes/<id>.yaml`)

```yaml
id: dbFind
name: Find rows
category: Database
description: ...
pure: false                  # true = no exec pins, written inline as an expression
capability: rest             # rest | websocket | any
pins:
  - { id: in,   name: "",      direction: in,  type: exec }
  - { id: then, name: "",      direction: out, type: exec }
  - { id: value, name: Match,  direction: in,  type: any }
  - { id: rows, name: Rows,    direction: out, type: list }
props:
  - { key: table, label: Table, type: table, default: "" }
  - { key: method, label: Method, type: select, default: GET, options: [ { value: GET, label: GET } ] }
templates:                   # one per language id
  typescript: |
    const {{out.rows}} = store.find({{str.table}}, ...);
{{flow.then}}
```

* Pin ids `in` (exec input) and `then` / `true` / `false` (exec outputs) are conventions; any id works.
* A **pure** node has exactly one output pin with id `value` and its template is **one expression**, no statements.
* Two files with the same node `id` are merged: the first one's pins and props win, and each language template is added
  unless that language already has one. This is how an extension adds a language: it ships `languages/mylang.yaml` plus
  node files that only contain `id` and `templates: { mylang: ... }`.
* A node file that only has `id` and `templates` is a "template patch".

### Placeholders in node templates

| Placeholder             | Value                                                                                   |
|-------------------------|-----------------------------------------------------------------------------------------|
| `{{in.<pin>}}`          | The expression for an input pin: a variable, an inline pure expression, or the pin's default as a literal |
| `{{out.<pin>}}`         | The variable name to declare for an output pin (`v_<nodeId>_<pin>`)                      |
| `{{prop.<key>}}`        | The property as plain text                                                              |
| `{{str.<key>}}`         | The property as a string literal in the language (quotes and escapes included)          |
| `{{flow.<pin>}}`        | **Alone on a line**: the code that follows the exec output `<pin>`, indented to match     |
| `{{id}}`                | The node's id                                                                           |
| `{{requireAuth}}`       | Route nodes: the language's `true` / `false` literal (API key needed on this route)      |
| `{{route.path}}`        | Route nodes: path with the API's base path, colon style: `/api/items/:id`                |
| `{{route.braces}}`      | Same path, brace style: `/api/items/{id}`                                                |
| `{{route.method}}`      | `GET`, `POST` ...                                                                       |
| `{{route.methodLower}}` | `get`, `post` ...                                                                       |
| `{{route.methodPascal}}`| `Get`, `Post` ...                                                                       |
| `{{route.params}}`      | Quoted path parameter names, comma separated: `"id", "slug"` (empty when none)           |
| `{{route.paramCount}}`  | How many path parameters                                                                |

The first line of a template is not indented by the generator; the generator indents the whole result when it nests it.
A route node's code ends up in `{{routes}}`, a WebSocket node's code in `{{wsHandlers}}`.

An exec node that ends the flow (like `respond`) has no `then` output. When a flow ends without a `respond`, the compiler
appends the language's default "204 No Content" through the route node's `{{flow.then}}` (it is empty) — so the **route
template itself must send a default response after `{{flow.then}}`**.

---------------------------------------------------------------------------------------------------

## 4. Services  (`services/<id>.yaml`)  — the launcher

```yaml
id: postgresql
name: PostgreSQL
description: ...
category: Database          # Web | Database | Cache | Other
kind: process               # builtin-static (built into the app) | process (a program on this computer)
defaultPort: 5432
detect: [ postgres ]        # program names looked up on the PATH (the user can also pick the file)
args: [ "-D", "{data}", "-p", "{port}", "-c", "listen_addresses={host}" ]
prepare:                    # run once, before the first start
  - { args: [ "initdb" ... ], skipIf: "{data}/PG_VERSION" }
url: ""                     # "http://{host}:{port}" for services with a web page
```

Placeholders: `{port}` `{host}` (always 127.0.0.1) `{data}` (the service's own data folder) `{root}` (folder chosen by the user).
Services only ever listen on 127.0.0.1.

---------------------------------------------------------------------------------------------------

## 5. Themes (`themes/<id>.yaml`) and keybinds

Same as Flux-Asteria: `name, author, mode, radius, motion, colors{background,panel,panelRaised,text,muted,accent,onAccent,danger}`.

---------------------------------------------------------------------------------------------------

## 6. Visual script export (`*.cosmos-script.yaml`)

```yaml
format: cosmos-script
version: 1
name: Todo API
language: typescript
packages: [ compression ]
security: { requireApiKey: true, allowedOrigins: [], rateLimitPerMinute: 120, maxBodyKb: 64 }
port: 8080
basePath: /api
kinds: [ route, respond, dbFind ]     # the node kinds used, so the importer can warn about missing ones
graph: { nodes: [...], links: [...] }
```

Importing a script adds a new API to the open project. The database it was bound to is not part of the file.

---------------------------------------------------------------------------------------------------

## 7. Extensions

An extension is a folder in the app's `extensions` folder:

```
my-extension/
  extension.yaml        id, name, version, author, description
  engines/*.yaml
  languages/*.yaml
  nodes/*.yaml
  services/*.yaml
  themes/*.yaml
```

Extensions are **data only**. They never run code inside the app, so a broken or hostile extension cannot read your files.
A service that comes from an extension asks for confirmation before it starts, because it runs a program.
Built-in files always win over an extension's file with the same id (except node templates, which are merged per language).
