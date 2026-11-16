// Fast Markdown renderer: a from-scratch, single-pass parser that returns
// exactly the HTML marked 18.1.3 renders with its default options
// (GFM on, breaks off, pedantic off, async off). Dependency-free ES module.
// It renders straight to HTML strings while it scans, with no token objects
// and no caching across calls: every parse() starts from fresh state.
// MIT licensed. See README.md.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Escape HTML characters. With encode=true every & < > " ' is escaped;
// otherwise a & that already starts an entity or numeric reference is left.
function esc(s, encode) {
  if (encode) {
    return s.indexOf('&') === -1 && s.indexOf('<') === -1 && s.indexOf('>') === -1 && s.indexOf('"') === -1 && s.indexOf("'") === -1
      ? s
      : s.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
  }
  return /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/.test(s)
    ? s.replace(/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, (ch) => ESCAPES[ch] || '&amp;')
    : s;
}

// Decode numeric character references only. Named entities are NOT decoded:
// marked leaves &amp; &copy; and friends exactly as written.
const RX_NUMREF = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));/;
const RX_NUMREF_ALL = /&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
function decodeRefs(s) {
  if (!RX_NUMREF.test(s)) return s;
  return s.replace(RX_NUMREF_ALL, (whole, dec, hex) => {
    if (dec === undefined && hex === undefined) return '&amp;';
    const code = dec === undefined ? parseInt(hex, 16) : parseInt(dec, 10);
    if (code === 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return '\uFFFD';
    if (code === 38) return '&amp;';
    return String.fromCodePoint(code);
  });
}

// Clean a link href the way marked does: encodeURI, then unescape %25 back.
function cleanUrl(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

// Split a table row on unescaped pipes, honouring the expected cell count.
function splitCells(row, count) {
  let out = row.replace(/\|/g, (ch, off, str) => {
    let escaped = false;
    for (let p = off - 1; p >= 0 && str[p] === '\\'; p--) escaped = !escaped;
    return escaped ? '|' : ' |';
  });
  let cells = out.split(/ \|/);
  let i = 0;
  if (cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  if (count) {
    if (cells.length > count) cells.splice(count);
    else while (cells.length < count) cells.push('');
  }
  for (; i < cells.length; i++) cells[i] = cells[i].trim().replace(/\\\|/g, '|');
  return cells;
}

// Strip trailing characters: with stripOther=false strip trailing `ch`,
// with stripOther=true strip trailing characters that are not `ch`.
function trimEndChars(s, ch, stripOther) {
  const n = s.length;
  let k = 0;
  while (k < n) {
    const c = s.charAt(n - k - 1);
    if (c === ch && !stripOther) k++;
    else if (c !== ch && stripOther) k++;
    else break;
  }
  return s.slice(0, n - k);
}

// Drop trailing blank lines, keeping at most one trailing blank line.
function trimBlankTail(s) {
  const lines = s.split('\n');
  let t = lines.length - 1;
  while (t >= 0 && /^[ \t]*$/.test(lines[t])) t--;
  return lines.length - t <= 2 ? s : lines.slice(0, t + 1).join('\n');
}

// Normalise a link reference label for lookup.
function normalizeLabel(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// Find the index of the unmatched closing character of a pair, skipping
// backslash escapes. -1: no pair at all, -2: an opener left unclosed.
function findPairEnd(s, pair) {
  if (s.indexOf(pair[0]) === -1 && s.indexOf(pair[1]) === -1) return -1;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === pair[0]) depth++;
    else if (s[i] === pair[1]) {
      depth--;
      if (depth < 0) return i;
    }
  }
  return depth > 0 ? -2 : -1;
}

// Expand tabs to spaces, to tab stops of 4, starting at column `col`.
function expandTabs(s, col) {
  let out = '';
  let t = col || 0;
  for (const ch of s) {
    if (ch === '\t') {
      const n = 4 - (t % 4);
      out += ' '.repeat(n);
      t += n;
    } else {
      out += ch;
      t++;
    }
  }
  return out;
}

// Regex builder: start from a string or regex source, replace placeholders
// (a literal string replaces its first occurrence, a regex replaces its
// matches), and build the final RegExp. A leading ^ in an inserted piece is
// dropped so an anchored pattern can be embedded mid-expression.
const RX_CARET = /(^|[^\[])\^/g;
function RX(template, flags) {
  let src = typeof template === 'string' ? template : template.source;
  const api = {
    rep(search, repl) {
      let piece = typeof repl === 'string' ? repl : repl.source;
      piece = piece.replace(RX_CARET, '$1');
      src = src.replace(search, piece);
      return api;
    },
    get() { return new RegExp(src, flags); },
  };
  return api;
}

// Block tag names that start an HTML block (CommonMark / GFM list).
const TAG_LIST = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';

// Small shared patterns.
const RX_CODE_INDENT = /^(?: {0,3}\t| {1,4})/gm;
const RX_LINK_BRACKET_ESC = /\\([\[\]])/g;
const RX_FENCE_INDENT = /^(\s+)(?:```)/;
const RX_START_SPACE = /^ /;
const RX_END_SPACE = / $/;
const RX_END_SPACE_TAB = /[ \t]$/;
const RX_NON_SPACE = /[^ ]/;
const RX_NEWLINE_G = /\n/g;
const RX_TAB_G = /\t/g;
const RX_LEAD_SPACE_TAB = /^[ \t]+/;
const RX_BLANK_LINE = /^[ \t]*$/;
const RX_DOUBLE_BLANK = /\n[ \t]*\n[ \t]*$/;
const RX_BQ_START = /^ {0,3}>/;
const RX_BQ_SETEXT = /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g;
const RX_BQ_STRIP = /^ {0,3}>[ \t]?/gm;
const RX_BQ_MARKER_WS = /^( {0,3}>)([ \t]+)/gm;
const RX_LIST_NEST = /^ {1,4}(?=( {4})*[^ ])/g;
const RX_LIST_TASK = /^\[[ xX]\][ \t]+\S/;
const RX_LIST_TASK_STRIP = /^\[[ xX]\][ \t]+/;
const RX_LIST_CHECKBOX = /\[[ xX]\]/;
const RX_ANY_LINE = /\n.*\n/;
const RX_HREF_BRACKETS = /^<(.*)>$/;
const RX_TABLE_DELIM = /[:|]/;
const RX_TABLE_TRIM_PIPES = /^\||\| *$/g;
const RX_TABLE_ROW_BLANK = /\n[ \t]*$/;
const RX_ALIGN_RIGHT = /^ *-+: *$/;
const RX_ALIGN_CENTER = /^ *:-+: *$/;
const RX_ALIGN_LEFT = /^ *:-+ *$/;
const RX_START_A = /^<a /i;
const RX_END_A = /^<\/a>/i;
const RX_START_PRE = /^<(pre|code|kbd|script)(\s|>)/i;
const RX_END_PRE = /^<\/(pre|code|kbd|script)(\s|>)/i;
const RX_START_ANGLE = /^</;
const RX_END_ANGLE = />$/;
const RX_ALNUM = /[\p{L}\p{N}]/u;
const RX_NOT_SPACE_START = /^\S*/;
const RX_END_NEWLINE = /\n$/;
const RX_CR = /\r\n|\r/g;

// Parameterised block-start patterns, cached per indent level (0..3).
function memoRegex(make) {
  const cache = [];
  return (n) => {
    const k = Math.max(0, Math.min(3, n - 1));
    let r = cache[k];
    if (!r) { r = make(k); cache[k] = r; }
    return r;
  };
}
const RX_LIST_ITEM = (bullet) => new RegExp(`^( {0,3}${bullet})((?:[ \t][^\\n]*)?(?:\\n|$))`);
const RX_NEXT_BULLET = memoRegex((n) => new RegExp(`^ {0,${n}}(?:[*+-]|\\d{1,9}[.)])((?:[ \t][^\\n]*)?(?:\\n|$))`));
const RX_HR_AT = memoRegex((n) => new RegExp(`^ {0,${n}}((?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\\*[ \t]*){3,})(?:\\n+|$)`));
const RX_FENCE_AT = memoRegex((n) => new RegExp(`^ {0,${n}}(?:\`\`\`|~~~)`));
const RX_HEADING_AT = memoRegex((n) => new RegExp(`^ {0,${n}}#{1,6}(?:\\s|$)`));
const RX_HTML_AT = memoRegex((n) => new RegExp(`^ {0,${n}}(?:</?(?:${TAG_LIST})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i'));
const RX_BQ_AT = memoRegex((n) => new RegExp(`^ {0,${n}}>`));

// Scan a string for the last possible emphasis / strikethrough closer.
// A delimiter run counts when the character before it is not whitespace.
function maskInfo(src) {
  const em = { '*': -1, '_': -1 };
  let del = -1;
  const n = src.length;
  for (let s = 0; s < n; s++) {
    const r = src[s];
    if (r !== '*' && r !== '_' && r !== '~') continue;
    const before = s === 0 ? '\n' : src[s - 1];
    let i = s + 1;
    while (i < n && src[i] === r) i++;
    if (before !== ' ' && before !== '\t' && before !== '\n' && before !== '\r' && before !== '\f') {
      if (r === '~') del = s;
      else em[r] = s;
    }
    s = i - 1;
  }
  return { src, em, del };
}

// ---- Block regexes (GFM) ----

const RX_NEWLINE = /^(?:[ \t]*(?:\n|$))+/;
const RX_INDENTED_CODE = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
const RX_FENCES = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/;
const RX_HR = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
const RX_HEADING = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
const RX_BULLET = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
const RX_TEXT = /^[^\n]+/;

// Paragraph pattern: a run of lines, stopping before a blank line or a line
// that opens another block. Built from a template with named placeholders.
const RX_PARA_TMPL = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \t]+\n)[^\n]+)*)/;
function paraRegex(listPat) {
  return RX(RX_PARA_TMPL)
    .rep('hr', RX_HR)
    .rep('heading', ' {0,3}#{1,6}(?:\\s|$)')
    .rep('|lheading', '')
    .rep('|table', '')
    .rep('blockquote', ' {0,3}>')
    .rep('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
    .rep('list', listPat)
    .rep('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
    .rep('tag', TAG_LIST)
    .get();
}
// Table: header line, delimiter line, then body rows. Defined before the
// paragraph pattern, which embeds it.
const RX_TABLE = RX('^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)')
  .rep('hr', RX_HR)
  .rep('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .rep('blockquote', ' {0,3}>')
  .rep('code', /(?: {4}| {0,3}\t)[^\n]/)
  .rep('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .rep('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]')
  .rep('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .rep('tag', TAG_LIST)
  .get();

// GFM paragraph: a list item only interrupts when it is a bullet/ordered
// marker followed by content (the "1." form for ordered).
const RX_PARAGRAPH = RX(RX_PARA_TMPL)
  .rep('hr', RX_HR)
  .rep('heading', ' {0,3}#{1,6}(?:\\s|$)')
  .rep('|lheading', '')
  .rep('table', RX_TABLE)
  .rep('blockquote', ' {0,3}>')
  .rep('fences', ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
  .rep('list', ' {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]')
  .rep('html', ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)')
  .rep('tag', TAG_LIST)
  .get();

// Setext heading pattern (GFM: the underline may be preceded by a table).
const RX_LHEADING_TMPL = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |fences|blockquote|heading|hr|html|table))+?)\n {0,3}(=+|-+)[ \t]*(?:\n+|$)/;
const RX_LHEADING = RX(RX_LHEADING_TMPL)
  .rep(/bull/g, RX_BULLET)
  .rep(/blockCode/g, /(?: {4}| {0,3}\t)/)
  .rep(/fences/g, / {0,3}(?:`{3,}|~{3,})/)
  .rep(/blockquote/g, / {0,3}>/)
  .rep(/heading/g, / {0,3}#{1,6}(?:\s|$)/)
  .rep(/hr/g, / {0,3}(?:(?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/)
  .rep(/html/g, / {0,3}<[^\n>]+>\n/)
  .rep(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/)
  .get();

// List opener: a bullet plus the rest of its first line.
const RX_LIST = RX(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).rep(/bull/g, RX_BULLET).get();

// Blockquote: runs of > lines plus lazy continuation lines, where a lazy
// line is a paragraph line (the paragraph pattern keeps it inside).
const RX_BQ_PARA = paraRegex(/ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|\n|$)/);
const RX_BLOCKQUOTE = RX(/^( {0,3}> ?(?:(?![ \t]*(?:\n|$))(paragraph)|[^\n]*)(?:\n|$))+/).rep('paragraph', RX_BQ_PARA).get();

// HTML comment, and the HTML block pattern (seven kinds, CommonMark 0.31.2).
const RX_HTML_COMMENT = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
const RX_HTML_COMMENT_END = RX(RX_HTML_COMMENT).rep('(?:-->|$)', '-->').get();
const RX_HTML_BLOCK = RX('^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$))', 'i')
  .rep('comment', RX_HTML_COMMENT)
  .rep('tag', TAG_LIST)
  .rep('attribute', / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/)
  .get();

// Link reference definition.
const RX_LABEL = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/;
const RX_DEF = RX(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/)
  .rep('label', RX_LABEL)
  .rep('title', /(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/)
  .get();

// ---- Inline regexes (GFM) ----

const RX_ESCAPE = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
const RX_CODESPAN = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
const RX_BR = /^( {2,}|\\)\n(?!\s*$)[ \t]*/;
const RX_ANY_PUNCT = RX(/\\(punct)/, 'gu').rep(/punct/g, /[\p{P}\p{S}]/u).get();
const RX_ANY_PUNCT_CODE = RX(/(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\(punct)/, 'gu').rep(/punct/g, /[\p{P}\p{S}]/u).get();

const RX_PUNCT = /[\p{P}\p{S}]/u;
const RX_PUNCT_SPACE = /[\s\p{P}\p{S}]/u;
const RX_NOT_PUNCT_SPACE = /[^\s\p{P}\p{S}]/u;
const RX_OPEN_QUOTE = /[\p{Pi}\p{Ps}"']/u;
const RX_PUNCT_NOTILDE = /(?!~)[\p{P}\p{S}]/u;
const RX_PUNCT_SPACE_NOTILDE = /(?!~)[\s\p{P}\p{S}]/u;
const RX_NOT_PUNCT_SPACE_TILDE = /(?:[^\s\p{P}\p{S}]|~)/u;
// A single punctuation-or-space character, but not * or _ at the start.
const RX_PUNCT_START = RX(/^((?![*_])punctSpace)/, 'u').rep(/punctSpace/g, RX_PUNCT_SPACE).get();

// Emphasis delimiter patterns. The left pattern matches a run plus the one
// character after it; the right patterns scan for runs that can close.
const RX_EM_LEFT_TMPL = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
const RX_EM_LEFT = RX(RX_EM_LEFT_TMPL, 'u').rep(/punct/g, RX_PUNCT_NOTILDE).get();
const RX_EM_RIGHT_AST_TMPL = '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)';
const RX_EM_RIGHT_AST = RX(RX_EM_RIGHT_AST_TMPL, 'gu')
  .rep(/notPunctSpace/g, RX_NOT_PUNCT_SPACE_TILDE)
  .rep(/punctSpace/g, RX_PUNCT_SPACE_NOTILDE)
  .rep(/punct/g, RX_PUNCT_NOTILDE)
  .get();
const RX_EM_RIGHT_UND_TMPL = '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)';
const RX_EM_RIGHT_UND = RX(RX_EM_RIGHT_UND_TMPL, 'gu')
  .rep(/notPunctSpace/g, RX_NOT_PUNCT_SPACE)
  .rep(/punctSpace/g, RX_PUNCT_SPACE)
  .rep(/punct/g, RX_PUNCT)
  .get();

// Strikethrough delimiter patterns.
const RX_DEL_LEFT = RX(/^~~?(?:((?!~)punct)|[^\s~])/, 'u').rep(/punct/g, RX_PUNCT).get();
const RX_DEL_RIGHT_TMPL = '^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)';
const RX_DEL_RIGHT = RX(RX_DEL_RIGHT_TMPL, 'gu')
  .rep(/notPunctSpace/g, RX_NOT_PUNCT_SPACE)
  .rep(/punctSpace/g, RX_PUNCT_SPACE)
  .rep(/punct/g, RX_PUNCT)
  .get();
const RX_DEL = /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/;

// Autolink <scheme:...> or <email>, and raw HTML tags inline.
const RX_EMAIL = /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/;
const RX_AUTOLINK = RX(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/)
  .rep('scheme', /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/)
  .rep('email', RX_EMAIL)
  .get();
const RX_TAG = RX('^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>')
  .rep('comment', RX_HTML_COMMENT_END)
  .rep('attribute', /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/)
  .get();

// Link pieces: label text (balanced brackets, code spans, escapes) and the
// inline / reference / shortcut link forms.
const RX_BRACKETED = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
const RX_LABEL_TEXT = RX(/(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/).rep('brackets', RX_BRACKETED).get();
const RX_LINK = RX(/^!?\[(label)\]\([ \t\n]*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?[ \t\n]*\)/)
  .rep('label', RX_LABEL_TEXT)
  .rep('href', /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/)
  .rep('title', /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/)
  .get();
const RX_REFLINK = RX(/^!?\[(label)\]\[(ref)\]/).rep('label', RX_LABEL_TEXT).rep('ref', RX_LABEL).get();
const RX_NOLINK = RX(/^!?\[(ref)\](?:\[\])?/).rep('ref', RX_LABEL).get();
const RX_REFLINK_SEARCH = RX('reflink|nolink(?!\\()', 'g')
  .rep('reflink', RX(/^!?\[(label)\]\[(ref)\]/).rep('label', RX(/(?:[^\[\]\\`]*(?:\[(?:brackets|\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\]))){0,999}?[^\[\]\\`]*?/).rep('brackets', RX_BRACKETED).get()).rep('ref', /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/).get())
  .rep('nolink', RX(/^!?\[(ref)\](?:\[\])?/).rep('ref', /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/).get())
  .get();

// Extended autolinks (www., scheme://, bare e-mail) and their backpedal,
// which trims trailing punctuation off a matched URL.
const RX_SCHEME = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
// The (@) group is needed in the bare-email alternative of RX_URL (group 2),
// but the mailto: alternative must not capture it, or the groups shift.
const RX_EMAIL_LOOSE = /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
const RX_EMAIL_PLAIN = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
const RX_MAILTO = RX(/(?:mailto:email|xmpp:email(?:\/[A-Za-z0-9@.]+)?)/).rep(/email/g, RX_EMAIL_PLAIN).get();
const RX_URL = RX(/^emailProtocol|^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/)
  .rep('emailProtocol', RX_MAILTO)
  .rep('protocol', RX_SCHEME)
  .rep('email', RX_EMAIL_LOOSE)
  .get();
const RX_BACKPEDAL = /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;

// Skip links, code spans and tags when masking a source for emphasis scans.
const RX_BLOCK_SKIP = RX(/link|precode-code|html/, 'g')
  .rep('link', /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/)
  .rep('precode-', '(?<!`)()')
  .rep('code', /(?<b>`+)[^`]+\k<b>(?!`)/)
  .rep('html', /<(?! )[^<>]*?>/)
  .get();

// Plain text: consume up to the next character that can start inline markup.
const RX_INLINE_TEXT = RX(/^(?:[^a-zA-Z0-9](?=emailProtocol)|(`+|~+|[^`~])(?:(?=[`~])|(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|wwwStart|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9](?=emailProtocol)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@))))/)
  .rep('protocol', RX_SCHEME)
  .rep(/emailProtocol/g, /(?:mailto|xmpp):/)
  .rep('wwwStart', '(?<![^\\s*_~(])www\\.')
  .get();

// ---- Block scanning ----
// A block is a small record {k, raw, ...}. Inline rendering is deferred:
// scanBlocks only collects blocks and link definitions; renderBlocks turns
// them into HTML once the whole document's definitions are known.

// Per-parse context: link definitions plus the inline lexer state.
function freshCtx() {
  return {
    links: Object.create(null),
    inLink: false,
    inRawBlock: false,
    linkEmitted: false,
    linkParenPossible: true,
    top: true,
    maskStack: [],
  };
}

// Dedent fenced code content when the fence itself was indented.
function dedentFence(raw, text) {
  const m = raw.match(RX_FENCE_INDENT);
  if (m === null) return text;
  const indent = m[1];
  return text.split('\n').map((line) => {
    const lead = line.match(/^\s+/);
    if (lead === null) return line;
    return line.slice(Math.min(lead[0].length, indent.length));
  }).join('\n');
}

function tryBlockquote(src, ctx) {
  const m = RX_BLOCKQUOTE.exec(src);
  if (!m) return null;
  let lines = trimEndChars(m[0], '\n').split('\n');
  let raw = '';
  let text = '';
  const blocks = [];
  while (lines.length > 0) {
    let lazy = false;
    const chunk = [];
    let p;
    for (p = 0; p < lines.length; p++) {
      if (RX_BQ_START.test(lines[p])) { chunk.push(lines[p]); lazy = true; }
      else if (!lazy) chunk.push(lines[p]);
      else break;
    }
    lines = lines.slice(p);
    const joined = chunk.join('\n');
    const stripped = joined
      .replace(RX_BQ_MARKER_WS, (g, mark, ws) => mark + expandTabs(ws, mark.length))
      .replace(RX_BQ_SETEXT, '\n    $1')
      .replace(RX_BQ_STRIP, '');
    raw = raw ? raw + '\n' + joined : joined;
    text = text ? text + '\n' + stripped : stripped;
    const savedTop = ctx.top;
    ctx.top = true;
    scanBlocks(stripped, blocks, true, ctx);
    ctx.top = savedTop;
    if (lines.length === 0) break;
    const last = blocks[blocks.length - 1];
    if (last && (last.k === 'code' || last.k === 'heading' || last.k === 'hr' || last.k === 'html' || last.k === 'table')) break;
    if (last && last.k === 'blockquote') {
      const rest = lines.join('\n');
      const again = last.raw + '\n' + rest.replace(RX_BQ_STRIP, '');
      const reparsed = tryBlockquote(again, ctx);
      blocks[blocks.length - 1] = reparsed.rec;
      const leftover = again.substring(reparsed.rec.raw.length).replace(/^\n/, '');
      const used = leftover ? leftover.split('\n').length : 0;
      const taken = used ? lines.slice(0, -used) : lines;
      if (taken.length > 0) raw = raw + '\n' + taken.join('\n');
      text = text.substring(0, text.length - last.text.length) + reparsed.rec.text;
      lines = lines.slice(taken.length);
      if (lines.length > 0 && RX_BQ_START.test(lines[0])) continue;
      break;
    }
    if (last && last.k === 'list') {
      const rest = last.raw + '\n' + lines.join('\n');
      const reparsed = tryList(rest, ctx);
      blocks[blocks.length - 1] = reparsed.rec;
      const extra = reparsed.rec.raw.length > last.raw.length
        ? rest.slice(last.raw.length + 1, reparsed.rec.raw.length).split('\n').length
        : 0;
      if (extra > 0) {
        const taken = lines.slice(0, extra).join('\n');
        raw += '\n' + taken;
        text += '\n' + taken;
      }
      lines = lines.slice(extra);
      continue;
    }
  }
  return { rec: { k: 'blockquote', raw, text, blocks }, len: raw.length };
}

function tryList(src, ctx) {
  const open = RX_LIST.exec(src);
  if (!open) return null;
  const whole = src;
  const consumed = () => whole.length - rest.length;
  let rest = src;
  const firstBullet = open[1].trim();
  const ordered = firstBullet.length > 1;
  const list = { k: 'list', raw: '', ordered, start: ordered ? +firstBullet.slice(0, -1) : 0, loose: false, items: [] };
  const bulletPat = ordered ? `\\d{1,9}\\${firstBullet.slice(-1)}` : `\\${firstBullet}`;
  const itemRx = RX_LIST_ITEM(bulletPat);
  let sawDoubleBlank = false;
  while (rest) {
    let blankItem = false;
    let content = '';
    const m = itemRx.exec(rest);
    if (!m || RX_HR.test(rest)) break;
    const startAt = consumed();
    rest = rest.substring(m[0].length);
    const firstLine = (m[2] || '').split('\n', 1)[0];
    const markerLen = m[1].length;
    let line = firstLine.replace(RX_LEAD_SPACE_TAB, (v) => expandTabs(v, markerLen));
    const nextLine = rest.split('\n', 1)[0];
    let emptyContent = !line.trim();
    let indent;
    if (emptyContent) {
      indent = markerLen + 1;
    } else {
      indent = line.search(RX_NON_SPACE);
      indent = indent > 4 ? 1 : indent;
      content = line.slice(indent);
      indent += markerLen;
    }
    if (emptyContent && RX_BLANK_LINE.test(nextLine)) {
      rest = rest.substring(nextLine.length + 1);
      blankItem = true;
    }
    if (!blankItem) {
      const nextBullet = RX_NEXT_BULLET(indent);
      const hrAt = RX_HR_AT(indent);
      const fenceAt = RX_FENCE_AT(indent);
      const headAt = RX_HEADING_AT(indent);
      const htmlAt = RX_HTML_AT(indent);
      const bqAt = RX_BQ_AT(indent);
      while (rest) {
        let cur = rest.split('\n', 1)[0];
        let expanded;
        if (fenceAt.test(cur) || headAt.test(cur) || htmlAt.test(cur) || bqAt.test(cur) || nextBullet.test(cur) || hrAt.test(cur)) break;
        expanded = cur.replace(RX_LEAD_SPACE_TAB, (v) => expandTabs(v));
        if (expanded.search(RX_NON_SPACE) >= indent || !cur.trim()) {
          content += '\n' + expanded.slice(indent);
        } else {
          if (emptyContent || line.replace(RX_TAB_G, '    ').search(RX_NON_SPACE) >= 4 || fenceAt.test(line) || headAt.test(line) || htmlAt.test(line) || hrAt.test(line)) break;
          const setextLine = /^ {0,3}(?:=+|-+) *$/.test(cur) && RX_LHEADING.test(`${line}\n${cur}`)
            ? `    ${expanded.replace(/^ {0,3}/, '')}`
            : cur;
          content += '\n' + setextLine;
        }
        emptyContent = !cur.trim();
        rest = rest.substring(cur.length + 1);
        line = expanded.slice(indent);
      }
    }
    const itemRaw = whole.slice(startAt, consumed());
    if (!list.loose) {
      if (sawDoubleBlank) list.loose = true;
      else if (RX_DOUBLE_BLANK.test(itemRaw)) sawDoubleBlank = true;
    }
    list.items.push({ raw: itemRaw, task: RX_LIST_TASK.test(content), loose: false, text: content, blocks: [], checkbox: undefined });
  }
  const lastItem = list.items[list.items.length - 1];
  if (!lastItem) return null;
  lastItem.raw = lastItem.raw.trimEnd();
  lastItem.text = lastItem.text.trimEnd();
  list.raw = whole.slice(0, consumed()).trimEnd();
  for (const item of list.items) {
    ctx.top = false;
    item.blocks = scanBlocks(item.text, [], false, ctx);
    if (!list.loose) {
      const spaces = item.blocks.filter((b) => b.k === 'space');
      if (spaces.length > 0 && spaces.some((b) => RX_ANY_LINE.test(b.raw))) list.loose = true;
    }
  }
  for (const item of list.items) {
    const first = item.blocks[0];
    if (item.task && (first && (first.k === 'text' || first.k === 'paragraph'))) {
      item.text = item.text.replace(RX_LIST_TASK_STRIP, '');
      first.raw = first.raw.replace(RX_LIST_TASK_STRIP, '');
      first.text = first.text.replace(RX_LIST_TASK_STRIP, '');
      const mark = RX_LIST_CHECKBOX.exec(item.raw);
      if (mark) {
        item.checkbox = mark[0] !== '[ ]';
        if (list.loose) {
          first.checkboxFirst = true;
          first.checkbox = item.checkbox;
        } else {
          item.checkboxFirst = true;
        }
      }
    } else if (item.task) {
      item.task = false;
    }
  }
  if (list.loose) {
    for (const item of list.items) {
      item.loose = true;
      for (const b of item.blocks) if (b.k === 'text') b.k = 'paragraph';
    }
  }
  return { rec: list, len: list.raw.length };
}

// Scan block-level constructs out of `src`, appending records to `out`.
// `mergePara` is true when scanning blockquote/list-continuation content:
// a paragraph at the start merges with a preceding paragraph record.
function scanBlocks(src, out, mergePara, ctx) {
  let guard = Infinity;
  let merging = mergePara;
  while (src) {
    if (src.length < guard) guard = src.length;
    else throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
    let m;
    // Blank lines.
    if ((m = RX_NEWLINE.exec(src)) && m[0].length > 0) {
      src = src.substring(m[0].length);
      const last = out[out.length - 1];
      if (m[0].length === 1 && last !== undefined) last.raw += '\n';
      else out.push({ k: 'space', raw: m[0] });
      continue;
    }
    // Indented code.
    if ((m = RX_INDENTED_CODE.exec(src))) {
      const raw = trimBlankTail(m[0]);
      const text = raw.replace(RX_CODE_INDENT, '');
      src = src.substring(m[0].length);
      const last = out[out.length - 1];
      if (last && (last.k === 'paragraph' || last.k === 'text')) {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + raw;
        last.text += '\n' + text;
      } else {
        out.push({ k: 'code', raw, text, lang: null });
      }
      continue;
    }
    // Fenced code.
    if ((m = RX_FENCES.exec(src))) {
      const raw = m[0];
      const lang = m[2] ? m[2].trim().replace(RX_ANY_PUNCT, '$1') : m[2];
      const text = dedentFence(raw, m[3] || '');
      src = src.substring(raw.length);
      out.push({ k: 'code', raw, text, lang });
      continue;
    }
    // ATX heading.
    if ((m = RX_HEADING.exec(src))) {
      let text = m[2].trim();
      if (/#$/.test(text)) {
        const stripped = trimEndChars(text, '#');
        if (!stripped || RX_END_SPACE_TAB.test(stripped)) text = stripped.trim();
      }
      src = src.substring(m[0].length);
      out.push({ k: 'heading', raw: trimEndChars(m[0], '\n'), depth: m[1].length, text });
      continue;
    }
    // Thematic break.
    if ((m = RX_HR.exec(src))) {
      src = src.substring(m[0].length);
      out.push({ k: 'hr', raw: trimEndChars(m[0], '\n') });
      continue;
    }
    // Blockquote.
    if ((m = tryBlockquote(src, ctx))) {
      src = src.substring(m.len);
      out.push(m.rec);
      continue;
    }
    // List.
    if ((m = tryList(src, ctx))) {
      src = src.substring(m.len);
      out.push(m.rec);
      continue;
    }
    // HTML block.
    if ((m = RX_HTML_BLOCK.exec(src))) {
      const raw = trimBlankTail(m[0]);
      src = src.substring(m[0].length);
      out.push({ k: 'html', raw, text: raw, pre: m[1] === 'pre' || m[1] === 'script' || m[1] === 'style' });
      continue;
    }
    // Link reference definition.
    if ((m = RX_DEF.exec(src))) {
      if (RX_START_ANGLE.test(m[2]) || findPairEnd(m[2], '()') === -1) {
        const raw = trimEndChars(m[0], '\n');
        const tag = normalizeLabel(m[1]);
        const href = m[2] ? m[2].replace(RX_HREF_BRACKETS, '$1').replace(RX_ANY_PUNCT, '$1') : '';
        const title = m[3] ? m[3].substring(1, m[3].length - 1).replace(RX_ANY_PUNCT, '$1') : m[3];
        src = src.substring(m[0].length);
        const last = out[out.length - 1];
        if (last && (last.k === 'paragraph' || last.k === 'text')) {
          last.raw += (last.raw.endsWith('\n') ? '' : '\n') + raw;
          last.text += '\n' + raw;
        } else {
          if (!Object.hasOwn(ctx.links, tag)) ctx.links[tag] = { href, title };
          out.push({ k: 'def', raw });
        }
      } else {
        // Not a definition after all: fall through to the paragraph rule.
        m = null;
      }
      if (m) continue;
    }
    // Table.
    if ((m = RX_TABLE.exec(src)) && RX_TABLE_DELIM.test(m[2])) {
      const headerCells = splitCells(m[1]);
      const delimCells = m[2].replace(RX_TABLE_TRIM_PIPES, '').split('|');
      const bodyLines = m[3] && m[3].trim() ? m[3].replace(RX_TABLE_ROW_BLANK, '').split('\n') : [];
      src = src.substring(m[0].length);
      const table = { k: 'table', raw: trimEndChars(m[0], '\n'), header: [], align: [], rows: [] };
      if (headerCells.length === delimCells.length) {
        for (const cell of delimCells) {
          if (RX_ALIGN_RIGHT.test(cell)) table.align.push('right');
          else if (RX_ALIGN_CENTER.test(cell)) table.align.push('center');
          else if (RX_ALIGN_LEFT.test(cell)) table.align.push('left');
          else table.align.push(null);
        }
        for (let i = 0; i < headerCells.length; i++) {
          table.header.push({ text: headerCells[i], header: true, align: table.align[i] });
        }
        for (const line of bodyLines) {
          table.rows.push(splitCells(line, table.header.length).map((cell, i) => ({ text: cell, header: false, align: table.align[i] })));
        }
        out.push(table);
        continue;
      }
      // Delimiter did not line up with the header: not a table. The header
      // line falls through to the paragraph rule below; rewind by putting
      // the matched text back is unnecessary because the paragraph pattern
      // will match the same first line. Re-run the loop on the original
      // source by restoring it.
      src = m[0] + src;
    }
    // Setext heading.
    if ((m = RX_LHEADING.exec(src))) {
      src = src.substring(m[0].length);
      out.push({ k: 'heading', raw: trimEndChars(m[0], '\n'), depth: m[2].charAt(0) === '=' ? 1 : 2, text: m[1].trim() });
      continue;
    }
    // Paragraph (only at the top level of a block scan).
    if (ctx.top && (m = RX_PARAGRAPH.exec(src))) {
      const text = m[1].charAt(m[1].length - 1) === '\n' ? m[1].slice(0, -1) : m[1];
      src = src.substring(m[0].length);
      const last = out[out.length - 1];
      if (merging && last && last.k === 'paragraph') {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + m[0];
        last.text += '\n' + text;
      } else {
        out.push({ k: 'paragraph', raw: m[0], text });
      }
      merging = false;
      continue;
    }
    // Plain text (reached inside list items, where paragraphs are off).
    if ((m = RX_TEXT.exec(src))) {
      src = src.substring(m[0].length);
      const last = out[out.length - 1];
      if (last && last.k === 'text') {
        last.raw += (last.raw.endsWith('\n') ? '' : '\n') + m[0];
        last.text += '\n' + m[0];
      } else {
        out.push({ k: 'text', raw: m[0], text: m[0] });
      }
      continue;
    }
    throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
  }
  ctx.top = true;
  return out;
}

// ---- Inline rendering ----
// Inline markup is rendered while scanning left to right. `plain` selects
// the alt-text mode (used for image alt text): no tags, no escaping, links
// and images render as their text, hard breaks vanish.

// Does `src` hold a link (inline or reference) that would actually resolve?
function linkInText(src, ctx) {
  if (!src.includes('[')) return false;
  for (const m of src.matchAll(RX_BLOCK_SKIP)) {
    if (RX_LINK.test(m[0]) && src.charAt(m.index - 1) !== '!') return true;
  }
  for (const m of src.matchAll(RX_REFLINK_SEARCH)) {
    const s = m[0];
    const r = s.lastIndexOf('[');
    if (!(s.charAt(0) === '!' || !Object.hasOwn(ctx.links, normalizeLabel(s.slice(r + 1, -1)))) && !(r > 1 && linkInText(s.slice(1, r - 1), ctx))) return true;
  }
  return false;
}

// Mask a source for emphasis scanning: hide links, code spans and tags so
// delimiter runs inside them are never seen as emphasis closers. Every
// replacement keeps the string the same length, so indexes stay aligned.
function maskInline(src, ctx) {
  let t = src;
  if (src.includes('[')) {
    const maskRef = (match) => {
      const o = match.lastIndexOf('[');
      if (!Object.hasOwn(ctx.links, normalizeLabel(match.slice(o + 1, -1)))) return match;
      if (o > 1 && match.charAt(0) !== '!') {
        const inner = match.slice(1, o - 1);
        if (linkInText(inner, ctx)) return '[' + inner.replace(RX_REFLINK_SEARCH, maskRef) + '][' + 'a'.repeat(match.length - o - 2) + ']';
      }
      return '[' + 'a'.repeat(match.length - 2) + ']';
    };
    t = t.replace(RX_REFLINK_SEARCH, maskRef);
  }
  t = t.replace(RX_ANY_PUNCT_CODE, (whole, code, punct) =>
    punct ? '+'.repeat(whole.length)
      : code ? code + whole.slice(code.length, -code.length).replace(/`/g, '+') + code
      : whole);
  t = t.replace(RX_BLOCK_SKIP, (whole, _g1, g2) => {
    const keep = g2 ? g2.length : 0;
    return whole.slice(0, keep) + '[' + 'a'.repeat(whole.length - keep - 2) + ']';
  });
  return t;
}

// The mask info of the innermost inline scan, for closer lookups.
function closerInfo(ctx, masked) {
  const top = ctx.maskStack[ctx.maskStack.length - 1];
  if (top && top.src === masked) return top;
  return maskInfo(masked);
}

// Render inline markup in `src`. `plain` renders alt text instead of HTML.
function inlineRender(src, plain, ctx) {
  const masked = (src.includes('*') || src.includes('_') || src.includes('~')) ? maskInline(src, ctx) : src;
  ctx.maskStack.push(maskInfo(masked));
  const savedParen = ctx.linkParenPossible;
  ctx.linkParenPossible = savedParen && src.includes(')');
  try {
    return inlineScan(src, masked, plain, ctx);
  } finally {
    ctx.maskStack.pop();
    ctx.linkParenPossible = savedParen;
  }
}

// A link or image whose text contains a tag is not a link at all.
function isLinkInTag(src, label, offset) {
  if (!label.includes('<')) return false;
  for (let s = 0; s < label.length; s++) {
    if (label[s] === '\\') { s++; continue; }
    if (label[s] === '`') {
      const code = RX_CODESPAN.exec(label.slice(s));
      if (code) { s += code[0].length - 1; continue; }
    }
    if (label[s] !== '<') continue;
    const tag = RX_TAG.exec(src.slice(offset + s)) || RX_AUTOLINK.exec(src.slice(offset + s));
    if (tag) {
      if (tag[0].length > label.length - s) return true;
      s += tag[0].length - 1;
    }
  }
  return false;
}

function renderAutolink(text, href, plain) {
  if (plain) return text;
  const cleaned = cleanUrl(href);
  if (cleaned === null) return esc(text, true);
  return `<a href="${esc(cleaned, true)}">${esc(text, true)}</a>`;
}

// Build a link or image from a match, rendering its label text. Returns
// null when the label itself contains a link (a link cannot hold a link).
function buildLink(match, href, title, raw, ctx, plain) {
  const label = match[1].replace(RX_LINK_BRACKET_ESC, '$1');
  const isImage = match[0].charAt(0) === '!';
  const savedInLink = ctx.inLink;
  const savedEmitted = ctx.linkEmitted;
  const savedRawBlock = ctx.inRawBlock;
  ctx.inLink = true;
  ctx.linkEmitted = false;
  const inner = inlineRender(label, isImage ? true : plain, ctx);
  const emittedInside = ctx.linkEmitted;
  ctx.linkEmitted = savedEmitted;
  ctx.inLink = savedInLink;
  if (!isImage) {
    if (emittedInside) {
      ctx.inRawBlock = savedRawBlock;
      return null;
    }
    ctx.linkEmitted = true;
  }
  if (plain) return { consumed: raw.length, html: inner };
  if (isImage) {
    const cleaned = cleanUrl(href);
    if (cleaned === null) return { consumed: raw.length, html: esc(inner) };
    let out = `<img src="${esc(cleaned)}" alt="${esc(inner)}"`;
    if (title) out += ` title="${esc(title)}"`;
    return { consumed: raw.length, html: out + '>' };
  }
  const cleaned = cleanUrl(href);
  if (cleaned === null) return { consumed: raw.length, html: inner };
  let out = `<a href="${esc(cleaned)}"`;
  if (title) out += ` title="${esc(title)}"`;
  return { consumed: raw.length, html: out + `>${inner}</a>` };
}

function tryLink(rest, ctx, plain) {
  const m = RX_LINK.exec(rest);
  if (!m) return null;
  const offset = m[0].charAt(0) === '!' ? 2 : 1;
  if (isLinkInTag(rest, m[1], offset)) return null;
  const hrefSrc = m[2].trim();
  let raw = m[0];
  let title = m[3] ? m[3].slice(1, -1) : '';
  if (RX_START_ANGLE.test(hrefSrc)) {
    if (!RX_END_ANGLE.test(hrefSrc)) return null;
    const stripped = trimEndChars(hrefSrc.slice(0, -1), '\\');
    if ((hrefSrc.length - stripped.length) % 2 === 0) return null;
  } else {
    const paren = findPairEnd(m[2], '()');
    if (paren === -2) return null;
    if (paren > -1) {
      const cut = (m[0].indexOf('!') === 0 ? 5 : 4) + m[1].length + paren;
      m[2] = m[2].substring(0, paren);
      raw = m[0].substring(0, cut).trim();
      title = '';
    }
  }
  const tail = trimEndChars(raw.slice(0, -1), '\\');
  if ((raw.length - tail.length) % 2 === 0) return null;
  let dest = m[2].trim();
  if (RX_START_ANGLE.test(dest)) dest = dest.slice(1, -1);
  const href = dest ? dest.replace(RX_ANY_PUNCT, '$1') : '';
  title = title ? title.replace(RX_ANY_PUNCT, '$1') : '';
  return buildLink(m, href, title, raw, ctx, plain);
}

function tryReflink(rest, ctx, plain) {
  const m = RX_REFLINK.exec(rest) || RX_NOLINK.exec(rest);
  if (!m) return null;
  const offset = m[0].charAt(0) === '!' ? 2 : 1;
  if (isLinkInTag(rest, m[1], offset)) return null;
  const def = ctx.links[normalizeLabel(m[2] || m[1])];
  if (!def) {
    const ch = rest[0];
    return { consumed: 1, html: plain ? ch : esc(ch) };
  }
  return buildLink(m, def.href, def.title, m[0], ctx, plain);
}

// Emphasis / strong emphasis, following the delimiter-run rules: a run can
// open only when the character after it and the one before it allow it, and
// the closer is found by scanning the masked source for a matching run,
// honouring the rule of three for mixed runs.
function tryEmStrong(rest, masked, prev, ctx, plain) {
  const s = RX_EM_LEFT.exec(rest);
  if (!s || (!s[1] && !s[2] && !s[3] && !s[4])) return null;
  const delim = s[0][0];
  const sameAsPrev = prev === delim;
  const offset = masked.length - rest.length;
  let runStart = offset;
  while (runStart > 0 && masked[runStart - 1] === delim) runStart--;
  const beforeRun = [...masked.slice(Math.max(0, runStart - 2), runStart)].at(-1) ?? '';
  const beforeIsPunct = beforeRun === '*' || beforeRun === '_' || !!RX_PUNCT_START.exec(beforeRun);
  let prevCh = prev;
  if (runStart < offset) prevCh = beforeRun;
  const prevIsPunct = runStart < offset ? beforeIsPunct : !!RX_PUNCT_START.exec(prevCh);
  if (s[4] && prevCh.match(RX_ALNUM)) return null;
  const afterPunct = s[1] || s[3] || '';
  if (!afterPunct || !prevCh || prevIsPunct) {
    const runLen = [...s[0]].length - 1;
    let openers = runLen;
    let skipped = 0;
    const total = offset - runStart + runLen;
    const canClose = !!beforeRun.trim() && (!!afterPunct || (delim === '*' && !beforeIsPunct));
    if (delim !== '*' && delim !== '_') return null;
    const closerRx = delim === '*' ? RX_EM_RIGHT_AST : RX_EM_RIGHT_UND;
    const lastCloser = closerInfo(ctx, masked).em[delim];
    const afterOpen = offset + runLen;
    if (lastCloser < afterOpen) return null;
    const tail = masked.slice(offset + runLen);
    const maxIdx = lastCloser - afterOpen;
    closerRx.lastIndex = 0;
    let c;
    while ((c = closerRx.exec(tail)) !== null && !(c.index > maxIdx)) {
      const g = c[1] || c[2] || c[3] || c[4] || c[5] || c[6];
      if (!g) continue;
      const b = [...g].length;
      if (c[3] || c[4]) { openers += b; continue; }
      if (c[5] || c[6] || canClose) {
        if (sameAsPrev && (c[5] || c[6])) break;
        if (total % 3 && !((total + b) % 3)) { skipped += b; continue; }
      }
      openers -= b;
      if (openers > 0) continue;
      const use = Math.min(b, b + openers + skipped);
      const firstLen = [...c[0]][0].length;
      const whole = rest.slice(0, runLen + c.index + firstLen + use);
      if (Math.min(runLen, use) % 2) {
        const inner = whole.slice(1, -1);
        const rendered = inlineRender(inner, plain, ctx);
        return { consumed: whole.length, html: plain ? rendered : `<em>${rendered}</em>` };
      }
      const inner = whole.slice(2, -2);
      const rendered = inlineRender(inner, plain, ctx);
      return { consumed: whole.length, html: plain ? rendered : `<strong>${rendered}</strong>` };
    }
  }
  return null;
}

// Strikethrough: one or two tildes, with the same closer scan as emphasis
// but the closer run must be exactly as long as the opener.
function tryDel(rest, masked, prev, ctx, plain) {
  const s = RX_DEL_LEFT.exec(rest);
  if (!s) return null;
  if (!s[1] || !prev || RX_PUNCT_START.exec(prev)) {
    const runLen = [...s[0]].length - 1;
    let openers = runLen;
    const lastCloser = closerInfo(ctx, masked).del;
    const afterOpen = masked.length - rest.length + runLen;
    if (lastCloser < afterOpen) return null;
    const tail = masked.slice(masked.length - rest.length + runLen);
    const maxIdx = lastCloser - afterOpen;
    RX_DEL_RIGHT.lastIndex = 0;
    let c;
    while ((c = RX_DEL_RIGHT.exec(tail)) !== null && !(c.index > maxIdx)) {
      const g = c[1] || c[2] || c[3] || c[4] || c[5] || c[6];
      if (!g) continue;
      const b = [...g].length;
      if (b !== runLen) continue;
      if (c[3] || c[4]) { openers += b; continue; }
      openers -= b;
      if (openers > 0) continue;
      const use = Math.min(b, b + openers);
      const firstLen = [...c[0]][0].length;
      const whole = rest.slice(0, runLen + c.index + firstLen + use);
      const inner = whole.slice(runLen, -runLen);
      const rendered = inlineRender(inner, plain, ctx);
      return { consumed: whole.length, html: plain ? rendered : `<del>${rendered}</del>` };
    }
  }
  return null;
}

function tryUrl(rest, ctx, plain) {
  const m = RX_URL.exec(rest);
  if (!m) return null;
  let text, href;
  if (m[2] === '@') {
    text = m[0];
    href = 'mailto:' + text;
  } else {
    let cur = m[0];
    let prev;
    do {
      prev = cur;
      const b = RX_BACKPEDAL.exec(cur);
      cur = b ? b[0] : '';
    } while (cur !== prev);
    text = cur;
    href = m[1] === 'www.' ? 'http://' + cur : cur;
  }
  return { consumed: text.length, html: renderAutolink(text, href, plain) };
}

function inlineScan(src, masked, plain, ctx) {
  let out = '';
  let rest = src;
  let lastWasText = false;
  let prevChar = '';
  let guard = Infinity;
  while (rest) {
    if (rest.length < guard) guard = rest.length;
    else throw new Error('Infinite loop on byte: ' + rest.charCodeAt(0));
    if (!lastWasText) prevChar = '';
    lastWasText = false;
    let r;
    const first = rest[0];
    // Backslash escape.
    if (first === '\\' && (r = RX_ESCAPE.exec(rest))) {
      out += plain ? r[1] : esc(r[1]);
      rest = rest.substring(r[0].length);
      continue;
    }
    // Raw HTML tag (also tracks <a> and <pre>-like state).
    if (first === '<' && (r = RX_TAG.exec(rest))) {
      if (!ctx.inLink && RX_START_A.test(r[0])) ctx.inLink = true;
      else if (ctx.inLink && RX_END_A.test(r[0])) ctx.inLink = false;
      if (!ctx.inRawBlock && RX_START_PRE.test(r[0])) ctx.inRawBlock = true;
      else if (ctx.inRawBlock && RX_END_PRE.test(r[0])) ctx.inRawBlock = false;
      out += r[0];
      rest = rest.substring(r[0].length);
      continue;
    }
    // Inline link or image.
    if ((first === '[' || first === '!') && ctx.linkParenPossible) {
      r = tryLink(rest, ctx, plain);
      if (r) { out += r.html; rest = rest.substring(r.consumed); continue; }
    }
    // Reference / shortcut link or image.
    if (first === '[' || first === '!') {
      r = tryReflink(rest, ctx, plain);
      if (r) { out += r.html; rest = rest.substring(r.consumed); continue; }
    }
    // Emphasis / strong.
    if (first === '*' || first === '_') {
      r = tryEmStrong(rest, masked, prevChar, ctx, plain);
      if (r) { out += r.html; rest = rest.substring(r.consumed); continue; }
    }
    // Code span.
    if (first === '`' && (r = RX_CODESPAN.exec(rest))) {
      let text = r[2].replace(RX_NEWLINE_G, ' ');
      if (RX_NON_SPACE.test(text) && RX_START_SPACE.test(text) && RX_END_SPACE.test(text)) text = text.substring(1, text.length - 1);
      out += plain ? text : `<code>${esc(text, true)}</code>`;
      rest = rest.substring(r[0].length);
      continue;
    }
    // Hard line break.
    if ((first === ' ' || first === '\\') && (r = RX_BR.exec(rest))) {
      out += plain ? '' : '<br>';
      rest = rest.substring(r[0].length);
      continue;
    }
    // Strikethrough.
    if (first === '~') {
      r = tryDel(rest, masked, prevChar, ctx, plain);
      if (r) { out += r.html; rest = rest.substring(r.consumed); continue; }
    }
    // Autolink <...>.
    if (first === '<' && (r = RX_AUTOLINK.exec(rest))) {
      const text = r[1];
      const href = r[2] === '@' ? 'mailto:' + text : text;
      out += renderAutolink(text, href, plain);
      rest = rest.substring(r[0].length);
      continue;
    }
    // Extended autolink (www. / scheme:// / e-mail), never inside a link.
    if (!ctx.inLink && /[A-Za-z0-9._+\-]/.test(first)) {
      r = tryUrl(rest, ctx, plain);
      if (r) { out += r.html; rest = rest.substring(r.consumed); continue; }
    }
    // Plain text up to the next markup character.
    if ((r = RX_INLINE_TEXT.exec(rest))) {
      const chunk = r[0];
      out += ctx.inRawBlock ? chunk : (plain ? decodeRefs(chunk) : esc(decodeRefs(chunk)));
      if (chunk.slice(-1) !== '_') prevChar = chunk.slice(-1);
      lastWasText = true;
      rest = rest.substring(chunk.length);
      continue;
    }
    throw new Error('Infinite loop on byte: ' + rest.charCodeAt(0));
  }
  return out;
}

// ---- Block rendering ----

function checkboxHtml(checked) {
  return '<input ' + (checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
}

function renderTableCell(cell, ctx) {
  const tag = cell.header ? 'th' : 'td';
  const align = cell.align ? ` align="${cell.align}"` : '';
  return `<${tag}${align}>${inlineRender(cell.text, false, ctx)}</${tag}>\n`;
}

function renderTable(b, ctx) {
  let head = '';
  for (const cell of b.header) head += renderTableCell(cell, ctx);
  let body = '';
  for (const row of b.rows) {
    let cells = '';
    for (const cell of row) cells += renderTableCell(cell, ctx);
    body += `<tr>\n${cells}</tr>\n`;
  }
  let out = `<table>\n<thead>\n<tr>\n${head}</tr>\n</thead>\n`;
  if (body) out += `<tbody>${body}</tbody>`;
  return out + '</table>\n';
}

function renderList(b, ctx) {
  const tag = b.ordered ? 'ol' : 'ul';
  const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
  let out = `<${tag}${start}>\n`;
  for (const item of b.items) {
    let inner = '';
    if (item.checkboxFirst) inner += checkboxHtml(item.checkbox);
    inner += renderBlocks(item.blocks, ctx);
    out += `<li>${inner}</li>\n`;
  }
  return out + `</${tag}>\n`;
}

function renderBlocks(blocks, ctx) {
  let out = '';
  for (const b of blocks) {
    switch (b.k) {
      case 'space':
        break;
      case 'code': {
        const first = (b.lang || '').match(RX_NOT_SPACE_START)?.[0];
        const text = b.text ? b.text.replace(RX_END_NEWLINE, '') + '\n' : '';
        const body = esc(text, true);
        out += first
          ? `<pre><code class="language-${esc(first)}">${body}</code></pre>\n`
          : `<pre><code>${body}</code></pre>\n`;
        break;
      }
      case 'heading':
        out += `<h${b.depth}>${inlineRender(b.text, false, ctx)}</h${b.depth}>\n`;
        break;
      case 'hr':
        out += '<hr>\n';
        break;
      case 'blockquote':
        out += `<blockquote>\n${renderBlocks(b.blocks, ctx)}</blockquote>\n`;
        break;
      case 'list':
        out += renderList(b, ctx);
        break;
      case 'html':
        out += b.text;
        break;
      case 'def':
        break;
      case 'table':
        out += renderTable(b, ctx);
        break;
      case 'paragraph': {
        const inner = inlineRender(b.text, false, ctx);
        out += b.checkboxFirst
          ? `<p>${checkboxHtml(b.checkbox)}${inner}</p>\n`
          : `<p>${inner}</p>\n`;
        break;
      }
      case 'text': {
        const inner = inlineRender(b.text, false, ctx);
        out += b.checkboxFirst ? checkboxHtml(b.checkbox) + inner : inner;
        break;
      }
    }
  }
  return out;
}

/** The HTML marked 18.1.3 renders for `markdown`, with marked's defaults. */
export function parse(markdown) {
  if (typeof markdown !== 'string') {
    if (markdown === undefined || markdown === null) throw new Error('marked(): input parameter is undefined or null');
    throw new Error('marked(): input parameter is of type ' + Object.prototype.toString.call(markdown) + ', string expected');
  }
  const ctx = freshCtx();
  const blocks = scanBlocks(markdown.replace(RX_CR, '\n'), [], false, ctx);
  return renderBlocks(blocks, ctx);
}
