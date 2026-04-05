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

## Working Agreements

- User allowed overwriting current local changes if they do not make technical sense or block a coherent implementation.
- When such overwrite happens, record it in this file so the change history stays explicit.
