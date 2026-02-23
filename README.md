# True-Memory: Semantic Persistent Memory for OpenCode

> **Standing on the shoulders of giants** — True-Memory is an evolution of [PsychMem](https://github.com/muratg98/psychmem) v1.0.5, incorporating critical architectural improvements to solve stability, precision, and retrieval issues in AI coding assistants.

True-Memory is a semantic persistent memory system that provides context-aware intelligence across coding sessions. It implements cognitive science principles to ensure your AI assistant remembers your preferences, decisions, and constraints while naturally letting trivial details fade away.

---

## Psychological Foundations

True-Memory is built on established cognitive science research:

### 1. Dual-Store Memory Model (Atkinson & Shiffrin, 1968)
Human memory operates in two stages:
- **Short-Term Memory (STM)**: Limited capacity, rapid decay, holds task-relevant information.
- **Long-Term Memory (LTM)**: Unlimited capacity, slow decay, consolidated through importance and repetition.

### 2. Forgetting Curve (Ebbinghaus, 1885)
Memory strength decays exponentially over time without reinforcement:
$$S(t) = S_0 e^{-\lambda t}$$
Where $S(t)$ is the strength at time $t$, $S_0$ is the initial strength, and $\lambda$ is the decay rate.

### 3. Working Memory Capacity (Miller, 1956)
Humans can hold approximately **7 ± 2 items** in working memory. True-Memory respects this limit to prevent "context bloat" and ensure the LLM focuses on the most relevant information.

---

## The True-Memory Algorithm: The 5 Pillars

True-Memory improves upon traditional implementations by addressing five critical flaws in AI memory systems:

### 1. Selective Decay (Episodic vs. Semantic)
**The Problem**: Traditional systems apply time-based decay to everything. If you don't mention a critical project constraint for a week, the AI forgets it.
**The Fix**: We decouple **Episodic Memory** (temporary observations like "Yesterday we struggled with auth") from **Semantic Memory** (permanent facts like "This project uses strict TypeScript"). Episodic memory decays exponentially, while Semantic memory is permanent until explicitly revoked or updated.

### 2. Semantic Vector Embeddings
**The Problem**: Keyword-based matching (Jaccard Similarity) is brittle. "The database is broken" and "Postgres keeps crashing" have zero word overlap but mean the same thing.
**The Fix**: We use **dense vector embeddings** (via Transformers.js) and **Cosine Similarity**. This allows the system to understand the *meaning* of your conversations, catching semantic overlaps that keywords would miss.

### 3. Contextual Retrieval (Stage 3)
**The Problem**: Injecting all stored memories into every session bloats the context window and causes hallucinations.
**The Fix**: We implement **Stage 3: Contextual Retrieval**. The system embeds your current prompt and performs a nearest-neighbor vector search. Only the **top-k** most relevant memories are injected, keeping the context lean and focused.

### 4. Non-Blocking Async Extraction
**The Problem**: Processing memory after every message can double latency and block the UI.
**The Fix**: True-Memory runs extraction as an **asynchronous background queue** with **500ms debounce**. The agent responds to you immediately, while a background process handles the scoring and storage without any perceptible lag.

### 5. Intelligent Reconsolidation
**The Problem**: Automatically overwriting memories based on partial similarity is destructive.
**The Fix**: When high semantic similarity is detected, the system uses a **reconsolidation heuristic** to determine if the new information *conflicts* with, *complements*, or *duplicates* existing memory, ensuring nuanced updates instead of blind overwrites.

---

## The 3-Stage Pipeline

1.  **Stage 1: Context Sweep**: Uses multilingual patterns (15 languages including full Italian support) and structural analysis (typography, repetition) to identify candidate memories.
2.  **Stage 2: Selective Memory**: Scores candidates using a **7-feature model** (Recency, Frequency, Importance, Utility, Novelty, Confidence, Interference) with a **four-layer defense system**:
    - Layer 1: Negative Patterns (filter out known false positives)
    - Layer 2: Multi-Keyword Scoring (require 2+ signals)
    - Layer 3: Confidence Threshold (store only if score ≥ 0.6)
    - Layer 4: Role Validation (Human-only for user-level classifications)
3.  **Stage 3: Contextual Retrieval**: Performs semantic search against the database to inject only the most relevant context for your current task.

### Role-Aware Extraction

True-Memory distinguishes between Human and Assistant messages to improve accuracy:

- **Human Messages**: Receive a 10x weight multiplier for intent signals, ensuring user preferences and decisions are prioritized.
- **Role Validation**: User-level classifications (preference, constraint, learning, procedural) MUST originate from Human messages.
- **Assistant Context**: Assistant messages provide supporting context but are not primary sources for user-level memories.
- **Assistant List Detection**: Automatically filters out AI-generated lists that rephrase user preferences.

This prevents false positives from Assistant-generated content while preserving the contextual value of AI responses.

### Multilingual Precision

True-Memory supports **15 languages** for memory extraction, with comprehensive support for **Italian** including:

- **Explicit Intent Patterns**: `ricorda questo`, `ricordati che`, `ricorda che`, `memorizza questo`, `memorizza che`, `memorizziamo`, `ricordiamoci che`, `ricordiamoci di`, `tieni a mente`, `nota che`
- **Classification Keywords**: Full Italian keyword support across all memory types (preference, constraint, decision, learning, bugfix, procedural)

This ensures that users can express preferences, constraints, and decisions naturally in Italian, and the system will correctly classify and store them.

---

## Memory Classifications

| Type | Decay | Default Store | Scope | Example |
| :--- | :--- | :--- | :--- | :--- |
| **constraint** | Never | STM | User (Global) | "Never use `var`" |
| **preference** | Never | STM | User (Global) | "Prefers functional style" |
| **learning** | Never | LTM (auto) | User (Global) | "Learned bun:sqlite API" |
| **decision** | Never | LTM (auto) | Project (Local) | "Decided SQLite over Postgres" |
| **bugfix** | Never | LTM (auto) | Project (Local) | "Fixed null pointer in auth" |
| **episodic** | Yes (7 days) | STM | Project (Local) | "Yesterday we refactored auth" |

---

## Getting Started

### Installation
Add the plugin to your `opencode.jsonc` configuration:

```json
{
  "plugin": [
    "true-memory"
  ]
}
```

For local development, you can point directly to your build directory:
```json
{
  "plugin": [
    "file:///path/to/true-memory"
  ]
}
```

### Basic Commands
```bash
# View debug logs
tail -f ~/.true-memory/plugin-debug.log

# Inspect memory database
sqlite3 ~/.true-memory/memory.db "SELECT classification, summary FROM memory_units WHERE status = 'active';"

# View session history
sqlite3 ~/.true-memory/memory.db "SELECT id, project, started_at, status FROM sessions;"

# Check raw events for audit trail
sqlite3 ~/.true-memory/memory.db "SELECT hook_type, timestamp FROM events ORDER BY timestamp DESC LIMIT 10;"
```

---

## Privacy & Performance
- **Local Processing**: All embeddings and memory extraction happen locally using Transformers.js. Your code and memories never leave your machine.
- **Lean Bundle**: Optimized build (~81KB) with lazy-loading to ensure zero impact on OpenCode startup time.
- **Resource Management**: Automatic idle timeout for the embedding pipeline to keep memory usage low.

---

## Acknowledgments
True-Memory is inspired by and builds upon the pioneering work of **PsychMem v1.0.5**. We are grateful for their contribution to the AI coding assistant ecosystem.
