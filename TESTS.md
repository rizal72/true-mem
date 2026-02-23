# True-Memory - TESTS.md

## Test Plan

Questo documento descrive i test per verificare il funzionamento del plugin True-Memory.

---

## Test 1: Estrazione e Classificazione

Verifica che il sistema estragga e classifichi correttamente le memorie dalle conversazioni.

| Frase | Classificazione Attesa | Note |
|-------|------------------------|------|
| `Ricorda questo: preferisco sempre TypeScript a JavaScript` | **preference** | Preferenza utente (classificazione esplicita) |
| `Non posso usare var, usa sempre const o let` | **constraint** | Vincolo di codifica |
| `Oggi ho imparato che bun:sqlite è integrato e non richiede l'installazione di npm` | **learning** | Nuova conoscenza |
| `Abbiamo deciso di usare SQLite perché è leggero e non richiede configurazione` | **decision** | Decisione architetturale |

---

## Test 2: Prevenzione Falsi Positivi

Verifica che il sistema filtri correttamente i falsi positivi usando negative patterns.

| Frase | Risultato Atteso | Note |
|-------|------------------|------|
| `Il pulsante ha una larghezza fissa di 200px` | **Skipped** | Negative pattern: "larghezza fissa" |
| `Dobbiamo risolvere il DNS per questo server` | **Skipped** | Negative pattern: "risolvere il DNS" |
| `C'è un bug` | **Skipped** | Bassa confidenza, single keyword |

---

## Test 3: Ricerca Vettoriale (Retrieval Contestuale)

**⚠️ CRITICAL NOTE**: Per verificare il recupero di una memoria appena creata, è necessario AVVIARE UNA NUOVA SESSIONE (o riavviare OpenCode). L'iniezione automatica avviene solo all'inizio della sessione per evitare loop infiniti.

Verifica che il sistema recuperi le memorie pertinenti usando vector embeddings.

| Query | Memorie Attese | Note |
|-------|----------------|------|
| `Qual è la mia preferenza per lo stile di codice?` | Preference su TypeScript (Clean Summary, no "Human:" prefix) | Top-k retrieval |
| `Perché abbiamo scelto questo database?` | Decision su SQLite (Clean Summary, no role prefixes) | Retrieval semantico |

---

## Test 4: Riconsolidazione

Verifica che il sistema gestisca duplicati e conflitti usando similarity thresholds.

| Caso | Frase | Risultato Atteso | Note |
|------|-------|------------------|------|
| **Duplicato** | Ripeti la frase su TypeScript | **Merge strength**, NO nuovo record | Similarity alta (>0.90) |
| **Conflitto** | `Abbiamo deciso di usare SQLite perché è più veloce di PostgreSQL` | **Reconsolidate** con motivo aggiornato | Similarità alta ma ragione diversa |

---

## Test 5: Background Queue

Verifica che il sistema non blocchi l'UI durante l'estrazione.

| Test | Risultato Atteso | Note |
|------|------------------|------|
| Estrazione durante conversazione | **UI reattiva**, NO blocco | Fire-and-forget + debounce |
| Multiplo estrazioni contemporanee | **Queue sequenziale**, NO crash | ExtractionQueue |

---

## Note

- Tutti i test devono essere eseguiti in un ambiente OpenCode funzionante
- Verificare il log `~/.true-memory/plugin-debug.log` per eventuali errori
- Controllare il database SQLite `~/.true-memory/memory.db` per verificare le memorie memorizzate
- **Build Timestamp**: Verificare nel log di startup che il timestamp di build sia recente, per assicurarsi di usare l'ultima versione del plugin. Esempio: `[True-Memory] Build: 2026-02-23T09:00:00Z`
