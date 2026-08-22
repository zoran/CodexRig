---
name: context-retrieval
description:
  Discover repository context through exact local search and the setup-created semantic index. Use
  for ordinary broad orientation, missing exact anchors, unfamiliar terminology, unknown ownership,
  cross-file relationships, or any change to indexing, embeddings, chunking, ranking, freshness,
  cache, or retrieval dependencies. Always read matched source files before edits or claims.
---

# Context Retrieval

Use the cheapest reliable retrieval path:

1. Use `rg` or known paths for exact text, symbols, filenames, and narrow questions.
2. When no reliable exact anchor exists, use `pnpm context:search -- "concept or relationship"`
   early for broad orientation, unfamiliar terminology, unknown ownership, behavior distributed
   across files, cross-file impact, or ambiguous exact results. A failed `rg` search is not a
   prerequisite; prefer semantic discovery to broad blind file reading.
3. Ask one concrete responsibility, behavior, data-flow, or relationship question rather than a
   generic task dump. Refine once when the first result exposes better repository terminology.
4. Treat results only as discovery pointers: read every matched source used for a claim or edit,
   then return to exact search and direct source inspection.
5. Use `pnpm context:check` for strictly read-only structural diagnostics. Use `context:index` for
   explicit maintenance or repair; semantic search retains bounded on-demand repair.
6. Read the returned source files directly. Retrieval output is a hint, never authority.

Project initialization is the one intentional bootstrap: `pnpm setup` must leave a current, usable
vector space and print its fixed location and statistics. After bootstrap, `context:search` checks
freshness and incrementally repairs changed, deleted, or damaged state on demand through the
mise-pinned runtime. The trusted Stop lifecycle remains preloaded and deliberately never loads
mutable semantic-index code after session admission. There is no watcher, per-tool hook, or
automatic Stop refresh. Do not prebuild or refresh the index as ceremony. Use semantic search only
with a concrete retrieval question, and stop if exact search is cheaper. `context:index` is for
explicit maintenance or diagnostics; vector writes alone are not useful work.

## Index Contract

- The repository provides local embeddings and storage so generated projects work without a hosted
  service. Production vector and model state has one fixed, ignored home at root `.context-index/`,
  outside every Product Root; path overrides are test-only. The ignored model/index size is
  acceptable; steady-state latency and memory matter more.
- Index only active, Git-aware project sources, combining code, tests, configuration, skills,
  durable docs, and the optional bounded project-context cache. Skip process history, ignored
  output, runtime state, secrets, symlinks, generated caches, and the index itself.
- Include tracked portable `.codex` config/hooks/docs/agent roles and semantic `.codexrig` policy,
  but exclude private `.codex/runtime/` state and generated installation checksum receipts. Keep
  `docs/future-modules.md` searchable while down-ranking it for queries that do not explicitly ask
  for future/backlog/idea candidates; the current manifest and read source remain authoritative.
- Chunk by token budget and useful boundaries, not a fixed physical-line rule.
- Refresh changed files incrementally and remove deleted files. Setup performs the initial build and
  a real smoke search, then becomes an incremental no-op while current. Semantic search owns
  freshness and bounded repair; explicit `context:index` owns maintenance. The trusted Stop
  lifecycle handles only durable continuation, loop protection, and terminal handover through its
  already-loaded controller. Unrelated verification and pre-push remain read-only and must not
  rebuild or remove the index.
- Replace a complete generation at 20 incremental operations or 100,000 affected rows. Reuse vectors
  only after deep validation for threshold replacement; corruption and schema-mismatch repair reuse
  none.
- Before bootstrap, read-only checks report the absent index without loading the model. Route native
  context output through the sanitized context worker, never emit absolute local paths, and surface
  search or maintenance failures clearly.
- Exact lexical matches must not be hidden behind a small dense candidate set. Ranking and output
  must be deterministic, bounded, and safe for terminal display.
- Work offline after the model is cached. Locks must be ownership-safe, and corrupt or partial state
  must fail clearly or repair itself without deleting a live build.

When changing retrieval internals, test unchanged, modified, added, deleted, offline, corrupt-state,
concurrent, exact-match, semantic-match, ranking, latency, and memory cases proportionally. Use a
separate read-only retrieval review when the change is substantial and independent review is useful.
