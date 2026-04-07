# Test Model Improvements Memory

## Goal

Improve the test-model generation pipeline so that:
- every `Feature` keeps at least one `Story`;
- every `Story` keeps at least one `Scenario`;
- every `Scenario` keeps at least one `Code`;
- coverage and validation treat empty lower levels as real failures, not soft warnings.

## Current Context

- Repository already has local user changes in:
  - `server/server.js`
  - `server/semanticChunking.mjs`
- Existing local changes already move generation from feature-based chunking to semantic chunking.
- Current local chunking behavior now preserves requirement text from Markdown tables by flattening table cells into plain text before chunk creation.
- Current weak point is downstream of chunking:
  - cleanup removes nodes;
  - validation does not hard-fail on empty `story/scenario/code`;
  - coverage mostly tracks `Feature -> Story`.

## Work Log

### 2026-04-05

- User requested model-selection consistency between test-model generation and test-case generation when choosing a model in the UI dropdown.
- Confirmed that direct transition from the test-model editor to test-case generation already forwarded `selectedModel`, but the `refine-test-model` path did not.
- Implemented the fix:
  - `client/src/components/test-model/TestModelGeneratorModal.jsx` now includes `models: [selectedModel]` in the `refine-test-model` payload;
  - `server/server.js` now reads `req.body.models` in `/api/refine-test-model` and builds `modelsToTry` using the same priority rule as other generation flows: selected model first, then configured fallbacks.
- Resulting behavior:
  - creating a test model, refining a test model, and generating test cases from that model now all honor the same model selected in the UI dropdown;
  - fallback order remains unchanged after the selected model.
- Rebuilt local image from current workspace:
  - `allure-test-inspector-local` -> `sha256:aef36dabb578d1af737e5f65798029edae3cc40e24fccb0fefa6b43a0a1687d5`
- Recreated runtime containers:
  - `docker compose up -d --force-recreate allure-test-inspector tia-mapping-service bdd-server`
- Verified live endpoints immediately after recreate:
  - `http://localhost:5000/health/db` -> `200 {"status":"ok","db":"connected"}`
  - `http://localhost:5001/health` -> `200 {"status":"healthy","timestamp":"2026-04-05T08:07:29.088Z","service":"tia-mapping-service"}`
  - `http://localhost:5002/api/bdd/steps` -> `200 {"steps":[],"count":0}`
- Observed compose status right after recreate:
  - `allure-test-inspector`, `tia-mapping-service`, and `bdd-server` were up with `health: starting`;
  - HTTP checks already succeeded, so the services were reachable despite the transient compose health state.
- Follow-up compose status check a bit later showed:
  - `bdd-server` -> `healthy`;
  - `allure-test-inspector` -> `unhealthy`;
  - `tia-mapping-service` -> still `health: starting`.
- Interpretation:
  - `allure-test-inspector` runtime itself is reachable and answers `200` on `/health/db`, but compose still marks it unhealthy because its healthcheck is configured against `/health`;
  - `tia-mapping-service` answers `200` on `/health`, so its remaining `health: starting` state was transient at the time of logging.
- User then reported a functional issue in generated test models:
  - inside one `Story`, different `Scenario` branches could still keep the same effective `Code` set.
- Implemented the duplicate-`Code`-set fix in `server/server.js`:
  - added normalization/signature helpers for comparing `Scenario` branches by their `Code` content;
  - added merge logic so duplicate `Scenario` branches inside the same `Story` collapse into one preferred branch with a deduplicated combined `Code` list;
  - added structural diagnostics so duplicate `Code` sets inside a `Story` are now treated as repairable model issues;
  - extended targeted Story repair and final retry prompts so regeneration explicitly merges duplicate `Code` sets instead of re-emitting them.
- Rebuilt all local service images from the current workspace after this fix:
  - `allure-test-inspector-local` -> `sha256:b107c828f472eaadc7b451df71413aab76e572f2c76c129d501de2b0bb30a8dd`
  - `tia-mapping-service-local` -> `sha256:fbbf29bf7315260199e45919d2443e3c769d18cddd4c02c2e9b90e1f1789d5a7`
  - `bdd-server-local` -> `sha256:2533006b250060c8c340126bf44111e9eb2b46d389dbabc29d91990891b8391a`
- Recreated runtime containers:
  - `docker compose up -d --force-recreate allure-test-inspector tia-mapping-service bdd-server`
- Verified live endpoints after recreate:
  - `http://localhost:5000/health/db` -> `200 {"status":"ok","db":"connected"}`
  - `http://localhost:5001/health` -> `200 {"status":"healthy","timestamp":"2026-04-05T09:56:42.344Z","service":"tia-mapping-service"}`
  - `http://localhost:5002/api/bdd/steps` -> `200 {"steps":[],"count":0}`
- Follow-up `docker compose ps` after ~75 seconds showed:
  - `bdd-server` -> `healthy`;
  - `allure-test-inspector` -> still `health: starting`;
  - `tia-mapping-service` -> still `health: starting`.
- Interpretation of the latest runtime state:
  - all three service endpoints are reachable over HTTP from the host;
  - `bdd-server` healthcheck now reaches `healthy`;
  - `allure-test-inspector` still does not converge at compose-health level because the configured check targets `/health`, while the verified backend route is `/health/db`;
  - `tia-mapping-service` still serves `200` on `/health`, so its `health: starting` status remains a compose-healthcheck lag rather than an observed HTTP outage.
- User then clarified the duplicate rule more precisely:
  - repeating `Scenario` in different `Story` is acceptable;
  - repeating `Code` in different `Story` is acceptable;
  - the real defect is duplicate `Code` entries inside one concrete `Scenario`.
- Corrected the same-day server-side interpretation in `server/server.js`:
  - removed the previously added logic that merged different `Scenario` branches by identical `Code` sets inside one `Story`;
  - removed the corresponding structural diagnostics and repair prompts about duplicate `Code` sets across `Scenario`;
  - updated the generation prompt so deduplication now explicitly applies only inside a single `Scenario`;
  - strengthened `validateAndCleanModel()` so it always runs `deduplicateCodesInScenario()` and logs when duplicate `Code` entries are removed from one `Scenario`.
- This correction supersedes the earlier 2026-04-05 attempt that treated equal `Code` sets across `Scenario` in one `Story` as a merge condition.
- Rebuilt local images from the current workspace after the corrected rule:
  - `allure-test-inspector-local` -> `sha256:54f7cc7c6307e977be1f998e25fe91ebc91f8c386941ea299ccc6e2693475f92`
  - `tia-mapping-service-local` -> `sha256:fbbf29bf7315260199e45919d2443e3c769d18cddd4c02c2e9b90e1f1789d5a7`
  - `bdd-server-local` -> `sha256:2533006b250060c8c340126bf44111e9eb2b46d389dbabc29d91990891b8391a`
- Recreated runtime containers again:
  - `docker compose up -d --force-recreate allure-test-inspector tia-mapping-service bdd-server`
- Verified live endpoints after recreate:
  - `http://localhost:5000/health/db` -> `200 {"status":"ok","db":"connected"}`
  - `http://localhost:5001/health` -> `200 {"status":"healthy","timestamp":"2026-04-05T10:27:12.694Z","service":"tia-mapping-service"}`
  - `http://localhost:5002/api/bdd/steps` -> `200 {"steps":[],"count":0}`
- Follow-up `docker compose ps` after ~75 seconds showed:
  - `bdd-server` -> `healthy`;
  - `allure-test-inspector` -> still `health: starting`;
  - `tia-mapping-service` -> still `health: starting`.
- Interpretation of the corrected-rule deployment:
  - HTTP availability of all three services is confirmed after recreate;
  - the runtime now reflects the narrower dedup rule: only duplicate `Code` entries inside one `Scenario` are automatically removed;
  - compose-health behavior remains unchanged from the earlier observation: `bdd-server` converges to `healthy`, while `allure-test-inspector` and `tia-mapping-service` still lag at compose-health level despite successful host-side HTTP checks.
- User then identified a graph-context gap:
  - linked context pages were indexed for RAG, but not reliably reaching Neo4j graph extraction;
  - explicit `contextPageIds` from the request were also not participating in graph enrichment for `generateTestModelAsync`.
- Root cause confirmed in `server/server.js`:
  - `autoPages` stored linked-page prompt blocks as plain strings;
  - the Neo4j branch later tried to read them as `{ content, title }` objects, so auxiliary graph texts collapsed to an empty list;
  - fallback `contextRefiner()` call also dropped explicit `contextPageIds` by passing `undefined`.
- Implemented the graph-context page fix in `server/server.js`:
  - introduced structured `autoPageDocs` alongside legacy `autoPages` prompt strings;
  - graph extraction now reads auxiliary texts from `autoPageDocs` plus separately loaded explicit `contextPageIds`;
  - explicit context pages are fetched, registered in `sourceRegistry`, deduplicated against auto-linked pages, and added to Neo4j graph extraction inputs;
  - fallback `contextRefiner()` now receives original `contextPageIds` instead of discarding them.
- Expected behavior after this fix:
  - Neo4j graph enrichment now includes main requirement chunks plus linked context pages and explicit request-level context pages;
  - logs should now show non-zero `auto-linked context pages`, `explicit context pages`, and `graph context texts` when such pages are present.
- Rebuilt local images from the current workspace after the graph-context fix:
  - `allure-test-inspector-local` -> `sha256:d72b6e01441c9d2d1cb37debfc38f8f993584596190d71e0988d4ede3a7a898c`
  - `tia-mapping-service-local` -> `sha256:fbbf29bf7315260199e45919d2443e3c769d18cddd4c02c2e9b90e1f1789d5a7`
  - `bdd-server-local` -> `sha256:2533006b250060c8c340126bf44111e9eb2b46d389dbabc29d91990891b8391a`
- Recreated runtime containers:
  - `docker compose up -d --force-recreate allure-test-inspector tia-mapping-service bdd-server`
- Verified live endpoints after recreate:
  - `http://localhost:5000/health/db` -> `200 {"status":"ok","db":"connected"}`
  - `http://localhost:5001/health` -> `200 {"status":"healthy","timestamp":"2026-04-05T16:31:46.169Z","service":"tia-mapping-service"}`
  - `http://localhost:5002/api/bdd/steps` -> `200 {"steps":[],"count":0}`
- Immediate `docker compose ps` after recreate showed:
  - `allure-test-inspector` -> `health: starting`
  - `tia-mapping-service` -> `health: starting`
  - `bdd-server` -> `health: starting`
- Interpretation:
  - the updated code is deployed and host-side HTTP checks succeed;
  - compose health status is still transient right after recreate, consistent with previous observations for this environment.

### 2026-03-29

- Created persistent memory file for this task.
- Confirmed existing local changes in `server/server.js` and `server/semanticChunking.mjs`; do not overwrite them.
- Next implementation focus:
  - add structural coverage report for `story/scenario/code`;
  - add closure/prune pass after cleanup;
  - integrate hard checks into `generateTestModelAsync`.
- Implemented in `server/server.js`:
  - extended coverage report with structure coverage, empty stories and empty scenarios;
  - text-matching helpers for expected/generated feature-story alignment;
  - targeted repair target collection for missing or incomplete story branches;
  - single-story regeneration routine through existing `submit_test_model` tool;
  - upsert logic to merge repaired stories back into the model;
  - prune pass for empty stories/scenarios/features after targeted repair.
- Integrated new repair flow into `generateTestModelAsync` before final coverage calculation.
- User clarified an additional hard rule for `Scenario`:
  - `Scenario` may contain only a concrete user-executable step;
  - feature requirements, system actions, state-verification phrases and placeholders are invalid on the `Scenario` level.
- Implemented scenario-actionability enforcement in `server/server.js`:
  - added a dedicated validator for actionable `Scenario` texts;
  - removed synthetic fallback scenarios like `Выполнить пользовательское действие`;
  - changed story repair so invalid scenarios no longer become placeholder actions;
  - extended post-process, validation, prune and targeted-repair target collection to detect/remove invalid scenarios;
  - strengthened single-story regeneration prompt and acceptance checks to reject non-actionable scenarios.
- Rebuilt all local service images from current workspace:
  - `allure-test-inspector-local` -> `sha256:6f0bf96c7e686c2c8eed85b9c5202bdf930e6a6f8d4cf963bd1bc96d9a20adce`
  - `tia-mapping-service-local` -> `sha256:fbbf29bf7315260199e45919d2443e3c769d18cddd4c02c2e9b90e1f1789d5a7`
  - `bdd-server-local` -> `sha256:1a56915c95a9ab7347a349cfac7ac3062866495ac0913abea4d810418bcace22`
- Recreated containers through `docker compose up -d --force-recreate allure-test-inspector tia-mapping-service bdd-server`.
- Verified live endpoints after recreate:
  - `http://localhost:5000/health/db` responds with DB connected status;
  - `http://localhost:5001/health` responds healthy;
  - `http://localhost:5002/api/bdd/steps` responds with JSON.
- Refined environment issue diagnosis:
  - `allure-test-inspector` and `tia-mapping-service` compose healthchecks use `curl`;
  - these containers do not have `curl` in PATH;
  - because of this, compose health status becomes `starting/unhealthy` independently of real HTTP availability;
  - for `allure-test-inspector` there is still a second known mismatch in compose: healthcheck targets `/health`, while the verified backend route is `/health/db`.

### 2026-04-03

- User requested that Markdown tables stop leaking raw table markup into semantic chunks.
- Implemented an initial mitigation in `server/semanticChunking.mjs`:
  - semantic chunk classification started using section text with Markdown table lines removed;
  - atomic chunk creation stopped emitting raw `| ... |` table lines into `raw_text` and `cleaned_text`;
  - sections classified as pure `table_row` were skipped during chunk creation.
- Result of this intermediate state:
  - mixed sections kept only surrounding prose;
  - table-only sections stopped producing chunks.

### 2026-04-04

- User clarified the real requirement: requirement text stored inside tables must remain available to chunking, but without Markdown table markup.
- Reworked the 2026-04-03 table filter in `server/semanticChunking.mjs` into table flattening:
  - replaced full table removal with `flattenMarkdownTables()` at chunk-text extraction time;
  - Markdown table blocks are now transformed into plain-text row lines in-place instead of being discarded;
  - header-based tables are normalized into `Header: value; Header: value` lines;
  - separator rows like `| --- | --- |` are ignored;
  - cell text is normalized to remove Markdown wrappers while preserving meaning.
- Behavioral outcome after the rework:
  - mixed prose + table sections now keep both the prose and the table requirements in chunk text;
  - table-only sections now produce chunks again, but as plain text derived from cell values rather than raw Markdown table syntax.
- Local verification executed on 2026-04-04 with a short inline `chunkify()` sample:
  - `| Поле | Обязательность | Описание | ... | ИНН | Да | 10 цифр |` became `Поле: ИНН; Обязательность: Да; Описание: 10 цифр`;
  - a table-only section became `Код: 400; Смысл: Ошибка валидации`.

### 2026-04-04 - Scenario Acceptance And Coverage Analysis

- Analysed runtime logs for test-model generation task `5b264dc2-1128-491a-a797-41cf4753cf00`.
- Confirmed two production-significant symptoms in logs:
  - final metrics reported `Coverage: 0/1 (0%)` and `Structure coverage: 0/1 (0%)`;
  - the pipeline still returned success after a critical Scenario issue remained: `Scenario "Раскрыть детальную информацию по заявке на возврат" ... причина: Scenario не начинается с пользовательского действия`.
- Root cause found in `server/server.js`:
  - story-regeneration acceptance compared only the raw issue count;
  - regenerated models were not sanitized again through structural repair and pruning before acceptance;
  - this allowed a candidate with fewer total issues but a worse Scenario-quality regression to replace the previous model.
- Implemented a focused fix in `server/server.js`:
  - added `sanitizeModelForValidation()` to re-run `repairModelStructure()`, `validateAndCleanModel()` and `pruneEmptyModelBranches()`;
  - added issue-profile helpers so the retry path compares severity, not only issue count;
  - applied sanitation to the merged final model and to story-regeneration candidates before acceptance.
- Added a targeted fallback for coverage matching:
  - placeholder requirement-story names such as `Базовый сценарий` or `Основной сценарий` are now treated as generic story containers;
  - when direct similarity matching fails for such placeholders, the matcher falls back to the most complete generated story inside the matched feature instead of returning `missing` immediately.
- Expected effect:
  - invalid or abstract Scenario nodes introduced during retry should no longer survive because of a naive `issues.length` comparison;
  - retry acceptance should stop preferring models with Scenario regressions over models that only have weaker story-label problems;
  - coverage should no longer collapse to `0%` only because the parsed requirement structure still contains a generic placeholder Story name.

### 2026-04-04 - Embedding Model Priority

- Updated embedding model priority in `server/pgvectorStore.mjs`:
  - primary model is now `Qwen/Qwen3-Embedding-0.6B`;
  - fallback model is now `BAAAI/bge-m3`.
- Rationale:
  - runtime logs showed repeated `404` on `BAAAI/bge-m3`, followed by successful fallback to Qwen;
  - switching the order removes avoidable failed calls and log noise before semantic indexing/search.
- Also updated the stale dimension comment in `server/pineconeIndexer.mjs` so local diagnostics no longer suggest a mismatched Qwen vector size for this project.

## Verification Queue

- `server/server.js` syntax validated on 2026-04-05 via inline VM module parse.
- Rebuilt `allure-test-inspector-local` on 2026-04-05 from the current workspace after the model-selection synchronization fix.
- Recreated `allure-test-inspector`, `tia-mapping-service`, and `bdd-server` containers on 2026-04-05.
- Verified runtime on 2026-04-05:
  - `http://localhost:5000/health/db` responds with `{"status":"ok","db":"connected"}`;
  - `http://localhost:5001/health` responds with `{"status":"healthy",...}`;
  - `http://localhost:5002/api/bdd/steps` responds with `{"steps":[],"count":0}`.
- Follow-up `docker compose ps` on 2026-04-05 showed:
  - `bdd-server` healthy;
  - `allure-test-inspector` unhealthy because compose checks `/health` while the verified backend route is `/health/db`;
  - `tia-mapping-service` still in `health: starting` despite `200` from `/health`.
- `node --check server/server.js` passed.
- `server/semanticChunking.mjs` was updated on 2026-04-03 and 2026-04-04 to normalize Markdown tables before semantic chunk creation.
- `server/server.js` was updated on 2026-04-04 to sanitize regenerated models before acceptance and to compare structural issues by severity profile instead of raw count.
- `server/pgvectorStore.mjs` was updated on 2026-04-04 to use `Qwen/Qwen3-Embedding-0.6B` as the primary embedding model with `BAAAI/bge-m3` as fallback.
- `server/pineconeIndexer.mjs` comment was updated on 2026-04-04 to reflect the current 1024-dim embedding expectation used in this project.
- Full runtime/integration test not executed in this turn.
- Rebuilt and recreated all three local service containers from current workspace.
- Verified runtime:
  - `http://localhost:5000/health/db` responds with `{"status":"ok","db":"connected"}`;
  - `http://localhost:5001/health` responds healthy;
  - `http://localhost:5002/api/bdd/steps` responds with JSON.
- Verified chunk-level table normalization on 2026-04-04 with a local `chunkify()` sample run:
  - mixed text + table sections preserve surrounding prose and inject flattened table rows into chunk text;
  - table-only sections produce plain-text requirement rows instead of raw Markdown table syntax.
- Found environment issue:
  - compose healthchecks for `allure-test-inspector` and `tia-mapping-service` require `curl`, but `curl` is absent inside both containers;
  - because of this, compose health status can stay `starting/unhealthy` even when service is alive;
  - `allure-test-inspector` also still has a route mismatch in compose: `/health` vs implemented `/health/db`.

## Pending Decisions

- Prefer targeted auto-repair for empty nodes over full regeneration.
- Keep chunking changes minimal because user already modified that area.

## 2026-04-05 - Neo4j Graph Integration for Better Scenario Context

### Goal
Improve Scenario quality by providing LLM with structured context about:
- UI elements from requirements
- API endpoints and their relationships
- Business rules and dependencies
- External references

Instead of raw text chunks, LLM now receives: main fragment + related method + related params + related conditions + external refs.

### Implementation

**1. Neo4j added to docker-compose.yml**
- `neo4j:5.16-community` on ports 7474/7687
- Configured with NEO4J_AUTH=neo4j/password
- Added healthcheck with cypher-shell
- Connected to allure-test-net
- Added environment variables NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD to allure-test-inspector

**2. New files created:**
- `server/graphStore.mjs` - Neo4j driver and operations:
  - `initNeo4j()` / `closeNeo4j()` - connection management
  - `isNeo4jAvailable()` - health check with logging
  - `upsertEntities()` - create/merge nodes
  - `upsertRelationships()` - create relationships
  - `getEntityContext()` - get connected entities by type
  - `clearSession()` - cleanup after generation
- `server/entityExtractor.mjs` - LLM-based entity extraction:
  - `extractEntitiesAndRelationships()` - extracts nodes of types:
    - RequirementFragment, APIEndpoint, ResponseParam, UIElement, BusinessRule, ExternalRef
  - `extractUIFromText()` - specialized UI element extraction
  - `convertUIToEntities()` - converts UI extraction to entities

**3. Node types in Neo4j:**
- `:RequirementFragment` - requirement text fragments
- `:APIEndpoint` - API endpoints with method, URL, description
- `:ResponseParam` - response parameters
- `:UIElement` - buttons, fields, sections, dropdowns
- `:BusinessRule` - validation rules, constraints
- `:ExternalRef` - external documentation links

**4. Relationship types:**
- `references` - between requirement fragments
- `uses_method` - requirement uses API endpoint
- `returns_param` - API returns parameter
- `controls_ui` - business rule controls UI element
- `depends_on` - entity dependency
- `extends_logic_from` - logic extension

**5. Integration in generateTestModelAsync:**
- After semantic chunking, entities are extracted from chunks
- Entities and relationships are upserted to Neo4j
- UI elements are additionally extracted from full text
- `getEntityContext()` retrieves connected entities
- `formatGraphContextForPrompt()` formats for LLM prompt
- Graph context added to buildModelUserPrompt() alongside RAG context
- Session cleaned after generation completes

**6. Updated server.js:**
- Added imports for graphStore and entityExtractor
- Added initNeo4j() in startup
- Added graph extraction logic after RAG (lines ~7176-7222)
- Added graphContext parameter to buildModelUserPrompt
- Added formatGraphContextForPrompt() function
- Added cleanup after generation

**7. Logging improvements:**
- Enhanced logging in graphStore.mjs: isNeo4jAvailable() logs availability check
- Enhanced logging in entityExtractor.mjs: extraction progress, chunk processing, deduplication results

### Result Flow
```
Confluence → semanticChunking → pgvector (chunks + RAG)
                              ↓
                     entityExtractor → Neo4j (entities + relationships)
                              ↓
                     getEntityContext() → formatGraphContextForPrompt()
                              ↓
                     LLM receives: text + RAG + graph context
```

### What to see in logs after deployment:
1. `[startup] ✅ Neo4j driver инициализирован`
2. `[graphStore] ✅ Neo4j is available` (when checking)
3. `[generate-test-model-async] 🌐 Извлечение сущностей в Neo4j граф...`
4. `[entityExtractor] 📦 Starting extraction from N chunks for session: ...`
5. `[entityExtractor] 🔄 Processing chunk X/Y...`
6. `[entityExtractor] 📊 Chunk X results: N entities, M relationships`
7. `[entityExtractor] ✅ Total unique: N entities, M relationships`
8. `[generate-test-model-async] 📊 Извлечено: N сущностей, M связей`
9. `[generate-test-model-async] 📱 UI элементов: N, путей: M`
10. `[generate-test-model-async] 🌐 Графовый контекст сформирован для сессии ...`
11. `[generate-test-model-async] 🗑️ Neo4j сессия ... очищена` (after completion)

## Working Agreements

- User allowed overwriting current local changes if they do not make technical sense or block a coherent implementation.
- When such overwrite happens, record it in this file so the change history stays explicit.

## 2026-04-05 Server Log Cleanup

- Analyzed `docker compose` logs after container recreation.
- Fixed false PostgreSQL startup errors in `tia-mapping-service/scripts/setup-db.sh`.
- Root cause: the bootstrap script tried to connect as `postgres`, while the stack is provisioned with `${DB_USER}` from `.env` (`tia_user` in the current environment).
- Added optional `DB_ADMIN_USER` / `DB_ADMIN_PASSWORD` support for setups that really need a separate bootstrap account.
- Kept healthcheck fixes in place:
  - `curl` is installed in `allure-test-inspector` and `tia-mapping-service` images.
  - `allure-test-inspector` healthcheck points to `/health/db`, which is the real backend health route.
- Expected outcome after rebuild:
  - no `FATAL: password authentication failed for user "postgres"` during `tia-mapping-service` startup;
  - `allure-test-inspector`, `tia-mapping-service`, and `bdd-server` stay `healthy`.

## 2026-04-05 Neo4j Graph Runtime Fix

- Confirmed that `upsertEntities is not defined` had not been fixed in the test model generation path.
- Found an adjacent runtime defect: `getEntityContext(...)` was also called from `server/server.js`, but no such function existed in `graphStore.mjs`.
- Fixed `server/server.js` graph pipeline so it now:
  - creates graph-ready chunks with stable `chunkId`, `position`, `sectionId`, and `documentId`;
  - creates `Chunk` nodes in Neo4j before entity extraction;
  - writes `NEXT` links between sequential chunks;
  - uses `createEntities` / `createEntityRelationships` instead of the non-existent `upsertEntities`;
  - passes proper options objects into `extractEntitiesFromChunks(...)` and `convertUIToEntities(...)`;
  - builds prompt graph context from `getAllNodes(...)` grouped by node type.
- Extended `server/graphStore.mjs#getAllNodes()` to return full node properties so graph context in prompts keeps method/url/UI metadata instead of just node names.
- Result: Neo4j startup is healthy, the graph generation path no longer references missing functions, and entity-to-chunk relationships have backing `Chunk` nodes.

## 2026-04-06 End-to-End Graph Verification

- Ran a real `POST /api/generate-test-model-async` request with inline requirements for password recommendations UI/API behavior.
- Confirmed that Neo4j graph creation now executes in a live generation run:
  - backend log reported `Создано узлов`, `Создано связей`, and `Графовый контекст сформирован для сессии ...`;
  - debug routes `/api/debug/graph-stats`, `/api/debug/graph-nodes`, `/api/debug/graph-relationships` returned data for the generated session.
- Found and fixed another runtime defect in graph readback:
  - Neo4j rejected `LIMIT 500.0` while reading graph context for the prompt;
  - fixed by passing integer parameters via `neo4j.int(...)` in `server/graphStore.mjs` for `limit` and `depth`, and by converting count values to plain numbers in graph stats.
- Found and fixed bad graph metadata for inline generation:
  - `chunkify()` received `String(pageId)` even when `pageId` was absent;
  - this produced `documentId: "undefined"` in graph chunk nodes;
  - fixed by using the stable fallback `graphDocumentId` before chunkification.
- Quality note after debug inspection:
  - graph infrastructure works, but UI extraction still over-generates some unrelated UI nodes in live runs;
  - prompt constraints in `server/entityExtractor.mjs` were tightened to reduce copying examples into the graph, but semantic noise is still not fully eliminated;
  - next likely improvement is a deterministic post-filter against the source text for UI nodes and user paths.

## 2026-04-07 Chunking Improvements And Verification

- Reworked `server/semanticChunking.mjs` so `scenario_branch` normalization now:
  - synthesizes broader scenario parents from over-granular nested children;
  - splits fallback clauses into dedicated `*-fallback` branches;
  - renames implicit top-level branches like `2` into `2.1` when a sibling `2.2` exists but `2.1` was lost during parsing.
- Added stricter retrieval exclusion handling for non-test-model chunks:
  - `document_meta`, `change_log`, `noise_metadata`, `noise_skipped`, `reference_link` are now marked out of retrieval by chunk type.
- Strengthened linked-page context selection in `server/server.js`:
  - replaced the old token-overlap selector with scored section ranking based on quoted phrases, endpoint hints, password-topic hints and explicit penalties for login / subscriptions / Push / TouchID / RuToken noise;
  - added `extractBestLinkedPageMention()` so the backend no longer uses the first `pageId=` hit from the main page (often a changelog row), but instead picks the strongest password-relevant occurrence of the linked-page reference;
  - added finer splitting inside mixed linked-page sections (`splitRelevantSearchBlocks`) so password-focused trimming can work not only on headings, but also on numbered items and table rows.
- Verified locally against the saved real main Confluence source from `report/chunk-dumps/test-model-chunks-40a8d001-38f6-4218-a6a7-92fab09b034c.md`:
  - `4.1.2` now produces the intended scenario seeds: `1.1`, `1.2`, `2.1`, `2.1-fallback`, `2.2`, `3`;
  - the old duplicate-driving microbranches `1.1.2.2.2`, `2.2.1`, `2.2.2`, `2.2.3` are gone as standalone retrieval units.
- Rebuilt the stack and ran a real `POST /api/generate-test-model-async` with the saved full primary requirement text:
  - taskId: `24d9b10e-db47-4961-a46b-56af385e1d07`;
  - fresh dump written to `report/chunk-dumps/test-model-chunks-24d9b10e-db47-4961-a46b-56af385e1d07.md`;
  - main requirement now chunks into `17` chunks instead of the previous `19`;
  - the generation did not finish within a 20-minute observation window and stayed at `progress=20`, but backend logs showed it had already passed chunking / graph build and was still actively generating chunk-level model output (`Обработка чанка 4/14...`), so this is a long-running LLM phase, not a chunking crash.
- Main requirement result after the live inline run:
  - `document_meta` and `change_log` are excluded from retrieval as intended;
  - `4.1.2` is now represented by the target set of scenario branches and no longer creates duplicate Story seeds from tiny child fragments;
  - `mainChunkCount` in the dump is `17`, while the previous dump had `19`.
- Linked-page verification had to be done offline, because no live Confluence bearer token is stored in repo `.env`:
  - used the saved old full dump as the source of real linked-page markdown and main-page references;
  - replayed `extractBestLinkedPageMention()` + `extractRelevantSections()` locally and then re-chunked the resulting filtered prompt text via `/api/debug/requirement-chunks`.
- Linked-page replay results:
  - page `163223068` (`Настройки`): old saved prompt `14060` chars / `20` chunks -> after new selector and finer trimming `8046` chars / `9` chunks;
  - page `175968366` (`Настройки МП`): old saved prompt `13099` chars / `12` chunks -> after new selector and finer trimming `7519` chars / `8` chunks;
  - page `168725592`: old saved prompt `16305` chars / `18` chunks -> after new selector and finer trimming `10318` chars / `13` chunks.
- What improved in linked pages:
  - the selector no longer anchors on changelog rows as the main `mention`;
  - prompt size and chunk count dropped materially for all three linked pages;
  - the worst duplicate drivers from the main requirement are resolved before model generation starts.
- What is still poor in linked pages:
  - mixed sections like `Изменить логин/пароль` still leak login parameter rows into password context because password and login live inside the same Confluence section, and table-row splitting is still syntactic rather than semantic;
  - mobile current-state docs still leak `TouchID` / `Push` rows when they share a selected screen table with password UI;
  - `rest- / summary` still appears in `Настройки` dumps, which means parsing artifacts inside mixed service documentation are not fully suppressed yet;
  - replayed linked-page dumps still keep too many retrievable chunks because the current exclusion model is chunk-type-based, while many noisy rows are still being typed as generic API/UI chunks instead of being marked as noise.
- Artifacts created during today's verification:
  - `report/chunk-dumps/test-model-chunks-24d9b10e-db47-4961-a46b-56af385e1d07.md`
  - `report/chunk-dumps/test-model-chunks-rechunk-163223068.md`
  - `report/chunk-dumps/test-model-chunks-rechunk-175968366.md`
  - `report/chunk-dumps/test-model-chunks-rechunk-168725592.md`
  - `report/chunk-dumps/test-model-chunks-relevant-rechunk-163223068.md`
  - `report/chunk-dumps/test-model-chunks-relevant-rechunk-175968366.md`
  - `report/chunk-dumps/test-model-chunks-relevant-rechunk-168725592.md`
  - `report/chunk-dumps/test-model-chunks-relevant-rechunk-v2-163223068.md`
  - `report/chunk-dumps/test-model-chunks-relevant-rechunk-v2-175968366.md`
  - `report/chunk-dumps/test-model-chunks-relevant-rechunk-v2-168725592.md`
  - `report/chunk-dumps/test-model-chunks-relevant-rechunk-v3-163223068.md`
  - `report/chunk-dumps/test-model-chunks-relevant-rechunk-v3-175968366.md`
  - `report/chunk-dumps/test-model-chunks-relevant-rechunk-v3-168725592.md`
