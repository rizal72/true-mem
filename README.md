# True-Memory

> **Standing on the shoulders of giants** — True-Memory builds upon the pioneering work of PsychMem, evolving the architecture based on practical experience and community feedback.

True-Memory is a persistent memory system for AI coding assistants (OpenCode), designed to provide context-aware, semantically intelligent memory across coding sessions.

---

## True-Memory vs PsychMem: Technical Comparison

True-Memory represents an architectural evolution of PsychMem, addressing critical stability and precision issues encountered in production environments. Below is a detailed technical comparison highlighting the key improvements.

### Stability & Integration

**PsychMem Approach:**
- Synchronous initialization in default export blocks OpenCode startup
- esbuild bundling with `--external` flags causes crashes in the OpenCode runtime
- Optional peer dependencies lead to unresolved import errors
- SDK-dependent logger crashes when plugin context is not fully initialized

**True-Memory Improvements:**
- **Lazy initialization**: Memory database loads only on first access, preventing startup blocks
- **Bun-native bundling**: Uses `bun build` instead of esbuild, ensuring OpenCode compatibility
- **Regular dependencies**: All dependencies are explicitly declared, eliminating peer dependency resolution issues
- **File-based logger**: Robust logging independent of SDK context, preventing crash cascades

### Precision

**PsychMem Approach:**
- Single keyword matching leads to high false positive rates
- Simple pattern extraction without negative filtering
- No confidence threshold, extracts everything that matches patterns

**True-Memory Improvements:**
- **Three-layer defense system**:
  1. **Negative patterns**: Explicit filters to exclude known false positives (e.g., "don't remember", "forget about")
  2. **Multi-keyword requirement**: Requires multiple pattern matches before classification
  3. **Confidence threshold**: Minimum threshold to validate memory extraction
- **Reduced false positives**: Significantly lowers noise in stored memories
- **Higher quality memory**: Only relevant, well-validated information is retained

### Semantic Retrieval

**PsychMem Approach:**
- Jaccard similarity based on word overlap
- Keyword matching without understanding semantic meaning
- Global injection of all stored memories into context

**True-Memory Improvements:**
- **Vector embeddings**: Uses Transformers.js to generate semantic embeddings for each memory
- **Cosine similarity**: Measures semantic similarity, not just keyword overlap
- **Top-k contextual retrieval**: Injects only the most relevant memories based on current query context
- **Cross-session continuity**: Maintains context across sessions while avoiding context bloat
- **Intra-session limits**: Retrieval is strategically limited to session start/first message to prevent oscillations

### Intelligent Decay

**PsychMem Approach:**
- Temporal decay applied to all memory types uniformly
- Preferences and decisions decay over time, potentially losing important context

**True-Memory Improvements:**
- **Selective decay**: Only episodic memories (short-term observations) decay after 7 days
- **Permanent storage**: Constraints, preferences, learning, procedural, decision, bugfix, and semantic memories persist indefinitely
- **Context preservation**: Important decisions and user preferences remain available across all future sessions
- **Smart consolidation**: Automatically promotes relevant memories from short-term to long-term storage

### User Experience

**PsychMem Approach:**
- Synchronous extraction blocks the UI during memory operations
- No debouncing causes redundant extractions
- Memory echo: System extracts its own injected content, creating feedback loops

**True-Memory Improvements:**
- **Fire-and-forget extraction**: Asynchronous, non-blocking memory operations
- **Debounced processing**: 500ms debounce prevents redundant extractions
- **Memory echo prevention**: Filters out injected memory content during text extraction
- **Smooth UI**: No perceptible lag during memory operations, ESC responds instantly
- **Reconsolidation**: Vector-based conflict resolution without LLM overhead

---

## Memory Classifications

| Type | Decay | Default Store | Scope | Example |
|------|-------|---------------|-------|---------|
| **constraint** | Never | STM | User (Global) | "Never use `var`" |
| **preference** | Never | STM | User (Global) | "Prefers functional style" |
| **learning** | Never | LTM (auto) | User (Global) | "Learned bun:sqlite API" |
| **procedural** | Never | STM | User (Global) | "Run tests before commit" |
| **decision** | Never | LTM (auto) | Project (Local) | "Decided SQLite over Postgres" |
| **bugfix** | Never | LTM (auto) | Project (Local) | "Fixed null pointer in auth" |
| **semantic** | Never | STM | Project (Local) | "API uses REST, not GraphQL" |
| **episodic** | Yes (7 days) | STM | Project (Local) | "Yesterday we refactored auth" |

**Dual-Scope Memory Logic:**
- **User-scoped memories** (constraint, preference, learning, procedural) are stored with `NULL project_scope` and are injected across **all projects**.
- **Project-scoped memories** (decision, bugfix, semantic, episodic) are tied to the **specific worktree path** and only injected when the current project matches.

---

## Getting Started

### Installation

Install the plugin via file:// in your OpenCode configuration:

```json
{
  "plugin": [
    "file:///Users/riccardosallusti/Documents/_PROGETTI/true-memory"
  ]
}
```

### Build

The plugin uses Bun's native bundler for maximum compatibility:

```bash
bun build src/index.ts --outdir dist --target bun --format esm
```

### Debug

View debug logs and inspect the memory database:

```bash
# View debug logs
tail -f ~/.true-memory/plugin-debug.log

# Query database schema
sqlite3 ~/.true-memory/memory.db ".schema"

# Search for errors
grep -i "error" ~/.true-memory/plugin-debug.log
```

---

## Architecture

```
true-memory/
├── src/
│   ├── index.ts                 # Entry point with fire-and-forget
│   ├── types.ts                 # Type definitions + SDK re-exports
│   ├── config.ts                # Default config
│   ├── logger.ts                # File-based logger
│   ├── storage/
│   │   ├── sqlite-adapter.ts    # bun:sqlite + node:sqlite
│   │   └── database.ts          # MemoryDatabase class
│   ├── memory/
│   │   ├── patterns.ts          # Multilingual patterns (670 lines)
│   │   ├── negative-patterns.ts # False positive prevention
│   │   ├── classifier.ts        # Three-layer defense
│   │   ├── embeddings.ts        # Transformers.js, cosine similarity
│   │   └── reconsolidate.ts     # Vector-based conflict resolution
│   ├── extraction/
│   │   └── queue.ts             # Fire-and-forget extraction queue
│   └── adapters/
│       └── opencode/
│           └── index.ts         # Full extraction + injection
├── dist/
│   └── index.js                 # Bundle (1.6M)
├── package.json
├── tsconfig.json
├── .gitignore
├── AGENTS.md
├── PLAN.md
└── README.md
```

---

## Key Features

- ✅ **Zero dependencies**: Uses built-in `bun:sqlite` and `node:sqlite`
- ✅ **Async extraction**: Non-blocking fire-and-forget architecture
- ✅ **Vector embeddings**: Semantic search with Transformers.js
- ✅ **Intelligent decay**: Selective decay for episodic memories only
- ✅ **False positive prevention**: Three-layer defense system
- ✅ **Context-aware retrieval**: Top-k injection based on semantic relevance
- ✅ **Dual-scope memory**: User-global and project-local memory isolation

---

## Acknowledgments

True-Memory is inspired by and builds upon [PsychMem](https://github.com/muratg98/psychmem) v1.0.5, which pioneered persistent memory for AI coding assistants.

---

## License

[Specify your license here]
