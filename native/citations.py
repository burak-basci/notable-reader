"""Citation / footnote marks: recognised, kept in text and offsets, skipped when speaking.

A mark (A7, [A7], a raised footnote digit, a back arrow) stays in the chunk text and
keeps its word, so click jumps, word rectangles, fingerprints and saved reading
positions are unchanged.  It is only flagged on its word as ``mute`` (character
ranges relative to the word start; ``silent`` = the whole word).  Before synthesis
``spoken_view`` cuts the ranges out of the text the voice receives, and
``remap_timings`` maps the voice's word timings back onto the chunk text and adds
zero-length entries for muted words, so the highlight never rests on a mark.

Numeric bracket citations ([16], [20-22]) are still removed by
``extraction.strip_citations`` (older behaviour, keeps existing fingerprints).
"""
import re

_DASH = r'[-‐‑‒–—]'
_ID = r'[A-Z]{1,2}\d{1,4}[a-z]?'
_NUM = r'\d{1,4}[a-z]?'
_ITEM = rf'(?:{_ID}|{_NUM})(?:\s*{_DASH}\s*(?:{_ID}|\d{{1,4}}))?'
_LABELS = (r'Quelle|Quellen|Source|Sources|Beleg|Belege|Nachweis|Anm\.?|Fn\.?|Note|Fußnote|ebd\.?|Ibid\.?|'
           r'citation needed|Zitat erforderlich|Beleg fehlt|Quelle fehlt')
# [A7] [A1, A3] [3-5] [12] [Quelle] [Anm. 3] [citation needed]; letter IDs need a boundary
# before the bracket so that code such as arr[A1] is not touched.
BRACKET_MARK = re.compile(
    rf'(?<![A-Za-z0-9_])\[\s*{_ITEM}(?:\s*[,;]\s*{_ITEM})*\s*\]'
    rf'|(?<![A-Za-z0-9_])\[\s*(?:{_LABELS})(?:\s*\d{{1,3}})?\s*\]')

SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
_RUN_OK = re.compile(r'^(?:\d{1,3}|[*†‡§¶‖#]{1,3}|[a-z]|\d{1,2}[,–—-]\d{1,2})$')
# Short bases for which a raised digit/letter is a unit or exponent, not a footnote.
_UNIT_WORDS = {'min', 'mol', 'bar', 'sec', 'rad', 'ppm', 'dpi', 'psi', 'kwh', 'mwh', 'mph', 'km', 'cm', 'mm', 'qkm', 'sqm', 'ha'}


def ranges_merge(ranges):
    out = []
    for a, b in sorted((a, b) for a, b in ranges if b > a):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def bracket_ranges(text):
    """Character ranges of plain-text marks such as [A7], [A1, A3], [3-5], [Quelle]."""
    return [[m.start(), m.end()] for m in BRACKET_MARK.finditer(text)]


def raised_accepts(base, run, labels=()):
    """May ``run`` (raised/small characters at the end of ``base``) be a footnote mark?

    Refuses exponents and units: m2, x2, 10^6, (a+b)2, km2.  ``labels`` are the
    footnote labels the same page shows at the start of its note lines; a match
    permits the rarer attachment points (year, closing bracket).
    """
    if not _RUN_OK.match(run):
        return False
    if not base:
        return True
    last = base[-1]
    if last in '.,;:!?”’"»':
        return True
    if last in ')]':
        return run in labels
    if last.isdigit():
        digits = re.search(r'\d+$', base).group()
        return len(digits) >= 4 and run in labels
    core = re.sub(r'[^\w]', '', base, flags=re.U)
    if not core or not any(c.isalpha() for c in core):
        return False
    if core.lower() in _UNIT_WORDS or len(core) < 3:
        return False
    if re.search(r'\d', core):
        return False  # chemical-looking or identifier: CO2, H2O, A4
    if run.isalpha() and len(run) == 1 and not (len(core) >= 4 and core[-1].isalpha()):
        return False
    return True


def superscript_runs(raw):
    """Footnote marks written as Unicode superscripts (Wort¹) in *raw* (pre-NFKC) text.

    Returns [start, end) ranges in raw coordinates; unit/exponent contexts are refused.
    """
    out = []
    for m in re.finditer(rf'[{SUPERSCRIPT_DIGITS}]+', raw):
        run = ''.join(str(SUPERSCRIPT_DIGITS.index(c)) for c in m.group())
        base = re.search(r'\S+$', raw[:m.start()])
        base = base.group() if base else ''
        after = raw[m.end():m.end() + 1]
        if after and after.isalnum():
            continue  # glued to more word: x²y
        if raised_accepts(base, run):
            out.append([m.start(), m.end()])
    return out


SUPERSCRIPT_DIGITS_ORDER = '⁰¹²³⁴⁵⁶⁷⁸⁹'


def set_mute(word, ranges):
    """Return *word* with ``mute`` extended by *ranges* (relative to the word)."""
    merged = ranges_merge([*word.get('mute', []), *ranges])
    clipped = [[max(0, a), min(len(word['text']), b)] for a, b in merged if b > 0 and a < len(word['text'])]
    clipped = ranges_merge(clipped)
    out = {k: v for k, v in word.items() if k not in ('mute', 'silent')}
    if clipped:
        out['mute'] = clipped
        if clipped[0][0] <= 0 and clipped[-1][1] >= len(word['text']) and len(clipped) == 1:
            out['silent'] = True
    return out


def mute_words(words, ranges):
    """Flag *words* (page/block coordinates) that overlap *ranges*."""
    ranges = ranges_merge(ranges)
    if not ranges:
        return words
    out = []
    for w in words:
        hit = [[a - w['start'], b - w['start']] for a, b in ranges if a < w['end'] and b > w['start']]
        out.append(set_mute(w, hit) if hit else w)
    return out


def mark_words(text, words):
    """Apply the text-level rules (bracket marks) to the words of *text*."""
    return mute_words(words, bracket_ranges(text))


def word_intervals(word):
    """Absolute [start, end) intervals muted inside *word*."""
    return [(word['start'] + a, word['start'] + b) for a, b in word.get('mute', [])]


def chunk_intervals(chunk):
    return ranges_merge([list(i) for w in chunk.get('words', []) for i in word_intervals(w)])


def shift_mute(word, cut):
    """Word whose first *cut* characters were removed (selection start)."""
    if 'mute' not in word:
        return word
    kept = [[a - cut, b - cut] for a, b in word['mute'] if b - cut > 0]
    out = {k: v for k, v in word.items() if k not in ('mute', 'silent')}
    return set_mute(out, kept) if kept else out


_CLOSE = re.compile(r'[.,;:!?)\]\u201d\u2019"\u00bb]')


def _trim_tail(out, segments):
    stripped = out.rstrip()
    if len(stripped) == len(out):
        return out
    while segments and segments[-1][0] >= len(stripped):
        segments.pop()
    if segments and segments[-1][1] > len(stripped):
        s0, _, t0 = segments[-1]
        segments[-1] = (s0, len(stripped), t0)
    return stripped


def spoken_view(chunk):
    """Text the voice should receive, or None when the chunk has no muted characters.

    Returns (spoken, segments); a segment is (spoken_start, spoken_end, text_start)
    for a stretch copied unchanged from the chunk text.  Synthetic separators that
    keep two surviving pieces apart belong to no segment.
    """
    text = chunk.get('text', '')
    muted = chunk_intervals(chunk)
    if not muted:
        return None
    pieces, cursor = [], 0
    for a, b in muted:
        if a > cursor:
            pieces.append((cursor, a))
        cursor = max(cursor, b)
    if cursor < len(text):
        pieces.append((cursor, len(text)))
    out, segments = '', []
    for a, b in pieces:
        part = text[a:b]
        if not out or out[-1].isspace():
            lead = len(part) - len(part.lstrip())
            a, part = a + lead, part.lstrip()
        if not part:
            continue
        if _CLOSE.match(part):
            out = _trim_tail(out, segments)
        elif out and not out[-1].isspace() and not part[0].isspace():
            out += ' '  # never fuse two pieces that a mark separated
        segments.append((len(out), len(out) + len(part), a))
        out += part
    out = _trim_tail(out, segments)
    return out, segments


def _to_text(position, segments):
    """Map a spoken index back to a chunk-text index (a gap maps to the next segment)."""
    for s0, s1, t0 in segments:
        if position < s0:
            return t0
        if position < s1:
            return t0 + position - s0
    s0, s1, t0 = segments[-1] if segments else (0, 0, 0)
    return t0 + s1 - s0


def remap_timings(chunk, view, timings):
    """Timings for the chunk text: voice timings mapped back, muted words at zero length."""
    if view is None:
        return timings
    spoken, segments = view
    mapped = []
    for t in timings or []:
        a = _to_text(t['charStart'], segments)
        b = _to_text(max(t['charStart'], t['charEnd'] - 1), segments) + 1
        mapped.append({**t, 'charStart': a, 'charEnd': max(b, a + 1)})
    for w in chunk.get('words', []):
        if not w.get('silent'):
            continue
        prior = [m for m in mapped if m['charStart'] < w['start'] and not m.get('silent')]
        at = max((m['end'] for m in prior), default=0.0)
        mapped.append({'text': w['text'], 'charStart': w['start'], 'charEnd': w['end'],
                       'start': at, 'end': at, 'silent': True})
    mapped.sort(key=lambda m: (m['start'], m['charStart']))
    return mapped


def has_speech(chunk):
    """True when something remains to say after the marks are cut out."""
    view = spoken_view(chunk)
    text = view[0] if view else chunk.get('text', '')
    return bool(re.search(r'\w', text))


def merge_mark_only(chunks):
    """A chunk made only of marks (and punctuation) joins its neighbour instead of being spoken alone."""
    out, carry = [], None
    for chunk in chunks:
        if 'words' in chunk and not has_speech(chunk):
            if out and out[-1]['page'] == chunk['page']:
                prev = out[-1]
                shift = len(prev['text']) + 1
                out[-1] = {**prev, 'text': prev['text'] + ' ' + chunk['text'],
                           'words': [*prev['words'], *({**w, 'start': w['start'] + shift, 'end': w['end'] + shift}
                                                       for w in chunk['words'])]}
            else:
                carry = chunk if carry is None else _join(carry, chunk)
            continue
        if carry is not None and carry['page'] == chunk['page']:
            chunk = _join(carry, chunk)
        carry = None
        out.append(chunk)
    if carry is not None:
        out.append(carry)
    return out


def _join(first, second):
    shift = len(first['text']) + 1
    return {**second, 'text': first['text'] + ' ' + second['text'],
            'words': [*first['words'], *({**w, 'start': w['start'] + shift, 'end': w['end'] + shift}
                                         for w in second['words'])]}


def raised_candidate(flags):
    """[start, end) of the last raised run of a word if only punctuation follows it, else None."""
    ends = [i for i, f in enumerate(flags) if f]
    if not ends:
        return None
    end = ends[-1] + 1
    start = end
    while start > 0 and flags[start - 1]:
        start -= 1
    return [start, end], len(flags) - end


def resolve_raised(lines):
    """Decide the raised/small-glyph candidates (``_raised`` on words) of one PDF page.

    ``_raised`` = [start, end] inside the word: a run of raised, smaller glyphs that is
    followed by at most punctuation, or the whole word.  Accepted runs become ``mute``;
    every candidate loses the key.  A detached raised word is either a note's number
    (first word of a smaller line in the lower page area) or a mark that MuPDF put into
    its own line next to its base word (same baseline height, touching).
    """
    weights = {}
    for line in lines:
        key = round(line.get('size', 0) * 2) / 2
        weights[key] = weights.get(key, 0) + len(line['text'])
    body = max(weights.items(), key=lambda kv: kv[1])[0] if weights else 0
    labels = set()
    for line in lines:
        first = line['words'][0] if line['words'] else None
        if (first and first.get('_raised') == [0, len(first['text'])] and _RUN_OK.match(first['text'])
                and len(line['words']) > 1 and line['y'] > line['height'] * 0.55
                and line.get('size', body) <= body * 0.95):
            labels.add(first['text'])
    previous = None
    for line in lines:
        for index, word in enumerate(line['words']):
            span = word.pop('_raised', None)
            if not span:
                continue
            a, b = span
            run, base = word['text'][a:b], word['text'][:a]
            ok = False
            if a == 0 and b == len(word['text']):
                if index == 0 and previous is not None and abs(line['y'] - previous['y']) <= 3 and previous['words']:
                    last = previous['words'][-1]
                    ok = (-1 <= word['bbox'][0] - last['bbox'][2] <= 2.5) and raised_accepts(last['text'], run, labels)
                elif index == 0:
                    ok = run in labels
            elif a > 0:
                ok = raised_accepts(base, run, labels)
            if ok:
                line['words'][index] = set_mute(word, [[a, b]])
        previous = line
    return lines


def raised_flags(chars, spans_sizes):
    """Per-character flag: smaller than the line's body size and lifted above its baseline."""
    sizes = {}
    for char, size in zip(chars, spans_sizes):
        if not char['c'].isspace():
            key = round(size * 2) / 2
            sizes[key] = sizes.get(key, 0) + 1
    if not sizes:
        return [False] * len(chars)
    body = max(sizes.items(), key=lambda kv: (kv[1], kv[0]))[0]
    base = sorted(char['origin'][1] for char, size in zip(chars, spans_sizes)
                  if not char['c'].isspace() and size >= body * 0.9)
    if not base:
        return [False] * len(chars)
    baseline = base[len(base) // 2]
    flags = []
    for char, size in zip(chars, spans_sizes):
        raw = char['c']
        lifted = (not raw.isspace() and size < body * 0.86 and char['origin'][1] < baseline - 0.12 * body)
        flags.append(bool(lifted or raw in SUPERSCRIPT_DIGITS))
    return flags


def body_size(line):
    """Most frequent glyph size of a rawdict line (by characters)."""
    sizes = {}
    for span in line['spans']:
        key = round(span['size'] * 2) / 2
        sizes[key] = sizes.get(key, 0) + sum(1 for c in span['chars'] if not c['c'].isspace())
    return max(sizes.items(), key=lambda kv: (kv[1], kv[0]))[0] if sizes else 0
