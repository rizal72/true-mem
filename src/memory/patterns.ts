/**
 * Multilingual Importance Pattern Dictionaries
 * 
 * Patterns for detecting importance signals across 15 languages:
 * English, Spanish, French, German, Portuguese, Japanese, Chinese, Korean,
 * Russian, Arabic, Hindi, Italian, Dutch, Turkish, Polish
 * 
 * For Latin scripts: compiled to single \b-bounded regex per category
 * For CJK/Arabic/Hindi: matched via string.includes() since \b doesn't work
 */

import type { ImportanceSignal, ImportanceSignalType } from '../types.js';
import * as os from 'os';

// =============================================================================
// Pattern Category Types
// =============================================================================

export interface PatternCategory {
  signalType: ImportanceSignalType;
  weight: number;
  /** Latin-script keywords (compiled to regex with \b word boundaries) */
  latin: string[];
  /** Non-Latin keywords (matched via string.includes) */
  nonLatin: string[];
  /** Compiled regex for Latin keywords (cached after first use) */
  compiledRegex?: RegExp;
}

// =============================================================================
// Pattern Categories
// =============================================================================

/**
 * Explicit remember signals - user explicitly asks to remember something
 * Weight: 0.9 (highest - direct user intent)
 */
export const EXPLICIT_REMEMBER: PatternCategory = {
  signalType: 'explicit_remember',
  weight: 0.9,
  latin: [
    // English
    'remember this', 'don\'t forget', 'keep in mind', 'note that', 'important to remember',
    'make sure to remember', 'never forget', 'always remember',
    // Spanish
    'recuerda esto', 'no olvides', 'ten en cuenta', 'nota que', 'importante recordar',
    // French
    'souviens-toi', 'n\'oublie pas', 'garde en tête', 'note que', 'retiens',
    // German
    'merk dir', 'vergiss nicht', 'beachte', 'denk daran', 'wichtig zu merken',
    // Portuguese
    'lembre-se', 'não esqueça', 'tenha em mente', 'note que', 'importante lembrar',
    // Italian
    'ricorda questo', 'ricordati che', 'ricordami che', 'non dimenticare', 'tieni a mente', 'nota che', 'memorizza questo', 'memorizza che', 'memorizziamo', 'ricordiamoci che', 'ricordiamoci di',
    // Dutch
    'onthoud dit', 'vergeet niet', 'houd in gedachten', 'let op',
    // Turkish
    'bunu unutma', 'aklında tut', 'dikkat et', 'not et',
    // Polish
    'zapamiętaj to', 'nie zapomnij', 'pamiętaj że', 'zwróć uwagę',
    // Russian (transliterated)
    'zapomni eto', 'ne zabud',
  ],
  nonLatin: [
    // Japanese
    '覚えておいて', '忘れないで', '覚えて', 'メモして', '重要なこと',
    // Chinese (Simplified)
    '记住这个', '不要忘记', '请记住', '重要的是', '注意',
    // Chinese (Traditional)
    '記住這個', '不要忘記', '請記住',
    // Korean
    '기억해', '잊지마', '명심해', '메모해',
    // Russian
    'запомни это', 'не забудь', 'имей в виду', 'обрати внимание',
    // Arabic
    'تذكر هذا', 'لا تنسى', 'ضع في اعتبارك',
    // Hindi
    'याद रखो', 'मत भूलो', 'ध्यान रखें',
  ],
};

/**
 * Emphasis cue signals - words indicating importance/emphasis
 * Weight: 0.8
 */
export const EMPHASIS_CUE: PatternCategory = {
  signalType: 'emphasis_cue',
  weight: 0.8,
  latin: [
    // English
    'always', 'never', 'must', 'critical', 'essential', 'crucial', 'vital',
    'extremely important', 'absolutely', 'definitely', 'certainly',
    // Spanish
    'siempre', 'nunca', 'debe', 'crítico', 'esencial', 'crucial', 'vital',
    'absolutamente', 'definitivamente',
    // French
    'toujours', 'jamais', 'doit', 'critique', 'essentiel', 'crucial',
    'absolument', 'certainement',
    // German
    'immer', 'niemals', 'muss', 'kritisch', 'wesentlich', 'entscheidend',
    'unbedingt', 'definitiv',
    // Portuguese
    'sempre', 'nunca', 'deve', 'crítico', 'essencial', 'crucial',
    'absolutamente', 'definitivamente',
    // Italian
    'sempre', 'mai', 'deve', 'critico', 'essenziale', 'cruciale',
    'assolutamente', 'certamente',
    // Dutch
    'altijd', 'nooit', 'moet', 'kritiek', 'essentieel', 'cruciaal',
    'absoluut', 'zeker',
    // Turkish
    'her zaman', 'asla', 'mutlaka', 'kritik', 'temel', 'kesinlikle',
    // Polish
    'zawsze', 'nigdy', 'musi', 'krytyczny', 'niezbędny', 'kluczowy',
    'absolutnie', 'zdecydowanie',
  ],
  nonLatin: [
    // Japanese
    '必ず', '絶対に', '常に', '決して', '重要', '必須', '不可欠',
    // Chinese
    '必须', '一定要', '总是', '从不', '关键', '重要', '绝对',
    '必須', '一定要', '總是', '從不', '關鍵', '重要', '絕對',
    // Korean
    '항상', '절대', '반드시', '필수', '중요한', '결정적인',
    // Russian
    'всегда', 'никогда', 'должен', 'критично', 'важно', 'обязательно',
    // Arabic
    'دائما', 'أبدا', 'يجب', 'حرج', 'أساسي', 'بالتأكيد',
    // Hindi
    'हमेशा', 'कभी नहीं', 'ज़रूरी', 'महत्वपूर्ण', 'अनिवार्य',
  ],
};

/**
 * Correction signals - user correcting themselves or the AI
 * Weight: 0.7
 */
export const CORRECTION: PatternCategory = {
  signalType: 'correction',
  weight: 0.7,
  latin: [
    // English
    'actually', 'wait', 'no,', 'correction', 'wrong', 'mistake', 'oops',
    'sorry, I meant', 'let me correct', 'that\'s not right', 'I was wrong',
    'my bad', 'scratch that', 'disregard',
    // Spanish
    'en realidad', 'espera', 'no,', 'corrección', 'incorrecto', 'error',
    'perdón, quise decir', 'me equivoqué',
    // French
    'en fait', 'attends', 'non,', 'correction', 'faux', 'erreur',
    'pardon, je voulais dire', 'je me suis trompé',
    // German
    'eigentlich', 'warte', 'nein,', 'korrektur', 'falsch', 'fehler',
    'ich meinte', 'das war falsch',
    // Portuguese
    'na verdade', 'espera', 'não,', 'correção', 'errado', 'erro',
    'desculpa, quis dizer', 'me enganei',
    // Italian
    'in realtà', 'aspetta', 'no,', 'correzione', 'sbagliato', 'errore',
    'scusa, intendevo', 'mi sono sbagliato',
    // Dutch
    'eigenlijk', 'wacht', 'nee,', 'correctie', 'fout', 'vergissing',
    'ik bedoelde',
    // Turkish
    'aslında', 'bekle', 'hayır,', 'düzeltme', 'yanlış', 'hata',
    // Polish
    'właściwie', 'czekaj', 'nie,', 'korekta', 'błąd', 'pomyłka',
    'miałem na myśli',
  ],
  nonLatin: [
    // Japanese
    '実は', 'ちょっと待って', '違う', '訂正', '間違い', 'ごめん',
    // Chinese
    '其实', '等一下', '不对', '更正', '错了', '抱歉',
    '其實', '等一下', '不對', '更正', '錯了',
    // Korean
    '사실', '잠깐', '아니', '수정', '틀렸어', '죄송',
    // Russian
    'на самом деле', 'подожди', 'нет,', 'исправление', 'ошибка', 'неправильно',
    // Arabic
    'في الواقع', 'انتظر', 'لا،', 'تصحيح', 'خطأ',
    // Hindi
    'असल में', 'रुको', 'नहीं,', 'सुधार', 'गलती', 'माफ करें',
  ],
};

/**
 * Preference signals - user expressing preferences
 * Weight: 0.6
 */
export const PREFERENCE: PatternCategory = {
  signalType: 'preference',
  weight: 0.6,
  latin: [
    // English
    'prefer', 'like', 'want', 'don\'t like', 'hate', 'avoid',
    'I\'d rather', 'better if', 'instead of', 'rather than',
    // Spanish
    'prefiero', 'me gusta', 'quiero', 'no me gusta', 'odio', 'evitar',
    'preferiría', 'mejor si',
    // French
    'je préfère', 'j\'aime', 'je veux', 'je n\'aime pas', 'je déteste', 'éviter',
    'plutôt', 'mieux si',
    // German
    'bevorzuge', 'mag', 'will', 'mag nicht', 'hasse', 'vermeiden',
    'lieber', 'besser wenn',
    // Portuguese
    'prefiro', 'gosto', 'quero', 'não gosto', 'odeio', 'evitar',
    'preferiria', 'melhor se',
    // Italian
    'preferisco', 'mi piace', 'voglio', 'non mi piace', 'odio', 'evitare',
    'piuttosto', 'meglio se',
    // Dutch
    'ik geef de voorkeur', 'ik hou van', 'ik wil', 'ik haat', 'vermijden',
    'liever', 'beter als',
    // Turkish
    'tercih ederim', 'seviyorum', 'istiyorum', 'sevmiyorum', 'nefret', 'kaçınmak',
    // Polish
    'wolę', 'lubię', 'chcę', 'nie lubię', 'nienawidzę', 'unikać',
    'lepiej gdyby',
  ],
  nonLatin: [
    // Japanese
    '好き', '嫌い', '欲しい', '避けたい', 'の方がいい', '好み',
    // Chinese
    '喜欢', '不喜欢', '想要', '讨厌', '避免', '偏好', '宁愿',
    '喜歡', '不喜歡', '想要', '討厭', '避免', '偏好', '寧願',
    // Korean
    '좋아해', '싫어해', '원해', '피하고 싶어', '선호해',
    // Russian
    'предпочитаю', 'нравится', 'хочу', 'не нравится', 'ненавижу', 'избегать',
    // Arabic
    'أفضل', 'أحب', 'أريد', 'لا أحب', 'أكره', 'تجنب',
    // Hindi
    'पसंद', 'नापसंद', 'चाहिए', 'नफरत', 'बचना',
  ],
};

/**
 * Decision signals - decisions being made
 * Weight: 0.7
 */
export const DECISION: PatternCategory = {
  signalType: 'decision',
  weight: 0.7,
  latin: [
    // English
    'decided', 'decision', 'chose', 'going with', 'let\'s use', 'we\'ll use',
    'we decided', 'the plan is', 'settled on', 'final choice',
    // Spanish
    'decidí', 'decisión', 'elegí', 'vamos con', 'usaremos', 'el plan es',
    // French
    'décidé', 'décision', 'choisi', 'on va utiliser', 'le plan est',
    // German
    'entschieden', 'entscheidung', 'gewählt', 'wir nehmen', 'der plan ist',
    // Portuguese
    'decidi', 'decisão', 'escolhi', 'vamos usar', 'o plano é',
    // Italian
    'deciso', 'decisione', 'scelto', 'useremo', 'il piano è',
    // Dutch
    'besloten', 'beslissing', 'gekozen', 'we gebruiken', 'het plan is',
    // Turkish
    'karar verdim', 'karar', 'seçtim', 'kullanacağız', 'plan şu',
    // Polish
    'zdecydowałem', 'decyzja', 'wybrałem', 'użyjemy', 'plan jest',
  ],
  nonLatin: [
    // Japanese
    '決めた', '決定', '選んだ', 'にする', '使うことにした', '計画は',
    // Chinese
    '决定了', '选择了', '我们用', '计划是', '最终选择',
    '決定了', '選擇了', '我們用', '計劃是',
    // Korean
    '결정했어', '선택했어', '사용하기로', '계획은',
    // Russian
    'решил', 'решение', 'выбрал', 'будем использовать', 'план',
    // Arabic
    'قررت', 'قرار', 'اخترت', 'سنستخدم', 'الخطة',
    // Hindi
    'तय किया', 'फैसला', 'चुना', 'इस्तेमाल करेंगे', 'योजना है',
  ],
};

/**
 * Constraint signals - rules and limitations
 * Weight: 0.7
 */
export const CONSTRAINT: PatternCategory = {
  signalType: 'constraint',
  weight: 0.7,
  latin: [
    // English
    'can\'t', 'cannot', 'shouldn\'t', 'must not', 'forbidden', 'not allowed',
    'don\'t ever', 'never do', 'off limits', 'prohibited', 'restricted',
    // Spanish
    'no puedo', 'no puede', 'no debería', 'prohibido', 'no permitido',
    'nunca hagas', 'restringido',
    // French
    'ne peut pas', 'ne doit pas', 'interdit', 'pas autorisé', 'jamais faire',
    // German
    'kann nicht', 'darf nicht', 'verboten', 'nicht erlaubt', 'niemals',
    // Portuguese
    'não pode', 'não deve', 'proibido', 'não permitido', 'nunca faça',
    // Italian
    'non può', 'non deve', 'vietato', 'non permesso', 'mai fare',
    // Dutch
    'kan niet', 'mag niet', 'verboden', 'niet toegestaan', 'nooit doen',
    // Turkish
    'yapamam', 'yapmamalı', 'yasak', 'izin verilmiyor', 'asla yapma',
    // Polish
    'nie może', 'nie wolno', 'zabronione', 'niedozwolone', 'nigdy nie rób',
  ],
  nonLatin: [
    // Japanese
    'できない', 'してはいけない', '禁止', '許可されていない', '絶対にしない',
    // Chinese
    '不能', '不可以', '禁止', '不允许', '绝不要',
    '不能', '不可以', '禁止', '不允許', '絕不要',
    // Korean
    '할 수 없어', '하면 안 돼', '금지', '허용되지 않아',
    // Russian
    'нельзя', 'не может', 'запрещено', 'не разрешено', 'никогда не делай',
    // Arabic
    'لا يمكن', 'لا يجب', 'ممنوع', 'غير مسموح',
    // Hindi
    'नहीं कर सकते', 'नहीं करना चाहिए', 'मना है', 'अनुमति नहीं',
  ],
};

/**
 * Bug/error signals - errors and issues
 * Weight: 0.8
 */
export const BUG_FIX: PatternCategory = {
  signalType: 'bug_fix',
  weight: 0.8,
  latin: [
    // English
    'bug', 'error', 'exception', 'crash', 'fail', 'broken', 'issue',
    'fix', 'fixed', 'resolved', 'solved', 'patched', 'workaround',
    'TypeError', 'ReferenceError', 'SyntaxError', 'null', 'undefined',
    'stack trace', 'traceback', 'segfault', 'memory leak',
    // Spanish
    'error', 'excepción', 'fallo', 'roto', 'problema', 'arreglado', 'solucionado',
    // French
    'erreur', 'exception', 'plantage', 'cassé', 'problème', 'corrigé', 'résolu',
    // German
    'fehler', 'ausnahme', 'absturz', 'kaputt', 'problem', 'behoben', 'gelöst',
    // Portuguese
    'erro', 'exceção', 'falha', 'quebrado', 'problema', 'corrigido', 'resolvido',
    // Italian
    'errore', 'eccezione', 'crash', 'rotto', 'problema', 'risolto', 'corretto',
    // Dutch
    'fout', 'uitzondering', 'crash', 'kapot', 'probleem', 'opgelost', 'gerepareerd',
    // Turkish
    'hata', 'istisna', 'çökme', 'bozuk', 'sorun', 'düzeltildi', 'çözüldü',
    // Polish
    'błąd', 'wyjątek', 'awaria', 'zepsuty', 'problem', 'naprawiono', 'rozwiązano',
  ],
  nonLatin: [
    // Japanese
    'バグ', 'エラー', '例外', 'クラッシュ', '失敗', '壊れた', '問題',
    '修正', '解決', 'ワークアラウンド',
    // Chinese
    '错误', '异常', '崩溃', '失败', '问题', '修复', '解决',
    '錯誤', '異常', '崩潰', '失敗', '問題', '修復', '解決',
    // Korean
    '버그', '오류', '예외', '크래시', '실패', '문제', '수정됨', '해결됨',
    // Russian
    'ошибка', 'исключение', 'сбой', 'сломано', 'проблема', 'исправлено', 'решено',
    // Arabic
    'خطأ', 'استثناء', 'تعطل', 'مشكلة', 'تم الإصلاح', 'تم الحل',
    // Hindi
    'त्रुटि', 'अपवाद', 'क्रैश', 'समस्या', 'ठीक किया', 'हल किया',
  ],
};

/**
 * Learning signals - discoveries and insights
 * Weight: 0.8
 */
export const LEARNING: PatternCategory = {
  signalType: 'learning',
  weight: 0.8,
  latin: [
    // English
    'learned', 'realized', 'discovered', 'found out', 'turns out',
    'TIL', 'insight', 'aha', 'gotcha', 'trick', 'tip',
    'the key is', 'the trick is', 'the solution is', 'the way to',
    'now I understand', 'I see now',
    // Spanish
    'aprendí', 'descubrí', 'resulta que', 'el truco es', 'la clave es',
    'ahora entiendo',
    // French
    'j\'ai appris', 'j\'ai découvert', 'il s\'avère', 'l\'astuce est', 'la clé est',
    'maintenant je comprends',
    // German
    'gelernt', 'entdeckt', 'herausgefunden', 'der trick ist', 'der schlüssel ist',
    'jetzt verstehe ich',
    // Portuguese
    'aprendi', 'descobri', 'percebi', 'o truque é', 'a chave é',
    'agora entendo',
    // Italian
    'ho imparato', 'ho scoperto', 'il trucco è', 'la chiave è',
    'ora capisco',
    // Dutch
    'geleerd', 'ontdekt', 'blijkt dat', 'de truc is', 'de sleutel is',
    'nu begrijp ik',
    // Turkish
    'öğrendim', 'keşfettim', 'anladım ki', 'hile şu', 'anahtar şu',
    // Polish
    'nauczyłem się', 'odkryłem', 'okazuje się', 'sztuczka to', 'klucz to',
    'teraz rozumiem',
  ],
  nonLatin: [
    // Japanese
    '学んだ', '分かった', '発見した', 'コツは', 'ポイントは', '理解した',
    // Chinese
    '学到了', '发现了', '原来', '诀窍是', '关键是', '明白了',
    '學到了', '發現了', '原來', '訣竅是', '關鍵是', '明白了',
    // Korean
    '배웠어', '알게 됐어', '발견했어', '비결은', '핵심은', '이해했어',
    // Russian
    'узнал', 'обнаружил', 'понял', 'фишка в том', 'ключ в том', 'теперь понимаю',
    // Arabic
    'تعلمت', 'اكتشفت', 'اتضح', 'الحيلة هي', 'المفتاح هو', 'الآن أفهم',
    // Hindi
    'सीखा', 'पता चला', 'समझ गया', 'तरीका है', 'कुंजी है',
  ],
};

// =============================================================================
// All Pattern Categories
// =============================================================================

export const ALL_PATTERNS: PatternCategory[] = [
  EXPLICIT_REMEMBER,
  EMPHASIS_CUE,
  CORRECTION,
  PREFERENCE,
  DECISION,
  CONSTRAINT,
  BUG_FIX,
  LEARNING,
];

// =============================================================================
// Classification Patterns (for classifyContent)
// =============================================================================

/**
 * Patterns for classifying content after importance is detected.
 * More specific than importance patterns - used to determine MemoryClassification.
 */
export const CLASSIFICATION_PATTERNS = {
  learning: {
    latin: [
      'learned', 'realized', 'discovered', 'found out', 'turns out',
      'TIL', 'insight', 'the key is', 'the trick is', 'now I understand',
    ],
    nonLatin: [
      '学んだ', '分かった', '発見',
      '学到', '发现', '明白', '學到', '發現',
      '배웠', '알게',
      'узнал', 'понял',
      'تعلمت', 'اكتشفت',
      'सीखा', 'समझ',
    ],
  },
  constraint: {
    latin: [
      'can\'t', 'cannot', 'shouldn\'t', 'must not', 'forbidden', 'not allowed',
      'never', 'must', 'prohibited', 'restricted', 'off limits',
    ],
    nonLatin: [
      'できない', 'してはいけない', '禁止',
      '不能', '不可以', '禁止', '不允许',
      '안 돼', '금지',
      'нельзя', 'запрещено',
      'ممنوع', 'لا يجب',
      'मना है', 'नहीं',
    ],
  },
  decision: {
    latin: [
      'decided', 'decision', 'chose', 'going with', 'let\'s use', 'we\'ll use',
      'settled on', 'final choice', 'the plan is',
    ],
    nonLatin: [
      '決めた', '決定', '選んだ',
      '决定', '选择', '決定', '選擇',
      '결정', '선택',
      'решил', 'выбрал',
      'قررت', 'اخترت',
      'तय किया', 'चुना',
    ],
  },
  preference: {
    latin: [
      'prefer', 'like', 'want', 'don\'t like', 'hate', 'avoid',
      'I\'d rather', 'better if',
      'preferisco', 'mi piace', 'voglio',
    ],
    nonLatin: [
      '好き', '嫌い', '好み',
      '喜欢', '不喜欢', '偏好', '喜歡', '不喜歡',
      '좋아', '싫어', '선호',
      'предпочитаю', 'нравится',
      'أفضل', 'أحب',
      'पसंद', 'नापसंद',
    ],
  },
  procedural: {
    latin: [
      'step', 'workflow', 'process', 'procedure', 'how to', 'the way to',
      'first', 'then', 'finally', 'next',
      'passo', 'processo', 'procedura', 'specifichiamo', 'definiamo', 'impostiamo',
    ],
    nonLatin: [
      'ステップ', '手順', '方法',
      '步骤', '流程', '方法', '步驟', '流程',
      '단계', '절차', '방법',
      'шаг', 'процесс', 'процедура',
      'خطوة', 'إجراء',
      'कदम', 'प्रक्रिया',
    ],
  },
};

// =============================================================================
// Pattern Matching Functions
// =============================================================================

/**
 * Compile a pattern category's Latin keywords into a single regex.
 * Caches the compiled regex on the category object.
 */
function compileLatinRegex(category: PatternCategory): RegExp {
  if (category.compiledRegex) {
    return category.compiledRegex;
  }
  
  // Escape special regex characters and join with |
  const escaped = category.latin.map(keyword =>
    keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  
  // Create case-insensitive regex with word boundaries
  category.compiledRegex = new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
  return category.compiledRegex;
}

/**
 * Check if text matches any non-Latin keyword via includes()
 */
function matchNonLatin(text: string, keywords: string[]): string | null {
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      return keyword;
    }
  }
  return null;
}

/**
 * Match text against a pattern category, returning an ImportanceSignal if matched.
 */
export function matchPattern(text: string, category: PatternCategory): ImportanceSignal | null {
  // Try Latin regex first
  if (category.latin.length > 0) {
    const regex = compileLatinRegex(category);
    const match = text.match(regex);
    if (match) {
      return {
        type: category.signalType,
        source: match[0],
        weight: category.weight,
      };
    }
  }
  
  // Try non-Latin includes
  if (category.nonLatin.length > 0) {
    const match = matchNonLatin(text, category.nonLatin);
    if (match) {
      return {
        type: category.signalType,
        source: match,
        weight: category.weight,
      };
    }
  }
  
  return null;
}

/**
 * Match text against all pattern categories, returning all matched signals.
 */
export function matchAllPatterns(text: string): ImportanceSignal[] {
  const signals: ImportanceSignal[] = [];
  
  for (const category of ALL_PATTERNS) {
    const signal = matchPattern(text, category);
    if (signal) {
      signals.push(signal);
    }
  }
  
  return signals;
}

/**
 * Classify content based on matched keywords.
 * Returns the best-matching MemoryClassification.
 */
export function classifyByPatterns(text: string): string | null {
  const lowerText = text.toLowerCase();

  // Check each classification in priority order
  const checks: Array<{ classification: string; patterns: typeof CLASSIFICATION_PATTERNS.learning }> = [
    { classification: 'learning', patterns: CLASSIFICATION_PATTERNS.learning },
    { classification: 'constraint', patterns: CLASSIFICATION_PATTERNS.constraint },
    { classification: 'decision', patterns: CLASSIFICATION_PATTERNS.decision },
    { classification: 'preference', patterns: CLASSIFICATION_PATTERNS.preference },
    { classification: 'procedural', patterns: CLASSIFICATION_PATTERNS.procedural },
  ];
  
  for (const { classification, patterns } of checks) {
    // Check Latin patterns
    for (const keyword of patterns.latin) {
      if (lowerText.includes(keyword.toLowerCase())) {
        return classification;
      }
    }
    // Check non-Latin patterns
    for (const keyword of patterns.nonLatin) {
      if (text.includes(keyword)) {
        return classification;
      }
    }
  }

  return null;
}

// =============================================================================
// Global Scope Detection
// =============================================================================

/**
 * Global scope keywords - indicate memory should apply to all projects
 * Must appear ANYWHERE in the text (not just after "ricordati")
 */
export const GLOBAL_SCOPE_KEYWORDS = {
  latin: [
    // English
    'always', 'everywhere', 'for all projects', 'in every project', 'globally',
    'in all my projects', 'across all projects', 'in all projects',
    // Italian
    'sempre', 'ovunque', 'per tutti i progetti', 'in ogni progetto', 'globalmente',
    'in tutti i miei progetti', 'in tutti i progetti', 'per ogni progetto',
    // Spanish
    'siempre', 'en todas partes', 'para todos los proyectos', 'en todos los proyectos',
    'en todos mis proyectos',
    // French
    'toujours', 'partout', 'pour tous les projets', 'dans tous les projets',
    'dans tous mes projets',
    // German
    'immer', 'uberall', 'fur alle projekte', 'in allen projekten',
    'in allen meinen projekten',
    // Portuguese
    'sempre', 'em todos os projetos', 'para todos os projetos',
    'em todos os meus projetos',
    // Dutch
    'altijd', 'overal', 'voor alle projecten',
    'in al mijn projecten',
    // Turkish
    'her zaman', 'her yerde', 'tum projelerde',
    // Polish
    'zawsze', 'wszedzie', 'dla wszystkich projektow',
    'we wszystkich moich projektach',
  ],
};

/**
 * Check if text contains global scope keywords
 */
export function hasGlobalScopeKeyword(text: string): boolean {
  const lowerText = text.toLowerCase();
  return GLOBAL_SCOPE_KEYWORDS.latin.some(keyword =>
    lowerText.includes(keyword.toLowerCase())
  );
}

// =============================================================================
// Contextual Scope Detection (NEW)
// Detects if a memory should be project-scoped based on conversation context
// =============================================================================

// Signal weights for project scope detection
const PROJECT_SIGNAL_WEIGHTS = {
  PROJECT_PATH_MENTIONED: 0.4,      // Full project path appears in conversation
  PROJECT_TERM_MATCH: 0.3,          // Each project term match
  EXPLICIT_PROJECT_CONTEXT: 0.3,    // Phrases like "in this project"
  FILE_REFERENCE: 0.1,               // Each file reference (.ts, .js, etc.)
} as const;

// Threshold for determining project scope (0-1 scale)
const PROJECT_SCOPE_THRESHOLD = 0.4;

// Stop words to filter out from project names
const PROJECT_STOP_WORDS = new Set([
  'the', 'and', 'for', 'src', 'dist', 'node', 'modules',
  'lib', 'bin', 'test', 'tests', 'docs', 'doc', 'config', 'build', 
  'public', 'app', 'core', 'utils', 'util', 'common', 'shared', 'src'
]);

export interface ConversationContext {
  recentMessages: string[];
  worktree: string;
  projectTerms: string[];
}

/**
 * Extract project-specific terms from worktree path
 * e.g., "/Users/.../oh-my-opencode-slim" → ["oh-my-opencode-slim", "opencode", "slim"]
 */
export function extractProjectTerms(worktree: string): string[] {
  // FIX: Check for home directory edge case
  const homeDir = os.homedir();
  if (worktree === homeDir || worktree === '/') {
    return []; // Home directory is not a project
  }
  
  const parts = worktree.split('/');
  const projectName = parts[parts.length - 1];
  
  if (!projectName || projectName.startsWith('unknown-project')) {
    return [];
  }
  
  // FIX: Use expanded stop words list
  return projectName
    .split(/[-_.]/)
    .map(part => part.toLowerCase())
    .filter(part => part.length > 2)
    .filter(part => !PROJECT_STOP_WORDS.has(part));
}

/**
 * Detect if conversation context indicates project-specific discussion
 * Returns score 0-1 where higher means more likely project-specific
 */
export function detectProjectSignals(context: ConversationContext): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const recentText = context.recentMessages.join(' ').toLowerCase();
  
  // FIX: Signal 1: File paths in project directory (cross-platform)
  const projectPath = context.worktree.toLowerCase();
  const homeDir = os.homedir().toLowerCase();
  // Support both full path and tilde-expanded path
  const tildePath = projectPath.replace(homeDir, '~');
  if (recentText.includes(projectPath) || recentText.includes(tildePath)) {
    score += PROJECT_SIGNAL_WEIGHTS.PROJECT_PATH_MENTIONED;
    reasons.push('project_path_mentioned');
  }
  
  // FIX: Signal 2: Project-specific terms (use pre-computed terms from context)
  const termMatches = context.projectTerms.filter(term => recentText.includes(term));
  if (termMatches.length > 0) {
    score += Math.min(PROJECT_SIGNAL_WEIGHTS.PROJECT_TERM_MATCH * termMatches.length, 0.5);
    reasons.push(`project_terms: ${termMatches.join(', ')}`);
  }
  
  // Signal 3: Explicit project context phrases
  const projectPhrases = [
    /in (this |the )?project/i,
    /nel(l)? (progetto|mio progetto)/i,
    /here in/i,
    /in this (session|conversation|chat)/i,
    /per (questo |il )?progetto/i,
    /for (this |the )?project/i,
  ];
  if (projectPhrases.some(p => p.test(recentText))) {
    score += PROJECT_SIGNAL_WEIGHTS.EXPLICIT_PROJECT_CONTEXT;
    reasons.push('explicit_project_context');
  }
  
  // FIX: Signal 4: Technical terms specific to this codebase
  // Improved regex to avoid matching URLs and require path-like context
  const fileReferences = recentText.match(/(?:^|[\s"'/])[A-Za-z_-]+\.(ts|js|json|md|py)\b/g);
  if (fileReferences && fileReferences.length > 0) {
    score += Math.min(PROJECT_SIGNAL_WEIGHTS.FILE_REFERENCE * fileReferences.length, 0.3);
    reasons.push(`file_refs: ${fileReferences.slice(0, 3).join(', ')}`);
  }
  
  return { score: Math.min(score, 1.0), reasons };
}

/**
 * Determine if a user-level memory (preference, constraint, etc.) should be project-scoped
 * based on conversation context
 */
export function shouldBeProjectScope(
  memoryText: string,
  context: ConversationContext,
  hasGlobalKeyword: boolean
): { isProjectScope: boolean; confidence: number; reason: string } {
  // If explicit global keyword, respect it
  if (hasGlobalKeyword) {
    return { isProjectScope: false, confidence: 0.9, reason: 'explicit_global_keyword' };
  }
  
  // Detect project signals in context
  const signals = detectProjectSignals(context);
  
  // FIX: Use documented threshold constant for project scope
  if (signals.score >= PROJECT_SCOPE_THRESHOLD) {
    return { 
      isProjectScope: true, 
      confidence: signals.score, 
      reason: `project_signals: ${signals.reasons.join(', ')}` 
    };
  }
  
  // FIX: Also check if memory text itself contains project-specific references
  // Use pre-computed terms from context instead of re-extracting
  const textLower = memoryText.toLowerCase();
  const directMatches = context.projectTerms.filter(term => textLower.includes(term));
  if (directMatches.length > 0) {
    return {
      isProjectScope: true,
      confidence: 0.6,
      reason: `direct_project_ref: ${directMatches.join(', ')}`
    };
  }
  
  // Default: user-level memories without signals go to global (safer for user preferences)
  return { isProjectScope: false, confidence: 0.5, reason: 'default_user_level_global' };
}

// =============================================================================
// Classification Helper - Export for use with classifier
// =============================================================================

/**
 * Get all classification types supported by patterns
 */
export function getSupportedClassifications(): string[] {
  return ['learning', 'decision', 'constraint', 'preference', 'procedural'];
}

// =============================================================================
// Memory List Command - Simplified single command pattern
// =============================================================================

/**
 * Command to list injected memories
 * Accepts: list-memories, list-memory, show-memory
 */
export const MEMORY_LIST_COMMAND_PATTERN = /^(list-memories|list-memory|show-memory)$/i;

/**
 * Check if text is the memory list command
 */
export function isMemoryListRequest(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return MEMORY_LIST_COMMAND_PATTERN.test(trimmed);
}
