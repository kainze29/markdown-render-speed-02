// Fast drop-in for marked 18.1.3 (default options: GFM on, breaks off).
// A single-pass, dependency-free Markdown parser that renders directly to
// HTML instead of building a token tree first. Written from scratch against
// the CommonMark 0.31.2 + GFM 0.29 rules as marked 18.1.3 applies them;
// where marked departs from the spec, marked's output is the target.
// No caching across calls: every parse() call is independent.

const noopTest = { exec: () => null };

function cachedIndentRegex(createRegex) {
  const cache = [];
  return (indent) => {
    const cacheIndex = Math.max(0, Math.min(3, indent - 1));
    let regex = cache[cacheIndex];
    if (!regex) {
      regex = createRegex(cacheIndex);
      cache[cacheIndex] = regex;
    }
    return regex;
  };
}

function edit(regex, opt = '') {
  let source = typeof regex === 'string' ? regex : regex.source;
  const obj = {
    replace(name, val) {
      let valSource = typeof val === 'string' ? val : val.source;
      valSource = valSource.replace(other.caret, '$1');
      source = source.replace(name, valSource);
      return obj;
    },
    getRegex() {
      return new RegExp(source, opt);
    },
  };
  return obj;
}

const supportsLookbehind = (() => {
  try {
    return !!new RegExp('(?<=1)(?<!1)');
  } catch {
    return false;
  }
})();

const other = {
  codeRemoveIndent: /^(?: {0,3}\t| {1,4})/gm,
  outputLinkReplace: /\\([\[\]])/g,
  indentCodeCompensation: /^(\s+)(?:```)/,
  beginningSpace: /^\s+/,
  endingHash: /#$/,
  startingSpaceChar: /^ /,
  endingSpaceChar: / $/,
  endingSpaceTabChar: /[ \t]$/,
  nonSpaceChar: /[^ ]/,
  newLineCharGlobal: /\n/g,
  tabCharGlobal: /\t/g,
  leadingSpaceTab: /^[ \t]+/,
  multipleSpaceGlobal: /\s+/g,
  blankLine: /^[ \t]*$/,
  doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
  blockquoteStart: /^ {0,3}>/,
  blockquoteSetextReplace: /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g,
  blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
  blockquoteMarkerWhitespace: /^( {0,3}>)([ \t]+)/gm,
  listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
  listIsTask: /^\[[ xX]\][ \t]+\S/,
  listReplaceTask: /^\[[ xX]\][ \t]+/,
  listTaskCheckbox: /\[[ xX]\]/,
  anyLine: /\n.*\n/,
  hrefBrackets: /^<(.*)>$/,
  tableDelimiter: /[:|]/,
  tableAlignChars: /^\||\| *$/g,
  tableRowBlankLine: /\n[ \t]*$/,
  tableAlignRight: /^ *-+: *$/,
  tableAlignCenter: /^ *:-+: *$/,
  tableAlignLeft: /^ *:-+ *$/,
  startATag: /^<a /i,
  endATag: /^<\/a>/i,
  startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
  endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
  startAngleBracket: /^</,
  endAngleBracket: />$/,
  unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
  numericCharacterReference: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/,
  numericCharacterReferenceOrAmpersand: /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
  escapeTest: /[&<>"']/,
  escapeReplace: /[&<>"']/g,
  escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
  escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
  caret: /(^|[^\[])\^/g,
  percentDecode: /%25/g,
  findPipe: /\|/g,
  splitPipe: / \|/,
  slashPipe: /\\\|/g,
  carriageReturn: /\r\n|\r/g,
  spaceLine: /^ +$/gm,
  notSpaceStart: /^\S*/,
  endingNewline: /\n$/,
  listItemRegex: (bull) => new RegExp(`^( {0,3}${bull})((?:[\t ][^\n]*)?(?:\n|$))`),
  nextBulletRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\n]*)?(?:\n|$))`)),
  hrRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\n+|$)`)),
  fencesBeginRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}(?:\`\`\`|~~~)`)),
  headingBeginRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}#{1,6}(?:\\s|$)`)),
  htmlBeginRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}(?:</?(?:${_tag})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i')),
  blockquoteBeginRegex: cachedIndentRegex((indent) => new RegExp(`^ {0,${indent}}>`)),
};

// ---- block grammar (GFM) ----
const newline = /^(?:[ \t]*(?:\n|$))+/;
const blockCode = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const fences = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/;
const hr = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
const heading = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const bullet = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
const lheadingCore = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)/;
const lheading = edit(lheadingCore)
  .replace(/bull/g, bullet)
  .replace(/blockCode/g, /(?: {4}| {0,3}\t)/)
  .replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/)
  .replace(/blockquote/g, / {0,3}>/)
  .replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/)
  .replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/) // thematic break can interrupt
  .replace(/html/g, / {0,3}<[^\n>]+>\n/)
  .replace(/\|table/g, '')
  .getRegex();
const lheadingGfm = edit(lheadingCore)
  .replace(/bull/g, bullet)
  .replace(/blockCode/g, /(?: {4}| {0,3}\t)/)
  .replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/)
  .replace(/blockquote/g, / {0,3}>/)
  .replace(/heading/g, / {0,3}#{1,6}(?:\s|$)/)
  .replace(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/) // thematic break can interrupt
  .replace(/html/g, / {0,3}<[^\n>]+>\n/)
  .replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/)
  .getRegex();
const _paragraph = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
const blockText = /^[^\n]+/;
const _blockLabel = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/;
const def = edit(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/)
  .replace('label', _blockLabel)
  .replace('title', /(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/)
  .getRegex();
const list = edit(/^(bull)([ \t][^\n]*?)?(?:\n|$)/)
  .replace(/bull/g, bullet)
  .getRegex();
const _tag = 'address|article|aside|base|basefont|blockquote|body|caption'
  + '|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption'
  + '|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe'
  + '|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option'
  + '|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title'
  + '|tr|track|ul';
const _comment = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
const html = edit(
  '^ {0,3}(?:'
  + '<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)'
  + '|comment[^\\n]*(\\n+|$)'
  + '|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)'
  + '|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)'
  + '|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)'
  + '|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)'
  + '|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)'
  + '|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)'
  + ')', 'i')
  .replace('comment', _comment)
  .replace('tag', _tag)
  .replace('attribute', / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/)
  .getRegex();
const createParagraph = (listInterrupt) => edit(_paragraph)
  .replace('hr', hr)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('|lheading', '')
  .replace('|table', '')
  .replace('blockquote', ' {0,3}>')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', listInterrupt)
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', _tag)
  .getRegex();
const paragraph = createParagraph(/ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t\n]/);
const blockquoteParagraph = createParagraph(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
const blockquoteRe = edit(/^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(paragraph)|[^\n]*)(?:\n|$))+/ )
  .replace('paragraph', blockquoteParagraph)
  .getRegex();
const gfmTable = edit(
  '^ *([^\\n ].*)\\n'
  + ' {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)'
  + '(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)')
  .replace('hr', hr)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('blockquote', ' {0,3}>')
  .replace('code', '(?: {4}| {0,3}\t)[^\\n]')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]')
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', _tag)
  .getRegex();
// GFM paragraph can be interrupted by a table
const paragraphGfm = edit(_paragraph)
  .replace('hr', hr)
  .replace('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .replace('|lheading', '')
  .replace('table', gfmTable)
  .replace('blockquote', ' {0,3}>')
  .replace('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .replace('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]')
  .replace('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .replace('tag', _tag)
  .getRegex();

// ---- inline grammar (GFM) ----
const escapeRe = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const inlineCode = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const brRe = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
const _punctuation = /[\p{P}\p{S}]/u;
const _punctuationOrSpace = /[\s\p{P}\p{S}]/u;
const _notPunctuationOrSpace = /[^\s\p{P}\p{S}]/u;
const punctuation = edit(/^((?![*_])punctSpace)/, 'u')
  .replace(/punctSpace/g, _punctuationOrSpace).getRegex();
const _punctuationGfmStrongEm = /(?!~)[\p{P}\p{S}]/u;
const _punctuationOrSpaceGfmStrongEm = /(?!~)[\s\p{P}\p{S}]/u;
const _notPunctuationOrSpaceGfmStrongEm = /(?:[^\s\p{P}\p{S}]|~)/u;
const blockSkip = edit(/link|precode-code|html/, 'g')
  .replace('link', /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/)
  .replace('precode-', supportsLookbehind ? '(?<!`)()' : '(^^|[^`])')
  .replace('code', /(?<b>`+)[^`]+\k<b>(?!`)/)
  .replace('html', /<(?! )[^<>]*?>/)
  .getRegex();
const emStrongLDelimCore = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
const emStrongLDelim = edit(emStrongLDelimCore, 'u')
  .replace(/punct/g, _punctuationGfmStrongEm)
  .getRegex();
const emStrongRDelimAstCore =
  '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)' // Skip orphan inside strong
  + '|[^*]+(?=[^*])' // Consume to delim
  + '|(?!\\*)punct(\\*+)(?=[\\s]|$)' // (1)
  + '|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)' // (2)
  + '|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)' // (3)
  + '|[\\s](\\*+)(?!\\*)(?=punct)' // (4)
  + '|(?!\\*)punct(\\*+)(?!\\*)(?=punct)' // (5)
  + '|notPunctSpace(\\*+)(?=notPunctSpace)'; // (6)
const emStrongRDelimAst = edit(emStrongRDelimAstCore, 'gu')
  .replace(/notPunctSpace/g, _notPunctuationOrSpaceGfmStrongEm)
  .replace(/punctSpace/g, _punctuationOrSpaceGfmStrongEm)
  .replace(/punct/g, _punctuationGfmStrongEm)
  .getRegex();
const emStrongRDelimUnd = edit(
  '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)'
  + '|[^_]+(?=[^_])'
  + '|(?!_)punct(_+)(?=[\\s]|$)'
  + '|notPunctSpace(_+)(?!_)(?=punctSpace|$)'
  + '|(?!_)punctSpace(_+)(?=notPunctSpace)'
  + '|[\\s](_+)(?!_)(?=punct)'
  + '|(?!_)punct(_+)(?!_)(?=punct)', 'gu')
  .replace(/notPunctSpace/g, _notPunctuationOrSpace)
  .replace(/punctSpace/g, _punctuationOrSpace)
  .replace(/punct/g, _punctuation)
  .getRegex();
const delLDelim = edit(/^~~?(?:((?!~)punct)|[^\s~])/, 'u')
  .replace(/punct/g, _punctuation)
  .getRegex();
const delRDelimCore =
  '^[^~]+(?=[^~])'
  + '|(?!~)punct(~~?)(?=[\\s]|$)'
  + '|notPunctSpace(~~?)(?!~)(?=punctSpace|$)'
  + '|(?!~)punctSpace(~~?)(?=notPunctSpace)'
  + '|[\\s](~~?)(?!~)(?=punct)'
  + '|(?!~)punct(~~?)(?!~)(?=punct)'
  + '|notPunctSpace(~~?)(?=notPunctSpace)';
const delRDelim = edit(delRDelimCore, 'gu')
  .replace(/notPunctSpace/g, _notPunctuationOrSpace)
  .replace(/punctSpace/g, _punctuationOrSpace)
  .replace(/punct/g, _punctuation)
  .getRegex();
const anyPunctuation = edit(/\\(punct)/, 'gu')
  .replace(/punct/g, _punctuation)
  .getRegex();
const anyPunctuationOutsideCode = edit(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, 'gu')
  .replace(/punct/g, _punctuation)
  .getRegex();
const autolink = edit(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/)
  .replace('scheme', /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/)
  .replace('email', /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/)
  .getRegex();
const _inlineComment = edit(_comment).replace('(?:-->|$)', '-->').getRegex();
const tagRe = edit(
  '^comment'
    + '|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>'
    + '|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>'
    + '|^<\\?[\\s\\S]*?\\?>'
    + '|^<![a-zA-Z]+\\s[\\s\\S]*?>'
    + '|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>')
  .replace('comment', _inlineComment)
  .replace('attribute', /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/)
  .getRegex();
const _inlineLabelBrackets = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
const _inlineLabel = edit(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/)
  .replace('brackets', _inlineLabelBrackets)
  .getRegex();
const linkRe = edit(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/)
  .replace('label', _inlineLabel)
  .replace('href', /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/)
  .replace('title', /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/)
  .getRegex();
const reflinkRe = edit(/^!?\[(label)\]\[(ref)\]/)
  .replace('label', _inlineLabel)
  .replace('ref', _blockLabel)
  .getRegex();
const nolinkRe = edit(/^!?\[(ref)\](?:\[\])?/)
  .replace('ref', _blockLabel)
  .getRegex();
const _boundedBlockLabel = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
const _boundedInlineLabel = edit(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/)
  .replace('brackets', _inlineLabelBrackets)
  .getRegex();
const reflinkSearch = edit('reflink|nolink(?!\\()', 'g')
  .replace('reflink', edit(/^!?\[(label)\]\[(ref)\]/)
    .replace('label', _boundedInlineLabel)
    .replace('ref', _boundedBlockLabel)
    .getRegex())
  .replace('nolink', edit(/^!?\[(ref)\](?:\[\])?/)
    .replace('ref', _boundedBlockLabel)
    .getRegex())
  .getRegex();
const _caseInsensitiveProtocol = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
const _extendedEmail = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
const _extendedEmailProtocol = edit(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/)
  .replace(/email/g, _extendedEmail)
  .getRegex();
const urlRe = edit(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/)
  .replace('emailProtocol', _extendedEmailProtocol)
  .replace('protocol', _caseInsensitiveProtocol)
  .replace('email', /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/)
  .getRegex();
const backpedalRe = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
const delRe = /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/;
const inlineTextRe = edit(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|wwwStart|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/)
  .replace('protocol', _caseInsensitiveProtocol)
  .replace(/emailProtocol/g, /(?:mailto|xmpp):/)
  .replace('wwwStart', supportsLookbehind ? '(?<![^\\s*_~(])www\\.' : 'www\\.')
  .getRegex();

// ---- scalar helpers ----
const escapeReplacements = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const getEscapeReplacement = (ch) => escapeReplacements[ch];

function escapeHtml(html, encode) {
  if (encode) {
    if (other.escapeTest.test(html)) {
      return html.replace(other.escapeReplace, getEscapeReplacement);
    }
  } else {
    if (other.escapeTestNoEncode.test(html)) {
      return html.replace(other.escapeReplaceNoEncode, getEscapeReplacement);
    }
  }
  return html;
}

function decodeNumericCharacterReferences(text) {
  if (!other.numericCharacterReference.test(text)) {
    return text;
  }
  return text.replace(other.numericCharacterReferenceOrAmpersand, (ref, dec, hex) => {
    if (dec === undefined && hex === undefined) {
      return '&amp;';
    }
    const code = dec === undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return '�';
    }
    return code === 38 ? '&amp;' : String.fromCodePoint(code);
  });
}

function cleanUrl(href) {
  try {
    href = encodeURI(href).replace(other.percentDecode, '%');
  } catch {
    return null;
  }
  return href;
}

function splitCells(tableRow, count) {
  const row = tableRow.replace(other.findPipe, (match, offset, str) => {
      let escaped = false;
      let curr = offset;
      while (--curr >= 0 && str[curr] === '\\') escaped = !escaped;
      if (escaped) {
        return '|';
      } else {
        return ' |';
      }
    }),
    cells = row.split(other.splitPipe);
  let i = 0;
  if (!cells[0].trim()) {
    cells.shift();
  }
  if (cells.length > 0 && !cells.at(-1)?.trim()) {
    cells.pop();
  }
  if (count) {
    if (cells.length > count) {
      cells.splice(count);
    } else {
      while (cells.length < count) cells.push('');
    }
  }
  for (; i < cells.length; i++) {
    cells[i] = cells[i].trim().replace(other.slashPipe, '|');
  }
  return cells;
}

function rtrim(str, c, invert) {
  const l = str.length;
  if (l === 0) {
    return '';
  }
  let suffLen = 0;
  while (suffLen < l) {
    const currChar = str.charAt(l - suffLen - 1);
    if (currChar === c && !invert) {
      suffLen++;
    } else if (currChar !== c && invert) {
      suffLen++;
    } else {
      break;
    }
  }
  return str.slice(0, l - suffLen);
}

function trimTrailingBlankLines(str) {
  const lines = str.split('\n');
  let end = lines.length - 1;
  while (end >= 0 && other.blankLine.test(lines[end])) {
    end--;
  }
  if (lines.length - end <= 2) {
    return str;
  }
  return lines.slice(0, end + 1).join('\n');
}

function normalizeLabel(label) {
  return label.trim().replace(other.multipleSpaceGlobal, ' ').toLowerCase().toUpperCase().toLowerCase();
}

function findClosingBracket(str, b) {
  if (str.indexOf(b[0]) === -1 && str.indexOf(b[1]) === -1) {
    return -1;
  }
  let level = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') {
      i++;
    } else if (str[i] === b[0]) {
      level++;
    } else if (str[i] === b[1]) {
      level--;
      if (level < 0) {
        return i;
      }
    }
  }
  if (level > 0) {
    return -2;
  }
  return -1;
}

function expandTabs(line, indent = 0) {
  let col = indent;
  let expanded = '';
  for (const char of line) {
    if (char === '\t') {
      const added = 4 - (col % 4);
      expanded += ' '.repeat(added);
      col += added;
    } else {
      expanded += char;
      col++;
    }
  }
  return expanded;
}

// ---- inline rendering ----
// mode 0 = HTML, mode 1 = plain text (image alt text). The tokenization
// decisions are identical in both modes; only the emitted text differs.

function scanClosers(masked) {
  let lastStar = -1, lastUnd = -1, lastTilde = -1;
  const len = masked.length;
  for (let i = 0; i < len; i++) {
    const ch = masked[i];
    if (ch !== '*' && ch !== '_' && ch !== '~') continue;
    const prev = i === 0 ? '\n' : masked[i - 1];
    let j = i + 1;
    while (j < len && masked[j] === ch) j++;
    if (prev !== ' ' && prev !== '\t' && prev !== '\n' && prev !== '\r' && prev !== '\f') {
      if (ch === '~') lastTilde = i;
      else if (ch === '*') lastStar = i;
      else lastUnd = i;
    }
    i = j - 1;
  }
  return { lastStar, lastUnd, lastTilde };
}

function linkInText(text, st) {
  if (!text.includes('[')) return false;
  for (const match of text.matchAll(blockSkip)) {
    if (linkRe.test(match[0]) && text.charAt(match.index - 1) !== '!') {
      return true;
    }
  }
  for (const match of text.matchAll(reflinkSearch)) {
    const match0 = match[0];
    const refStart = match0.lastIndexOf('[');
    if (match0.charAt(0) === '!' || !Object.hasOwn(st.links, normalizeLabel(match0.slice(refStart + 1, -1)))) {
      continue;
    }
    if (refStart > 1 && linkInText(match0.slice(1, refStart - 1), st)) {
      continue;
    }
    return true;
  }
  return false;
}

function maskSrc(src, st) {
  let maskedSrc = src;
  if (st.links && src.includes('[')) {
    const maskReflink = (match0) => {
      const refStart = match0.lastIndexOf('[');
      if (!Object.hasOwn(st.links, normalizeLabel(match0.slice(refStart + 1, -1)))) {
        return match0;
      }
      if (refStart > 1 && match0.charAt(0) !== '!') {
        const text = match0.slice(1, refStart - 1);
        if (linkInText(text, st)) {
          return '[' + text.replace(reflinkSearch, maskReflink)
            + '][' + 'a'.repeat(match0.length - refStart - 2) + ']';
        }
      }
      return '[' + 'a'.repeat(match0.length - 2) + ']';
    };
    maskedSrc = maskedSrc.replace(reflinkSearch, maskReflink);
  }
  // anyPunctuationOutsideCode only matches code spans and \punct escapes;
  // blockSkip only matches links, code spans and html tags. Skip both when
  // the run holds none of those, which is the common plain-text case.
  if (maskedSrc.includes('`') || maskedSrc.includes('\\')) {
    maskedSrc = maskedSrc.replace(anyPunctuationOutsideCode, (match0, code, punct) => {
      if (punct) {
        return '+'.repeat(match0.length);
      }
      if (code) {
        return code + match0.slice(code.length, -code.length).replace(/`/g, '+') + code;
      }
      return match0;
    });
  }
  if (maskedSrc.includes('[') || maskedSrc.includes('`') || maskedSrc.includes('<')) {
    maskedSrc = maskedSrc.replace(blockSkip, (match0, _link, context) => {
      const offset = context ? context.length : 0;
      return match0.slice(0, offset) + '[' + 'a'.repeat(match0.length - offset - 2) + ']';
    });
  }
  return maskedSrc;
}

function isLabelEndInsideToken(src, label, labelStart) {
  if (!label.includes('<')) {
    return false;
  }
  for (let i = 0; i < label.length; i++) {
    if (label[i] === '\\') {
      i++;
      continue;
    }
    if (label[i] === '`') {
      const code = inlineCode.exec(label.slice(i));
      if (code) {
        i += code[0].length - 1;
        continue;
      }
    }
    if (label[i] !== '<') {
      continue;
    }
    const tokenSrc = src.slice(labelStart + i);
    const token = tagRe.exec(tokenSrc) || autolink.exec(tokenSrc);
    if (!token) {
      continue;
    }
    if (token[0].length > label.length - i) {
      return true;
    }
    i += token[0].length - 1;
  }
  return false;
}

// Render one link or image. Returns false when the link must bail out
// (its label already holds a link), true once rendered.
function outputLink(cap, href, title, isImage, mode, out, st) {
  const text = cap[1].replace(other.outputLinkReplace, '$1');
  const outerInLink = st.inLink;
  const outerLinkEmitted = st.linkEmitted;
  const outerInRawBlock = st.inRawBlock;
  st.inLink = true;
  st.linkEmitted = false;
  const labelOut = [];
  inlineRun(text, isImage ? 1 : mode, labelOut, st);
  const textHasLink = st.linkEmitted;
  st.linkEmitted = outerLinkEmitted;
  st.inLink = outerInLink;
  if (!isImage) {
    if (textHasLink) {
      st.inRawBlock = outerInRawBlock;
      return false;
    }
    st.linkEmitted = true;
  }
  if (mode === 1) {
    // plain-text rendering: a link or image is just its label text
    out.push(labelOut.join(''));
    return true;
  }
  if (isImage) {
    const altText = labelOut.join('');
    const cleanHref = cleanUrl(href);
    if (cleanHref === null) {
      out.push(escapeHtml(altText));
      return true;
    }
    let tag = '<img src="' + escapeHtml(cleanHref) + '" alt="' + escapeHtml(altText) + '"';
    if (title) tag += ' title="' + escapeHtml(title) + '"';
    tag += '>';
    out.push(tag);
    return true;
  }
  const labelHtml = labelOut.join('');
  const cleanHref = cleanUrl(href);
  if (cleanHref === null) {
    out.push(labelHtml);
    return true;
  }
  let tag = '<a href="' + escapeHtml(cleanHref, false) + '"';
  if (title) tag += ' title="' + escapeHtml(title) + '"';
  tag += '>';
  out.push(tag);
  out.push(labelHtml);
  out.push('</a>');
  return true;
}

// Try an inline link or image at the start of s.
// Returns consumed length (>0), 0 for no match, -1 when it matched but is
// invalid (caller falls through to the next inline rule).
function tryLink(s, mode, out, st) {
  if (st.linkParenPossible === false) return 0;
  const cap = linkRe.exec(s);
  if (!cap) return 0;
  const labelStart = cap[0].charAt(0) === '!' ? 2 : 1;
  if (isLabelEndInsideToken(s, cap[1], labelStart)) return -1;
  const trimmedUrl = cap[2].trim();
  if (other.startAngleBracket.test(trimmedUrl)) {
    if (!other.endAngleBracket.test(trimmedUrl)) return -1;
    const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), '\\');
    if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) return -1;
  } else {
    const lastParenIndex = findClosingBracket(cap[2], '()');
    if (lastParenIndex === -2) return -1;
    if (lastParenIndex > -1) {
      const start = cap[0].indexOf('!') === 0 ? 5 : 4;
      const linkLen = start + cap[1].length + lastParenIndex;
      cap[2] = cap[2].substring(0, lastParenIndex);
      cap[0] = cap[0].substring(0, linkLen).trim();
      cap[3] = '';
    }
  }
  const unescaped = rtrim(cap[0].slice(0, -1), '\\');
  if ((cap[0].length - unescaped.length) % 2 === 0) return -1;
  let href = cap[2];
  let title = cap[3] ? cap[3].slice(1, -1) : '';
  href = href.trim();
  if (other.startAngleBracket.test(href)) {
    href = href.slice(1, -1);
  }
  href = href ? href.replace(anyPunctuation, '$1') : href;
  title = title ? title.replace(anyPunctuation, '$1') : title;
  const isImage = cap[0].charAt(0) === '!';
  if (!outputLink(cap, href, title, isImage, mode, out, st)) return -1;
  return cap[0].length;
}

function tryEmStrong(s, maskedFull, run, prevChar, mode, out, st) {
  let match = emStrongLDelim.exec(s);
  if (!match) return 0;
  if (!match[1] && !match[2] && !match[3] && !match[4]) return 0;
  const delimChar = match[0][0];
  const midRun = prevChar === delimChar;
  const srcStart = maskedFull.length - s.length;
  let runStart = srcStart;
  while (runStart > 0 && maskedFull[runStart - 1] === delimChar) {
    runStart--;
  }
  const runPrevChar = [...maskedFull.slice(Math.max(0, runStart - 2), runStart)].at(-1) ?? '';
  const runPrevPunct = runPrevChar === '*' || runPrevChar === '_' || !!punctuation.exec(runPrevChar);
  if (runStart < srcStart) {
    prevChar = runPrevChar;
  }
  const prevPunct = runStart < srcStart ? runPrevPunct : !!punctuation.exec(prevChar);
  if (match[4] && prevChar.match(other.unicodeAlphaNumeric)) return 0;
  const nextChar = match[1] || match[3] || '';
  if (!nextChar || !prevChar || prevPunct) {
    const lLength = [...match[0]].length - 1;
    let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;
    const runLength = srcStart - runStart + lLength;
    const openerCanClose = !!runPrevChar.trim()
      && (!!nextChar || (delimChar === '*' && !runPrevPunct));
    if (delimChar !== '*' && delimChar !== '_') return 0;
    const endReg = delimChar === '*' ? emStrongRDelimAst : emStrongRDelimUnd;
    const lastPossible = delimChar === '*' ? run.lastStar : run.lastUnd;
    const windowStart = maskedFull.length - s.length + lLength;
    if (lastPossible < windowStart) return 0;
    const masked = maskedFull.slice(-1 * s.length + lLength);
    const lastPossibleInWindow = lastPossible - windowStart;
    endReg.lastIndex = 0;
    let m;
    while ((m = endReg.exec(masked)) !== null) {
      if (m.index > lastPossibleInWindow) break;
      rDelim = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
      if (!rDelim) continue;
      rLength = [...rDelim].length;
      if (m[3] || m[4]) {
        delimTotal += rLength;
        continue;
      } else if (m[5] || m[6] || openerCanClose) {
        if (midRun && (m[5] || m[6])) {
          break;
        }
        if (runLength % 3 && !((runLength + rLength) % 3)) {
          midDelimTotal += rLength;
          continue;
        }
      }
      delimTotal -= rLength;
      if (delimTotal > 0) continue;
      rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
      const lastCharLength = [...m[0]][0].length;
      const raw = s.slice(0, lLength + m.index + lastCharLength + rLength);
      if (Math.min(lLength, rLength) % 2) {
        const text = raw.slice(1, -1);
        if (mode === 0) out.push('<em>');
        inlineRun(text, mode, out, st);
        if (mode === 0) out.push('</em>');
        return raw.length;
      }
      const text = raw.slice(2, -2);
      if (mode === 0) out.push('<strong>');
      inlineRun(text, mode, out, st);
      if (mode === 0) out.push('</strong>');
      return raw.length;
    }
  }
  return 0;
}

function tryDel(s, maskedFull, run, prevChar, mode, out, st) {
  let match = delLDelim.exec(s);
  if (!match) return 0;
  const nextChar = match[1] || '';
  if (!nextChar || !prevChar || punctuation.exec(prevChar)) {
    const lLength = [...match[0]].length - 1;
    let rDelim, rLength, delimTotal = lLength;
    const lastPossible = run.lastTilde;
    const windowStart = maskedFull.length - s.length + lLength;
    if (lastPossible < windowStart) return 0;
    const masked = maskedFull.slice(-1 * s.length + lLength);
    const lastPossibleInWindow = lastPossible - windowStart;
    delRDelim.lastIndex = 0;
    let m;
    while ((m = delRDelim.exec(masked)) !== null) {
      if (m.index > lastPossibleInWindow) break;
      rDelim = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
      if (!rDelim) continue;
      rLength = [...rDelim].length;
      if (rLength !== lLength) continue;
      if (m[3] || m[4]) {
        delimTotal += rLength;
        continue;
      }
      delimTotal -= rLength;
      if (delimTotal > 0) continue;
      rLength = Math.min(rLength, rLength + delimTotal);
      const lastCharLength = [...m[0]][0].length;
      const raw = s.slice(0, lLength + m.index + lastCharLength + rLength);
      const text = raw.slice(lLength, -lLength);
      if (mode === 0) out.push('<del>');
      inlineRun(text, mode, out, st);
      if (mode === 0) out.push('</del>');
      return raw.length;
    }
  }
  return 0;
}

// Render an autolink (<...>) or extended autolink (www./email) token.
function renderAutolink(cap, mode, out) {
  let text, href;
  if (cap[2] === '@') {
    text = cap[1];
    href = 'mailto:' + text;
  } else {
    text = cap[1];
    href = text;
  }
  if (mode === 1) {
    out.push(text);
    return;
  }
  const cleanHref = cleanUrl(href);
  if (cleanHref === null) {
    out.push(escapeHtml(text, true));
    return;
  }
  out.push('<a href="' + escapeHtml(cleanHref, true) + '">' + escapeHtml(text, true) + '</a>');
}

function inlineRun(src, mode, out, st) {
  const prevLinkParenPossible = st.linkParenPossible;
  st.linkParenPossible = prevLinkParenPossible && src.includes(')');
  try {
    inlineRunInner(src, mode, out, st);
  } finally {
    st.linkParenPossible = prevLinkParenPossible;
  }
}

function inlineRunInner(src, mode, out, st) {
  const needMask = src.includes('*') || src.includes('_') || src.includes('~');
  const masked = needMask ? maskSrc(src, st) : src;
  const run = needMask ? scanClosers(masked) : { lastStar: -1, lastUnd: -1, lastTilde: -1 };
  let s = src;
  let keepPrevChar = false;
  let prevChar = '';
  while (s) {
    if (!keepPrevChar) prevChar = '';
    keepPrevChar = false;
    let cap;
    // escape
    if ((cap = escapeRe.exec(s))) {
      if (mode === 0 && !st.inRawBlock) out.push(escapeHtml(cap[1]));
      else out.push(cap[1]);
      s = s.substring(cap[0].length);
      continue;
    }
    // tag
    if ((cap = tagRe.exec(s))) {
      if (!st.inLink && other.startATag.test(cap[0])) {
        st.inLink = true;
      } else if (st.inLink && other.endATag.test(cap[0])) {
        st.inLink = false;
      }
      if (!st.inRawBlock && other.startPreScriptTag.test(cap[0])) {
        st.inRawBlock = true;
      } else if (st.inRawBlock && other.endPreScriptTag.test(cap[0])) {
        st.inRawBlock = false;
      }
      out.push(cap[0]);
      s = s.substring(cap[0].length);
      continue;
    }
    // link
    {
      const n = tryLink(s, mode, out, st);
      if (n > 0) {
        s = s.substring(n);
        continue;
      }
    }
    // reflink, nolink
    {
      const cap2 = reflinkRe.exec(s) || nolinkRe.exec(s);
      if (cap2) {
        const labelStart = cap2[0].charAt(0) === '!' ? 2 : 1;
        if (!isLabelEndInsideToken(s, cap2[1], labelStart)) {
          const link = st.links[normalizeLabel(cap2[2] || cap2[1])];
          if (!link) {
            out.push(s.charAt(0));
            s = s.substring(1);
            continue;
          }
          const isImage = cap2[0].charAt(0) === '!';
          if (outputLink(cap2, link.href, link.title, isImage, mode, out, st)) {
            s = s.substring(cap2[0].length);
            continue;
          }
        }
      }
    }
    // em & strong
    {
      const n = tryEmStrong(s, masked, run, prevChar, mode, out, st);
      if (n > 0) {
        s = s.substring(n);
        continue;
      }
    }
    // code
    if ((cap = inlineCode.exec(s))) {
      let text = cap[2].replace(other.newLineCharGlobal, ' ');
      const hasNonSpaceChars = other.nonSpaceChar.test(text);
      const hasSpaceCharsOnBothEnds = other.startingSpaceChar.test(text) && other.endingSpaceChar.test(text);
      if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) {
        text = text.substring(1, text.length - 1);
      }
      if (mode === 1) out.push(text);
      else out.push('<code>' + escapeHtml(text, true) + '</code>');
      s = s.substring(cap[0].length);
      continue;
    }
    // br
    if ((cap = brRe.exec(s))) {
      if (mode === 0) out.push('<br>');
      s = s.substring(cap[0].length);
      continue;
    }
    // del (gfm)
    {
      const n = tryDel(s, masked, run, prevChar, mode, out, st);
      if (n > 0) {
        s = s.substring(n);
        continue;
      }
    }
    // autolink
    if ((cap = autolink.exec(s))) {
      renderAutolink(cap, mode, out);
      s = s.substring(cap[0].length);
      continue;
    }
    // url (gfm)
    if (!st.inLink && (cap = urlRe.exec(s))) {
      let text, href;
      if (cap[2] === '@') {
        text = cap[0];
        href = 'mailto:' + text;
      } else {
        let prevCapZero;
        do {
          prevCapZero = cap[0];
          cap[0] = backpedalRe.exec(cap[0])?.[0] ?? '';
        } while (prevCapZero !== cap[0]);
        text = cap[0];
        if (cap[1] === 'www.') {
          href = 'http://' + cap[0];
        } else {
          href = cap[0];
        }
      }
      if (mode === 1) {
        out.push(text);
      } else {
        const cleanHref = cleanUrl(href);
        if (cleanHref === null) {
          out.push(escapeHtml(text, true));
        } else {
          out.push('<a href="' + escapeHtml(cleanHref, true) + '">' + escapeHtml(text, true) + '</a>');
        }
      }
      s = s.substring(cap[0].length);
      continue;
    }
    // text
    if ((cap = inlineTextRe.exec(s))) {
      const rawText = cap[0];
      const decoded = st.inRawBlock ? rawText : decodeNumericCharacterReferences(rawText);
      if (mode === 0) out.push(st.inRawBlock ? rawText : escapeHtml(decoded));
      else out.push(decoded);
      if (rawText.slice(-1) !== '_') {
        prevChar = rawText.slice(-1);
      }
      keepPrevChar = true;
      s = s.substring(rawText.length);
      continue;
    }
    throw new Error('Infinite loop on byte: ' + s.charCodeAt(0));
  }
}

// Top-level inline render for one block's content: a raw <pre>/<code>/
// <kbd>/<script> left open ends with the block holding it.
function inlineTop(text, out, st) {
  st.inRawBlock = false;
  inlineRun(text, 0, out, st);
}

// ---- block scanning ----
// Node layouts:
//   ['p', text]  ['t', text]  ['code', lang, text]  ['h', depth, text]
//   ['hr']  ['bq', children, raw, text]
//   ['list', ordered, start, loose, items, raw]  (items: {task,checked,children,text,raw})
//   ['html', text, pre]  ['table', headers, aligns, rows]

function indentCodeCompensation(raw, text) {
  const m = raw.match(other.indentCodeCompensation);
  if (m === null) return text;
  const indentToCode = m[1];
  return text.split('\n').map((node) => {
    const mm = node.match(other.beginningSpace);
    if (mm === null) return node;
    return node.slice(Math.min(mm[0].length, indentToCode.length));
  }).join('\n');
}

function scanBlocks(src, top, st) {
  const nodes = [];
  let sawBlankGap = false;
  let blankSinceLastNode = false;
  const startLen = src.length;
  let srcLength = Infinity;
  while (src) {
    if (src.length < srcLength) {
      srcLength = src.length;
    } else {
      throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
    }
    let cap;
    // newline / blank lines
    if ((cap = newline.exec(src))) {
      const raw = cap[0];
      src = src.substring(raw.length);
      if (!(raw.length === 1 && nodes.length > 0)) {
        if (other.anyLine.test(raw)) { sawBlankGap = true; blankSinceLastNode = true; }
      }
      continue;
    }
    // indented code
    if ((cap = blockCode.exec(src))) {
      const raw = trimTrailingBlankLines(cap[0]);
      const text = raw.replace(other.codeRemoveIndent, '');
      src = src.substring(raw.length);
      const last = nodes[nodes.length - 1];
      if (last && (last[0] === 'p' || last[0] === 't') && !blankSinceLastNode) {
        last[1] += '\n' + text;
        blankSinceLastNode = false;
      } else {
        nodes.push(['code', undefined, text]);
      }
      continue;
    }
    // fenced code
    if ((cap = fences.exec(src))) {
      const raw = cap[0];
      const text = indentCodeCompensation(raw, cap[3] || '');
      const lang = cap[2] ? cap[2].trim().replace(anyPunctuation, '$1') : cap[2];
      src = src.substring(raw.length);
      nodes.push(['code', lang, text]);
      continue;
    }
    // ATX heading
    if ((cap = heading.exec(src))) {
      let text = cap[2].trim();
      if (other.endingHash.test(text)) {
        const trimmed = rtrim(text, '#');
        if (!trimmed || other.endingSpaceTabChar.test(trimmed)) {
          text = trimmed.trim();
        }
      }
      src = src.substring(rtrim(cap[0], '\n').length);
      nodes.push(['h', cap[1].length, text]);
      continue;
    }
    // thematic break
    if ((cap = hr.exec(src))) {
      src = src.substring(rtrim(cap[0], '\n').length);
      nodes.push(['hr']);
      continue;
    }
    // blockquote
    {
      const bq = scanBlockquote(src, st);
      if (bq) {
        src = src.substring(bq.consumed);
        nodes.push(bq.node);
        continue;
      }
    }
    // list
    {
      const lst = scanList(src, st);
      if (lst) {
        src = src.substring(lst.consumed);
        nodes.push(lst.node);
        continue;
      }
    }
    // html block
    if ((cap = html.exec(src))) {
      const raw = trimTrailingBlankLines(cap[0]);
      const pre = cap[1] === 'pre' || cap[1] === 'script' || cap[1] === 'style';
      src = src.substring(raw.length);
      nodes.push(['html', raw, pre]);
      continue;
    }
    // link reference definition
    if ((cap = def.exec(src))) {
      if (!other.startAngleBracket.test(cap[2]) && findClosingBracket(cap[2], '()') !== -1) {
        // not a definition; fall through to the other block rules
      } else {
        const raw = rtrim(cap[0], '\n');
        const tag = normalizeLabel(cap[1]);
        const href = cap[2] ? cap[2].replace(other.hrefBrackets, '$1').replace(anyPunctuation, '$1') : '';
        const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(anyPunctuation, '$1') : cap[3];
        src = src.substring(raw.length);
        const last = nodes[nodes.length - 1];
        if (last && (last[0] === 'p' || last[0] === 't') && !blankSinceLastNode) {
          last[1] += '\n' + raw;
          blankSinceLastNode = false;
        } else {
          if (!st.links[tag]) {
            st.links[tag] = { href, title };
          }
          blankSinceLastNode = true;
        }
        continue;
      }
    }
    // table (gfm)
    if ((cap = gfmTable.exec(src))) {
      if (other.tableDelimiter.test(cap[2])) {
        const headers = splitCells(cap[1]);
        const aligns = cap[2].replace(other.tableAlignChars, '').split('|');
        const rows = cap[3]?.trim() ? cap[3].replace(other.tableRowBlankLine, '').split('\n') : [];
        if (headers.length === aligns.length) {
          const align = [];
          for (const a of aligns) {
            if (other.tableAlignRight.test(a)) align.push('right');
            else if (other.tableAlignCenter.test(a)) align.push('center');
            else if (other.tableAlignLeft.test(a)) align.push('left');
            else align.push(null);
          }
          src = src.substring(rtrim(cap[0], '\n').length);
          nodes.push(['table', headers, align, rows.map((r) => splitCells(r, headers.length))]);
          continue;
        }
      }
    }
    // setext heading
    if ((cap = lheadingGfm.exec(src))) {
      const text = cap[1].trim();
      src = src.substring(rtrim(cap[0], '\n').length);
      nodes.push(['h', cap[2].charAt(0) === '=' ? 1 : 2, text]);
      continue;
    }
    // paragraph (top level only)
    if (top && (cap = paragraphGfm.exec(src))) {
      const text = cap[1].charAt(cap[1].length - 1) === '\n' ? cap[1].slice(0, -1) : cap[1];
      src = src.substring(cap[0].length);
      nodes.push(['p', text]);
      blankSinceLastNode = false;
      continue;
    }
    // text (single line fallback)
    if ((cap = blockText.exec(src))) {
      const text = cap[0];
      src = src.substring(text.length);
      const last = nodes[nodes.length - 1];
      if (last && last[0] === 't' && !blankSinceLastNode) {
        last[1] += '\n' + text;
      } else {
        nodes.push(['t', text]);
      }
      blankSinceLastNode = false;
      continue;
    }
    if (src) {
      throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
    }
  }
  return { nodes, consumed: startLen - src.length, sawBlankGap };
}

function scanBlockquote(src, st) {
  const cap = blockquoteRe.exec(src);
  if (!cap) return null;
  let lines = rtrim(cap[0], '\n').split('\n');
  let raw = '';
  let text = '';
  const tokens = [];
  while (lines.length > 0) {
    let inBlockquote = false;
    const currentLines = [];
    let i;
    for (i = 0; i < lines.length; i++) {
      if (other.blockquoteStart.test(lines[i])) {
        currentLines.push(lines[i]);
        inBlockquote = true;
      } else if (!inBlockquote) {
        currentLines.push(lines[i]);
      } else {
        break;
      }
    }
    lines = lines.slice(i);
    const currentRaw = currentLines.join('\n');
    const currentText = currentRaw
      .replace(
        other.blockquoteMarkerWhitespace,
        (_, marker, whitespace) => marker + expandTabs(whitespace, marker.length),
      )
      .replace(other.blockquoteSetextReplace, '\n    $1')
      .replace(other.blockquoteSetextReplace2, '');
    raw = raw ? `${raw}\n${currentRaw}` : currentRaw;
    text = text ? `${text}\n${currentText}` : currentText;
    const sub = scanBlocks(currentText, true, st);
    const first = sub.nodes[0];
    const prev = tokens[tokens.length - 1];
    if (first && prev && first[0] === 'p' && prev[0] === 'p') {
      // a paragraph that opens the continuation merges with the previous one
      prev[1] += '\n' + first[1];
      tokens.push(...sub.nodes.slice(1));
    } else if (first && prev && first[0] === 'code' && (prev[0] === 'p' || prev[0] === 't')) {
      // indented code cannot interrupt a paragraph: it joins the paragraph
      prev[1] += '\n' + first[2];
      tokens.push(...sub.nodes.slice(1));
    } else if (first && prev && first[0] === 't' && prev[0] === 't') {
      prev[1] += '\n' + first[1];
      tokens.push(...sub.nodes.slice(1));
    } else {
      tokens.push(...sub.nodes);
    }
    if (lines.length === 0) break;
    const lastToken = tokens[tokens.length - 1];
    if (lastToken && (lastToken[0] === 'code' || lastToken[0] === 'h' || lastToken[0] === 'hr' || lastToken[0] === 'html' || lastToken[0] === 'table')) {
      break;
    } else if (lastToken && lastToken[0] === 'bq') {
      const oldToken = lastToken;
      const continuation = lines.join('\n');
      const newText = oldToken[2] + '\n' + continuation.replace(other.blockquoteSetextReplace2, '');
      const newToken = scanBlockquote(newText, st);
      tokens[tokens.length - 1] = newToken.node;
      const leftover = newText.substring(newToken.node[2].length).replace(/^\n/, '');
      const leftoverCount = leftover ? leftover.split('\n').length : 0;
      const consumed = leftoverCount ? lines.slice(0, -leftoverCount) : lines;
      if (consumed.length > 0) {
        raw = `${raw}\n${consumed.join('\n')}`;
      }
      text = text.substring(0, text.length - oldToken[3].length) + newToken.node[3];
      lines = lines.slice(consumed.length);
      if (lines.length > 0 && other.blockquoteStart.test(lines[0])) {
        continue;
      }
      break;
    } else if (lastToken && lastToken[0] === 'list') {
      const oldToken = lastToken;
      const newText = oldToken[5] + '\n' + lines.join('\n');
      const newToken = scanList(newText, st);
      tokens[tokens.length - 1] = newToken.node;
      const consumedCount = newToken.node[5].length > oldToken[5].length
        ? newText.slice(oldToken[5].length + 1, newToken.node[5].length).split('\n').length
        : 0;
      if (consumedCount > 0) {
        const consumed = lines.slice(0, consumedCount).join('\n');
        raw = `${raw}\n${consumed}`;
        text = `${text}\n${consumed}`;
      }
      lines = lines.slice(consumedCount);
      continue;
    }
  }
  return { node: ['bq', tokens, raw, text], consumed: raw.length };
}

function scanList(src, st) {
  let cap = list.exec(src);
  if (!cap) return null;
  const listSrc = src;
  let s = src;
  const taken = () => listSrc.length - s.length;
  let bull = cap[1].trim();
  const isordered = bull.length > 1;
  const start = isordered ? +bull.slice(0, -1) : '';
  const node = ['list', isordered, start, false, [], ''];
  const items = node[4];
  bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;
  const itemRegex = other.listItemRegex(bull);
  let endsWithBlankLine = false;
  while (s) {
    let endEarly = false;
    let itemContents = '';
    if (!(cap = itemRegex.exec(s))) break;
    if (hr.test(s)) break;
    const itemStart = taken();
    s = s.substring(cap[0].length);
    const firstLine = cap[2].split('\n', 1)[0];
    const bulletIndent = cap[1].length;
    let line = firstLine.replace(other.leadingSpaceTab, (whitespace) => expandTabs(whitespace, bulletIndent));
    let nextLine = s.split('\n', 1)[0];
    let blankLine = !line.trim();
    let indent = 0;
    if (blankLine) {
      indent = bulletIndent + 1;
    } else {
      indent = line.search(other.nonSpaceChar);
      indent = indent > 4 ? 1 : indent;
      itemContents = line.slice(indent);
      indent += bulletIndent;
    }
    if (blankLine && other.blankLine.test(nextLine)) {
      s = s.substring(nextLine.length + 1);
      endEarly = true;
    }
    if (!endEarly) {
      const nextBulletRegex = other.nextBulletRegex(indent);
      const hrRegex = other.hrRegex(indent);
      const fencesBeginRegex = other.fencesBeginRegex(indent);
      const headingBeginRegex = other.headingBeginRegex(indent);
      const htmlBeginRegex = other.htmlBeginRegex(indent);
      const blockquoteBeginRegex = other.blockquoteBeginRegex(indent);
      while (s) {
        const rawLine = s.split('\n', 1)[0];
        nextLine = rawLine;
        const nextLineWithoutTabs = nextLine.indexOf('\t') === -1
          ? nextLine
          : nextLine.replace(other.leadingSpaceTab, (whitespace) => expandTabs(whitespace));
        const firstNonSpace = nextLineWithoutTabs.search(other.nonSpaceChar);
        const firstChar = firstNonSpace < 0 ? '' : nextLineWithoutTabs[firstNonSpace];
        if ((firstChar === '`' || firstChar === '~') && fencesBeginRegex.test(nextLine)) break;
        if (firstChar === '#' && headingBeginRegex.test(nextLine)) break;
        if (firstChar === '<' && htmlBeginRegex.test(nextLine)) break;
        if (firstChar === '>' && blockquoteBeginRegex.test(nextLine)) break;
        if ((firstChar === '*' || firstChar === '+' || firstChar === '-' || (firstChar >= '0' && firstChar <= '9')) && nextBulletRegex.test(nextLine)) break;
        if ((firstChar === '-' || firstChar === '_' || firstChar === '*') && hrRegex.test(nextLine)) break;
        if (firstNonSpace >= indent || !nextLine.trim()) {
          itemContents += '\n' + nextLineWithoutTabs.slice(indent);
        } else {
          if (blankLine) break;
          if (line.replace(other.tabCharGlobal, '    ').search(other.nonSpaceChar) >= 4) break;
          if (fencesBeginRegex.test(line)) break;
          if (headingBeginRegex.test(line)) break;
          if (htmlBeginRegex.test(line)) break;
          if (hrRegex.test(line)) break;
          const setextContinuation = /^ {0,3}(?:=+|-+) *$/.test(nextLine)
            && lheadingGfm.test(`${line}\n${nextLine}`);
          const continuation = setextContinuation
            ? `    ${nextLineWithoutTabs.replace(/^ {0,3}/, '')}`
            : nextLine;
          itemContents += '\n' + continuation;
        }
        blankLine = !nextLine.trim();
        s = s.substring(rawLine.length + 1);
        line = nextLineWithoutTabs.slice(indent);
      }
    }
    const raw = listSrc.slice(itemStart, taken());
    if (!node[3]) {
      if (endsWithBlankLine) {
        node[3] = true;
      } else if (other.doubleBlankLine.test(raw)) {
        endsWithBlankLine = true;
      }
    }
    items.push({
      raw,
      task: !!other.listIsTask.test(itemContents),
      checked: undefined,
      children: [],
      text: itemContents,
    });
  }
  const lastItem = items[items.length - 1];
  if (lastItem) {
    lastItem.raw = lastItem.raw.trimEnd();
    lastItem.text = lastItem.text.trimEnd();
  } else {
    return null;
  }
  node[5] = listSrc.slice(0, taken()).trimEnd();
  // First pass: tokenize items, finalize looseness from blank gaps inside.
  for (const item of items) {
    const sub = scanBlocks(item.text, false, st);
    item.children = sub.nodes;
    if (!node[3] && sub.sawBlankGap) {
      node[3] = true;
    }
  }
  // Second pass: place task checkboxes.
  for (const item of items) {
    const itemToken = item.children[0];
    if (item.task && (itemToken?.[0] === 't' || itemToken?.[0] === 'p')) {
      item.text = item.text.replace(other.listReplaceTask, '');
      itemToken[1] = itemToken[1].replace(other.listReplaceTask, '');
      const taskRaw = other.listTaskCheckbox.exec(item.raw);
      if (taskRaw) {
        const checked = taskRaw[0] !== '[ ]';
        item.checked = checked;
        item.checkboxRaw = taskRaw[0] + ' ';
      }
    } else if (item.task) {
      item.task = false;
    }
  }
  // A loose list wraps every item's text in a paragraph.
  if (node[3]) {
    for (const item of items) {
      for (const child of item.children) {
        if (child[0] === 't') child[0] = 'p';
      }
    }
  }
  return { node, consumed: node[5].length };
}

// ---- rendering ----
function renderNodes(nodes, out, st) {
  for (const node of nodes) {
    switch (node[0]) {
      case 'p': {
        out.push('<p>');
        inlineTop(node[1], out, st);
        out.push('</p>\n');
        break;
      }
      case 't': {
        inlineTop(node[1], out, st);
        break;
      }
      case 'code': {
        const langString = (node[1] || '').match(other.notSpaceStart)?.[0];
        const code = node[2] ? node[2].replace(other.endingNewline, '') + '\n' : '';
        if (!langString) {
          out.push('<pre><code>' + escapeHtml(code, true) + '</code></pre>\n');
        } else {
          out.push('<pre><code class="language-' + escapeHtml(langString) + '">' + escapeHtml(code, true) + '</code></pre>\n');
        }
        break;
      }
      case 'h': {
        out.push('<h' + node[1] + '>');
        inlineTop(node[2], out, st);
        out.push('</h' + node[1] + '>\n');
        break;
      }
      case 'hr': {
        out.push('<hr>\n');
        break;
      }
      case 'bq': {
        out.push('<blockquote>\n');
        renderNodes(node[1], out, st);
        out.push('</blockquote>\n');
        break;
      }
      case 'list': {
        renderList(node, out, st);
        break;
      }
      case 'html': {
        out.push(node[1]);
        break;
      }
      case 'table': {
        renderTable(node, out, st);
        break;
      }
    }
  }
}

function renderList(node, out, st) {
  const ordered = node[1];
  const start = node[2];
  const loose = node[3];
  const items = node[4];
  const type = ordered ? 'ol' : 'ul';
  let open = '<' + type;
  if (ordered && start !== 1) open += ' start="' + start + '"';
  open += '>\n';
  out.push(open);
  for (const item of items) {
    out.push('<li>');
    const checkboxHtml = item.checked === undefined ? ''
      : '<input ' + (item.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
    if (checkboxHtml && loose) {
      // inside the first paragraph
      const first = item.children[0];
      if (first && (first[0] === 'p' || first[0] === 't')) {
        out.push('<p>' + checkboxHtml);
        inlineTop(first[1], out, st);
        out.push('</p>\n');
        renderNodes(item.children.slice(1), out, st);
        out.push('</li>\n');
        continue;
      }
    }
    if (checkboxHtml) out.push(checkboxHtml);
    renderNodes(item.children, out, st);
    out.push('</li>\n');
  }
  out.push('</' + type + '>\n');
}

function renderTable(node, out, st) {
  const headers = node[1];
  const aligns = node[2];
  const rows = node[3];
  let header = '';
  for (let j = 0; j < headers.length; j++) {
    const cellOut = [];
    inlineTop(headers[j], cellOut, st);
    const tag = aligns[j] ? `<th align="${aligns[j]}">` : '<th>';
    header += tag + cellOut.join('') + '</th>\n';
  }
  let body = '';
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    let cell = '';
    for (let k = 0; k < row.length; k++) {
      const cellOut = [];
      inlineTop(row[k], cellOut, st);
      const tag = aligns[k] ? `<td align="${aligns[k]}">` : '<td>';
      cell += tag + cellOut.join('') + '</td>\n';
    }
    body += `<tr>\n${cell}</tr>\n`;
  }
  if (body) body = `<tbody>${body}</tbody>`;
  out.push('<table>\n<thead>\n<tr>\n' + header + '</tr>\n</thead>\n' + body + '</table>\n');
}

/** The HTML marked 18.1.3 renders for `markdown`, with its defaults. */
export function parse(markdown) {
  const src = markdown.includes('\r') ? markdown.replace(other.carriageReturn, '\n') : markdown;
  const st = {
    links: Object.create(null),
    inLink: false,
    inRawBlock: false,
    linkEmitted: false,
    linkParenPossible: true,
  };
  const { nodes } = scanBlocks(src, true, st);
  const out = [];
  renderNodes(nodes, out, st);
  return out.join('');
}
