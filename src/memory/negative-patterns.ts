/**
 * Negative Patterns for False Positive Prevention
 *
 * These patterns filter out common false positives before classification.
 * E.g., "resolve DNS" should NOT trigger bugfix classification.
 */

/**
 * Negation Patterns
 *
 * These patterns detect negations that invalidate memory statements.
 * Sentences containing negations should NOT be stored as memories, regardless
 * of whether they contain other memory-related keywords.
 *
 * Example: "non ho capito" contains "capito" but is negated → DON'T store
 * Example: "I don't understand" contains "understand" but is negated → DON'T store
 *
 * Rationale: Negations reverse the meaning of statements. Learning something
 * implies understanding, but "I don't understand" is the opposite.
 */
export const NEGATION_PATTERNS: RegExp[] = [
  // Italian - negation patterns
  /\bnon\s+(ho|hai|ha|abbiamo|avete|hanno)\s+(capito|capita|capisco|capisci|capisce|capiamo)\b/i,
  /\bnon\s+(è|sono|e'|erano|eravamo|fu|fui)\b/i,
  /\bnon\s+(posso|puoi|può|possiamo|potete|possono|potrei|potresti|potrebbe|potremmo)\b/i,
  /\bnon\s+(voglio|vuoi|vuole|vogliamo|volete|vogliono|vorrei|vorresti|vorrebbe|vorremmo)\b/i,
  /\bnon\s+(devo|devi|deve|dobbiamo|dovete|devono|dovrei|dovresti|dovrebbe|dovremmo)\b/i,
  /\bnon\s+(so|sai|sa|sappiamo|sapete|sanno)\b/i,
  /\bnon\s+(mi|ti|si|ci|vi)\s+(ricordo|ricordi|ricorda|ricordiamo|ricordate)\b/i,
  /\bnon\s+(funziona|funzionano|funzionava|funzionava|funzioner[aà])\b/i,
  /\bnon\s+(c'[eè]|ci\s+[eè]|c'\s+era|ci\s+era)\b/i,

  // English - negation patterns
  /\bI\s+(don'?t|do\s+not)\s+(understand|know|think|believe|remember|recall)\b/i,
  /\bI\s+(didn'?t|did\s+not)\s+(understand|know|think|believe|remember|recall|get|catch)\b/i,
  /\bI\s+(haven'?t|have\s+not)\s+(understood|known|thought|believed|remembered|recalled)\b/i,
  /\bI\s+(wouldn'?t|would\s+not)\b/i,
  /\bI\s+(couldn'?t|could\s+not)\b/i,
  /\bI\s+(shouldn'?t|should\s+not)\b/i,
  /\bit\s+(doesn'?t|does\s+not)\s+(work|function|exist)\b/i,
  /\bit\s+(didn'?t|did\s+not)\s+(work|function)\b/i,
  /\b(not|never|no)\s+(understand|know|remember|recall|believe|think)\b/i,

  // Spanish - negation patterns
  /\bno\s+(entiendo|entiende|entend[ií]|comprendo|comprende|comprend[ií])\b/i,
  /\bno\s+(puedo|puedes|puede|podemos|pod[eé]is|pueden|podr[ií]a|podr[ií]as)\b/i,
  /\bno\s+(quiero|quieres|quiere|queremos|quer[eé]is|quieren|querr[ií]a|querr[ií]as)\b/i,
  /\bno\s+(s[ée]|sabes|sabe|sabemos|sab[eé]is|saben)\b/i,
  /\bno\s+(recuerdo|recuerdas|recuerda|recordamos|record[eá]is|recuerdan)\b/i,
  /\bno\s+(funciona|funcionan|funcionaba|funcionab[aan]|funcionar[aá])\b/i,

  // French - negation patterns
  /\bje\s+ne\s+(comprends|comprend|comprendais|compris)\b/i,
  /\bje\s+ne\s+(sais|sais|savait|su)\b/i,
  /\bje\s+ne\s+(veux|veux|voulais|voulus)\b/i,
  /\bje\s+ne\s+(peux|peux|pouvais|pus)\b/i,
  /\bje\s+ne\s+(dois|dois|devais|d[uu])\b/i,
  /\bje\s+ne\s+(me\s+)?souviens\b/i,
  /\bil\s+ne\s+(fonctionne|fonctionnait|fonctionnera)\b/i,

  // German - negation patterns
  /\bich\s+(verstehe|verstand|verstanden)\s+nicht\b/i,
  /\bich\s+(wei[sß]|wusste|gewusst)\s+nicht\b/i,
  /\bich\s+(will|wollte|wollte)\s+nicht\b/i,
  /\bich\s+(kann|konnte|gekonnt)\s+nicht\b/i,
  /\bich\s+(muss|musste|gemusst)\s+nicht\b/i,
  /\bich\s+erinnere\s+(mich|nicht)\b/i,
  /\b(es|das)\s+(funktioniert|funktionierte|funktionieren)\s+nicht\b/i,

  // Portuguese - negation patterns
  /\b(eu\s+)?n[ãa]o\s+(entendo|entende|entend[ií])\b/i,
  /\b(eu\s+)?n[ãa]o\s+(sei|sabe|sabia|soube)\b/i,
  /\b(eu\s+)?n[ãa]o\s+(quero|quer|queria|quis)\b/i,
  /\b(eu\s+)?n[ãa]o\s+(posso|pode|podia|p[^o]de)\b/i,
  /\b(eu\s+)?n[ãa]o\s+(devo|deve|devia|deveu)\b/i,
  /\b(eu\s+)?n[ãa]o\s+me\s+lembro\b/i,
  /\bn[ãa]o\s+(funciona|funcionam|funcionava|funcionar[aá])\b/i,

  // Dutch - negation patterns
  /\bik\s+versta\s+(niet)\b/i,
  /\bik\s+(weet|wist|geweten)\s+(niet)\b/i,
  /\bik\s+(wil|wou|gewild)\s+(niet)\b/i,
  /\bik\s+(kan|kon|gekund)\s+(niet)\b/i,
  /\bik\s+(moet|moest|gemogen)\s+(niet)\b/i,
  /\bhet\s+(werkt|werkte|gewerkt)\s+(niet)\b/i,

  // Polish - negation patterns
  /\b(nie)\s+(rozumiem|rozumiesz|rozumie|rozumia[lł]|zrozumia[lł])\b/i,
  /\b(nie)\s+(wiem|wiesz|wie|wiedzia[lł])\b/i,
  /\b(nie)\s+(chc[eę]|chcia[lł]em|chcia[lł])\b/i,
  /\b(nie)\s+(potraf[ię]|mog[eę]|mog[lł]em|mog[lł])\b/i,
  /\b(nie)\s+(musz[eę]|musia[lł]em|musia[lł])\b/i,
  /\b(nie)\s+(dzia[lł]a|dzia[lł]a[lł])\b/i,

  // Turkish - negation patterns
  /\banlam[iı]yorum\b/i,
  /\banlamad[iı]m\b/i,
  /\bbilmiyorum\b/i,
  /\bbilmedim\b/i,
  /\bistemiyorum\b/i,
  /\bistemeden\b/i,
  /\bisteyemem\b/i,
  /\bcal[iı][şs]m[iı]yor\b/i,
];

/**
 * AI Meta-Talk Patterns
 *
 * These patterns detect AI-generated content (summaries, meta-talk, task completions)
 * that should NEVER be stored as user memories, regardless of classification.
 *
 * Rationale: In multilingual contexts, AI output is often in English while user
 * preferences are in their primary language. These patterns catch AI-generated
 * content at the source, preventing it from polluting the memory database.
 */
export const AI_META_TALK_PATTERNS: RegExp[] = [
  // AI summary prefixes
  /^(Goal|Summary|Context|Analysis|Note|Overview|Background):\s+The user/i,
  /^(Goal|Summary|Context|Analysis|Note|Overview|Background):\s+This/i,

  // Task completion markers
  /^\[.*task.*completed\]/i,
  /^\[.*completed.*\]/i,
  /^\[Background task/i,

  // AI instructional prefixes
  /^Please (analyze|create|review|implement|explain|describe|summarize)/i,
  /^Let me (analyze|create|review|implement|explain|describe)/i,
  /^I will (analyze|create|review|implement|explain|describe)/i,

  // AI self-reference patterns
  /^This (file|code|implementation|solution|approach|method)/i,
  /^The (above|following|below) (code|solution|implementation)/i,
  /^Here('s| is) (the|a)/i,

  // AI meta-commentary
  /^Based on (the|my) analysis/i,
  /^After (reviewing|analyzing|examining)/i,
  /^Looking at (the|this)/i,

  // Markdown table / pipe-separated content
  /^\|[^|]+\|[^|]+\|/i,           // Starts with table row
  /^[\s]*\|[^\n]+\|[^\n]*$/im,    // Any table row at start

  // Regex-like patterns (technical docs)
  /^[\s]*\/.*\/[gimsuvy]*\s*$/i,  // Regex pattern lines
  /\|\w+\|.*\.\.\./i,              // |important|... patterns

  // System-generated content markers
  /^\|.+\|$/i,                     // Entire line is pipe-wrapped
];

/**
 * Check if text appears to be AI-generated meta-talk
 */
export function isAIMetaTalk(text: string): boolean {
  return AI_META_TALK_PATTERNS.some(pattern => pattern.test(text.trim()));
}

/**
 * Check if text is a question (should NOT be stored as a statement)
 */
export function isQuestion(text: string): boolean {
  const trimmed = text.trim();

  // Ends with question mark
  if (trimmed.endsWith('?')) return true;

  // Italian question patterns (no question mark in casual writing)
  const questionPatterns = [
    /\b(?:cosa|come|quando|dove|perché|chi|quale|quanto)\s+(?:devo|posso|dovrei|potrei|conviene)\b/i,
    /\b(?:potrò|dovrò|posso|devo)\s+\w+/i,
  ];

  return questionPatterns.some(p => p.test(trimmed));
}

/**
 * First Person Recall Patterns
 *
 * These patterns detect when the user is recounting/recalling something
 * (1st person indicative) rather than requesting storage (imperative).
 *
 * "I remember when..." = recounting, NOT storage request
 * "Remember this!" = imperative, storage request
 */
export const FIRST_PERSON_RECALL_PATTERNS: RegExp[] = [
  // English - 1st person indicative
  /\bI\s+(remember|recall|recollect|don'?t\s+forget)\b/i,
  /\bwe\s+(remember|recall|recollect)\b/i,
  /\bI\s+can\s+remember\b/i,

  // Italian - 1st person singular "io ricordo"
  /\b(io\s+)?ricordo\b/i,
  /\bmi\s+ricordo\b/i,
  /\bho\s+ricordato\b/i,

  // Italian - 1st person plural with indicative context
  /\b(ci\s+)?ricordiamo\s+(che|di|quando|come|perch)\b/i,

  // Spanish - 1st person "yo recuerdo"
  /\b(yo\s+)?recuerdo\b/i,
  /\bme\s+acuerdo\b/i,
  /\brecordamos\b/i,

  // French - 1st person "je me souviens"
  /\bje\s+(me\s+)?souviens\b/i,
  /\bnous\s+(nous\s+)?souvenons\b/i,

  // German - 1st person "ich erinnere mich"
  /\bich\s+erinnere(\s+mich)?\b/i,
  /\bwir\s+erinnern(\s+uns)?\b/i,

  // Portuguese - 1st person "eu me lembro"
  /\b(eu\s+)?(me\s+)?lembro\b/i,
  /\bnos\s+lembramos\b/i,

  // Dutch - 1st person "ik herinner me"
  /\bik\s+herinner(\s+me)?\b/i,
  /\bwe\s+herinneren(\s+ons)?\b/i,

  // Polish - 1st person "pamiętam"
  /\bpamiętam\b/i,
  /\bpamiętamy\b/i,

  // Turkish - 1st person "hatırlıyorum"
  /\bhatırlıyorum\b/i,
  /\bhatırlıyoruz\b/i,
];

/**
 * Remind Recall Patterns
 *
 * These patterns detect when "remind me" is used to request INFORMATION
 * (recall) rather than to store something (imperative).
 *
 * "Remind me how we did this" = asking AI to recall → DON'T store
 * "Remind me to commit" = imperative to store → STORE
 *
 * Key distinction: question word vs. preposition/demonstrative after "remind me"
 */
export const REMIND_RECALL_PATTERNS: RegExp[] = [
  // English: remind me [question word]
  /\bremind\s+me\s+(how|what|when|where|why|who|which)\b/i,
  /\bremind\s+me\s+of\s+(the|what|how|when|where|why)\b/i,

  // Italian: ricordami [question word]
  /\bricordami\s+(come|cosa|quando|dove|perch[eé]|chi|quale|quanto)\b/i,
  /\bricordami\s+che\s+(cosa|tipo|ragione)\b/i,

  // Spanish: recuérdame [question word]
  /\brec[uú]rdame\s+(c[oó]mo|qu[eé]|cu[aá]ndo|d[oó]nde|por\s*qu[eé]|qui[eé]n|cu[aá]l)\b/i,

  // French: rappelle-moi [question word]
  /\brappelle[s]?\s*-?\s*moi\s+(comment|quand|o[uù]|pourquoi|qui|quel)\b/i,
  /\brappelle[s]?\s*-?\s*moi\s+ce\s+que\b/i,

  // German: erinner mich [question word]
  /\berinner\s+(mich|uns)\s+(wie|was|wann|wo|warum|wer|welche[ns]?)\b/i,

  // Portuguese: lembre-me [question word]
  /\blembre\s*-?\s*me\s+(como|quando|onde|por\s*que|quem|qual)\b/i,
  /\blembre\s*-?\s*me\s+o\s+que\b/i,

  // Dutch: herinner me [question word]
  /\bherinner\s+(me|ons)\s+(hoe|wat|wanneer|waar|waarom|wie|welke)\b/i,

  // Polish: przypomnij mi [question word]
  /\bprzypomnij\s+mi\s+(jak|co|kiedy|gdzie|dlaczego|kto|kt[oó]ry)\b/i,

  // Turkish: hatırlat bana [question word]
  /\bhat[ıi]rlat\s+(bana)\s+(nas[ıi]l|ne|ne\s+zaman|nere[dy]e|neden|kim|hangi)\b/i,
];

// Negative patterns per classification type
export const NEGATIVE_PATTERNS: Record<string, RegExp[]> = {
  bugfix: [
    // resolve (not bug-related)
    /resolve\s+(dns|ip|address|hostname|url|uri|path)/i,
    /resolve\s+(promise|async|await)/i,
    /git\s+resolve/i,
    /resolve\s+conflict(?!.*(?:bug|error|crash|fail))/i,
    /resolve\s+overlapping/i,

    // fix (not bug-related)
    /fixed\s+(width|height|position|size|length)/i,
    /fix\s+(position|layout|spacing|padding|margin)/i,
    /fixed-point/i,
    /fixed\s+asset/i,

    // handle (not error-related)
    /handle\s+(click|event|input|change|submit|hover|focus|blur)/i,
    /event\s+handler/i,
    /click\s+handler/i,
    /handler\s+function/i,

    // address (not issue-related)
    /\baddress\s+(space|bar|book|ing)\b/i,
    /ip\s+address/i,
    /mac\s+address/i,
    /email\s+address/i,
    /memory\s+address/i,

    // error (not bug-related)
    /error\s*(handling|handler|boundary)/i,
    /type\s*error/i,  // TypeScript type errors in docs
  ],

  decision: [
    /decided\s+to\s+(run|start|begin|try|test|check|verify|use)/i,
    /decision\s+(tree|matrix|making)/i,
  ],

  learning: [
    /machine\s+learning/i,
    /deep\s+learning/i,
    /learning\s+(rate|curve)/i,
  ],

  constraint: [
    /database\s+constraint/i,
    /foreign\s+key\s+constraint/i,
    /unique\s+constraint/i,
  ],

  preference: [
    // List selection patterns - "preferisco 3", "scelgo la 2", "voglio la prima"
    /\b(preferisco|scelgo|voglio|prendo|opto)\s+(?:la\s+)?[0-9]+(?:a|o)?\b/i,
    /\b(preferisco|scelgo|voglio|prendo|opto)\s+(?:la\s+)?(prima|seconda|terza|quarta|quinta|primo|secondo|terzo)\b/i,
    /\b(preferisco|scelgo|voglio|prendo|opto)\s+(?:l'|il\s+)?(?:opzione\s+)?[0-9]+\b/i,
    /\b(?:option|opzione)\s+[0-9]+\b/i,
    /\b(preferisco|scelgo|voglio)\s+[0-9]\s*[,.\n]/i,
  ],
};

/**
 * Check if text matches any negative pattern for the given classification
 * Also checks AI meta-talk patterns first (applies to all classifications)
 */
export function matchesNegativePattern(text: string, classification: string): boolean {
  // First, check if this is AI-generated meta-talk (applies to ALL classifications)
  if (isAIMetaTalk(text)) {
    return true;
  }

  // Check for negation patterns - negations invalidate memory statements
  if (NEGATION_PATTERNS.some(pattern => pattern.test(text))) {
    return true;
  }

  // Check for 1st person recall patterns (recounting, not storage request)
  if (FIRST_PERSON_RECALL_PATTERNS.some(pattern => pattern.test(text))) {
    return true;
  }

  // Check for "remind me [question word]" patterns (recall request, not storage)
  if (REMIND_RECALL_PATTERNS.some(pattern => pattern.test(text))) {
    return true;
  }

  const patterns = NEGATIVE_PATTERNS[classification];
  if (!patterns) return false;

  return patterns.some(pattern => pattern.test(text));
}

/**
 * Get matching negative patterns (for debugging)
 */
export function getMatchingNegativePatterns(text: string, classification: string): string[] {
  const matches: string[] = [];

  // Check AI meta-talk first
  if (isAIMetaTalk(text)) {
    matches.push('[AI_META_TALK]');
  }

  // Check negation patterns
  if (NEGATION_PATTERNS.some(pattern => pattern.test(text))) {
    matches.push('[NEGATION]');
    // Add specific negation pattern sources
    matches.push(
      ...NEGATION_PATTERNS
        .filter(pattern => pattern.test(text))
        .map(p => p.source)
    );
  }

  // Check 1st person recall patterns
  if (FIRST_PERSON_RECALL_PATTERNS.some(pattern => pattern.test(text))) {
    matches.push('[FIRST_PERSON_RECALL]');
  }

  // Check "remind me [question word]" patterns
  if (REMIND_RECALL_PATTERNS.some(pattern => pattern.test(text))) {
    matches.push('[REMIND_RECALL]');
  }

  const patterns = NEGATIVE_PATTERNS[classification];
  if (patterns) {
    matches.push(
      ...patterns
        .filter(pattern => pattern.test(text))
        .map(p => p.source)
    );
  }

  return matches;
}
