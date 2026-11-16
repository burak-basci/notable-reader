"""Language hints and offline stop-word detection."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from langdetect import analyse, detect_document, normalize_code

DE = ("Die Stadt liegt am Rand eines weiten Tals, durch das sich ein schmaler Fluss zieht. Im Frühjahr, wenn der Schnee "
      "in den Bergen schmilzt, tritt das Wasser über die Ufer und färbt die Wiesen silbern. Die Bewohner kennen dieses "
      "Schauspiel seit Generationen und bereiten sich darauf vor, ohne große Aufregung, aber mit Sorgfalt. ") * 2
EN = ("The city lies at the edge of a wide valley, and a narrow river runs through it. In the spring, when the snow in "
      "the mountains melts, the water rises over the banks and turns the meadows silver. The people who live there have "
      "known this for generations and they prepare for it with care. ") * 2
FR = ("La ville se trouve au bord d'une large vallée, et une rivière étroite la traverse. Au printemps, quand la neige "
      "fond dans les montagnes, l'eau déborde et colore les prairies en argent. Les habitants connaissent ce spectacle "
      "depuis des générations et ils s'y préparent avec soin. ") * 2
ES = ("La ciudad está al borde de un valle amplio, y un río estrecho lo atraviesa. En primavera, cuando la nieve de las "
      "montañas se derrite, el agua sube por encima de las orillas y tiñe los prados de plata. Los habitantes conocen "
      "este espectáculo desde hace generaciones y se preparan con cuidado. ") * 2
IT = ("La città si trova al margine di una grande valle, e un fiume stretto la attraversa. In primavera, quando la neve "
      "delle montagne si scioglie, l'acqua sale oltre le rive e colora i prati di argento. Gli abitanti conoscono questo "
      "spettacolo da generazioni e si preparano con cura. ") * 2
PT = ("A cidade fica na beira de um vale amplo, e um rio estreito passa por ela. Na primavera, quando a neve das "
      "montanhas derrete, a água sobe por cima das margens e pinta os prados de prata. Os moradores conhecem este "
      "espetáculo há gerações e se preparam com cuidado. ") * 2


def doc(text, hint=None):
    return {"navigationChunks": [{"text": text}], "langHint": hint}


for code, text in [("de", DE), ("en", EN), ("fr", FR), ("es", ES), ("it", IT), ("pt", PT)]:
    result = detect_document(doc(text))
    assert result["language"] == code and result["source"] == "text", (code, result, analyse(text)[1])

# Hints: normalized, win when the text agrees or is silent.
assert normalize_code("de-AT") == "de" and normalize_code("EN") == "en" and normalize_code("pt_BR") == "pt"
assert normalize_code("deu") == "de" and normalize_code("") is None and normalize_code(None) is None
assert normalize_code("not a code!") is None and normalize_code(123) is None
assert detect_document(doc(DE, "de-DE"))["source"] == "hint"
assert detect_document(doc("", "fr"))["language"] == "fr"
assert detect_document(doc("1 2 3 4 5 6", "es"))["language"] == "es"
# Word and CMS defaults label German text "en-US": strong text evidence overrules the hint.
overruled = detect_document(doc(DE * 3, "en-US"))
assert overruled["language"] == "de" and overruled["source"] == "text" and overruled["hint"] == "en", overruled
# ...but a hint is not overruled by weak or equal evidence.
assert detect_document(doc(EN, "en-GB"))["language"] == "en"
# English technical terms inside German prose stay German.
mixed = DE + " Der Commit wurde im Repository gemerged und der Build ist grün, sagt das Team. " * 2
assert detect_document(doc(mixed))["language"] == "de"
# Sparse input (code, numbers, names) says nothing instead of guessing.
assert detect_document(doc("x = 3; y = 4; foo(bar, baz)"))["language"] is None
assert detect_document({"navigationChunks": []})["language"] is None
# An unsupported but declared language is still reported (the bar shows the fallback).
assert detect_document(doc("", "tr"))["language"] == "tr"
# Cost on a long document is bounded by the sample size.
big = {"navigationChunks": [{"text": DE} for _ in range(5000)]}
start = time.perf_counter()
assert detect_document(big)["language"] == "de"
assert time.perf_counter() - start < 0.5
print("ok langdetect")
