# True-Mem

> A persistent memory plugin for OpenCode with cognitive psychology-based memory management.

---

## Table of Contents

- [Overview](#overview)
- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [The Psychology Behind It](#the-psychology-behind-it)
- [Key Features](#key-features)
- [Installation](#installation)
- [Usage](#usage)
- [Architecture](#architecture)
- [Memory Classifications](#memory-classifications)
- [Technical Details](#technical-details)
- [Inspiration](#inspiration)
- [Debug](#debug)

---

## Overview

**True-Mem** is a production-ready memory plugin for OpenCode that enables AI coding agents to remember information across sessions and projects. It doesn't just store information - it manages memory like a human mind would.

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

**Four-Layer Defense System** - Prevents false positives with Negative Pattern filtering (including AI meta-talk detection), Multi-Keyword Scoring, Confidence Thresholds, and Role Validation (only Human messages for user-level preferences).

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
| **Production-Ready** | Tested and stable |

---

## Installation

```bash
npm install true-mem
```

Then add to your `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugin": [
    "true-mem"
  ]
}
```

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

### Explicit Memory Storage

Use phrases like "Remember this:" or "Ricorda questo:" to force storage:

```
"Ricorda questo: preferisco sempre usare TypeScript per i miei progetti"
"Remember this: never commit without running tests first"
```

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
| 1. Negative Patterns | Filter known false positives |
| 2. Multi-Keyword Scoring | Require 2+ signals |
| 3. Confidence Threshold | Store only if score >= 0.6 |
| 4. Role Validation | Human-only for user-level memories |

### Decay Strategy

- **Episodic memories**: Decay using Ebbinghaus formula (lambda = 0.05 STM, 0.01 LTM)
- **All other types**: Permanent (no decay)

---

## Inspiration

This project was inspired by [PsychMem](https://github.com/muratg98/psychmem) - a pioneering plugin for persistent memory in OpenCode. True-Mem builds on those ideas with a focus on cognitive psychology models and production stability.

---

## Debug

```bash
# View logs
tail -f ~/.true-mem/plugin-debug.log

# Query database
sqlite3 ~/.true-mem/memory.db "SELECT classification, summary, strength FROM memory_units WHERE status = 'active' ORDER BY strength DESC LIMIT 10;"
```

---

**Version**: 1.0.0  
**License**: MIT  
**Status**: Production-ready, actively maintained
