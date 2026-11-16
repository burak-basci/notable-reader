"""Small offline language detection for documents: hints first, then stop words.

No model and no network.  Function words of each language are counted in a
bounded sample; a language wins only with enough evidence and a clear margin.
Only the language code leaves this module, never text.
"""
from __future__ import annotations

import re

STOPWORDS = {
    "de": "der die das den dem des ein eine einen einem einer eines und oder aber nicht ist sind war waren wird werden wurde "
          "wurden hat haben hatte kann können muss auch auf mit für von zu im in an bei nach aus über unter wie wenn dass "
          "daß sich es er sie wir ihr ich du als noch nur schon sehr diese dieser dieses dann so da hier dort man zum zur "
          "vom beim ins am um durch gegen ohne bis seit während weil obwohl doch wieder mehr kein keine",
    "en": "the of and to in is that it was for on are as with his they be at one have this from or had by not but what all "
          "were when we there can an your which their said if do will each about how up out them then she many some so "
          "these would other into has more her two like him see time could no make than first been its who now people my "
          "made over did down only way find use may water long little very after words called just where most know",
    "fr": "le la les un une des du de et est en que qui dans pour pas sur au aux avec ce cette ces il elle ils elles nous vous "
          "je tu on ne se son sa ses leur leurs mais ou donc car par plus être avoir fait comme tout tous aussi bien très "
          "sont ont était été sans sous entre vers chez où quand si même autre autres peut peuvent",
    "es": "el la los las un una unos unas de del y o en que es por con para su sus al lo como más pero sus le ya fue "
          "este esta estos estas ese esa son está están ser se no sí muy también entre sobre hasta desde cuando donde "
          "porque sin tiene tienen hay había todo todos otra otro mismo así",
    "it": "il lo la i gli le un una uno di del dello della dei degli delle e o in che è per con su da al allo alla ai agli alle "
          "non si come più ma anche sono era stato questo questa questi queste quello quella suo sua loro tra fra dove quando "
          "perché molto tutto tutti ogni se ha hanno essere fare",
    "pt": "o a os as um uma uns umas de do da dos das e ou em no na nos nas que é por com para seu sua seus suas ao aos como "
          "mais mas não se foi são está estão ser tem têm há muito também entre sobre até desde quando onde porque sem "
          "todo todos outra outro mesmo assim já",
    "nl": "de het een en of van in is dat op te zijn met voor niet aan er ook als bij maar om uit door over ze hij zij wij "
          "wordt worden werd waren heeft hebben kan naar dan nog wel meer geen deze dit die dus omdat tussen onder",
}
# Distinguishing characters add a little evidence (never decisive on their own).
CHARACTER_CLUES = {"de": "äöüß", "fr": "àâçéèêëîïôùûœ", "es": "ñ¿¡áíóú", "it": "àèéìòù", "pt": "ãõçâêô", "nl": "ĳ"}
_SETS = {code: frozenset(text.split()) for code, text in STOPWORDS.items()}
_TOKEN = re.compile(r"[^\W\d_]+", re.UNICODE)

SAMPLE_WORDS = 4000
MIN_EVIDENCE = 12          # function-word hits needed before text analysis speaks
MIN_SHARE = 0.06           # hits / tokens: below this the text is too sparse (code, names, tables)
MARGIN = 1.35              # winner needs this factor over the runner-up


def normalize_code(value):
    """``de-AT`` / ``de_DE`` / ``EN`` -> ``de`` / ``de`` / ``en``; anything else -> None."""
    if not isinstance(value, str):
        return None
    match = re.match(r"^\s*([A-Za-z]{2,3})(?:[-_][A-Za-z0-9]{2,8})*\s*$", value)
    if not match:
        return None
    code = match.group(1).lower()
    return {"deu": "de", "ger": "de", "eng": "en", "fra": "fr", "fre": "fr", "spa": "es",
            "ita": "it", "por": "pt", "nld": "nl", "dut": "nl"}.get(code, code)


def analyse(text):
    """-> (best code or None, per-language scores {code: hits}, token count)."""
    tokens = _TOKEN.findall(text.lower())[:SAMPLE_WORDS]
    if not tokens:
        return None, {}, 0
    scores = {code: 0.0 for code in _SETS}
    for token in tokens:
        for code, words in _SETS.items():
            if token in words:
                scores[code] += 1
    for code, clue in CHARACTER_CLUES.items():
        scores[code] += 0.25 * sum(text.lower().count(ch) for ch in clue) / max(1, len(tokens)) * 10
    ordered = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    best, top = ordered[0]
    second = ordered[1][1] if len(ordered) > 1 else 0
    if top < MIN_EVIDENCE or top / len(tokens) < MIN_SHARE or top < second * MARGIN:
        return None, scores, len(tokens)
    return best, scores, len(tokens)


def sample_text(chunks, limit=SAMPLE_WORDS * 7):
    """Spread the sample over the whole document: title pages and legal text skew the start."""
    texts = [str(chunk.get("text", "")) for chunk in chunks]
    total = sum(len(t) for t in texts)
    if total <= limit:
        return " ".join(texts)
    step = max(1, len(texts) // 40)
    picked, size = [], 0
    for text in texts[::step]:
        picked.append(text)
        size += len(text)
        if size >= limit:
            break
    return " ".join(picked)


def detect_document(document):
    """Detect a document's language.  -> {"language": code|None, "source": "hint"|"text"|None, "hint": code|None}.

    Order: ``lang`` attribute of the page/frame or the PDF's own language field
    (``langHint``), then stop-word analysis of the text.  A hint is overruled
    when the text clearly says otherwise, because Word and CMS defaults often
    label German documents ``en-US``.
    """
    hint = normalize_code(document.get("langHint"))
    chunks = document.get("navigationChunks") or document.get("chunks") or []
    text = sample_text(chunks)
    best, scores, tokens = analyse(text) if text.strip() else (None, {}, 0)
    if hint and hint in _SETS:
        if best and best != hint and scores.get(best, 0) >= 3 * max(1.0, scores.get(hint, 0)):
            return {"language": best, "source": "text", "hint": hint}
        return {"language": hint, "source": "hint", "hint": hint}
    if best:
        return {"language": best, "source": "text", "hint": hint}
    # An unsupported hint (e.g. "tr") is still reported so the bar can say so.
    return {"language": hint if hint else None, "source": "hint" if hint else None, "hint": hint}
