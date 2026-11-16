/* beNotable! Reader engine · speech normalisation (own code, MIT).
 * Rewrites the text that is SPOKEN, never the text that is shown: file names, paths, URLs, versions, decimals, abbreviations and acronyms
 * are turned into what a person would say ("terraform.tf" -> "terraform dot T F", "AWS" -> "A W S", "z. B." -> "zum Beispiel").
 * Contract ("Offsets sind heilig"): the result has EXACTLY one non-empty spoken string per input token, so the displayed words, their offsets,
 * the word times of the engine and the highlight stay 1:1; a rule may turn one token into several spoken words ("A W S"), never into none,
 * and a multi-token abbreviation ("z." "B.") is distributed over its tokens ("zum" "Beispiel"). Only the synthesis input changes.
 * Separate from the chunker (session/text-map.mjs), which only decides where a section ends.
 * Languages: de and en have tables; any other language is returned unchanged (add an entry to LANGS to support one).
 * Decisions: SQL is spoken "sequel" in English and spelled in German; JSON/YAML are words; URL schemes (https://) and query strings are not read. */

/* Letter spelling, chosen with the bundled eSpeak phonemizer (phoneme dump in tests/speech-normalize-asr.cjs): German capitals with spaces ("A W S") are read
   as letter names; English needs words, because a lone capital A becomes the article "uh" (A W S -> "uh double you ess") and "ay" is read like "eye":
   a = "eigh", f = "ef" (not "eff"). */
const LETTERS = {
  en: {a: 'eigh', b: 'bee', c: 'see', d: 'dee', e: 'ee', f: 'ef', g: 'gee', h: 'aitch', i: 'eye', j: 'jay', k: 'kay', l: 'el', m: 'em', n: 'en', o: 'oh', p: 'pee', q: 'cue', r: 'ar', s: 'ess', t: 'tee', u: 'you', v: 'vee', w: 'double you', x: 'ex', y: 'why', z: 'zee'},
  de: Object.fromEntries([...'abcdefghijklmnopqrstuvwxyz'].map(c => [c, c.toUpperCase()])),
};
/* Acronyms that are spoken as a word (kept unchanged) or with a fixed pronunciation. */
const ACRONYM_WORDS = new Set('NASA NATO UNESCO UNICEF OPEC FIFA UEFA LASER RADAR SCUBA RAM ROM BIOS LAN WAN PIN FAQS BASIC COBOL FORTRAN LISP PERL OTTO'.split(' '));
const ACRONYM_SPOKEN = {
  en: {SQL: 'sequel', JSON: 'Jason', YAML: 'yammel', TOML: 'tomel', GUI: 'gooey', CRUD: 'crud', ASCII: 'askey', GIF: 'jif', JPEG: 'jay peg', K8S: 'Kubernetes', WLAN: 'W lan', NOSQL: 'no sequel', MYSQL: 'my sequel', OAUTH: 'oh auth', README: 'read me'},
  de: {JSON: 'Jason', YAML: 'Jammel', TOML: 'Tomel', GUI: 'G U I', CRUD: 'Krad', ASCII: 'Aski', GIF: 'Gif', JPEG: 'J P E G', K8S: 'Kubernetes', WLAN: 'W Lan', NOSQL: 'No S Q L', README: 'Read Mi'},
};
/* All-caps words that must stay words (headlines, ordinary words in capitals) and are not acronyms. */
const STOPWORDS = {
  en: new Set('THE AND FOR NOT BUT YOU ALL ARE WAS NEW NOW OUT ONE TWO NO YES OK STOP WARNING NOTE TODO WIP FIXME TBD HELLO WELL WHO WHY HOW WHAT THIS THAT WITH FROM HAVE WILL YOUR WHEN THEN THAN INTO ONLY ALSO MORE MOST SOME THEY WERE BEEN EACH'.split(' ')),
  de: new Set('DER DIE DAS UND MIT FÜR NICHT EIN EINE JA NEIN OK ACHTUNG STOPP HINWEIS NEU ALLE ALLES WIR SIE ICH ER ES IST SIND WAR AUF AUS BEI NUR AUCH WIE WAS WER WANN WENN DASS ODER ABER'.split(' ')),
};
const WORDS = {
  en: {vdot: 'point', dot: 'dot', slash: 'slash', backslash: 'backslash', colon: 'colon', tilde: 'tilde', at: 'at', point: 'point', version: 'version', minus: 'minus'},
  de: {vdot: 'Punkt', dot: 'Punkt', slash: 'Slash', backslash: 'Backslash', colon: 'Doppelpunkt', tilde: 'Tilde', at: 'ät', point: 'Komma', version: 'Version', minus: 'minus'},
};
/* File extensions that are spoken; value = how (letters spelled when missing and length <= 3, otherwise the word itself). */
const EXT_SPOKEN = {
  en: {json: 'Jason', yaml: 'yammel', yml: 'Y M L', toml: 'tomel', md: 'M D', txt: 'T X T', sql: 'sequel', py: 'P Y', rs: 'R S', env: 'env', lock: 'lock', log: 'log', conf: 'conf', cfg: 'C F G', ini: 'I N I', tfvars: 'T F vars', tfstate: 'T F state', gitignore: 'git ignore', net: 'net', exe: 'exe', bat: 'bat', ps1: 'P S 1', tar: 'tar', zip: 'zip', go: 'go', java: 'java', html: 'H T M L', css: 'C S S', xml: 'X M L', csv: 'C S V', pdf: 'P D F', svg: 'S V G', png: 'P N G', jpg: 'J P G', jpeg: 'J P E G', gif: 'gif', mjs: 'M J S', cjs: 'C J S', tsx: 'T S X', jsx: 'J S X', php: 'P H P', rb: 'R B', sh: 'S H', h: 'H', c: 'C', hpp: 'H P P', cpp: 'C P P', ts: 'T S', js: 'J S', tf: 'T F', gz: 'G Z', dll: 'D L L', iso: 'I S O', img: 'I M G', bak: 'back', tmp: 'temp'},
  de: {json: 'Jason', yaml: 'Jammel', yml: 'Y M L', toml: 'Tomel', md: 'M D', txt: 'T X T', sql: 'S Q L', py: 'P Y', rs: 'R S', env: 'env', lock: 'lock', log: 'log', conf: 'conf', cfg: 'C F G', ini: 'I N I', tfvars: 'T F vars', tfstate: 'T F state', gitignore: 'git ignore', net: 'net', exe: 'exe', bat: 'bat', ps1: 'P S 1', tar: 'tar', zip: 'zip', go: 'go', java: 'java', html: 'H T M L', css: 'C S S', xml: 'X M L', csv: 'C S V', pdf: 'P D F', svg: 'S V G', png: 'P N G', jpg: 'J P G', jpeg: 'J P E G', gif: 'gif', mjs: 'M J S', cjs: 'C J S', tsx: 'T S X', jsx: 'J S X', php: 'P H P', rb: 'R B', sh: 'S H', h: 'H', c: 'C', hpp: 'H P P', cpp: 'C P P', ts: 'T S', js: 'J S', tf: 'T F', gz: 'G Z', dll: 'D L L', iso: 'I S O', img: 'I M G', bak: 'back', tmp: 'temp'},
};
/* Spoken only in a DE/EN-neutral way: the letters of these are filled from LETTERS at runtime (see spellOut). */
const FILE_EXT = new Set(Object.keys(EXT_SPOKEN.en).concat(['toml', 'ts', 'tf', 'hcl', 'proto', 'gradle', 'cs', 'kt', 'swift', 'lua', 'vue', 'scss', 'less', 'md', 'rst', 'tex', 'bib', 'docx', 'xlsx', 'pptx', 'odt', 'mp3', 'mp4', 'wav', 'webp', 'ico', 'woff', 'woff2', 'wasm', 'bin', 'dat', 'db', 'sqlite', 'pem', 'crt', 'key', 'pub', 'service', 'timer', 'mount', 'desktop', 'nix', 'patch', 'diff', 'rpm', 'deb', 'apk', 'jar', 'war', 'tgz', 'xz', 'bz2', '7z', 'rar']));
const TLD_SPOKEN = {
  en: {com: 'com', org: 'org', net: 'net', edu: 'E D U', gov: 'gov', io: 'I O', dev: 'dev', app: 'app', info: 'info', cloud: 'cloud', ai: 'A I', de: 'D E', eu: 'E U', uk: 'U K', us: 'U S', co: 'C O', me: 'M E', fr: 'F R', nl: 'N L', ch: 'C H', at: 'A T', tv: 'T V', xyz: 'X Y Z', tech: 'tech', online: 'online', site: 'site', shop: 'shop'},
  de: {com: 'com', org: 'org', net: 'net', edu: 'E D U', gov: 'gov', io: 'I O', dev: 'dev', app: 'app', info: 'info', cloud: 'cloud', ai: 'A I', de: 'D E', eu: 'E U', uk: 'U K', us: 'U S', co: 'C O', me: 'M E', fr: 'F R', nl: 'N L', ch: 'C H', at: 'A T', tv: 'T V', xyz: 'X Y Z', tech: 'tech', online: 'online', site: 'site', shop: 'shop'},
};
const FILE_BASE = {readme: 'read me', license: 'license', changelog: 'change log', makefile: 'make file', dockerfile: 'docker file', gemfile: 'gem file', procfile: 'proc file'};
/* Single-token abbreviations: key = lower case with the dot. keepEnd: the dot is kept when the next token starts a new sentence or the text ends. */
const ABBREVIATIONS = {
  en: {'e.g.': 'for example', 'i.e.': 'that is', 'etc.': {s: 'et cetera', keepEnd: true}, 'vs.': 'versus', 'approx.': 'approximately', 'dr.': 'Doctor', 'mr.': 'Mister', 'mrs.': 'Missus', 'ms.': 'Miz', 'prof.': 'Professor', 'fig.': 'Figure', 'inc.': 'Incorporated', 'ltd.': 'Limited', 'jr.': 'Junior', 'sr.': 'Senior', 'cf.': 'compare', 'a.m.': 'A M', 'p.m.': 'P M', 'u.s.': 'U S', 'u.k.': 'U K', 'ph.d.': 'P H D', 'dept.': 'department', 'est.': 'estimated', 'vol.': 'volume'},
  de: {'z.b.': 'zum Beispiel', 'd.h.': 'das heißt', 'u.a.': 'unter anderem', 'u.u.': 'unter Umständen', 'o.ä.': 'oder ähnliche', 'v.a.': 'vor allem', 'z.t.': 'zum Teil', 'i.d.r.': 'in der Regel', 'dr.': 'Doktor', 'prof.': 'Professor', 'nr.': 'Nummer', 'usw.': {s: 'und so weiter', keepEnd: true}, 'etc.': {s: 'et cetera', keepEnd: true}, 'bzw.': 'beziehungsweise', 'ca.': 'circa', 'ggf.': 'gegebenenfalls', 'inkl.': 'inklusive', 'vgl.': 'vergleiche', 'evtl.': 'eventuell', 'max.': 'maximal', 'mio.': 'Millionen', 'mrd.': 'Milliarden', 'tel.': 'Telefon', 'str.': 'Straße', 'abb.': 'Abbildung', 'bspw.': 'beispielsweise', 'sog.': 'sogenannte', 'hr.': 'Herr', 'bzgl.': 'bezüglich', 'e.g.': 'zum Beispiel', 'i.e.': 'das heißt', 'ph.d.': 'P H D', 'hrsg.': 'herausgegeben'},
};
/* Multi-token abbreviations written with spaces ("z. B."): keys are lower case with the dot, spoken words are distributed one per token. */
const SEQUENCES = {
  en: [],
  de: [['z. b.', 'zum Beispiel'], ['d. h.', 'das heißt'], ['u. a.', 'unter anderem'], ['u. u.', 'unter Umständen'], ['o. ä.', 'oder ähnliche'], ['v. a.', 'vor allem'], ['z. t.', 'zum Teil'], ['i. d. r.', 'in der Regel'], ['s. o.', 'siehe oben'], ['s. u.', 'siehe unten'], ['i. a.', 'im Allgemeinen'], ['n. chr.', 'nach Christus'], ['v. chr.', 'vor Christus'], ['e. v.', 'eingetragener Verein'], ['d. j.', 'dieses Jahres'], ['u. ä.', 'und ähnliche']].map(([k, s]) => [k.split(' '), s.split(' ')]),
};
/* Formula symbols that stand alone as a token ("x = y 2" from MathML): the phonemizer would drop them. Only the exact token; "-" is left alone (dash in prose). */
const MATH_SYMBOLS = {
  en: {'=': 'equals', '+': 'plus', '−': 'minus', '×': 'times', '÷': 'divided by', '±': 'plus or minus', '≤': 'less than or equal to', '≥': 'greater than or equal to', '≠': 'not equal to', '≈': 'approximately', '<': 'less than', '>': 'greater than', '∑': 'sum', '∫': 'integral', '√': 'square root of', '∞': 'infinity', 'π': 'pi', '→': 'goes to', '∈': 'in', '·': 'times'},
  de: {'=': 'gleich', '+': 'plus', '−': 'minus', '×': 'mal', '÷': 'geteilt durch', '±': 'plus minus', '≤': 'kleiner gleich', '≥': 'größer gleich', '≠': 'ungleich', '≈': 'ungefähr', '<': 'kleiner als', '>': 'größer als', '∑': 'Summe', '∫': 'Integral', '√': 'Wurzel aus', '∞': 'unendlich', 'π': 'Pi', '→': 'geht gegen', '∈': 'Element von', '·': 'mal'},
};
const LANG_SETTINGS = {de: {decimal: 'Komma'}, en: {decimal: 'point'}};
const baseLang = lang => String(lang || '').toLowerCase().split(/[-_]/)[0];
export const isSupported = lang => Object.hasOwn(LETTERS, baseLang(lang));

const spellOut = (value, lang, plural = false) => {
  const out = [];
  for (const ch of value) { const l = ch.toLowerCase(); out.push(LETTERS[lang][l] ?? ch); }
  if (plural && out.length) out[out.length - 1] += 's';
  return out.join(' ');
};
const digitsOnly = text => text.split('').join(' ');

/* Splits "(\"foo.tf\")," into lead / core / trail where the trail is closing punctuation without dots (dots stay in the core: they may belong to an abbreviation). */
const LEAD = /^[(\[{"'„“‚‘»«*_`]+/u, TRAIL = /[)\]}"'”’“»«,;:!?…*_`]+$/u;
function parts(token) {
  let lead = '', trail = '', core = token;
  const l = LEAD.exec(core); if (l) { lead = l[0]; core = core.slice(lead.length); }
  const t = TRAIL.exec(core); if (t) { trail = t[0]; core = core.slice(0, core.length - trail.length); }
  return {lead, core, trail};
}
const splitDots = core => { const bare = core.replace(/\.+$/u, ''); return {bare, dots: core.slice(bare.length)}; };

function speakExt(ext, lang) {
  const key = ext.toLowerCase();
  if (EXT_SPOKEN[lang][key]) return EXT_SPOKEN[lang][key];
  return key.length <= 3 ? spellOut(key, lang) : key;
}
/* One dotted word like "terraform.tf", "archive.tar.gz", "example.com", ".gitignore", "Node.js" -> spoken, or null when it is not a file/domain. inPath = every dot is spoken. */
function speakDotted(word, lang, inPath = false) {
  const W = WORDS[lang];
  if (!word.includes('.')) return null;
  const segs = word.split('.');
  const last = segs[segs.length - 1].toLowerCase();
  const leadingDot = segs[0] === '';
  const body = leadingDot ? segs.slice(1) : segs;
  if (body.length === 0 || body.some(s => s === '')) return null;
  if (!inPath) {
    if (leadingDot) { if (body.length === 1 && /^[A-Za-z][\w-]*$/u.test(body[0]) && body[0].length >= 3) return `${W.dot} ${body[0]}`; if (!FILE_EXT.has(last)) return null; }
    else if (!(FILE_EXT.has(last) || Object.hasOwn(TLD_SPOKEN[lang], last))) return null;
    if (!/^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u.test(body.join('.'))) return null;
  }
  const out = leadingDot ? [W.dot] : [];
  body.forEach((seg, i) => {
    if (i > 0) out.push(W.dot);
    const isLast = i === body.length - 1, lower = seg.toLowerCase();
    if (i === 0) out.push(leadingDot ? seg : (seg.toLowerCase() === 'www' ? spellOut('www', lang) : FILE_BASE[lower] || seg));
    else if (isLast && Object.hasOwn(TLD_SPOKEN[lang], lower) && !FILE_EXT.has(lower)) out.push(TLD_SPOKEN[lang][lower]);
    else if (isLast || FILE_EXT.has(lower) || Object.hasOwn(TLD_SPOKEN[lang], lower)) out.push(speakExt(seg, lang));
    else out.push(seg);
  });
  return out.join(' ');
}
const SEG = /^[\p{L}\p{N}_.@%+~-]*$/u;
/* Paths ("/etc/hosts", "~/.config/foo", "C:\\Dir\\file.txt") and URLs/domains with a path ("github.com/user/repo"). */
function speakPath(bare, lang) {
  const W = WORDS[lang];
  let rest = bare, drive = '';
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//iu.exec(rest); if (scheme) rest = rest.slice(scheme[0].length);       // "https://" is not read
  const q = rest.search(/[?#]/u); if (q > 0) rest = rest.slice(0, q);                                            // query/fragment are not read
  const win = /^([A-Za-z]):\\/u.exec(rest); if (win) { drive = `${spellOut(win[1], lang)} ${W.colon} ${W.backslash}`; rest = rest.slice(3); }
  const useBack = win || (rest.includes('\\') && !rest.includes('/'));
  const sep = useBack ? '\\' : '/', sepWord = useBack ? W.backslash : W.slash;
  const lead = /^(~|\.{1,2})?(?=[/\\])/u.exec(rest);
  const pieces = [];
  if (lead && lead[0]) { pieces.push(lead[0] === '~' ? W.tilde : lead[0] === '..' ? `${W.dot} ${W.dot}` : W.dot); rest = rest.slice(lead[0].length); }
  const segs = rest.split(sep);
  const spoken = segs.map(seg => {
    if (!seg) return '';
    if (!SEG.test(seg)) return seg;
    if (seg.includes('.')) return speakDotted(seg, lang, true) ?? seg;
    return FILE_BASE[seg.toLowerCase()] || seg;
  });
  // the separator word stands between two segments (a leading or trailing empty segment keeps its separator)
  const joined = [];
  spoken.forEach((word, i) => { if (i > 0) joined.push(sepWord); if (word) joined.push(word); });
  return [drive, ...pieces, ...joined].filter(Boolean).join(' ');
}
const hintSegment = seg => { const d = seg.split('.'); return d.length > 1 && d.at(-1) !== '' && (FILE_EXT.has(d.at(-1).toLowerCase()) || Object.hasOwn(TLD_SPOKEN.en, d.at(-1).toLowerCase())); };
const isPathLike = bare => {
  if (/^[A-Za-z]:\\[^\s]/u.test(bare)) return true;                                   // C:\Dir\file.txt
  if (/^[a-z][a-z0-9+.-]*:\/\/[^\s/]/iu.test(bare)) return true;                         // https://example.com/...
  if (/^(?:~|\.{1,2})\/[^\s/]/u.test(bare)) return true;                               // ~/x  ./x  ../x
  if (/^[\p{L}\p{N}_.@%+-]+(?:\\[\p{L}\p{N}_.@%+-]+)+$/u.test(bare)) return true;       // Dir\file
  const m = /^\/?[\p{L}\p{N}_.~@%+-]+(?:\/[\p{L}\p{N}_.~@%+-]*)+$/u.exec(bare);        // /etc/hosts  src/main.rs  github.com/user/repo
  if (!m) return false;
  const slashes = (bare.match(/\//g) || []).length;
  if (/^\d[\d/.-]*$/u.test(bare) || /^[A-Z0-9]{1,5}(?:\/[A-Z0-9]{1,5})+$/u.test(bare)) return false;   // 24/7, 1/2, I/O, TCP/IP
  return slashes >= 2 || bare.split('/').some(hintSegment);
};
const isEmail = bare => /^[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(bare);
function speakEmail(bare, lang) {
  const [local, domain] = bare.split('@'), W = WORDS[lang];
  return `${local.split('.').join(` ${W.dot} `)} ${W.at} ${domain.split('.').map((s, i, a) => i === a.length - 1 && Object.hasOwn(TLD_SPOKEN[lang], s.toLowerCase()) ? TLD_SPOKEN[lang][s.toLowerCase()] : s).join(` ${W.dot} `)}`;
}

/* Versions ("v1.2.3", "10.0.19045", "192.168.0.1") and decimals ("3.14", "0.05%"). Dates (05.11.2026) and German thousands (1.500) are left to the engine. */
function speakNumber(bare, lang, ctx = {}) {
  const W = WORDS[lang];
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/u.test(bare)) return null;
  const ver = /^([vV]?)(\d+(?:\.\d+){2,})([-+][\w.]+)?$/u.exec(bare);
  if (ver) return `${ver[1] && !/^version$/iu.test(ctx.prev || '') ? `${W.version} ` : ''}${ver[2].split('.').join(` ${W.vdot} `)}${ver[3] ? ` ${ver[3].slice(1)}` : ''}`;
  const dec = /^([-+−]?)(\d+)\.(\d+)(%?)$/u.exec(bare);
  if (dec) {
    if (lang === 'de' && dec[3].length === 3 && dec[2].length <= 3 && dec[1] === '' && !dec[4]) return null;      // 1.500 = tausendfünfhundert
    return `${dec[1] ? `${W.minus} ` : ''}${dec[2]} ${LANG_SETTINGS[lang].decimal} ${digitsOnly(dec[3])}${dec[4] ? ' %' : ''}`;
  }
  return null;
}

/* Acronyms. known = all-caps token (optionally with digits / plural s). Returns spoken or null. */
const ACRO = /^([A-Z][A-Z0-9]{1,5}|[A-Z]\d[A-Z]?|\d[A-Z]{1,2})(s?)$/u;
function speakAcronym(bare, lang, neighbours) {
  if (bare === 'K8s' || bare === 'K8S') return ACRONYM_SPOKEN[lang].K8S;
  const m = ACRO.exec(bare); if (!m) return null;
  const word = m[1], plural = m[2] === 's', upper = word.toUpperCase();
  if (!/[A-Z]/u.test(word) || ACRONYM_WORDS.has(upper) || STOPWORDS[lang].has(upper) || ROMAN.has(upper)) return null;
  if (!plural && Object.hasOwn(ACRONYM_SPOKEN[lang], upper)) return ACRONYM_SPOKEN[lang][upper];
  // shouting text ("HOW TO INSTALL ...") is not an acronym: a long all-caps neighbour that is not an acronym itself
  if (neighbours.some(n => /^[A-ZÄÖÜ]{4,}$/u.test(n) && /[AEIOUYÄÖÜ]/u.test(n) && !KNOWN_LONG.has(n) && !ACRONYM_WORDS.has(n) && !Object.hasOwn(ACRONYM_SPOKEN[lang], n))) return null;
  // letters only when it looks like an acronym: short, or without vowels, or on the explicit list ("HELLO" is a shouted word, "HTTPS" is not)
  if (word.length > 4 && !KNOWN_LONG.has(upper) && /[AEIOUY]/u.test(word)) return null;
  return plural ? spellOut(word, lang, true) : spellDigitsMixed(word, lang);
}
const ROMAN = new Set(['II', 'III', 'IV', 'VII', 'VIII', 'XII', 'XIII']);
const KNOWN_LONG = new Set('HTTPS HTML YAML JSON TOML CSRF OAUTH IPV4 IPV6 TCPIP DEVOPS NOSQL SMTP IMAP LDAP SFTP GRPC GRAPHQL WLAN'.split(' '));
/* "EC2" -> "E C 2" (digits stay digits: the engine reads numbers in its language). */
function spellDigitsMixed(word, lang) {
  return word.replace(/[A-Za-z]+|\d+/gu, run => /\d/u.test(run) ? run : spellOut(run, lang)).replace(/\s+/gu, ' ').replace(/(\S)(?=\d)/gu, '$1 ').replace(/(\d)(?=[A-Za-z])/gu, '$1 ').replace(/\s+/gu, ' ').trim();
}
/* Hyphen/slash compounds that contain an acronym: "AWS-Konto" -> "A W S Konto", "CI/CD" -> "C I C D", "TCP/IP". */
function speakCompound(bare, lang, neighbours) {
  if (!/[-/–]/u.test(bare)) return null;
  const pieces = bare.split(/([-/–])/u);
  const items = pieces.filter((_, i) => i % 2 === 0);
  if (items.some(s => !s)) return null;
  const spokenItems = items.map(s => speakAcronym(s, lang, neighbours));
  const acros = spokenItems.filter(Boolean).length;
  if (!acros) return null;
  if (pieces.some((p, i) => i % 2 === 1 && p === '/') && spokenItems.some(s => !s)) return null;               // "AWS/Azure"-like text with a slash stays
  return items.map((s, i) => spokenItems[i] ?? s).join(' ');
}

/* Ordered rules for ONE token core (no lead/trail). Returns {s, dots} or null. */
function speakCore(core, lang, ctx) {
  const {bare, dots} = splitDots(core);
  if (!bare) return null;
  const key = (bare + (dots ? '.' : '')).toLowerCase();
  if (dots.length <= 1) {
    const abbreviation = ABBREVIATIONS[lang][key];
    if (abbreviation) {
      const s = typeof abbreviation === 'string' ? abbreviation : abbreviation.s;
      const keep = typeof abbreviation === 'object' && abbreviation.keepEnd && (ctx.next === undefined || /^[(\["„“»'‘]*[\p{Lu}\p{N}]/u.test(ctx.next));
      return {s, dots: keep ? '.' : ''};
    }
    if (dots && /^(?:\p{L}\.){2,}$/u.test(key)) return {s: spellOut(key.replace(/\./gu, ''), lang), dots: ''};      // U.S.A. -> U S A
  }
  if (isEmail(bare) && !dots) return {s: speakEmail(bare, lang), dots: ''};
  if (isPathLike(bare)) return {s: speakPath(bare, lang), dots};
  if (isEmail(bare)) return {s: speakEmail(bare, lang), dots};
  const number = speakNumber(bare, lang, ctx);
  if (number) return {s: number, dots};
  const dotted = speakDotted(bare, lang);
  if (dotted) return {s: dotted, dots};
  const acronym = speakAcronym(bare, lang, ctx.neighbours);
  if (acronym) return {s: acronym, dots};
  const compound = speakCompound(bare, lang, ctx.neighbours);
  if (compound) return {s: compound, dots};
  return null;
}

/** tokens: whitespace tokens of the displayed text. Returns the spoken string for every token (same length, never empty). */
export function speechTokens(tokens, lang) {
  const code = baseLang(lang);
  if (!isSupported(code) || !Array.isArray(tokens)) return tokens ? tokens.slice() : tokens;
  const cores = tokens.map(t => parts(String(t)));
  const out = tokens.map(String);
  const alpha = i => (cores[i]?.core || '').replace(/[^A-Za-zÄÖÜ]/gu, '');
  for (let i = 0; i < tokens.length; i++) {
    const symbol = MATH_SYMBOLS[code][cores[i].core];
    if (symbol) { out[i] = cores[i].lead + symbol + cores[i].trail; continue; }
    // multi-token abbreviations first ("z. B.")
    let done = false;
    for (const [seq, words] of SEQUENCES[code]) {
      if (i + seq.length > tokens.length) continue;
      let ok = true;
      for (let k = 0; k < seq.length && ok; k++) ok = (k === seq.length - 1 ? cores[i + k].core.toLowerCase() === seq[k] : cores[i + k].core.toLowerCase() === seq[k] && !cores[i + k].trail);
      if (!ok) continue;
      for (let k = 0; k < seq.length; k++) out[i + k] = cores[i + k].lead + words[k] + (k === seq.length - 1 ? cores[i + k].trail : '');
      i += seq.length - 1; done = true; break;
    }
    if (done) continue;
    const neighbours = [alpha(i - 2), alpha(i - 1), alpha(i + 1), alpha(i + 2)].filter(Boolean);
    const {lead, core, trail} = cores[i];
    const r = speakCore(core, code, {next: tokens[i + 1], prev: cores[i - 1]?.core, neighbours});
    if (!r || !r.s) continue;
    out[i] = lead + r.s + r.dots + trail;
  }
  return out;
}

/** Engine entry: {text, words?} -> {text, words} in speech form, or the input untouched (same object) when nothing changes.
 *  words must be the whitespace tokens of text; if they are not, nothing is rewritten (the mapping could not be proven). */
export function prepareSpeech({text, words}, lang) {
  if (!isSupported(lang) || typeof text !== 'string') return {text, words, changed: false};
  const tokens = text.match(/\S+/gu) || [];
  const base = Array.isArray(words) && words.length ? words : tokens;
  if (base.length !== tokens.length || base.some((w, i) => w !== tokens[i])) return {text, words, changed: false};
  const spoken = speechTokens(tokens, lang);
  if (spoken.every((s, i) => s === tokens[i])) return {text, words, changed: false};
  return {text: spoken.join(' '), words: spoken, changed: true};
}
