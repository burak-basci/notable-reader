"""Map Kokoro's model-duration phonemes back to the original text words.

Audio is produced once, as a complete sentence, with the established Bella
settings.  Extra per-token phonemization only locates source word boundaries;
it does not produce audio or estimate time from text length.
"""
from __future__ import annotations

import re

import numpy as np

import phonemizer
from kokoro_onnx.tokenizer import _espeak_lock


def _source_phonemes(model, words, lang="en-us"):
    # Use the same process-global eSpeak lock and settings as Kokoro.  Process
    # each source token separately: phonemizer's punctuation restoration can
    # return multiple list entries for one token such as "2.4.".  Enumerating
    # a whole sentence's output list would then shift subsequent word owners
    # and eventually index past the source words.
    with _espeak_lock:
        groups = [" ".join(phonemizer.phonemize(
            [word.group()], language=lang, preserve_punctuation=True,
            with_stress=True,
        )) for word in words]
    chars, owners = [], []
    for index, group in enumerate(groups):
        if index:
            chars.append(" ")
            owners.append(None)
        group = " ".join(model.tokenizer.known(group).split())
        chars.extend(group)
        owners.extend([index] * len(group))
    return "".join(chars), owners


def _align_owners(source, source_owners, target):
    """Global phoneme alignment, allowing context-dependent pronunciation.

    Source and target normally agree exactly.  A minimum-edit alignment handles
    differences such as standalone versus connected-speech articles without
    confusing expanded numbers with extra source words.  Whitespace has a
    higher substitution cost so that word boundaries remain useful anchors.
    """
    if source == target:
        return list(source_owners)

    # Store traceback in one byte/cell, rather than a matrix of Python ints.
    width = len(target) + 1
    trace = bytearray((len(source) + 1) * width)
    previous = list(range(width))
    for j in range(1, width):
        trace[j] = 2  # insert target phoneme
    for i, left in enumerate(source, 1):
        row = [i] + [0] * len(target)
        base = i * width
        trace[base] = 1  # delete source phoneme
        for j, right in enumerate(target, 1):
            substitution = 0 if left == right else (3 if (left == " ") != (right == " ") else 1)
            choices = (previous[j - 1] + substitution, previous[j] + 1, row[j - 1] + 1)
            direction = min(range(3), key=choices.__getitem__)
            row[j] = choices[direction]
            trace[base + j] = direction
        previous = row

    owners = [None] * len(target)
    i, j = len(source), len(target)
    while i or j:
        direction = trace[i * width + j]
        if direction == 0:
            owners[j - 1] = source_owners[i - 1]
            i, j = i - 1, j - 1
        elif direction == 1:
            i -= 1
        else:
            if target[j - 1] != " ":
                # An inserted phoneme belongs to the current word.  At a
                # source separator, take the word immediately before it.
                at = min(i, len(source_owners) - 1)
                if at >= 0 and source_owners[at] is None:
                    at -= 1
                if at >= 0:
                    owners[j - 1] = source_owners[at]
            j -= 1
    return owners


def synthesize_with_words(model, text, voice="af_bella", lang="en-us"):
    """Return (samples, sample_rate, source-word timings) using the loaded model.

    Each timing has start/end seconds and exact charStart/charEnd offsets into
    ``text``.  Bounds come from model durations after Kokoro's silence trimming
    and punctuation pauses.  An unpronounced token receives a zero-length span
    at an adjacent model boundary.  Context pronunciation can make alignment
    ambiguous; no forced-alignment acoustic model is used.
    """
    words = list(re.finditer(r"\S+", text))
    samples, sample_rate, spoken = model.create_timed(
        text, voice=voice, speed=1.0, lang=lang,
    )
    if not spoken:
        raise RuntimeError("Das Sprachmodell liefert keine Wortzeitgrenzen.")
    source, source_owners = _source_phonemes(model, words, lang)
    owners = _align_owners(source, source_owners, "".join(item.phoneme for item in spoken))
    spans = [[] for _ in words]
    for item, owner in zip(spoken, owners):
        if owner is not None:
            spans[owner].append(item)

    duration = len(samples) / sample_rate
    result, previous_end = [], 0.0
    for word, span in zip(words, spans):
        start = max(previous_end, min(duration, span[0].start)) if span else previous_end
        end = max(start, min(duration, span[-1].end)) if span else start
        result.append({"text": word.group(), "charStart": word.start(),
                       "charEnd": word.end(), "start": start, "end": end})
        previous_end = end
    return samples, sample_rate, result


# --- Engines without duration output (Piper) --------------------------------
# Words are placed by phoneme-weighted shares of the *measured* speech: the
# audio's silent gaps are located first and pinned to the punctuation of the
# text, then each stretch between two pauses is divided by phoneme weight.
# This is an estimate (no forced alignment), but never based on letter count.

_PAUSE_PUNCT = re.compile(r"[,;:.!?…–—)\]»”]$")
_STRONG_PUNCT = re.compile(r"[.!?…]$")
_HOP = 0.01


def _phoneme_weight(phonemes):
    weight = 0.0
    for char in phonemes:
        if char in "ˈˌ ,.;:!?…-'\"()":
            continue
        weight += 0.55 if char in "ːˑ" else (0.35 if char in "̯̩̪̃ʰʲ" else 1.0)
    return max(weight, 0.8)


def _speech_frames(samples, rate):
    hop = max(1, int(rate * _HOP))
    count = len(samples) // hop
    if count == 0:
        return np.zeros(0), 0.0
    frames = samples[:count * hop].reshape(count, hop)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    return rms, float(np.percentile(rms, 95)) if count else 0.0


def detect_pauses(samples, rate, minimum=0.2):
    """Silent runs inside the speech region -> [(start, end)] seconds, plus (speech_start, speech_end)."""
    rms, level = _speech_frames(samples, rate)
    if len(rms) == 0 or level <= 0:
        return [], (0.0, len(samples) / rate)
    quiet = rms < level * 0.06
    loud = np.flatnonzero(~quiet)
    if len(loud) == 0:
        return [], (0.0, len(samples) / rate)
    first, last = int(loud[0]), int(loud[-1]) + 1
    pauses, run = [], None
    for index in range(first, last):
        if quiet[index]:
            run = index if run is None else run
        elif run is not None:
            if (index - run) * _HOP >= minimum:
                pauses.append((run * _HOP, index * _HOP))
            run = None
    return pauses, (first * _HOP, last * _HOP)


def weighted_timings(text, samples, rate, word_phonemes):
    """Word spans for audio with no duration output.  ``word_phonemes`` is one phoneme string per word."""
    words = list(re.finditer(r"\S+", text))
    if len(words) != len(word_phonemes):
        raise ValueError("Wortzahl und Phonemzahl passen nicht zusammen.")
    duration = len(samples) / rate
    if not words:
        return []
    weights = [_phoneme_weight(p) for p in word_phonemes]
    pauses, (speech_start, speech_end) = detect_pauses(np.asarray(samples), rate)
    # Boundaries (after word i) at which the text calls for a pause.
    boundaries = [i for i, w in enumerate(words[:-1]) if _PAUSE_PUNCT.search(w.group())]
    total = sum(weights) or 1.0
    cumulative, running = [], 0.0
    for weight in weights:
        running += weight
        cumulative.append(running / total)
    span = max(speech_end - speech_start, 1e-6)
    anchors, used, previous = {}, set(), -1
    # Match each detected pause to the nearest predicted boundary, keeping order.
    for start, end in pauses:
        mid = ((start + end) / 2 - speech_start) / span
        best, best_distance = None, 0.18
        for i in boundaries:
            if i in used or i <= previous:
                continue
            distance = abs(cumulative[i] - mid)
            # Sentence ends are more likely owners of long pauses.
            if _STRONG_PUNCT.search(words[i].group()) and end - start > 0.3:
                distance *= 0.6
            if distance < best_distance:
                best, best_distance = i, distance
        if best is not None:
            anchors[best] = (start, end)
            used.add(best)
            previous = best
    # Stretches of words between anchored pauses share their stretch's speech time.
    result, cursor_word, cursor_time = [], 0, speech_start
    ends = sorted(anchors)
    for stop in [*ends, len(words) - 1]:
        if stop in anchors:
            stretch_end = anchors[stop][0]
            next_time = anchors[stop][1]
        else:
            stretch_end, next_time = speech_end, speech_end
        group = range(cursor_word, stop + 1)
        group_weight = sum(weights[i] for i in group) or 1.0
        t = cursor_time
        length = max(stretch_end - cursor_time, 0.0)
        for i in group:
            share = weights[i] / group_weight * length
            result.append((t, t + share))
            t += share
        cursor_word, cursor_time = stop + 1, next_time
    return [{"text": word.group(), "charStart": word.start(), "charEnd": word.end(),
             "start": min(max(a, 0.0), duration), "end": min(max(b, a), duration)}
            for word, (a, b) in zip(words, result)]
