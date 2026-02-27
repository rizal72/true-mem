# True-Mem

> A persistent memory plugin for OpenCode with cognitive psychology-based memory management.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Noise Filtering](#noise-filtering)
- [Installation](#installation)
- [Usage](#usage)
- [Architecture](#architecture)
- [Memory Classifications](#memory-classifications)
- [Technical Details](#technical-details)
- [Contributing](#contributing)
- [Debug](#debug)

---

## Overview

**True-Mem** is a memory plugin for OpenCode that enables AI coding agents to remember information across sessions and projects. It doesn't just store information - it manages memory like a human mind would.

---

## The Problem

If you've ever had to repeat your preferences to your AI assistant every time you start a new session, you know the pain. "I prefer TypeScript over JavaScript", "Never use `var`", "Always run tests before committing" - things you've already said, but the AI forgot.

---

## The Solution

True-Mem automatically extracts and stores memories from your conversations:

- **Preferences**: "I prefer functional style over OOP"
- **Constraints**: "Never use `var` keyword"
- **Decisions**: "We decided to use SQLite instead of Postgres for this project"
- **Bugfixes**: "Fixed the auth timeout issue"
- **Learning**: "Learned that bun:sqlite is built-in"

Next time you open OpenCode, it remembers. No more repeating yourself.

---

## The Psychology Behind It

What makes True-Mem different from a simple database? It's modeled after how human memory actually works:

**Ebbinghaus Forgetting Curve** - Episodic memories fade over time (7-day default), while preferences and decisions stay permanent. Just like your brain forgets what you had for lunch last Tuesday but remembers your favorite color.

**7-Feature Scoring Model** - Every memory is scored using Recency, Frequency, Importance, Utility, Novelty, Confidence, and Interference. This determines which memories surface when you need them.

**Dual-Store Architecture (STM/LTM)** - Short-term and long-term memory stores with automatic promotion. High-strength memories get promoted to LTM; weak ones stay in STM or decay.

**Four-Layer Defense System** - Prevents false positives with Question Detection (filters questions before classification), Negative Pattern filtering (including AI meta-talk detection), Multi-Keyword Scoring with sentence-level isolation, Confidence Thresholds, and Role Validation (only Human messages for user-level preferences).

**Reconsolidation** - When new information conflicts with existing memories, the system detects similarity and handles it intelligently (merge duplicates, keep both complements, or resolve conflicts).

**Jaccard Similarity Search** - Fast, lightweight semantic retrieval without heavy ML dependencies.

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Dual-Scope Memory** | Global (follows you across projects) + Project-specific |
| **Non-Blocking** | Async extraction, no UI freezes or QUEUED states |
| **Multilingual** | Full support for Italian, Spanish, French, German, and 11 more languages |
| **Smart Decay** | Only episodic memories fade; preferences and decisions stay forever |
| **Zero Native Dependencies** | Works on Bun and Node 22+ with built-in SQLite |
| **Multilingual** | Full support for Italian, Spanish, French, German, and 11 more languages |

---

## Noise Filtering

What truly sets True-Mem apart is its ability to distinguish **signal from noise**. Unlike simpler memory plugins that store everything matching a keyword, True-Mem understands context and intent:

**What gets filtered OUT:**

| Pattern Type | Example | Why filtered |
|--------------|---------|--------------|
| Questions | "Do you remember this?" | It's a question, not a statement |
| 1st person recall | "I remember when we fixed that" | Recounting, not requesting storage |
| Remind-me recall | "Remind me how we did this" | Asking AI to recall info, not store |
| AI meta-talk | "Goal: The user is trying to..." | AI-generated, not user content |
| List selections | "I prefer option 3" | Context-specific choice, not general preference |

**What gets stored:**

| Pattern Type | Example | Why stored |
|--------------|---------|------------|
| Imperatives | "Remember this: always run tests" | Explicit storage request |
| Preferences | "I prefer TypeScript over JavaScript" | General, reusable preference |
| Decisions | "We decided to use SQLite" | Project-level decision |
| Constraints | "Never use var keyword" | Permanent rule |

All filtering patterns support **10 languages**: English, Italian, Spanish, French, German, Portuguese, Dutch, Polish, Turkish, and Russian.

---

## Installation

Add to your `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugin": [
    "true-mem"
  ]
}
```

OpenCode will automatically download the plugin from npm.

A `~/.true-mem/` directory will be created to store the SQLite database and debug logs.

After restarting OpenCode, you'll see a toast notification in the top-right corner confirming the plugin is loaded:

```
True-Mem vX.X.X
Memory active.
```

This confirms True-Mem is installed and working correctly.

---

## Usage

### Automatic Extraction

Just have conversations with OpenCode. True-Mem extracts relevant info in the background.

**What gets stored**:
- User preferences: "I prefer TypeScript over JavaScript"
- Constraints: "Never use var keyword"
- Decisions: "We decided to use SQLite instead of Postgres"
- Bugfixes: "Fixed null pointer in auth module"
- Learning: "I learned that bun:sqlite is built-in"

### List Injected Memories

To see which memories are currently injected in your prompt, use:

```
list-memories
```

This command displays all memories (LTM and STM) that True-Mem has injected into the current conversation context. Useful for debugging or understanding what the AI remembers about you.

### Explicit Memory Storage

Use phrases like "Remember this:" or "Remember that ..." to force storage:

```
"Remember this: never commit without running tests first"
"Remember that I prefer to use TypeScript in my projects"
```

**Scope Behavior**:

By default, explicit intent memories are stored at **project scope** (only visible in the current project). To make them **global** (available in all projects), include a global scope keyword anywhere in your phrase:

| Language | Global Scope Keywords |
|----------|---------------------|
| **English** | "always", "everywhere", "for all projects", "in every project", "globally" |
| **Italian** | "sempre", "ovunque", "per tutti i progetti", "in ogni progetto", "globalmente" |
| **Spanish** | "siempre", "en todas partes", "para todos los proyectos" |
| **French** | "toujours", "partout", "pour tous les projets" |
| **German** | "immer", "überall", "für alle projekte" |
| **Portuguese** | "sempre", "em todos os projetos" |

**Examples**:

| Memory | Scope | Phrase |
|---------|---------|---------|
| **Project** | `project_scope = current_project` | "Remember that we use REST for the API" |
| **Global** | `project_scope = null` | "Remember to _always_ run tests before committing" |
| **Global** | `project_scope = null` | "Remember that I _always_ use Typescript _in every project_" |

---

## Architecture

```
true-mem/
├── src/
│   ├── index.ts                 # Entry point with fire-and-forget init
│   ├── storage/
│   │   ├── sqlite-adapter.ts    # bun:sqlite + node:sqlite runtime adapter
│   │   └── database.ts          # MemoryDatabase class
│   ├── memory/
│   │   ├── patterns.ts          # Multilingual patterns (15 languages)
│   │   ├── negative-patterns.ts # False positive prevention
│   │   ├── role-patterns.ts     # Role-aware extraction (Human vs Assistant)
│   │   ├── classifier.ts        # Four-layer defense + role validation
│   │   ├── embeddings.ts        # Jaccard similarity
│   │   └── reconsolidate.ts     # Conflict resolution
│   ├── extraction/
│   │   └── queue.ts             # Fire-and-forget extraction queue
│   └── adapters/
│       └── opencode/
│           └── index.ts         # Full extraction + injection
└── dist/
    └── index.js                 # Bundle (~92KB)
```

---

## Memory Classifications

| Type | Decay | Store | Scope | Example |
|------|-------|-------|-------|---------|
| **constraint** | Never | STM | Global | "Never use `var`" |
| **preference** | Never | STM | Global | "Prefers functional style" |
| **learning** | Never | LTM | Global | "Learned bun:sqlite API" |
| **procedural** | Never | STM | Global | "Run tests before commit" |
| **decision** | Never | LTM | Project | "Decided SQLite over Postgres" |
| **bugfix** | Never | LTM | Project | "Fixed null pointer in auth" |
| **semantic** | Never | STM | Project | "API uses REST, not GraphQL" |
| **episodic** | Yes (7d) | STM | Project | "Yesterday we refactored auth" |

---

## Technical Details

### 7-Feature Scoring Model

| Feature | Weight | Description |
|---------|--------|-------------|
| Recency | 0.20 | Time since creation (0 = recent, 1 = old) |
| Frequency | 0.15 | Number of accesses (log scale) |
| Importance | 0.25 | Combination of signals (diminishing returns) |
| Utility | 0.20 | Usefulness for current task |
| Novelty | 0.10 | Distance from existing memories |
| Confidence | 0.10 | Consensus of extraction evidence |
| Interference | -0.10 | Penalty for conflicts |

**Strength Formula**: `Strength = Sum(weight_i * feature_i)` clamped to [0, 1]

### Four-Layer False Positive Prevention

| Layer | Purpose |
|-------|---------|
| 1. Question Detection | Filter questions before classification |
| 2. Negative Patterns | AI meta-talk, list selections, 1st person recall, remind-me recall (10 languages) |
| 3. Multi-Keyword + Sentence-Level | Require 2+ signals in the same sentence |
| 4. Confidence Threshold | Store only if score >= 0.6 |

### Decay Strategy

- **Episodic memories**: Decay using Ebbinghaus formula (lambda = 0.05 STM, 0.01 LTM)
- **All other types**: Permanent (no decay)

---

## Inspiration

This project was inspired by [PsychMem](https://github.com/muratg98/psychmem) - a pioneering plugin for persistent memory in OpenCode. True-Mem builds on those ideas with a focus on cognitive psychology models and production stability.

---

## Contributing

Want to contribute or test your own changes? Here's how:

1. **Fork this repository**

2. **Build the plugin**
   ```bash
   cd true-mem
   bun install
   bun run build
   ```

3. **Use your local version** in `~/.config/opencode/opencode.json`:
   ```json
   {
     "plugin": [
       "file:///path/to/your/fork/true-mem"
     ]
   }
   ```

4. **Restart OpenCode** - it will load your local build instead of the npm version.

5. **Make your changes**, rebuild with `bun run build`, and test.

6. **Submit a PR** when ready!

---

## Debug

```bash
# View logs
tail -f ~/.true-mem/plugin-debug.log

# Query database
sqlite3 ~/.true-mem/memory.db "SELECT classification, summary, strength FROM memory_units WHERE status = 'active' ORDER BY strength DESC LIMIT 10;"
```

---

**License**: MIT
**Status**: Actively maintained
