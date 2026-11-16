#!/usr/bin/env python3
"""Citation marks: recognition rules, offsets, spoken view, timing remap.  No browser, model or PDF needed."""
from pathlib import Path
import re
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import citations
import extraction


def words_of(text, page=1):
    return [{'text': m.group(), 'start': m.start(), 'end': m.end(), 'page': page,
             'bbox': [m.start(), 0, m.end(), 10], 'pageWidth': 600, 'pageHeight': 800}
            for m in re.finditer(r'\S+', text)]


def chunks(text):
    return extraction.chunks_for(text, 1, words_of(text))


def spoken(chunk):
    view = citations.spoken_view(chunk)
    return view[0] if view else chunk['text']


class BracketMarks(unittest.TestCase):
    def test_forms_are_marks(self):
        for mark in ['[A7]', '[B12]', '[A1, A3]', '[3–5]', '[12]', '[Quelle]', '[Anm. 3]', '[citation needed]', '[A1–A4]']:
            text = f'Der Satz endet hier {mark} und geht weiter.'
            found = [text[a:b] for a, b in citations.bracket_ranges(text)]
            self.assertEqual(found, [mark], mark)

    def test_not_marks(self):
        for text in ['Siehe [Kapitel drei] dazu.', 'Das Papier [A4 Format] ist da.', 'Array arr[A1] bleibt.', 'Version [2022 Edition] steht.',
                     'Ein Wort [a] bleibt ohne DOM-Hinweis.', 'Müller 2020 und (Schmidt, 2019) bleiben.']:
            self.assertEqual(citations.bracket_ranges(text), [], text)


class RaisedRules(unittest.TestCase):
    def test_footnote_vs_exponent(self):
        yes = [('Gutachten', '1'), ('fest', '2'), ('Ende.', '3'), ('Satz,', '12'), ('Ergebnis', '*'), ('Quelle', 'a'), ('Stadt', '1,2')]
        no = [('m', '2'), ('km', '2'), ('x', '2'), ('10', '6'), ('2020', '1'), ('(a+b)', '2'), ('CO', '2'), ('H2', '2'), ('min', '2'), ('bar', '2')]
        for base, run in yes:
            self.assertTrue(citations.raised_accepts(base, run), (base, run))
        for base, run in no:
            self.assertFalse(citations.raised_accepts(base, run), (base, run))
        # the same page also shows that number as a note label: rarer attachments are allowed
        self.assertTrue(citations.raised_accepts('2020', '1', {'1'}))
        self.assertTrue(citations.raised_accepts('(siehe oben)', '1', {'1'}))
        self.assertFalse(citations.raised_accepts('10', '6', {'6'}))

    def test_unicode_superscripts(self):
        raw = 'Das Gutachten¹ nennt 25 m² und km³, aber Wort² geht weiter, x² gilt.'
        found = [raw[a:b] for a, b in citations.superscript_runs(raw)]
        self.assertEqual(found, ['¹', '²'])  # Gutachten, Wort; never m², km³, x²


class SpokenView(unittest.TestCase):
    def test_marks_stay_in_text_but_not_in_speech(self):
        text = 'Eine Firma gibt es nicht A1A3A14. Das Ergebnis bleibt unklar L3. Letzter Satz (A7).'
        words = citations.mute_words(words_of(text), [[m.start(), m.end()] for m in re.finditer(r'A1A3A14|L3|A7', text)])
        out = extraction.chunks_for(text, 1, words)
        full = ' '.join(c['text'] for c in out)
        self.assertIn('A1A3A14', full)
        said = ' '.join(spoken(c) for c in out)
        for mark in ('A1', 'A3', 'A14', 'L3', 'A7'):
            self.assertNotIn(mark, said)
        self.assertIn('Eine Firma gibt es nicht.', said)
        self.assertIn('Das Ergebnis bleibt unklar.', said)
        for c in out:
            for w in c['words']:
                self.assertEqual(c['text'][w['start']:w['end']], w['text'])

    def test_never_fuses_words(self):
        text = 'Vorher A1 nachher und Satz.A1Weiter hier'
        words = citations.mute_words(words_of(text), [[7, 9], [text.index('A1Weiter'), text.index('A1Weiter') + 2]])
        chunk = extraction.chunks_for(text, 1, words)[0]
        said = spoken(chunk)
        self.assertEqual(said, 'Vorher nachher und Satz. Weiter hier')

    def test_mark_only_chunk_merges_into_neighbour(self):
        text = 'Erster Satz steht hier. A5 Zweiter Satz folgt.'
        words = citations.mute_words(words_of(text), [[text.index('A5'), text.index('A5') + 2]])
        out = extraction.chunks_for(text, 1, words)
        self.assertTrue(all(citations.has_speech(c) for c in out))
        self.assertEqual(sum(len(c['words']) for c in out), len(words))
        # also when a lone mark would be the whole sentence
        text = 'Wahr ist das. [A1] Doch dann folgt mehr.'
        out = extraction.chunks_for(text, 1, words_of(text))
        self.assertTrue(all(citations.has_speech(c) for c in out), [c['text'] for c in out])

    def test_remap_timings(self):
        text = 'Es ist belegt A1A3 und klar.'
        words = citations.mute_words(words_of(text), [[text.index('A1A3'), text.index('A1A3') + 4]])
        chunk = extraction.chunks_for(text, 1, words)[0]
        view = citations.spoken_view(chunk)
        self.assertEqual(view[0], 'Es ist belegt und klar.')
        # What a voice returns for the spoken text: one timing per token.
        timings, t = [], 0.0
        for m in re.finditer(r'\S+', view[0]):
            timings.append({'text': m.group(), 'charStart': m.start(), 'charEnd': m.end(), 'start': t, 'end': t + .3})
            t += .35
        mapped = citations.remap_timings(chunk, view, timings)
        self.assertEqual(len(mapped), len(words))
        for item in mapped:
            self.assertEqual(text[item['charStart']:item['charEnd']], item['text'])
        silent = [m for m in mapped if m.get('silent')]
        self.assertEqual([m['text'] for m in silent], ['A1A3'])
        self.assertEqual(silent[0]['start'], silent[0]['end'])
        self.assertEqual([m['start'] for m in mapped], sorted(m['start'] for m in mapped))
        # Unmarked chunks pass through untouched.
        plain = chunks('Nichts zu tun hier.')[0]
        self.assertIsNone(citations.spoken_view(plain))
        self.assertEqual(citations.remap_timings(plain, None, [{'a': 1}]), [{'a': 1}])

    def test_selection_start_keeps_mutes(self):
        text = 'Anfang A1A3 Mitte und Ende.'
        words = citations.mute_words(words_of(text), [[text.index('A1A3'), text.index('A1A3') + 4]])
        for cut in (0, 3, text.index('A1A3') + 2, text.index('Mitte')):
            sliced = extraction.slice_words(words, cut)
            rest = text[cut:]
            for w in sliced:
                self.assertEqual(rest[w['start']:w['end']], w['text'])
            out = extraction.chunks_for(rest, 1, sliced)
            said = ' '.join(spoken(c) for c in out)
            self.assertNotIn('A1A3', said)
            self.assertNotIn('A3', said)

    def test_remaining_time_ignores_silent_words(self):
        import remaining
        text = 'Ein Satz mit Beleg A1 A3 und Ende.'
        words = citations.mute_words(words_of(text), [[text.index('A1'), text.index('A1') + 2], [text.index('A3'), text.index('A3') + 2]])
        chunk = extraction.chunks_for(text, 1, words)[0]
        self.assertEqual(remaining.word_count(chunk), len(text.split()) - 2)
        self.assertEqual(remaining.word_count({'text': 'a b c'}), 3)

    def test_unmarked_text_is_untouched(self):
        # Same text, bbox and words as before the feature: saved reading positions stay valid.
        text = 'Ein ganz normaler Text ohne Belege, aber mit Zahlen 12 und m2 und [Kapitel].'
        out = chunks(text)
        for c in out:
            self.assertIsNone(citations.spoken_view(c))
            self.assertTrue(all('mute' not in w and 'silent' not in w for w in c['words']))


class HtmlUnicodeSuperscript(unittest.TestCase):
    def test_extract_html_mutes_footnote_digits_only(self):
        raw = 'Das Gutachten¹ nennt 25 m² Fläche und weitere Angaben zur Sache.'
        state = {'title': 't', 'selection': '', 'blocks': [{'text': raw, 'top': 0, 'bottom': 20, 'width': 500, 'height': 20}]}
        result = extraction.extract_html(state)
        said = ' '.join(spoken(c) for c in result['chunks'])
        self.assertIn('Das Gutachten nennt 25 m2 Fläche', said)
        text = result['chunks'][0]['text']
        self.assertIn('Gutachten1', text)  # NFKC text unchanged: offsets and fingerprint as before
        for w in result['chunks'][0]['words']:
            self.assertEqual(text[w['start']:w['end']], w['text'])
        self.assertEqual(result['chunks'], result['navigationChunks'])


if __name__ == '__main__':
    unittest.main(verbosity=1)
