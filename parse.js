// SwiftMark - a fast renderer producing exactly marked 18.1.3 HTML.
// Written from scratch for the make.fun markdown-render-speed-02 bounty.
// Single file, no dependencies, no imports, deterministic, no caching
// across parse() calls, no network/clock/env use.

const ASCII_PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const ASCII_SPACE = " \t\n\r\f\v";

function isSpaceCode(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11;
}

function isAsciiPunctCode(c) {
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}

// Unicode-aware punctuation check (marked's \p{P}|\p{S} class).
function isPunctChar(ch) {
  const c = ch.charCodeAt(0);
  if (c < 128) return isAsciiPunctCode(c);
  return /[\p{P}\p{S}]/u.test(ch);
}

// marked's punctSpace class: whitespace or punctuation/symbol.
function isPunctSpaceChar(ch) {
  const c = ch.charCodeAt(0);
  if (c < 128) return isAsciiPunctCode(c) || isSpaceCode(c);
  return /[\s\p{P}\p{S}]/u.test(ch);
}

// notPunctSpace class: not whitespace and not punctuation/symbol.
function isNotPunctSpaceChar(ch) {
  const c = ch.charCodeAt(0);
  if (c < 128) return !isAsciiPunctCode(c) && !isSpaceCode(c);
  return /[^\s\p{P}\p{S}]/u.test(ch);
}

function isAlnumChar(ch) {
  const c = ch.charCodeAt(0);
  if (c < 128) return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  return /[\p{L}\p{N}]/u.test(ch);
}

// Opening-quote class (marked's openQuote): Pi, Ps, " and '.
function isOpenQuoteChar(ch) {
  const c = ch.charCodeAt(0);
  if (c === 34 || c === 39) return true;
  if (c < 128) return false;
  return /[\p{Pi}\p{Ps}]/u.test(ch);
}

const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Escape with encode=true: escape & < > " ' always.
function escFull(s) {
  if (!/[&<>"']/.test(s)) return s;
  let out = "";
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const m = ESC_MAP[s[i]];
    if (m) { out += s.slice(last, i) + m; last = i + 1; }
  }
  return out + s.slice(last);
}

// Escape with encode=false: escape < > " ' always; escape & only when it
// does not start a valid entity reference.
function escText(s) {
  if (!/[&<>"']/.test(s)) return s;
  let out = "";
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "&") {
      if (isEntityAt(s, i)) continue;
      out += s.slice(last, i) + "&amp;";
      last = i + 1;
    } else {
      const m = ESC_MAP[ch];
      if (m) { out += s.slice(last, i) + m; last = i + 1; }
    }
  }
  return out + s.slice(last);
}

// True when s starting at i is a valid entity reference:
// &#digits; (1-7), &#x hex; (1-6), or &word; .
function isEntityAt(s, i) {
  if (s[i] !== "&" || i + 1 >= s.length) return false;
  let j = i + 1;
  if (s[j] === "#") {
    j++;
    if (s[j] === "x" || s[j] === "X") {
      j++;
      const st = j;
      while (j < s.length && j - st < 6 && /[0-9A-Fa-f]/.test(s[j])) j++;
      return j > st && j < s.length && s[j] === ";";
    }
    const st = j;
    while (j < s.length && j - st < 7 && s[j] >= "0" && s[j] <= "9") j++;
    return j > st && j < s.length && s[j] === ";";
  }
  const st = j;
  while (j < s.length && /[A-Za-z0-9]/.test(s[j])) j++;
  return j > st && j < s.length && s[j] === ";";
}

// marked's unescape: decode numeric character references in plain text;
// a bare & (not starting a valid entity) becomes &amp;.
// Only runs the replacement when a numeric reference is present.
function unescapeText(s) {
  if (!/&#(?:\d{1,7}|[Xx][0-9A-Fa-f]{1,6});/.test(s)) return s;
  return s.replace(/&#(?:(\d{1,7})|[Xx]([0-9A-Fa-f]{1,6}));|&(?!(#\d{1,7}|#[Xx][0-9A-Fa-f]{1,6}|\w+);)/g,
    (m, dec, hex) => {
      if (dec === undefined && hex === undefined) return "&amp;";
      const v = hex === undefined ? parseInt(dec, 10) : parseInt(hex, 16);
      if (v === 0 || v > 1114111 || (v >= 55296 && v <= 57343)) return "\uFFFD";
      if (v === 38) return "&amp;";
      return String.fromCodePoint(v);
    });
}

// marked's cleanUrl: encodeURI, restoring %25 to %, or null on failure.
function cleanUrl(href) {
  try {
    return encodeURI(href).replace(/%25/g, "%");
  } catch {
    return null;
  }
}

// marked's label normalisation (case fold via lower/upper/lower).
function normalizeLabel(s) {
  return s.trim().replace(/\s+/g, " ").toLowerCase().toUpperCase().toLowerCase();
}

// Strip trailing occurrences of ch from s (marked's L helper).
function stripTrailing(s, ch) {
  let n = s.length;
  while (n > 0 && s.charAt(n - 1) === ch) n--;
  return s.slice(0, n);
}

// Find the index of the closing bracket that brings the level below 0,
// -2 when an opener is left unclosed, -1 when no bracket is present.
function findClosingBracket(s, open, close) {
  if (s.indexOf(open) === -1 && s.indexOf(close) === -1) return -1;
  let level = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") { i++; continue; }
    if (s[i] === open) level++;
    else if (s[i] === close) {
      level--;
      if (level < 0) return i;
    }
  }
  return level > 0 ? -2 : -1;
}

function isBlankLine(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== " " && s[i] !== "\t") return false;
  }
  return true;
}

// Count leading whitespace columns of a line (tab = next multiple of 4).
function leadColumns(s) {
  let col = 0;
  let i = 0;
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === 32) { col++; i++; }
    else if (c === 9) { col += 4 - (col % 4); i++; }
    else break;
  }
  return { chars: i, cols: col };
}

// Expand tabs in s to spaces, starting at column startCol.
function expandTabs(s, startCol) {
  if (s.indexOf("\t") === -1) return s;
  let col = startCol;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\t") {
      const w = 4 - (col % 4);
      out += " ".repeat(w);
      col += w;
    } else {
      out += s[i];
      col++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

// Per-parse inline state. inLink persists across inline texts (paragraphs);
// inRawBlock is reset before each inline text by the caller; canLink is
// set by lexInline on entry (restored on exit).
function newInlineState() {
  return { inLink: false, inRawBlock: false, canLink: true };
}

// Match a link label starting at text[i] === '['.
// Returns {end, label} where end is the index just past the closing ']',
// or null when the label is invalid. Grammar (marked's label rule):
// nested [...] pairs (one level), backslash escapes, code spans whose
// content holds no backtick (closing run may differ in length), a run of
// 2+ backticks directly before ']', or any other single char.
function matchLabel(text, i) {
  const n = text.length;
  let j = i + 1;
  let depth = 0;
  while (j < n) {
    const c = text[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "`") {
      let k = j;
      while (k < n && text[k] === "`") k++;
      const run = k - j;
      // A run of 2+ backticks directly before ']' is a literal
      // (the `+(?=\]) alternative) -- it is NOT a code-span opener.
      if (run >= 2 && k < n && text[k] === "]") { j = k; continue; }
      // code span: find the next backtick run; the label regex's code
      // span alternative accepts any closer run length.
      let m = k;
      let close = -1;
      let closeRun = 0;
      while (m < n) {
        if (text[m] === "`") {
          let e = m;
          while (e < n && text[e] === "`") e++;
          close = m;
          closeRun = e - m;
          break;
        }
        m++;
      }
      if (close !== -1) {
        if (close > k) { j = close + closeRun; continue; }
      }
      return null;
    }
    if (c === "[") {
      // the label regex nests two levels: the outer label may contain a
      // [...] pair, whose content may itself contain one [...] pair
      if (depth >= 2) return null;
      depth++;
      j++;
      continue;
    }
    if (c === "]") {
      if (depth >= 1) { depth--; j++; continue; }
      return { end: j + 1, label: text.slice(i + 1, j) };
    }
    j++;
  }
  return null;
}

// Scan a reference (reflink `be` rule): 1..999 chars, escapes or chars
// other than [ ] \, not starting with optional whitespace then ']'.
function scanRef(text, i) {
  const n = text.length;
  let k = i;
  while (k < n && (text[k] === " " || text[k] === "\t" || text[k] === "\n")) k++;
  if (k < n && text[k] === "]") return null;
  let j = i;
  let count = 0;
  while (j < n && count < 999) {
    const c = text[j];
    if (c === "]") break;
    if (c === "[" || c === "\\" && j + 1 >= n) return null;
    if (c === "\\") { j += 2; count += 2; continue; }
    j++;
    count++;
  }
  if (count === 0) return null;
  if (j >= n || text[j] !== "]") return null;
  return { end: j + 1, ref: text.slice(i, j) };
}

// Scan a `le` reference (used by reflink/nolink label and defs): escapes,
// non-bracket chars, or a newline not followed by a blank line.
function scanLeRef(text, i) {
  const n = text.length;
  let j = i;
  let k = i;
  while (k < n && (text[k] === " " || text[k] === "\t" || text[k] === "\n")) k++;
  if (k < n && text[k] === "]") return null;
  while (j < n) {
    const c = text[j];
    if (c === "]") break;
    if (c === "[" || c === "\\") {
      if (c === "[") return null;
      if (j + 1 >= n) return null;
      j += 2;
      continue;
    }
    if (c === "\n") {
      // newline not followed by a blank line
      let m = j + 1;
      while (m < n && (text[m] === " " || text[m] === "\t")) m++;
      if (m < n && text[m] === "\n") return null;
      j++;
      continue;
    }
    j++;
  }
  if (j >= n || text[j] !== "]" || j === i) return null;
  return { end: j + 1, ref: text.slice(i, j) };
}

// True when the label contains an unclosed '<' tag/autolink (marked's Be).
function labelHasUnclosedTag(src, label, labelStart) {
  if (label.indexOf("<") === -1) return false;
  for (let s = 0; s < label.length; s++) {
    if (label[s] === "\\") { s++; continue; }
    if (label[s] === "`") {
      const cs = matchCodeSpan(label, s);
      if (cs) { s += cs.end - 1; continue; }
    }
    if (label[s] !== "<") continue;
    const rest = src.slice(labelStart + s);
    const tag = matchTagRaw(rest);
    const auto = tag === null ? matchAutolinkRaw(rest) : null;
    const m = tag || auto;
    if (m) {
      if (m.end > label.length - s) return true;
      s += m.end - 1;
    }
  }
  return false;
}

// Match a code span at text[i] === '`' (normal inline rule: closing run
// must equal the opening run, content at least one char).
function matchCodeSpan(text, i) {
  const n = text.length;
  let j = i;
  while (j < n && text[j] === "`") j++;
  const run = j - i;
  let k = j;
  while (k < n) {
    if (text[k] === "`") {
      let e = k;
      while (e < n && text[e] === "`") e++;
      if (e - k === run) {
        const content = text.slice(j, k);
        if (content.length === 0) return null;
        return { end: e, content };
      }
      k = e;
      continue;
    }
    k++;
  }
  return null;
}

// Render a code span's content: newlines become spaces; one leading and
// one trailing space are stripped when both are present and the content
// is not all spaces.
function codeSpanText(content) {
  const s = content.replace(/\n/g, " ");
  if (s.length > 0 && /[^ ]/.test(s) && s[0] === " " && s[s.length - 1] === " ") {
    return s.substring(1, s.length - 1);
  }
  return s;
}

// Match a raw HTML tag at text[i] === '<'. Returns {end} or null.
// Comment, processing instruction, declaration, CDATA, open tag (with
// attribute rules), close tag (no attributes).
function matchTagRaw(text) {
  if (text[0] !== "<") return null;
  const n = text.length;
  // Comment <!-- ... --> : the first alternative is -?> (an optional
  // '-' followed by '>'), so <!--> and <!---> are complete comments;
  // otherwise scan to -->
  if (text.startsWith("<!--")) {
    if (text[4] === ">") return { end: 5 };
    if (text[4] === "-" && text[5] === ">") return { end: 6 };
    const e = text.indexOf("-->", 4);
    if (e === -1) return null;
    return { end: e + 3 };
  }
  // Processing instruction <? ... ?>
  if (text.startsWith("<?")) {
    const e = text.indexOf("?>", 2);
    if (e === -1) return null;
    return { end: e + 2 };
  }
  // CDATA <![CDATA[ ... ]]>
  if (text.startsWith("<![CDATA[")) {
    const e = text.indexOf("]]>", 9);
    if (e === -1) return null;
    return { end: e + 3 };
  }
  // Declaration <!Letter ... >
  if (text.startsWith("<!") && n > 2 && /[A-Za-z]/.test(text[2])) {
    let j = 2;
    while (j < n && text[j] !== ">") {
      if (text[j] === "<") return null;
      j++;
    }
    if (j >= n) return null;
    // needs whitespace after the name: <!X ...>
    if (!/[ \t\n]/.test(text.slice(3, j)) && j > 3) {
      // declaration requires a space after the tag name word
      let k = 2;
      while (k < j && /[A-Za-z]/.test(text[k])) k++;
      if (k === j) return null;
    }
    return { end: j + 1 };
  }
  // Closing tag </name ... >
  if (text.startsWith("</")) {
    let j = 2;
    if (j >= n || !/[A-Za-z]/.test(text[j])) return null;
    while (j < n && /[A-Za-z0-9-]/.test(text[j])) j++;
    while (j < n && (text[j] === " " || text[j] === "\t" || text[j] === "\n")) j++;
    if (j >= n || text[j] !== ">") return null;
    return { end: j + 1 };
  }
  // Open tag <name (attr)* /?>
  {
    let j = 1;
    if (j >= n || !/[A-Za-z]/.test(text[j])) return null;
    while (j < n && /[A-Za-z0-9-]/.test(text[j])) j++;
    while (true) {
      // attribute: whitespace + name + optional =value
      let k = j;
      while (k < n && (text[k] === " " || text[k] === "\t" || text[k] === "\n")) k++;
      if (k === j) break;
      if (k < n && /[A-Za-z_:]/.test(text[k])) {
        let m = k;
        while (m < n && /[\w.:-]/.test(text[m])) m++;
        let p = m;
        while (p < n && (text[p] === " " || text[p] === "\t" || text[p] === "\n")) p++;
        if (p < n && text[p] === "=") {
          p++;
          while (p < n && (text[p] === " " || text[p] === "\t" || text[p] === "\n")) p++;
          if (p < n && (text[p] === '"' || text[p] === "'")) {
            const q = text[p];
            p++;
            while (p < n && text[p] !== q) p++;
            if (p >= n) return null;
            p++;
          } else {
            let q = p;
            while (q < n && !/[ \t\n"'=<>`]/.test(text[q])) q++;
            if (q === p) return null;
            p = q;
          }
          j = p;
        } else {
          // valueless attribute: leave the whitespace so the next
          // attribute's required leading whitespace is still there
          j = m;
        }
        continue;
      }
      break;
    }
    let k = j;
    while (k < n && (text[k] === " " || text[k] === "\t" || text[k] === "\n")) k++;
    if (k < n && text[k] === "/") k++;
    if (k >= n || text[k] !== ">") return null;
    return { end: k + 1 };
  }
}

// Match an autolink <scheme:...> or <email> at text[i] === '<'.
// Returns {end, href, text} or null.
function matchAutolinkRaw(text) {
  if (text[0] !== "<") return null;
  const n = text.length;
  let j = 1;
  // scheme: letter followed by letters/digits/+/./- (2..32 chars total), ':'
  if (j < n && /[A-Za-z]/.test(text[j])) {
    let k = j + 1;
    while (k < n && /[A-Za-z0-9+.-]/.test(text[k])) k++;
    const schemeLen = k - j;
    if (schemeLen >= 2 && schemeLen <= 32 && k < n && text[k] === ":") {
      let m = k + 1;
      // the autolink body has no whitespace at all ([^\s\x00-\x1f<>]*)
      while (m < n && text[m] !== ">" && text[m] !== "<" && text[m] !== " " && text[m] !== "\t" && text[m] !== "\n" && text[m].charCodeAt(0) > 31) m++;
      if (m < n && text[m] === ">") {
        const inner = text.slice(1, m);
        return { end: m + 1, href: inner, text: inner };
      }
    }
  }
  // email: local@domain with a dot in the domain
  const em = matchEmailAt(text, 1, true);
  if (em && em.end < n && text[em.end] === ">") {
    const inner = text.slice(1, em.end);
    return { end: em.end + 1, href: "mailto:" + inner, text: inner };
  }
  return null;
}

// Match an email address starting at text[i]. If angle is true, the
// address is inside <...>: stricter domain (labels with dots, no trailing
// - or _). Returns {end} or null.
function matchEmailAt(text, i, angle) {
  const n = text.length;
  let j = i;
  // local part
  const localStart = j;
  while (j < n && /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]/.test(text[j])) j++;
  if (j === localStart || j >= n || text[j] !== "@") return null;
  const at = j;
  j++;
  if (j >= n || !/[A-Za-z0-9]/.test(text[j])) return null;
  // domain: labels separated by dots, at least one dot, TLD ends alnum
  let labels = 0;
  let lastDot = -1;
  let k = j;
  while (k < n && /[A-Za-z0-9-]/.test(text[k])) k++;
  if (k === j) return null;
  labels = 1;
  while (k < n && text[k] === ".") {
    lastDot = k;
    k++;
    const st = k;
    while (k < n && /[A-Za-z0-9-]/.test(text[k])) k++;
    if (k === st) return null;
    labels++;
  }
  if (labels < 2) return null;
  // domain must not end with '-' and the char after must not be - or _
  if (text[k - 1] === "-") return null;
  if (k < n && (text[k] === "-" || text[k] === "_")) return null;
  if (angle) {
    // angle-bracket email: each label 1..63 chars, TLD alnum-ended
    if (text[k - 1] === "-" || text[k - 1] === ".") return null;
  }
  return { end: k, at };
}

// ---------------------------------------------------------------------------
// Emphasis masking (marked's #n): build a same-length masked copy of an
// inline text in which delimiters inside links, code spans and reflinks
// are invisible to the emphasis closer search.
// ---------------------------------------------------------------------------

const EMAIL_LOCAL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.!#$%&'*+/=?^_`{|}~-";
const EMAIL_TBL = new Uint8Array(128);
for (let i = 0; i < EMAIL_LOCAL.length; i++) EMAIL_TBL[EMAIL_LOCAL.charCodeAt(i)] = 1;

function isEmailLocalChar(ch) {
  const code = ch.charCodeAt(0);
  return code < 128 && EMAIL_TBL[code] === 1;
}

// Does an email address start at text[i]? (broad local part + '@'; the
// url rule itself applies the stricter domain check.)
function emailLookaheadAt(text, i) {
  let j = i;
  while (j < text.length && isEmailLocalChar(text[j])) j++;
  return j > i && j < text.length && text[j] === "@";
}

// Match a code span (blockSkip / anyPunctuationOutsideCode flavour):
// opening run, content starting and ending with a non-backtick char,
// closing run equal to the opening run, not followed by a backtick.
function matchCodeSpanStrict(text, i) {
  const n = text.length;
  let j = i;
  while (j < n && text[j] === "`") j++;
  const run = j - i;
  let k = j;
  while (k < n) {
    if (text[k] === "`") {
      let e = k;
      while (e < n && text[e] === "`") e++;
      if (e - k === run) {
        const content = text.slice(j, k);
        if (content.length > 0 && content[0] !== "`" && content[content.length - 1] !== "`") {
          return { end: e, openEnd: j, closeStart: k };
        }
        return null;
      }
      k = e;
      continue;
    }
    k++;
  }
  return null;
}

// Match the blockSkip link span at text[i] === '[':
// [label](dest) where the label holds no brackets, only code spans and
// plain chars, and dest holds escapes, non-paren chars or one paren group.
function matchBlockSkipLink(text, i) {
  const n = text.length;
  let j = i + 1;
  while (j < n) {
    const c = text[j];
    if (c === "]") break;
    if (c === "[") return null;
    if (c === "`") {
      const cs = matchCodeSpanStrict(text, j);
      if (!cs) return null;
      j = cs.end;
      continue;
    }
    if (c === "[") return null;
    j++;
  }
  if (j >= n || text[j] !== "]") return null;
  if (j + 1 >= n || text[j + 1] !== "(") return null;
  let k = j + 2;
  while (k < n) {
    const c = text[k];
    if (c === ")") return { end: k + 1 };
    if (c === "\\") { k += 2; continue; }
    if (c === "(") {
      k++;
      while (k < n && text[k] !== ")") {
        if (text[k] === "\\") k += 2;
        else if (text[k] === "(" || text[k] === ")") return null;
        else k++;
      }
      if (k >= n) return null;
      k++;
      continue;
    }
    k++;
  }
  return null;
}

// Match an html-ish span <...> (no space after <, no < or > inside).
function matchBlockSkipHtml(text, i) {
  if (text[i] !== "<" || i + 1 < text.length && text[i + 1] === " ") return null;
  let j = i + 1;
  while (j < text.length && text[j] !== ">" && text[j] !== "<") j++;
  if (j >= text.length || text[j] !== ">") return null;
  return { end: j + 1 };
}

// Does the label text contain a link (marked's linkInText)?
function labelHasLink(label, refs) {
  if (label.indexOf("[") === -1) return false;
  // blockSkip link spans whose link regex would match
  for (let i = 0; i < label.length; i++) {
    if (label[i] === "[") {
      const m = matchBlockSkipLink(label, i);
      if (m && label.charAt(i - 1) !== "!") return true;
    }
  }
  // reflink spans with a known ref
  for (let i = 0; i < label.length; i++) {
    if (label[i] === "[" || (label[i] === "!" && label[i + 1] === "[")) {
      const st = label[i] === "!" ? i + 1 : i;
      const lm = matchLabel(label, st);
      if (!lm) continue;
      const after = lm.end;
      if (after < label.length && label[after] === "[") {
        const rm = scanRef(label, after + 1);
        if (rm && refs.has(normalizeLabel(rm.ref))) {
          const inner = label.slice(st + 1, lm.end - 1);
          if (!(lm.end - 1 - (st + 1) > 1 && labelHasLink(inner, refs))) return true;
        }
      } else {
        if (refs.has(normalizeLabel(lm.label))) return true;
      }
    }
  }
  return false;
}

// Mask reflink spans in text (step 1 of the masking).
function maskReflinks(text, refs) {
  const n = text.length;
  let out = "";
  let i = 0;
  let last = 0;
  const flush = (to) => { out += text.slice(last, to); };
  while (i < n) {
    if (text[i] !== "[" && !(text[i] === "!" && text[i + 1] === "[")) { i++; continue; }
    const st = text[i] === "!" ? i + 1 : i;
    const lm = matchLabel(text, st);
    if (!lm) { i++; continue; }
    const after = lm.end;
    let spanEnd = -1;
    let refNorm = null;
    let isReflink = false;
    if (after < n && text[after] === "[") {
      const rm = scanLeRef(text, after + 1);
      if (rm) {
        spanEnd = rm.end;
        refNorm = normalizeLabel(rm.ref);
        isReflink = true;
      }
    }
    if (spanEnd === -1) {
      // nolink: [label] or [label][]
      if (after + 1 < n && text[after] === "[" && text[after + 1] === "]") {
        spanEnd = after + 2;
        refNorm = normalizeLabel(lm.label);
      } else {
        spanEnd = after;
        refNorm = normalizeLabel(lm.label);
      }
    }
    if (spanEnd === -1 || !refs.has(refNorm)) { i++; continue; }
    // matched a reflink/nolink with a known ref: mask it
    flush(i);
    const span = text.slice(i, spanEnd);
    const labelText = lm.label;
    const o = span.lastIndexOf("[");
    if (o > 1 && span.charAt(0) !== "!" && labelHasLink(labelText, refs)) {
      out += "[" + maskReflinks(labelText, refs) + "][" + "a".repeat(span.length - o - 2) + "]";
    } else {
      out += "[" + "a".repeat(span.length - 2) + "]";
    }
    i = spanEnd;
    last = i;
  }
  flush(n);
  return out;
}

// Step 2: mask escaped punctuation and backticks inside code spans.
function maskPunctOutsideCode(text) {
  const n = text.length;
  let out = "";
  let last = 0;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === "\\" && i + 1 < n && isPunctChar(text[i + 1])) {
      out += text.slice(last, i) + "++";
      i += 2;
      last = i;
      continue;
    }
    if (c === "`") {
      const cs = matchCodeSpanStrict(text, i);
      if (cs) {
        const inner = text.slice(cs.openEnd, cs.closeStart).replace(/`/g, "+");
        out += text.slice(last, i) + text.slice(i, cs.openEnd) + inner + text.slice(cs.closeStart, cs.end);
        i = cs.end;
        last = i;
        continue;
      }
      // lone run: leave as-is
      let j = i;
      while (j < n && text[j] === "`") j++;
      i = j;
      continue;
    }
    i++;
  }
  out += text.slice(last);
  return out;
}

// Step 3: mask link spans, code spans and html spans as [aaa...].
// A code span can only start at the beginning of a backtick run, so a
// failed match skips the whole run (never re-enter mid-run).
function maskBlockSkip(text) {
  const n = text.length;
  let out = "";
  let last = 0;
  let i = 0;
  while (i < n) {
    const c = text[i];
    let m = null;
    if (c === "[") m = matchBlockSkipLink(text, i);
    else if (c === "`") m = matchCodeSpanStrict(text, i);
    else if (c === "<") m = matchBlockSkipHtml(text, i);
    if (m) {
      out += text.slice(last, i) + "[" + "a".repeat(m.end - i - 2) + "]";
      i = m.end;
      last = i;
      continue;
    }
    if (c === "`") {
      let j = i;
      while (j < n && text[j] === "`") j++;
      i = j;
      continue;
    }
    i++;
  }
  out += text.slice(last);
  return out;
}

// Full masking for one inline text.
function maskText(text, refs) {
  let t = text;
  if (refs.size > 0 && text.indexOf("[") !== -1) t = maskReflinks(t, refs);
  t = maskPunctOutsideCode(t);
  t = maskBlockSkip(t);
  return t;
}

// Last possible closer indices in a masked text (marked's fe).
function lastClosers(masked) {
  const res = { "*": -1, "_": -1, "~": -1 };
  const n = masked.length;
  for (let s = 0; s < n; s++) {
    const r = masked[s];
    if (r !== "*" && r !== "_" && r !== "~") continue;
    const o = s === 0 ? "\n" : masked[s - 1];
    let i = s + 1;
    while (i < n && masked[i] === r) i++;
    if (o !== " " && o !== "\t" && o !== "\n" && o !== "\r" && o !== "\f") {
      res[r] = s;
    }
    s = i - 1;
  }
  return res;
}

// Classify a delimiter run in the masked text for the closer search.
// Returns the group number (1..6) or 0 when it is not a candidate.
// P = char before the run, N = char after the run ('' at the edges).
// Closer groups from marked's GFM RDelim regexes. '*' and '~' use the
// $e/bt variant (groups 1-6, group 3 = prev punctSpace, group 6 = prev
// notPunctSpace); '_' uses kt (groups 1-5 only, NO group 6: a '_' run
// between two alphanumerics is not a closer). The '*' RDelim uses the
// GFM classes (it/st/ye): '~' counts as notPunctSpace, not punct.
// '_' and '~' use the plain classes (X/j/$).
function closerGroup(masked, q, runLen, ch) {
  const P = q > 0 ? masked[q - 1] : "";
  const e = q + runLen;
  const N = e < masked.length ? masked[e] : "";
  const gfm = ch === "*";
  const pPunct = P !== "" && P !== ch && isPunctChar(P) && (!gfm || P !== "~");
  const pNotPS = P !== "" && (isNotPunctSpaceChar(P) || (gfm && P === "~"));
  const pSpace = P !== "" && isSpaceCode(P.charCodeAt(0));
  const pPunctSpace = pSpace || pPunct;
  const nSpace = N !== "" && isSpaceCode(N.charCodeAt(0));
  const nPunct = N !== "" && N !== ch && isPunctChar(N) && (!gfm || N !== "~");
  const nNotPS = N !== "" && (isNotPunctSpaceChar(N) || (gfm && N === "~"));
  const nEnd = N === "";
  if (pPunct && (nSpace || nEnd)) return 1;
  if (pNotPS && (nSpace || nPunct || nEnd)) return 2;
  if (pPunctSpace && nNotPS) return 3;
  if (pSpace && nPunct) return 4;
  if (pPunct && nPunct) return 5;
  if (ch === "_") return 0;
  if (pNotPS && nNotPS) return 6;
  return 0;
}

// Is the first delimiter run after the opener a run of ch sitting between
// two double runs of the other delimiter? (marked's RDelim first
// alternative: ^[^_*]*?__[^_*]*?\*[^_*]*?(?=__) and the _ mirror.)
function isBetweenDoubleRuns(masked, from, q, ch) {
  const other = ch === "*" ? "_" : "*";
  // find the first delimiter run at or after `from`
  let i = from;
  while (i < q) {
    const c = masked[i];
    if (c === ch || c === other) {
      // first delimiter run found before q: must be a double run of other
      let j = i;
      while (j < masked.length && masked[j] === c) j++;
      if (c !== other || j - i < 2) return false;
      // after that run, the next delimiter run must be the one at q
      let k = j;
      while (k < q) {
        if (masked[k] === ch || masked[k] === other) return false;
        k++;
      }
      // after the run at q, the next delimiter run must be a double `other`
      let m = q;
      while (m < masked.length && masked[m] === ch) m++;
      let p = m;
      while (p < masked.length) {
        if (masked[p] === ch || masked[p] === other) {
          let e = p;
          while (e < masked.length && masked[e] === masked[p]) e++;
          return masked[p] === other && e - p >= 2;
        }
        p++;
      }
      return false;
    }
    i++;
  }
  return false;
}

// Try emphasis/strong at text[i] (a '*' or '_' run). Returns
// {end, kind, inner} or null. Implements marked's emStrong algorithm:
// left-flanking opener check, last-possible-closer gate, closer scan
// over the masked text with the rule of three and the m-arithmetic.
function tryEmStrong(text, masked, last, i, prevChar) {
  const ch = text[i];
  const n = text.length;
  let j = i;
  while (j < n && text[j] === ch) j++;
  const k = j - i;
  const after = j < n ? text[j] : "";
  // LDelim groups (GFM lt, built on _e): punct after the run (not the
  // delimiter itself, and not '~' -- the GFM punct class ye excludes
  // '~') is group 1/3; any other non-space non-delimiter char is
  // group 2/4. There is NO open-quote exclusion in GFM (that is only
  // in the pedantic ut regex), so '"' after a delimiter IS punct.
  let d = "";
  let groupOther = false;
  if (after !== "" && after !== ch && !isSpaceCode(after.charCodeAt(0))) {
    if (isPunctChar(after) && after !== "~") d = after;
    else groupOther = true;
  }
  if (d === "" && !groupOther) return null;
  // walk the run back over the same delimiter in the masked text
  let l = i;
  while (l > 0 && masked[l - 1] === ch) l--;
  const p = l > 0 ? masked[l - 1] : "";
  // marked's punctuation class for flanking INCLUDES whitespace
  // ([\s\p{P}\p{S}]) but never matches '*' or '_'.
  const h = p !== "" && isPunctSpaceChar(p);
  let nn = prevChar;
  if (l < i) nn = p;
  const u = l < i ? h : (nn !== "" && isPunctSpaceChar(nn) && nn !== "*" && nn !== "_");
  // intraword '_' rule
  if (ch === "_" && groupOther && nn !== "" && isAlnumChar(nn)) return null;
  if (d !== "" && nn !== "" && !u) return null;
  const m0 = k;
  let m = m0;
  let f = 0;
  const y = i - l + k;
  const R = p.trim() !== "" && (d !== "" || (ch === "*" && !h));
  const o = prevChar === ch;
  const v = last[ch];
  const Q = i + k;
  if (v < Q) return null;
  // scan the masked text for closer runs
  let q = Q;
  let firstRun = true;
  while (q < n) {
    if (masked[q] !== ch) { q++; continue; }
    let e = q;
    while (e < n && masked[e] === ch) e++;
    const b = e - q;
    if (q - 1 > v) return null;
    if (firstRun) {
      firstRun = false;
      if (isBetweenDoubleRuns(masked, Q, q, ch)) { q = e; continue; }
    }
    const g = closerGroup(masked, q, b, ch);
    if (g === 0) { q = e; continue; }
    if (g === 3 || g === 4) { m += b; q = e; continue; }
    if (g === 5 || g === 6 || R) {
      if (o && (g === 5 || g === 6)) return null;
      if (y % 3 !== 0 && (y + b) % 3 === 0) { f += b; q = e; continue; }
    }
    m -= b;
    if (m > 0) { q = e; continue; }
    const use = Math.min(b, b + m + f);
    const end = q + use;
    if (Math.min(k, use) % 2 === 1) {
      return { end, kind: "em", inner: text.slice(i + 1, end - 1) };
    }
    return { end, kind: "strong", inner: text.slice(i + 2, end - 2) };
  }
  return null;
}

// Try strikethrough at text[i] (a '~' run). Returns {end, kind, inner}
// or null. The closer run must have exactly the opener length.
function tryDel(text, masked, last, i, prevChar) {
  const n = text.length;
  let j = i;
  while (j < n && text[j] === "~") j++;
  const L = j - i;
  const o = L === 2 ? 2 : 1;
  const after = L >= 2 ? (i + 2 < n ? text[i + 2] : "") : (i + 1 < n ? text[i + 1] : "");
  const s1 = after !== "" && after !== "~" && isPunctChar(after);
  if (s1 && prevChar !== "" && !isPunctChar(prevChar)) return null;
  const u = last["~"];
  const d = i + o;
  if (u < d) return null;
  let p = o;
  let q = d;
  while (q < n) {
    if (masked[q] !== "~") { q++; continue; }
    let e = q;
    while (e < n && masked[e] === "~") e++;
    const l = e - q;
    if (q - 1 > u) return null;
    const g = closerGroup(masked, q, l, "~");
    if (g === 0 || l !== o) { q = e; continue; }
    if (g === 3 || g === 4) { p += l; q = e; continue; }
    p -= l;
    if (p > 0) { q = e; continue; }
    const use = Math.min(l, l + p);
    const end = q + use;
    return { end, kind: "del", inner: text.slice(i + o, end - o) };
  }
  return null;
}

// The backpedal: longest valid prefix of a URL (trailing punctuation
// trimmed, balanced parens kept, & kept unless it starts an entity).
const BACKPEDAL_RE = /^(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![A-Za-z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/;
function backpedalUrl(s) {
  let cur = s;
  for (;;) {
    const m = BACKPEDAL_RE.exec(cur);
    const next = m ? m[0] : "";
    if (next === cur) return cur;
    cur = next;
  }
}

// Match an extended autolink email (marked's It regex) at text[i].
function matchExtEmail(text, i) {
  const n = text.length;
  let j = i;
  while (j < n && /[A-Za-z0-9._+-]/.test(text[j])) j++;
  if (j === i || j >= n || text[j] !== "@") return null;
  j++;
  let k = j;
  while (k < n && /[A-Za-z0-9_-]/.test(text[k])) k++;
  if (k === j) return null;
  let labels = 1;
  while (k < n && text[k] === ".") {
    k++;
    const st = k;
    while (k < n && /[A-Za-z0-9_-]/.test(text[k])) k++;
    if (k === st) { k = st - 1; break; } // trailing dot: domain ends here
    if (text[k - 1] < "0" || (text[k - 1] > "9" && text[k - 1] < "A") || (text[k - 1] > "Z" && text[k - 1] < "a") || text[k - 1] > "z") {
      if (!/[A-Za-z0-9]/.test(text[k - 1])) return null;
    }
    labels++;
  }
  if (labels < 2) return null;
  if (k < n && /[\w-]/.test(text[k])) return null;
  return { end: k };
}

// Match an extended autolink (url rule) at text[i]. Returns
// {end, href, text} or null.
function matchUrl(text, i) {
  const n = text.length;
  // (a) emailProtocol: mailto: / xmpp: + email
  for (const proto of ["mailto:", "xmpp:"]) {
    if (text.startsWith(proto, i)) {
      const em = matchExtEmail(text, i + proto.length);
      if (em) {
        let end = em.end;
        if (proto === "xmpp:" && end < n && text[end] === "/") {
          let k = end + 1;
          while (k < n && /[A-Za-z0-9@.]/.test(text[k])) k++;
          if (k > end + 1) end = k;
        }
        const s = text.slice(i, end);
        return { end, href: s, text: s };
      }
    }
  }
  // (b) scheme:// or www. + host + [^\s<]*
  let schemeEnd = -1;
  let isWww = false;
  const lower = text.slice(i, i + 8).toLowerCase();
  if (lower.startsWith("http://")) schemeEnd = i + 7;
  else if (lower.startsWith("https://")) schemeEnd = i + 8;
  else if (lower.startsWith("ftp://")) schemeEnd = i + 6;
  else if (text.startsWith("www.", i)) { schemeEnd = i + 4; isWww = true; }
  if (schemeEnd !== -1) {
    let j = schemeEnd;
    // host: (label.)+ labels of [A-Za-z0-9-]+ with optional trailing dot
    let hostEnd = -1;
    let k = j;
    while (k < n) {
      const st = k;
      while (k < n && /[A-Za-z0-9-]/.test(text[k])) k++;
      if (k === st) break;
      hostEnd = k;
      if (k < n && text[k] === ".") { k++; hostEnd = k; continue; }
      break;
    }
    if (hostEnd !== -1) {
      let m = hostEnd;
      while (m < n && text[m] !== " " && text[m] !== "\t" && text[m] !== "\n" && text[m] !== "\r" && text[m] !== "<") m++;
      let s = text.slice(i, m);
      s = backpedalUrl(s);
      if (s.length > 0) {
        return { end: i + s.length, href: isWww ? "http://" + s : s, text: s };
      }
    }
  }
  // (c) bare email
  const em = matchExtEmail(text, i);
  if (em) {
    const s = text.slice(i, em.end);
    return { end: em.end, href: "mailto:" + s, text: s };
  }
  return null;
}

// Parse an inline link destination/title after the label's ']'
// (labelEnd is the index just past ']'). Returns
// {end, href, title} or null when the destination part is invalid.
function parseLinkDest(text, labelEnd) {
  const n = text.length;
  if (labelEnd >= n || text[labelEnd] !== "(") return null;
  let j = labelEnd + 1;
  while (j < n && (text[j] === " " || text[j] === "\t" || text[j] === "\n")) j++;
  let href = "";
  let hrefEnd = j;
  if (j < n && text[j] === "<") {
    // angle destination: <...> with no newline or '<' inside
    let k = j + 1;
    let ok = false;
    while (k < n) {
      const c = text[k];
      if (c === ">") { ok = true; break; }
      if (c === "\n" || c === "<") break;
      if (c === "\\") { k += 2; continue; }
      k++;
    }
    if (!ok) return null;
    const raw = text.slice(j, k + 1);
    // trailing-backslash check before '>'
    let b = 0;
    for (let m = k - 1; m >= j + 1 && text[m] === "\\"; m--) b++;
    if (b % 2 === 1) return null;
    href = raw.slice(1, -1);
    hrefEnd = k + 1;
  } else if (j < n && text[j] === ")") {
    href = "";
    hrefEnd = j;
  } else {
    // bare destination: run of non-space, non-control chars
    let k = j;
    while (k < n) {
      const c = text.charCodeAt(k);
      if (c === 32 || c === 9 || c === 10 || c <= 31) break;
      k++;
    }
    if (k === j) return null;
    let dest = text.slice(j, k);
    const l = findClosingBracket(dest, "(", ")");
    if (l === -2) return null;
    if (l > -1) {
      dest = dest.substring(0, l);
      hrefEnd = j + l;
    } else {
      hrefEnd = k;
    }
    href = dest;
  }
  // optional title
  let title = "";
  let end = hrefEnd;
  // separator: spaces/tabs/newlines
  let s = hrefEnd;
  while (s < n && (text[s] === " " || text[s] === "\t" || text[s] === "\n")) s++;
  if (s < n && (text[s] === '"' || text[s] === "'" || text[s] === "(")) {
    const q = text[s];
    const close = q === "(" ? ")" : q;
    let k = s + 1;
    let ok = false;
    while (k < n) {
      const c = text[k];
      if (c === close) { ok = true; break; }
      if (c === "\\") { k += 2; continue; }
      k++;
    }
    if (!ok) return null;
    title = text.slice(s + 1, k);
    end = k + 1;
    s = end;
    while (s < n && (text[s] === " " || text[s] === "\t" || text[s] === "\n")) s++;
    end = s;
  } else {
    end = s;
  }
  if (end >= n || text[end] !== ")") return null;
  // trailing-backslash check before ')': cap[0] ends with ')'
  const rawEnd = end + 1;
  let b = 0;
  for (let m = end - 1; m >= 0 && text[m] === "\\"; m--) b++;
  if (b % 2 === 1) return null;
  // unescape \(punct) in href and title
  const unesc = (t) => t.replace(/\\([\p{P}\p{S}])/gu, "$1");
  return { end: rawEnd, href: unesc(href.trim()), title: title === "" ? "" : unesc(title) };
}

// Lex a label's text with inLink=true; returns {html, linkEmitted}.
// The outer state is saved and restored (inRawBlock only on rejection).
function lexLabel(labelText, refs, st, isImage, plain) {
  const savedInLink = st.inLink;
  const savedRaw = st.inRawBlock;
  st.inLink = true;
  const res = lexInline(labelText, refs, st, st.canLink && labelText.indexOf(")") !== -1, plain);
  const innerEmitted = res.linkEmitted;
  st.inLink = savedInLink;
  if (!isImage && innerEmitted) {
    st.inRawBlock = savedRaw;
    return null;
  }
  return { html: res.html, emitted: innerEmitted };
}

// Try an inline link/image at text[i] ('[' or '!['). Returns
// {end, html, isLink} or null. In plain mode (inside an image alt) a
// link or image renders as its label's plain text.
function tryInlineLink(text, i, refs, st, plain) {
  const isImage = text[i] === "!";
  const start = isImage ? i + 1 : i;
  if (text[start] !== "[") return null;
  const lm = matchLabel(text, start);
  if (!lm) return null;
  if (!st.canLink) return null;
  if (labelHasUnclosedTag(text, lm.label, start + 1)) return null;
  const dest = parseLinkDest(text, lm.end);
  if (!dest) return null;
  const href = cleanUrl(dest.href);
  const lab = lexLabel(lm.label, refs, st, isImage, plain || isImage);
  if (!lab) return null;
  if (plain) return { end: dest.end, html: lab.html, isLink: !isImage };
  if (isImage) {
    const altText = lab.html;
    if (href === null) return { end: dest.end, html: escText(altText), isLink: false };
    let out = '<img src="' + escText(href) + '" alt="' + escText(altText) + '"';
    if (dest.title) out += ' title="' + escText(dest.title) + '"';
    return { end: dest.end, html: out + ">", isLink: false };
  }
  if (href === null) return { end: dest.end, html: lab.html, isLink: true };
  let out = '<a href="' + escText(href) + '"';
  if (dest.title) out += ' title="' + escText(dest.title) + '"';
  return { end: dest.end, html: out + ">" + lab.html + "</a>", isLink: true };
}

// Try a reference link/image at text[i]. Returns {end, html, isLink},
// {oneChar: true} (emit a single '[' or '!' as text), or null.
function tryReflink(text, i, refs, st, plain) {
  const isImage = text[i] === "!";
  const start = isImage ? i + 1 : i;
  if (text[start] !== "[") return null;
  const lm = matchLabel(text, start);
  if (!lm) return null;
  const after = lm.end;
  // full reference [label][ref]
  if (after < text.length && text[after] === "[") {
    const rm = scanLeRef(text, after + 1);
    if (rm) {
      if (labelHasUnclosedTag(text, lm.label, start + 1)) return null;
      const ref = refs.get(normalizeLabel(rm.ref));
      if (!ref) return { oneChar: true };
      const lab = lexLabel(lm.label, refs, st, isImage, plain || isImage);
      if (!lab) return null;
      return finishRefLink(rm.end, ref, lm.label, lab, isImage, st, plain);
    }
  }
  // shortcut / collapsed [label] or [label][]
  const sm = scanLeRef(text, start + 1);
  if (!sm) return null;
  let end = sm.end;
  if (end + 1 < text.length && text[end] === "[" && text[end + 1] === "]") {
    end += 2;
  }
  if (labelHasUnclosedTag(text, sm.ref, start + 1)) return null;
  const ref = refs.get(normalizeLabel(sm.ref));
  if (!ref) return { oneChar: true };
  const lab = lexLabel(sm.ref, refs, st, isImage, plain || isImage);
  if (!lab) return null;
  return finishRefLink(end, ref, sm.ref, lab, isImage, st, plain);
}

function finishRefLink(end, ref, labelRaw, lab, isImage, st, plain) {
  const href = cleanUrl(ref.href);
  if (plain) return { end, html: lab.html, isLink: !isImage };
  if (isImage) {
    const altText = lab.html;
    if (href === null) return { end, html: escText(altText), isLink: false };
    let out = '<img src="' + escText(href) + '" alt="' + escText(altText) + '"';
    if (ref.title) out += ' title="' + escText(ref.title) + '"';
    return { end, html: out + ">", isLink: false };
  }
  if (href === null) return { end, html: lab.html, isLink: true };
  let out = '<a href="' + escText(href) + '"';
  if (ref.title) out += ' title="' + escText(ref.title) + '"';
  return { end, html: out + ">" + lab.html + "</a>", isLink: true };
}

// Scan one text run starting at i. Stops before trigger chars, hard
// breaks, and autolink/email triggers. Returns the run (at least 1 char).
// Trigger chars that end a text run.
const TEXT_TRIGGER_TBL = new Uint8Array(128);
for (const ch of "\\<![]`*_~") TEXT_TRIGGER_TBL[ch.charCodeAt(0)] = 1;

function scanTextRun(text, i) {
  const n = text.length;
  let p = i;
  // first char: a backtick run, a tilde run, or one char
  if (text[p] === "`") {
    while (p < n && text[p] === "`") p++;
  } else if (text[p] === "~") {
    while (p < n && text[p] === "~") p++;
  } else {
    p++;
  }
  while (p < n) {
    const c = text[p];
    const code = c.charCodeAt(0);
    // trigger chars
    if (code < 128 && TEXT_TRIGGER_TBL[code] === 1) break;
    // hard break starting here: 2+ spaces + newline, not at end
    if (c === " ") {
      let m = p;
      while (m < n && text[m] === " ") m++;
      if (m - p >= 2 && m < n && text[m] === "\n" && !isOnlyWhitespaceToEnd(text, m + 1)) break;
    }
    // hard break starting after this char (only if next char is a space)
    if (c !== " " && c !== "\t" && text[p + 1] === " ") {
      let m = p + 1;
      while (m < n && text[m] === " ") m++;
      if (m - (p + 1) >= 2 && m < n && text[m] === "\n" && !isOnlyWhitespaceToEnd(text, m + 1)) {
        p++;
        break;
      }
    }
    // email lookahead at p: only at the start of an email-local run
    // (an email run can only begin where the previous char is not an
    // email-local char); checking every char is quadratic.
    if (code < 128 && EMAIL_TBL[code] === 1) {
      if (p === i || !isEmailLocalChar(text[p - 1])) {
        if (emailLookaheadAt(text, p)) break;
      }
    }
    // scheme:// at p (case-insensitive), guarded by first char
    if (c === "h" || c === "H") {
      const t1 = text[p + 1], t2 = text[p + 2], t3 = text[p + 3];
      if ((t1 === "t" || t1 === "T") && (t2 === "t" || t2 === "T") && (t3 === "p" || t3 === "P")) {
        const t4 = text[p + 4];
        if (t4 === ":" && text[p + 5] === "/" && text[p + 6] === "/") break;
        if ((t4 === "s" || t4 === "S") && text[p + 5] === ":" && text[p + 6] === "/" && text[p + 7] === "/") break;
      }
    } else if (c === "f" || c === "F") {
      const t1 = text[p + 1], t2 = text[p + 2];
      if ((t1 === "t" || t1 === "T") && (t2 === "p" || t2 === "P") && text[p + 3] === ":" && text[p + 4] === "/" && text[p + 5] === "/") break;
    }
    // www. at p, when preceded by whitespace / * / _ / ~ / ( / start
    if (c === "w" && text.startsWith("www.", p)) {
      const prev = p === 0 ? "" : text[p - 1];
      if (prev === "" || prev === " " || prev === "\t" || prev === "\n" || prev === "*" || prev === "_" || prev === "~" || prev === "(") break;
    }
    // mailto:/xmpp: after a non-alphanumeric char at p
    if (!((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122))) {
      if (text.startsWith("mailto:", p + 1) || text.startsWith("xmpp:", p + 1)) {
        p++;
        break;
      }
    }
    p++;
  }
  return text.slice(i, p);
}

function isOnlyWhitespaceToEnd(text, i) {
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") return false;
  }
  return true;
}

// Render a text run to HTML (unescape numeric entities, then escape).
// In plain mode (image alt text) the run is unescaped but not re-escaped.
function renderTextRun(s, inRawBlock, plain) {
  if (inRawBlock) return s;
  if (plain) return unescapeText(s);
  return escText(unescapeText(s));
}

// Lex one inline text to HTML (or plain text when plain=true).
// Returns {html, linkEmitted} where linkEmitted is true when a
// non-image link token was emitted during this call.
function lexInline(text, refs, st, canLink, plain) {
  const savedCanLink = st.canLink;
  st.canLink = canLink;
  const n = text.length;
  const hasEm = text.indexOf("*") !== -1 || text.indexOf("_") !== -1 || text.indexOf("~") !== -1;
  const masked = hasEm ? maskText(text, refs) : text;
  // lastClosers is only read by resolveEmphasis, which never runs
  // without an emphasis delimiter
  const last = hasEm ? lastClosers(masked) : { "*": -1, "_": -1, "~": -1 };
  const out = [];
  let linkEmitted = false;
  let i = 0;
  let prevChar = "";
  let wasText = false;
  let textBuf = "";
  const flushText = () => {
    if (textBuf.length > 0) {
      out.push(renderTextRun(textBuf, st.inRawBlock, plain));
      textBuf = "";
    }
  };
  while (i < n) {
    if (!wasText) prevChar = "";
    wasText = false;
    const c = text[i];
    // escape: backslash + ASCII punctuation. Rendered as its own token
    // (so a following '&ouml;' is NOT treated as an entity).
    if (c === "\\" && i + 1 < n && isAsciiPunctCode(text.charCodeAt(i + 1))) {
      flushText();
      const ec = text[i + 1];
      out.push(plain ? ec : escText(ec));
      i += 2;
      continue;
    }
    // hard break: backslash + newline
    if (c === "\\" && i + 1 < n && text[i + 1] === "\n" && !isOnlyWhitespaceToEnd(text, i + 2)) {
      flushText();
      if (!plain) out.push("<br>");
      i += 2;
      while (i < n && (text[i] === " " || text[i] === "\t")) i++;
      continue;
    }
    // tag / autolink
    if (c === "<") {
      const tag = matchTagRaw(text.slice(i));
      if (tag) {
        flushText();
        const raw = text.slice(i, i + tag.end);
        if (!st.inLink && /^<a /i.test(raw)) st.inLink = true;
        else if (st.inLink && /^<\/a>/i.test(raw)) st.inLink = false;
        if (!st.inRawBlock && /^<(pre|code|kbd|script)(\s|>)/i.test(raw)) st.inRawBlock = true;
        else if (st.inRawBlock && /^<\/(pre|code|kbd|script)(\s|>)/i.test(raw)) st.inRawBlock = false;
        out.push(raw);
        i += tag.end;
        continue;
      }
      const auto = matchAutolinkRaw(text.slice(i));
      if (auto) {
        flushText();
        const href = cleanUrl(auto.href);
        if (href === null || plain) {
          out.push(plain ? auto.text : escFull(auto.text));
        } else {
          out.push('<a href="' + escFull(href) + '">' + escFull(auto.text) + "</a>");
        }
        i += auto.end;
        continue;
      }
    }
    // link / image / reflink
    if (c === "[" || (c === "!" && i + 1 < n && text[i + 1] === "[")) {
      if (canLink) {
        const link = tryInlineLink(text, i, refs, st, plain);
        if (link) {
          flushText();
          if (link.isLink) linkEmitted = true;
          out.push(link.html);
          i = link.end;
          continue;
        }
      }
      const ref = tryReflink(text, i, refs, st, plain);
      if (ref) {
        if (ref.oneChar) {
          textBuf += text[i];
          prevChar = text[i];
          wasText = true;
          i += 1;
          continue;
        }
        flushText();
        if (ref.isLink) linkEmitted = true;
        out.push(ref.html);
        i = ref.end;
        continue;
      }
    }
    // emphasis / strong
    if (c === "*" || c === "_") {
      const em = tryEmStrong(text, masked, last, i, prevChar);
      if (em) {
        flushText();
        const inner = lexInline(em.inner, refs, st, st.canLink && em.inner.indexOf(")") !== -1, plain);
        if (inner.linkEmitted) linkEmitted = true;
        if (plain) out.push(inner.html);
        else if (em.kind === "em") out.push("<em>" + inner.html + "</em>");
        else out.push("<strong>" + inner.html + "</strong>");
        i = em.end;
        continue;
      }
    }
    // code span
    if (c === "`") {
      const cs = matchCodeSpan(text, i);
      if (cs) {
        flushText();
        const body = codeSpanText(cs.content);
        out.push(plain ? body : "<code>" + escFull(body) + "</code>");
        i = cs.end;
        continue;
      }
    }
    // hard break: 2+ spaces + newline
    if (c === " ") {
      let m = i;
      while (m < n && text[m] === " ") m++;
      if (m - i >= 2 && m < n && text[m] === "\n" && !isOnlyWhitespaceToEnd(text, m + 1)) {
        flushText();
        if (!plain) out.push("<br>");
        i = m + 1;
        while (i < n && (text[i] === " " || text[i] === "\t")) i++;
        continue;
      }
    }
    // strikethrough
    if (c === "~") {
      const del = tryDel(text, masked, last, i, prevChar);
      if (del) {
        flushText();
        const inner = lexInline(del.inner, refs, st, st.canLink && del.inner.indexOf(")") !== -1, plain);
        if (inner.linkEmitted) linkEmitted = true;
        if (plain) out.push(inner.html);
        else out.push("<del>" + inner.html + "</del>");
        i = del.end;
        continue;
      }
    }
    // extended autolink (not inside a link)
    if (!st.inLink) {
      const url = matchUrl(text, i);
      if (url) {
        flushText();
        const href = cleanUrl(url.href);
        if (href === null || plain) {
          out.push(plain ? url.text : escFull(url.text));
        } else {
          out.push('<a href="' + escFull(href) + '">' + escFull(url.text) + "</a>");
        }
        i = url.end;
        continue;
      }
    }
    // text run
    const run = scanTextRun(text, i);
    if (run.length === 0) {
      // safety: consume one char to avoid an infinite loop
      textBuf += text[i];
      i += 1;
    } else {
      textBuf += run;
      i += run.length;
    }
    if (run.length > 0 && run[run.length - 1] !== "_") prevChar = run[run.length - 1];
    wasText = true;
  }
  flushText();
  st.canLink = savedCanLink;
  return { html: out.join(""), linkEmitted };
}

// ---- block helpers ----

// Remove trailing spaces/tabs.
function trimEndSpaces(s) {
  let e = s.length;
  while (e > 0 && (s[e - 1] === " " || s[e - 1] === "\t")) e--;
  return s.slice(0, e);
}

// Remove leading spaces/tabs.
function trimStartSpaces(s) {
  let i = 0;
  while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
  return s.slice(i);
}

function trimSpaces(s) {
  return trimStartSpaces(trimEndSpaces(s));
}

// Column count of the leading whitespace (tab = next multiple of 4).
function indentCols(s) {
  let col = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === " ") col++;
    else if (s[i] === "\t") col += 4 - (col % 4);
    else break;
  }
  return col;
}

// Strip `cols` columns of leading whitespace (tab-aware; a tab that
// straddles the boundary is replaced by the remaining spaces).
function stripCols(s, cols) {
  let col = 0;
  let i = 0;
  while (i < s.length && col < cols) {
    if (s[i] === " ") { col++; i++; }
    else if (s[i] === "\t") {
      const w = 4 - (col % 4);
      if (col + w <= cols) { col += w; i++; }
      else return " ".repeat(col + w - cols) + s.slice(i + 1);
    } else break;
  }
  return s.slice(i);
}

// marked's ge(): if there are at most 1 trailing blank lines, keep the
// string as-is; otherwise strip all trailing blank lines.
function geStr(a) {
  const e = a.split("\n");
  let t = e.length - 1;
  while (t >= 0 && isBlankLine(e[t])) t--;
  return e.length - t <= 2 ? a : e.slice(0, t + 1).join("\n");
}

// Fence start: up to 3 spaces, 3+ backticks or tildes. Returns
// {char, len, info, indent} or null. A backtick fence's info may not
// contain a backtick.
function fenceInfo(line) {
  let i = 0;
  while (i < line.length && line[i] === " " && i < 3) i++;
  const indent = i;
  if (i >= line.length) return null;
  const ch = line[i];
  if (ch !== "`" && ch !== "~") return null;
  let j = i;
  while (j < line.length && line[j] === ch) j++;
  const len = j - i;
  if (len < 3) return null;
  const info = line.slice(j);
  if (ch === "`" && info.indexOf("`") !== -1) return null;
  return { char: ch, len, info, indent };
}

// ATX heading start. Returns {level, text} or null.
function atxInfo(line) {
  let i = 0;
  while (i < line.length && line[i] === " " && i < 3) i++;
  if (i >= line.length || line[i] !== "#") return null;
  let j = i;
  while (j < line.length && line[j] === "#") j++;
  const level = j - i;
  if (level > 6) return null;
  if (j < line.length && line[j] !== " " && line[j] !== "\t") return null;
  return { level, text: line.slice(j) };
}

// Thematic break: 3+ of one marker (*, -, _) separated by spaces/tabs,
// with at most 3 leading spaces.
function isHrLine(line) {
  let i = 0;
  while (i < line.length && line[i] === " " && i < 3) i++;
  if (i >= line.length) return false;
  if (i === 3 && line[3] === " ") return false;
  const t = trimEndSpaces(line.slice(i));
  if (t.length < 3) return false;
  const ch = t[0];
  if (ch !== "*" && ch !== "-" && ch !== "_") return false;
  let count = 0;
  for (let k = 0; k < t.length; k++) {
    if (t[k] === ch) count++;
    else if (t[k] !== " " && t[k] !== "\t") return false;
  }
  return count >= 3;
}

// Setext underline: up to 3 spaces, 1+ '=' or '-', spaces/tabs only.
// Returns 1 (=), 2 (-), or 0.
function setextLevel(line) {
  let i = 0;
  while (i < line.length && line[i] === " " && i < 3) i++;
  if (i >= line.length) return 0;
  const ch = line[i];
  if (ch !== "=" && ch !== "-") return 0;
  let j = i;
  while (j < line.length && line[j] === ch) j++;
  for (let k = j; k < line.length; k++) {
    if (line[k] !== " " && line[k] !== "\t") return 0;
  }
  return ch === "=" ? 1 : 2;
}

// Block-level HTML tag names (marked's K list).
const BLOCK_TAGS = new Set(("address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul").split("|"));

// HTML block type at the start of a line (0 = not an HTML block).
// Types 1-6 can interrupt a paragraph; type 7 cannot.
function htmlBlockType(line) {
  let i = 0;
  while (i < line.length && line[i] === " " && i < 3) i++;
  if (i >= line.length || line[i] !== "<") return 0;
  const rest = line.slice(i);
  const low = rest.toLowerCase();
  if (/^<(script|pre|style|textarea)(\s|>|$)/.test(low)) return 1;
  if (rest.startsWith("<!--")) return 2;
  if (rest.startsWith("<?")) return 3;
  if (/^<![a-zA-Z]/.test(rest)) return 4;
  if (rest.startsWith("<![CDATA[")) return 5;
  // type 6: block-level tag
  const m6 = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:[\s/>]|$)/.exec(rest);
  if (m6 && BLOCK_TAGS.has(m6[1].toLowerCase())) return 6;
  // type 7: a complete open or close tag on its own line
  if (/^<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"\n]*"|\s*=\s*'[^'\n]*'|\s*=\s*[^\s"'=<>`]+)?)*\s*\/?>[ \t]*$/.test(rest)) return 7;
  if (/^<\/[a-zA-Z][a-zA-Z0-9-]*\s*>[ \t]*$/.test(rest)) return 7;
  return 0;
}

// Table delimiter row: cells of :?-+:? separated by '|', with optional
// leading/trailing '|'. Returns the cell list or null.
function tableDelimCells(line) {
  const t = trimSpaces(line);
  if (t.length === 0) return null;
  const body = t.replace(/^\||\| *$/g, "");
  const cells = body.split("|");
  for (const cell of cells) {
    if (!/^ *:?-+:? *$/.test(cell)) return null;
  }
  return cells;
}

// Split a table row into cells (marked's de()): unescaped '|' becomes
// ' |', split on ' |', trim first/last empties, pad/truncate to count.
function splitTableCells(row, count) {
  let t = "";
  for (let i = 0; i < row.length; i++) {
    if (row[i] === "|") {
      let back = 0;
      for (let j = i - 1; j >= 0 && row[j] === "\\"; j--) back++;
      t += back % 2 === 1 ? "|" : " |";
    } else t += row[i];
  }
  const parts = t.split(" |");
  if (parts.length > 0 && !parts[0].trim()) parts.shift();
  if (parts.length > 0 && !parts[parts.length - 1].trim()) parts.pop();
  if (count !== undefined) {
    if (parts.length > count) parts.splice(count);
    while (parts.length < count) parts.push("");
  }
  for (let i = 0; i < parts.length; i++) parts[i] = parts[i].trim().replace(/\\\|/g, "|");
  return parts;
}

function tableAlignOf(cell) {
  const t = cell.trim();
  if (/^ *-+: *$/.test(t)) return "right";
  if (/^ *:-+: *$/.test(t)) return "center";
  if (/^ *:-+ *$/.test(t)) return "left";
  return null;
}

// Match a link reference definition's label (marked's `le` rule: no
// nested brackets, escapes allowed, newlines allowed when the next line
// is not blank). lines[i][p] must be '['. Returns
// {label, endLine, endPos} or null.
function matchDefLabel(lines, i, p) {
  let li = i, pos = p + 1;
  let label = "";
  while (true) {
    const cur = lines[li];
    while (pos < cur.length) {
      const c = cur[pos];
      if (c === "\\") {
        if (pos + 1 < cur.length) { label += cur.slice(pos, pos + 2); pos += 2; continue; }
        // backslash at end of line: escape the newline
        if (li + 1 >= lines.length || isBlankLine(lines[li + 1])) return null;
        label += "\\\n";
        li++;
        pos = 0;
        break;
      }
      if (c === "[") return null;
      if (c === "]") {
        if (label.trim().length === 0) return null;
        return { label, endLine: li, endPos: pos + 1 };
      }
      label += c;
      pos++;
    }
    if (pos >= cur.length) {
      // end of line: continue only if the next line is not blank
      if (li + 1 >= lines.length) return null;
      if (isBlankLine(lines[li + 1])) return null;
      label += "\n";
      li++;
      pos = 0;
    }
  }
}

// Scan a title starting at lines[lineIdx][pos] (opening quote " ' or ().
// Returns {title, endLine, endPos} or null. Titles may span lines;
// a single-quoted title may not span an empty line.
function scanTitleAcross(lines, lineIdx, pos) {
  const q = lines[lineIdx][pos];
  const close = q === "(" ? ")" : q;
  let title = "";
  let li = lineIdx, p = pos + 1;
  while (li < lines.length) {
    const cur = lines[li];
    while (p < cur.length) {
      const c = cur[p];
      if (c === "\\") {
        if (p + 1 < cur.length) { title += cur.slice(p, p + 2); p += 2; continue; }
        if (li + 1 >= lines.length) return null;
        title += "\\\n";
        li++;
        p = 0;
        break;
      }
      if (c === close) return { title, endLine: li, endPos: p + 1 };
      title += c;
      p++;
    }
    if (p >= cur.length) {
      if (li + 1 >= lines.length) return null;
      if (q === "'" && lines[li + 1].length === 0) return null;
      title += "\n";
      li++;
      p = 0;
    }
  }
  return null;
}

// Try to parse a link reference definition starting at lines[i].
// Returns {ref, lines} (lines consumed) or null.
function tryDef(lines, i) {
  const first = lines[i];
  let p = 0;
  while (p < first.length && first[p] === " " && p < 3) p++;
  if (p >= first.length || first[p] !== "[") return null;
  const lm = matchDefLabel(lines, i, p);
  if (!lm) return null;
  // ':' then optional spaces/tabs/newline
  let lineIdx = lm.endLine;
  let cur = lines[lineIdx];
  let pos = lm.endPos;
  if (pos >= cur.length || cur[pos] !== ":") return null;
  pos++;
  const skipWs = () => {
    while (true) {
      while (pos < cur.length && (cur[pos] === " " || cur[pos] === "\t")) pos++;
      if (pos < cur.length) return true;
      if (lineIdx + 1 >= lines.length) return false;
      lineIdx++;
      cur = lines[lineIdx];
      pos = 0;
      if (isBlankLine(cur)) return false;
    }
  };
  if (!skipWs()) return null;
  // destination: <...> or a bare run
  let href = "";
  if (cur[pos] === "<") {
    let k = pos + 1;
    let ok = false;
    while (k < cur.length) {
      if (cur[k] === ">") { ok = true; break; }
      if (cur[k] === "\n" || cur[k] === "<") break;
      if (cur[k] === "\\") { k += 2; continue; }
      k++;
    }
    if (!ok) return null;
    href = cur.slice(pos + 1, k);
    pos = k + 1;
  } else {
    let k = pos;
    while (k < cur.length) {
      const c = cur.charCodeAt(k);
      if (c === 32 || c === 9 || c === 10 || c <= 31) break;
      k++;
    }
    if (k === pos) return null;
    href = cur.slice(pos, k);
    pos = k;
    // bare dest with unbalanced parens is not a def
    if (findClosingBracket(href, "(", ")") !== -1) return null;
  }
  href = href.replace(/\\([\p{P}\p{S}])/gu, "$1");
  const destLine = lineIdx, destPos = pos;
  // optional title: needs a separator (spaces, or a newline) before it
  let title = "";
  let endLine = destLine, endPos = destPos;
  let tLine = lineIdx, tPos = pos, tCur = cur;
  let sep = false;
  while (tPos < tCur.length && (tCur[tPos] === " " || tCur[tPos] === "\t")) { tPos++; sep = true; }
  if (tPos >= tCur.length) {
    if (tLine + 1 < lines.length && !isBlankLine(lines[tLine + 1])) {
      tLine++;
      tCur = lines[tLine];
      tPos = 0;
      while (tPos < tCur.length && (tCur[tPos] === " " || tCur[tPos] === "\t")) tPos++;
      sep = true;
    }
  }
  if (sep && tPos < tCur.length && (tCur[tPos] === '"' || tCur[tPos] === "'" || tCur[tPos] === "(")) {
    const tm = scanTitleAcross(lines, tLine, tPos);
    if (tm) {
      // after the title, only spaces/tabs to end of line
      const ec = lines[tm.endLine];
      let okEnd = true;
      for (let m = tm.endPos; m < ec.length; m++) {
        if (ec[m] !== " " && ec[m] !== "\t") { okEnd = false; break; }
      }
      if (okEnd) {
        title = tm.title.replace(/\\([\p{P}\p{S}])/gu, "$1");
        endLine = tm.endLine;
        endPos = tm.endPos;
      }
    }
  }
  if (endLine === destLine && endPos === destPos) {
    // no title: the rest of the dest's line must be spaces only
    const ec = lines[endLine];
    for (let m = endPos; m < ec.length; m++) {
      if (ec[m] !== " " && ec[m] !== "\t") return null;
    }
  }
  const label = normalizeLabel(lm.label);
  if (label.length === 0) return null;
  return { ref: { href, title }, label, lines: endLine - i + 1 };
}

// Render one inline text to HTML (fresh inRawBlock; canLink from ')').
function renderInlineText(text, refs, st) {
  st.inRawBlock = false;
  const res = lexInline(text, refs, st, text.indexOf(")") !== -1, false);
  return res.html;
}

// Render a code block's text: strip one trailing newline, add one
// (but an empty code block gets no newline at all).
function codeHtml(text, lang) {
  const body = text ? text.replace(/\n$/, "") + "\n" : "";
  const langAttr = lang ? ' class="language-' + escText(lang.split(/\s/)[0]) + '"' : "";
  return "<pre><code" + langAttr + ">" + escFull(body) + "</code></pre>\n";
}

// ---- block lexer ----

// Is this line a blockquote marker line (up to 3 spaces + '>')?
function isBlockquoteLine(line) {
  let i = 0;
  while (i < line.length && line[i] === " " && i < 3) i++;
  return i < line.length && line[i] === ">";
}

// Strip one blockquote marker (up to 3 spaces, '>', one optional space/tab).
function stripBlockquoteMarker(line) {
  let i = 0;
  while (i < line.length && line[i] === " " && i < 3) i++;
  if (i >= line.length || line[i] !== ">") return line;
  i++;
  if (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return line.slice(i);
}

// List item start. Returns {ordered, marker, start, content, indent} or null.
// `marker` is the raw marker text (e.g. '-', '1.'); `indent` is the
// marker's column width (indent spaces + marker length).
function listStart(line) {
  let i = 0;
  while (i < line.length && line[i] === " " && i < 3) i++;
  if (i >= line.length) return null;
  const ch = line[i];
  if (ch === "*" || ch === "-" || ch === "+") {
    let j = i + 1;
    if (j < line.length && line[j] !== " " && line[j] !== "\t" && line[j] !== "\n") return null;
    return { ordered: false, marker: ch, start: 0, content: line.slice(j), indent: j };
  }
  if (ch >= "0" && ch <= "9") {
    let j = i;
    while (j < line.length && line[j] >= "0" && line[j] <= "9" && j - i < 9) j++;
    if (j - i === 0 || j - i > 9) return null;
    if (j >= line.length || (line[j] !== "." && line[j] !== ")")) return null;
    const delim = line[j];
    const num = parseInt(line.slice(i, j), 10);
    j++;
    if (j < line.length && line[j] !== " " && line[j] !== "\t" && line[j] !== "\n") return null;
    return { ordered: true, marker: line.slice(i, j), start: num, delim, content: line.slice(j), indent: j };
  }
  return null;
}

// Does a list item start interrupt a paragraph? Bullet items interrupt
// when non-empty; ordered items only when the start number is 1.
function listInterrupts(line) {
  const l = listStart(line);
  if (!l) return false;
  if (l.ordered && l.start !== 1) return false;
  return l.content.trim().length > 0;
}

// Does this line start a block that interrupts a paragraph?
function paragraphInterrupt(line, isTableHeader) {
  if (fenceInfo(line)) return true;
  if (atxInfo(line)) return true;
  if (isHrLine(line)) return true;
  if (isBlockquoteLine(line)) return true;
  if (listInterrupts(line)) return true;
  const h = htmlBlockType(line);
  if (h >= 1 && h <= 6) return true;
  return false;
}

// A lazy continuation line inside a blockquote/list: non-blank and not
// starting a block that interrupts a paragraph.
function isLazyLine(line) {
  if (isBlankLine(line)) return false;
  return !paragraphInterrupt(line, false);
}

// Lex a range of lines into blocks. Returns an array of
// {type, html, text}. `top` false (list items) turns paragraphs into
// text blocks. Space blocks (blank lines) are included with html "".
// Lex a range of lines into blocks (structure only; no inline rendering
// yet — the render pass runs after the whole document is lexed, so link
// reference definitions are all collected first). Appends into `into`
// when given (a blockquote passes its shared inner-blocks array so
// marked's cross-chunk merges apply). Returns the array. `top` false
// (list items) turns paragraphs into text blocks. Space blocks (blank
// lines) are included with html "".
function lexBlocks(lines, refs, st, top, into) {
  const blocks = into || [];
  let i = 0;
  const n = lines.length;
  const push = (b) => {
    // merge consecutive text blocks
    if (b.type === "text" && blocks.length > 0 && blocks[blocks.length - 1].type === "text") {
      const prev = blocks[blocks.length - 1];
      prev.text += "\n" + b.text;
      return;
    }
    // merge a paragraph into a preceding paragraph when top is true
    // (marked's blockTokens n-flag; only reachable inside a blockquote,
    // where chunks share the array)
    if (b.type === "paragraph" && top && blocks.length > 0 && blocks[blocks.length - 1].type === "paragraph") {
      const prev = blocks[blocks.length - 1];
      prev.text += "\n" + b.text;
      return;
    }
    blocks.push(b);
  };
  while (i < n) {
    const line = lines[i];
    if (isBlankLine(line)) {
      // collect a run of blank lines as one space block
      let j = i;
      while (j < n && isBlankLine(lines[j])) j++;
      blocks.push({ type: "space", text: "", raw: "\n".repeat(j - i) });
      i = j;
      continue;
    }
    // indented code
    if (indentCols(line) >= 4) {
      let j = i;
      const collected = [];
      while (j < n && (indentCols(lines[j]) >= 4 || isBlankLine(lines[j]))) {
        collected.push(lines[j]);
        j++;
      }
      const rawText = geStr(collected.join("\n"));
      const codeText = rawText.split("\n").map((l) => stripCols(l, 4)).join("\n");
      const last = blocks[blocks.length - 1];
      if ((last && (last.type === "paragraph" || last.type === "text"))) {
        // indented code merges into a preceding paragraph/text
        last.text += "\n" + codeText;
      } else {
        blocks.push({ type: "code", text: codeText, lang: "" });
      }
      i = j;
      continue;
    }
    // fenced code
    const f = fenceInfo(line);
    if (f) {
      let j = i + 1;
      const content = [];
      let closed = false;
      while (j < n) {
        const cl = lines[j];
        const cf = fenceInfo(cl);
        if (cf && cf.char === f.char && cf.len >= f.len && trimSpaces(cl.slice(cf.indent + cf.len)).length === 0 && indentCols(cl) <= 3) {
          closed = true;
          break;
        }
        content.push(cl);
        j++;
      }
      let contentText;
      if (closed) {
        contentText = content.join("\n");
      } else {
        if (content.length > 0 && content[content.length - 1] === "") content.pop();
        contentText = content.join("\n");
      }
      // indent compensation for backtick fences only
      if (f.char === "`" && f.indent > 0) {
        contentText = contentText.split("\n").map((l) => {
          const ws = /^\s+/.exec(l);
          if (!ws) return l;
          return l.slice(Math.min(ws[0].length, f.indent));
        }).join("\n");
      }
      const lang = f.info.trim().replace(/\\([\p{P}\p{S}])/gu, "$1");
      blocks.push({ type: "code", text: contentText, lang });
      i = closed ? j + 1 : j;
      continue;
    }
    // ATX heading
    const a = atxInfo(line);
    if (a) {
      let text = a.text.trim();
      if (text.endsWith("#")) {
        const stripped = text.replace(/#+$/, "");
        if (stripped.length === 0 || /[ \t]$/.test(stripped)) text = stripped.trim();
      }
      blocks.push({ type: "heading", level: a.level, text });
      i++;
      continue;
    }
    // hr
    if (isHrLine(line)) {
      blocks.push({ type: "hr", text: "" });
      i++;
      continue;
    }
    // blockquote
    if (isBlockquoteLine(line)) {
      const res = lexBlockquote(lines, i, refs, st);
      blocks.push({ type: "blockquote", blocks: res.blocks, raw: res.raw, text: res.text });
      i = res.next;
      continue;
    }
    // list
    const ls = listStart(line);
    if (ls) {
      const res = lexList(lines, i, refs, st);
      blocks.push({ type: "list", ordered: res.ordered, start: res.start, loose: res.loose, items: res.items, raw: res.raw });
      i = res.next;
      continue;
    }
    // html block
    const ht = htmlBlockType(line);
    if (ht) {
      const res = lexHtmlBlock(lines, i, ht);
      blocks.push({ type: "html", text: res.html });
      i = res.next;
      continue;
    }
    // def
    const d = tryDef(lines, i);
    if (d) {
      const last = blocks[blocks.length - 1];
      if (last && (last.type === "paragraph" || last.type === "text")) {
        // a def after a paragraph merges into it (and is not registered)
        const defText = lines.slice(i, i + d.lines).join("\n");
        last.text += "\n" + defText;
      } else {
        if (!refs.has(d.label)) refs.set(d.label, d.ref);
        blocks.push({ type: "def", text: "" });
      }
      i += d.lines;
      continue;
    }
    // table: header line + delimiter line
    if (i + 1 < n) {
      const delim = tableDelimCells(lines[i + 1]);
      if (delim && /[:|]/.test(lines[i + 1])) {
        const headerCells = splitTableCells(lines[i]);
        const delimCells = delim;
        if (headerCells.length === delimCells.length) {
          const aligns = delimCells.map(tableAlignOf);
          // body rows: the table regex's blank-line lookahead is
          // ` *\n` (spaces only), so a tab-only line is a row, not a
          // blank line
          let j = i + 2;
          const rows = [];
          while (j < n && !/^[ ]*$/.test(lines[j]) && !paragraphInterrupt(lines[j], false)) {
            rows.push(splitTableCells(lines[j], headerCells.length));
            j++;
          }
          blocks.push({ type: "table", headerCells, aligns, rows });
          i = j;
          continue;
        }
      }
    }
    // paragraph (collect lines, stopping before a block start or a
    // setext underline), then check for a setext heading.
    // When top is false (list item), an indented line is NOT a text
    // continuation — it is an indented code block (merged, indent
    // stripped) instead.
    const paraLines = [line];
    let j = i + 1;
    while (j < n) {
      if (isBlankLine(lines[j])) {
        // a spaces-only LAST line (no newline after it) is a paragraph
        // continuation -- the paragraph regex excludes only [ \t]+\n
        if (j === n - 1 && lines[j].length > 0) { paraLines.push(lines[j]); j++; }
        break;
      }
      // inside a list item (top=false) ANY list line starts a nested
      // list; at top level only bullets and ordered-start-1 interrupt
      if (!top && listStart(lines[j])) break;
      if (paragraphInterrupt(lines[j], false) || setextLevel(lines[j]) !== 0 || (!top && indentCols(lines[j]) >= 4)) break;
      paraLines.push(lines[j]);
      j++;
    }
    if (j < n && setextLevel(lines[j]) > 0) {
      const level = setextLevel(lines[j]);
      const text = paraLines.join("\n").trim();
      blocks.push({ type: "heading", level, text });
      i = j + 1;
      continue;
    }
    const text = paraLines.join("\n");
    if (top) {
      push({ type: "paragraph", text });
    } else {
      push({ type: "text", text });
    }
    i = j;
  }
  return blocks;
}

// Render a list of blocks to HTML (after the whole document is lexed,
// so all link reference definitions are known).
function renderBlockList(blocks, refs, st) {
  let out = "";
  for (const b of blocks) out += renderOneBlock(b, refs, st);
  return out;
}

function renderOneBlock(b, refs, st) {
  switch (b.type) {
    case "paragraph":
      return "<p>" + renderInlineText(b.text, refs, st) + "</p>\n";
    case "text":
      return renderInlineText(b.text, refs, st);
    case "heading":
      return "<h" + b.level + ">" + renderInlineText(b.text, refs, st) + "</h" + b.level + ">\n";
    case "code":
      return codeHtml(b.text, b.lang || "");
    case "hr":
      return "<hr>\n";
    case "html":
      return b.text;
    case "table": {
      let html = "<table>\n<thead>\n<tr>\n";
      for (let c = 0; c < b.headerCells.length; c++) {
        const al = b.aligns[c] ? ' align="' + b.aligns[c] + '"' : "";
        html += "<th" + al + ">" + renderInlineText(b.headerCells[c], refs, st) + "</th>\n";
      }
      html += "</tr>\n</thead>\n";
      if (b.rows.length > 0) {
        html += "<tbody>";
        for (const row of b.rows) {
          html += "<tr>\n";
          for (let c = 0; c < row.length; c++) {
            const al = b.aligns[c] ? ' align="' + b.aligns[c] + '"' : "";
            html += "<td" + al + ">" + renderInlineText(row[c], refs, st) + "</td>\n";
          }
          html += "</tr>\n";
        }
        html += "</tbody>";
      }
      return html + "</table>\n";
    }
    case "blockquote":
      return "<blockquote>\n" + renderBlockList(b.blocks, refs, st) + "</blockquote>\n";
    case "list": {
      let html = b.ordered
        ? (b.start !== 1 ? '<ol start="' + b.start + '">\n' : "<ol>\n")
        : "<ul>\n";
      for (const it of b.items) {
        const check = it.task
          ? (it.checked ? '<input checked="" disabled="" type="checkbox"> ' : '<input disabled="" type="checkbox"> ')
          : "";
        const firstIsText = it.blocks.length > 0 && it.blocks[0].type === "text";
        let inner = "";
        let prefix = "";
        if (!b.loose && it.blocks.length === 1 && it.blocks[0].type === "text") {
          inner = renderInlineText(it.blocks[0].text, refs, st);
          prefix = check;
        } else if (it.blocks.length === 0) {
          inner = "";
          prefix = check;
        } else if (b.loose) {
          // marked unshifts the checkbox into the first paragraph when
          // loose; if the first block is not text it gets its own <p>
          inner = it.blocks.map((x, idx) => {
            if (x.type === "text") {
              const content = (idx === 0 && it.task) ? check + renderInlineText(x.text, refs, st) : renderInlineText(x.text, refs, st);
              return "<p>" + content + "</p>\n";
            }
            return renderOneBlock(x, refs, st);
          }).join("");
          if (it.task && !firstIsText) prefix = "<p>" + check + "</p>\n";
        } else {
          // tight, multiple blocks: checkbox only if first block is text
          inner = renderBlockList(it.blocks, refs, st);
          prefix = firstIsText ? check : "";
        }
        html += "<li>" + prefix + inner + "</li>\n";
      }
      return html + (b.ordered ? "</ol>\n" : "</ul>\n");
    }
    default:
      return "";
  }
}

function renderBlocks(lines, refs, st) {
  return renderBlockList(lexBlocks(lines, refs, st, true), refs, st);
}

// HTML block: types 1-5 end at the matching end tag, types 6-7 at a
// blank line. The raw includes any following blank lines (ge() strips
// them when there are 2+). Returns {html, next}.
function lexHtmlBlock(lines, i, type) {
  const n = lines.length;
  const startLine = lines[i];
  let j = i;
  if (type === 1) {
    const tag = /^ {0,3}<(\w+)/.exec(startLine)[1].toLowerCase();
    const endRe = new RegExp("</" + tag + "(\\s|>)", "i");
    j = i;
    let found = false;
    while (j < n) {
      if (j > i && endRe.test(lines[j])) { found = true; break; }
      if (j === i && endRe.test(lines[j].slice(lines[j].indexOf(">") + 1))) { found = true; break; }
      j++;
    }
    if (found) j++;
    else j = n;
  } else if (type === 2) {
    while (j < n && lines[j].indexOf("-->") === -1) j++;
    j = Math.min(j + 1, n);
  } else if (type === 3) {
    while (j < n && lines[j].indexOf("?>") === -1) j++;
    j = Math.min(j + 1, n);
  } else if (type === 4) {
    while (j < n && lines[j].indexOf(">") === -1) j++;
    j = Math.min(j + 1, n);
  } else if (type === 5) {
    while (j < n && lines[j].indexOf("]]>") === -1) j++;
    j = Math.min(j + 1, n);
  } else {
    // types 6-7: run to a blank line; the regex ends with the blank
    // lines, and ge() strips them (so the text ends with no newline)
    j = i + 1;
    while (j < n && !isBlankLine(lines[j])) j++;
    while (j < n && isBlankLine(lines[j])) j++;
  }
  if (type >= 1 && type <= 5) {
    // after the end marker, the regex's (\n+|\n*) consumes following
    // EMPTY lines only (newlines, not whitespace-only lines), so ge()
    // keeps one trailing newline iff no empty line follows
    while (j < n && lines[j].length === 0) j++;
  }
  // the raw is the block's lines plus a trailing newline when more
  // lines follow
  let raw = lines.slice(i, j).join("\n");
  if (j < n) raw += "\n";
  const text = geStr(raw);
  return { html: text, next: j };
}

// Blockquote: collect the regex match, process it in chunks. Returns
// {blocks, next, raw, text} (raw/text are the match lines / inner text,
// needed for the nested re-lexing below).
function lexBlockquote(lines, i, refs, st) {
  const n = lines.length;
  // 1. match extent (marked's blockquote regex Xe): '>' lines; a lazy
  // line is in the match only if the previous match line started or
  // continues a paragraph -- a '>' line with blank content starts no
  // paragraph, so a lazy line after it ends the match. A lazy setext
  // underline is not a paragraph continuation either.
  let j = i;
  let inPara = false;
  while (j < n) {
    if (isBlockquoteLine(lines[j])) {
      j++;
      inPara = stripBlockquoteMarker(lines[j - 1]).trim() !== "";
    } else if (inPara && isLazyLine(lines[j])) {
      j++;
    } else break;
  }
  const matchLines = lines.slice(i, j);
  const raw = matchLines.join("\n");
  // 2. chunk processing: lex each chunk into the SHARED innerBlocks
  // array so marked's cross-chunk merges (code/def/paragraph into a
  // preceding paragraph) apply
  let remaining = matchLines.slice();
  const innerBlocks = [];
  let consumed = 0;
  let innerText = "";
  while (remaining.length > 0) {
    let chunk = [];
    let p = 0;
    let seenMarker = false;
    while (p < remaining.length) {
      if (isBlockquoteLine(remaining[p])) { chunk.push(remaining[p]); seenMarker = true; p++; }
      else if (!seenMarker) { chunk.push(remaining[p]); p++; }
      else break;
    }
    remaining = remaining.slice(p);
    const h = chunk.join("\n");
    // tab expansion after '>', lazy setext indent, strip markers
    let u = h.replace(/^( {0,3}>)([ \t]+)/gm, (g, b, m) => b + expandTabs(m, b.length));
    u = u.replace(/\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g, "\n    $1");
    u = u.replace(/^ {0,3}>[ \t]?/gm, "");
    innerText = innerText ? innerText + "\n" + u : u;
    lexBlocks(u.split("\n"), refs, st, true, innerBlocks);
    consumed = matchLines.length - remaining.length;
    if (remaining.length === 0) break;
    const last = innerBlocks.length > 0 ? innerBlocks[innerBlocks.length - 1] : null;
    const lastType = last ? last.type : "";
    if (lastType === "code" || lastType === "heading" || lastType === "hr" || lastType === "html" || lastType === "table") break;
    if (lastType === "blockquote" && last.raw !== undefined) {
      // re-lex the nested blockquote with the remaining lines appended
      // (their '>' markers stripped), as marked does
      const rest = remaining.join("\n").replace(/^ {0,3}>[ \t]?/gm, "");
      const m = last.raw + "\n" + rest;
      const f = lexBlockquote(m.split("\n"), 0, refs, st);
      innerBlocks[innerBlocks.length - 1] = { type: "blockquote", blocks: f.blocks, raw: f.raw, text: f.text };
      const nestedLines = last.raw.split("\n").length;
      const used = Math.max(0, f.next - nestedLines);
      remaining = remaining.slice(used);
      consumed = matchLines.length - remaining.length;
      if (remaining.length > 0 && isBlockquoteLine(remaining[0])) continue;
      break;
    }
    if (lastType === "list" && last.raw !== undefined) {
      // re-lex the list with the remaining lines appended, as marked does
      const m = last.raw + "\n" + remaining.join("\n");
      const f = lexList(m.split("\n"), 0, refs, st);
      innerBlocks[innerBlocks.length - 1] = { type: "list", ordered: f.ordered, start: f.start, loose: f.loose, items: f.items, raw: f.raw };
      const used = f.raw.length > last.raw.length ? m.slice(last.raw.length + 1, f.raw.length).split("\n").length : 0;
      remaining = remaining.slice(used);
      consumed = matchLines.length - remaining.length;
      continue;
    }
    // otherwise the next chunk is lexed normally
  }
  return { blocks: innerBlocks, next: i + consumed, raw, text: innerText };
}

// List: collect items, determine tight/loose. Returns
// {ordered, start, loose, items: [{blocks, task, checked}], next}.
// The items' blocks are lexed with top=false (paragraphs become text).
function lexList(lines, i, refs, st) {
  const n = lines.length;
  const first = listStart(lines[i]);
  const ordered = first.ordered;
  const delim = first.delim;
  const marker = first.marker; // bullet lists keep one marker char
  const items = [];
  let j = i;
  let loose = false;
  let pendingLoose = false;
  let lastTrailingBlanks = 0; // trailing blank lines of the last item
  while (j < n) {
    const ls = listStart(lines[j]);
    if (!ls || ls.ordered !== ordered || (ordered && ls.delim !== delim) || (!ordered && ls.marker !== marker)) break;
    if (isHrLine(lines[j])) break;
    if (pendingLoose) loose = true;
    const b = ls.indent; // marker width (indent + marker)
    const content = ls.content;
    const m0 = content.replace(/^[ \t]+/, (v) => expandTabs(v, b));
    const empty = m0.trim().length === 0;
    let m = m0;
    let R;
    let d;
    if (empty) {
      R = b + 1;
      d = "";
    } else {
      R = m.search(/[^ ]/);
      if (R === -1) R = 0;
      if (R > 4) R = 1;
      d = m.slice(R);
      R += b;
    }
    // an empty item followed by a blank line is a blank item: the
    // blank line is consumed (marked skips it from the source) and the
    // item has no continuation lines
    let blankItem = false;
    if (empty && j + 1 < n && isBlankLine(lines[j + 1])) {
      blankItem = true;
      j += 2;
    }
    const itemLines = [d];
    let trailingBlank = false;
    if (!blankItem) {
      j++;
      let y = empty;
      // block-start break regexes use max indent min(3, R-1) (marked's
      // D() memoizer clamps the indent argument)
      const breakIndent = Math.max(0, Math.min(3, R - 1));
      while (j < n) {
        const U = lines[j];
        const Z = U.replace(/^[ \t]+/, (v) => expandTabs(v, 0));
        const ind = Z.search(/[^ ]/);
        const indCols = ind === -1 ? Z.length : ind;
        if (indCols <= breakIndent) {
          if (fenceInfo(Z) || atxInfo(Z) || htmlBlockType(Z) >= 1 || isBlockquoteLine(Z)) break;
          if (isHrLine(Z)) break;
          if (listStart(Z)) break;
        }
        if (indCols >= R || !U.trim()) {
          itemLines.push(Z.slice(R));
        } else {
          if (y || m.replace(/\t/g, "    ").search(/[^ ]/) >= 4 || fenceInfo(m) || atxInfo(m) || htmlBlockType(m) >= 1 || isHrLine(m)) break;
          // lazy line; a setext underline after the first line is indented
          let qe = U;
          if (/^ {0,3}(?:=+|-+) *$/.test(U) && setextLevel(U) > 0) qe = "    " + U.replace(/^ {0,3}/, "");
          itemLines.push(qe);
        }
        y = !U.trim();
        m = Z.slice(R);
        j++;
      }
    }
    // looseness from blank lines is decided on the item's LEXED blocks
    // (a space block between two non-space blocks), not on the raw
    // item lines -- blank lines inside nested blocks do not loosen the
    // outer list
    // a trailing blank line makes the list loose only if another item
    // follows (marked's doubleBlankLine test on the item's raw): a
    // blank continuation line, or the blank line after a blank item
    trailingBlank = blankItem || (itemLines.length > 1 && itemLines[itemLines.length - 1].trim() === "");
    pendingLoose = trailingBlank;
    // trim trailing blank lines from the item text, but remember how
    // many there were: they are left for the outer lexing (a blank line
    // after a nested list is a space block in the outer item, which is
    // what makes the outer list loose)
    let trimCount = 0;
    while (itemLines.length > 0 && itemLines[itemLines.length - 1].trim() === "") { itemLines.pop(); trimCount++; }
    lastTrailingBlanks = trimCount;
    const itemText = itemLines.join("\n");
    const isTask = /^\[[ xX]\][ \t]+\S/.test(itemText);
    items.push({ text: itemText, task: isTask });
  }
  if (items.length === 0) return { ordered, start: first.start, loose: false, items: [], next: j, raw: "" };
  // re-lex each item's text (top=false)
  const itemBlocks = items.map((it) => {
    let text = it.text;
    if (it.task) text = text.replace(/^\[[ xX]\][ \t]+/, "");
    const blocks = lexBlocks(text.split("\n"), refs, st, false);
    return { blocks, task: it.task, checked: /^\[[xX]\]/.test(it.text) };
  });
  // loose if any item's top-level blocks have a space block strictly
  // between two non-space blocks (a blank line between two blocks)
  for (const ib of itemBlocks) {
    const bs = ib.blocks;
    for (let k = 1; k + 1 < bs.length; k++) {
      if (bs[k].type === "space" && bs[k - 1].type !== "space" && bs[k + 1].type !== "space") { loose = true; break; }
    }
    if (loose) break;
  }
  // leave the last item's trailing blank lines unconsumed so the outer
  // lexing sees them as a space block
  j = Math.max(i, j - lastTrailingBlanks);
  return { ordered, start: first.start, loose, items: itemBlocks, next: j, raw: lines.slice(i, j).join("\n") };
}

// ---- parse entry ----

export function parse(markdown) {
  const text = String(markdown).replace(/\r\n?/g, "\n");
  const refs = new Map();
  const st = newInlineState();
  const lines = text.split("\n");
  return renderBlocks(lines, refs, st);
}

