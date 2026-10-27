import re
import unicodedata

_UNITS = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
}
_TENS = {
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
}
_NUMBER_WORDS = {**_UNITS, **_TENS}
_DIGIT_OR_RUN = re.compile(r"\d|\D+")
_APOSTROPHES = str.maketrans("", "", "'’ʼ`")


def _strip_punctuation(text: str) -> str:
    return "".join(
        " " if unicodedata.category(char)[0] in {"P", "S"} else char
        for char in text.translate(_APOSTROPHES)
    )


def _join_numbers(words: list[str]) -> list[str]:
    joined: list[str] = []
    index = 0
    while index < len(words):
        word = words[index]
        following = words[index + 1] if index + 1 < len(words) else None
        if word in {*_TENS, "twenty"} and following in _UNITS and 1 <= _UNITS[following] <= 9:
            joined.append(str(_NUMBER_WORDS[word] + _UNITS[following]))
            index += 2
            continue
        joined.append(str(_NUMBER_WORDS[word]) if word in _NUMBER_WORDS else word)
        index += 1
    return joined


def normalize_words(text: str) -> list[str]:
    words = _strip_punctuation(unicodedata.normalize("NFKC", text).casefold()).split()
    return [piece for word in _join_numbers(words) for piece in _DIGIT_OR_RUN.findall(word)]


def _edit_distance(reference: list[str], hypothesis: list[str]) -> int:
    previous = list(range(len(hypothesis) + 1))
    for i, ref_word in enumerate(reference, start=1):
        current = [i]
        for j, hyp_word in enumerate(hypothesis, start=1):
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + (ref_word != hyp_word),
                )
            )
        previous = current
    return previous[-1]


def word_error_rate(reference: str, hypothesis: str) -> float:
    ref_words = normalize_words(reference)
    hyp_words = normalize_words(hypothesis)
    if not ref_words:
        return 0.0 if not hyp_words else 1.0
    return _edit_distance(ref_words, hyp_words) / len(ref_words)
