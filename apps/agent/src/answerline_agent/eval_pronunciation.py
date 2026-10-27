import re
from collections.abc import Callable
from itertools import groupby

from .eval_wer import _NUMBER_WORDS, _TENS, _UNITS, normalize_words

_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
_MONTH_BY_NAME = {
    **{month: month for month in _MONTHS},
    **{month[:3]: month for month in _MONTHS},
    "Sept": "September",
}
_WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_TITLES = {"dr", "mr", "mrs", "ms", "mx", "prof", "st"}
_ORDINALS = {
    "first": "one",
    "second": "two",
    "third": "three",
    "fourth": "four",
    "fifth": "five",
    "sixth": "six",
    "seventh": "seven",
    "eighth": "eight",
    "ninth": "nine",
    "tenth": "ten",
    "eleventh": "eleven",
    "twelfth": "twelve",
    "thirteenth": "thirteen",
    "fourteenth": "fourteen",
    "fifteenth": "fifteen",
    "sixteenth": "sixteen",
    "seventeenth": "seventeen",
    "eighteenth": "eighteen",
    "nineteenth": "nineteen",
    "twentieth": "twenty",
    "thirtieth": "thirty",
    "fortieth": "forty",
    "fiftieth": "fifty",
    "sixtieth": "sixty",
    "seventieth": "seventy",
    "eightieth": "eighty",
    "ninetieth": "ninety",
}
_ORDINAL_SUFFIXES = {"st", "nd", "rd", "th"}
_SCALES = {"hundred": 100, "thousand": 1000}
_WORDS = re.compile(r"\d+|[^\W\d_]+")

_DATE = re.compile(
    rf"\b(?P<month>{'|'.join(sorted(_MONTH_BY_NAME, key=len, reverse=True))})\.?\s+"
    r"(?P<day>\d{1,2})(?:st|nd|rd|th)?\b"
)
_PHONE = re.compile(r"(?:\+?\d{1,2}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\b\d{3}-\d{4}\b")
_TIME = re.compile(r"\b(?P<hour>\d{1,2}):(?P<minute>\d{2})\b")
_NUMBER = re.compile(r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?")
_WEEKDAY = re.compile(rf"\b(?:{'|'.join(_WEEKDAYS)})\b")
_WORD = re.compile(r"[^\W\d_][\w'’-]*")


def _continues_number(previous: str, word: str) -> bool:
    if previous in _SCALES or word in _SCALES:
        return True
    return previous in {*_TENS, "twenty"} and word in _UNITS and 1 <= _UNITS[word] <= 9


def _read_number(words: list[str], start: int) -> tuple[int, int, bool]:
    end = start
    total = current = 0
    scaled = False
    previous = ""
    while end < len(words):
        word = words[end]
        if word == "and" and previous in _SCALES and words[end + 1 : end + 2]:
            if words[end + 1] not in _NUMBER_WORDS:
                break
            end += 1
            continue
        if word not in _NUMBER_WORDS and word not in _SCALES:
            break
        if previous and not _continues_number(previous, word):
            break
        if word == "hundred":
            current = (current or 1) * 100
            scaled = True
        elif word == "thousand":
            total += (current or 1) * 1000
            current = 0
            scaled = True
        else:
            current += _NUMBER_WORDS[word]
        previous = word
        end += 1
    return total + current, end, scaled


def _compose_scales(words: list[str]) -> list[str]:
    composed: list[str] = []
    index = 0
    while index < len(words):
        value, end, scaled = _read_number(words, index)
        if end == index:
            composed.append(words[index])
            index += 1
        elif scaled:
            composed.append(str(value))
            index = end
        else:
            composed.extend(words[index:end])
            index = end
    return composed


def _spoken_words(text: str) -> list[str]:
    words: list[str] = []
    for word in _WORDS.findall(text.casefold()):
        if word in _ORDINAL_SUFFIXES and words and words[-1].isdigit():
            continue
        words.append(_ORDINALS.get(word, word))
    return _compose_scales(words)


def _zero_as_oh(tokens: list[str]) -> list[str]:
    mapped: list[str] = []
    for is_digitlike, group in groupby(tokens, key=lambda token: token.isdigit() or token == "oh"):
        run = list(group)
        if is_digitlike and any(token.isdigit() for token in run):
            run = ["0" if token == "oh" else token for token in run]
        mapped.extend(run)
    return mapped


def spoken_tokens(text: str) -> list[str]:
    return _zero_as_oh(normalize_words(" ".join(_spoken_words(text))))


def contains_tokens(haystack: list[str], needle: list[str]) -> bool:
    size = len(needle)
    return size > 0 and any(
        haystack[start : start + size] == needle for start in range(len(haystack) - size + 1)
    )


def _blank(text: str, spans: list[tuple[int, int]]) -> str:
    chars = list(text)
    for start, end in spans:
        chars[start:end] = " " * (end - start)
    return "".join(chars)


def _number_entities(match: re.Match[str]) -> list[str]:
    whole, _, fraction = match.group().replace(",", "").partition(".")
    return [whole, *([fraction] if fraction.strip("0") else [])]


def _scan(
    text: str, pattern: re.Pattern[str], render: Callable[[re.Match[str]], list[str]]
) -> tuple[list[tuple[int, str]], str]:
    found: list[tuple[int, str]] = []
    spans: list[tuple[int, int]] = []
    for match in pattern.finditer(text):
        found.extend((match.start(), entity) for entity in render(match))
        spans.append(match.span())
    return found, _blank(text, spans)


def _is_sentence_initial(text: str, start: int) -> bool:
    prefix = text[:start].rstrip(" \t\"'“‘(")
    if not prefix:
        return True
    title = re.search(r"(\w+)\.$", prefix)
    if title and title.group(1).casefold() in _TITLES:
        return False
    return prefix[-1] in ".!?\n"


def _proper_noun_phrases(text: str) -> list[tuple[int, str]]:
    skipped = {*_MONTH_BY_NAME, *_WEEKDAYS}
    phrases: list[tuple[int, str]] = []
    current: list[re.Match[str]] = []

    def flush() -> None:
        if current:
            phrases.append((current[0].start(), " ".join(word.group() for word in current)))
            current.clear()

    for match in _WORD.finditer(text):
        word = match.group()
        bare = word.rstrip("'’-").casefold()
        eligible = (
            word[0].isupper()
            and not word.isupper()
            and word[:2] not in {"I'", "I’"}
            and word not in skipped
            and bare not in _TITLES
            and not _is_sentence_initial(text, match.start())
        )
        if eligible and current and text[current[-1].end() : match.start()] != " ":
            flush()
        if eligible:
            current.append(match)
        else:
            flush()
    flush()
    return phrases


def extract_entities(text: str, name: str = "") -> list[str]:
    found: list[tuple[int, str]] = []
    working = text
    for pattern, render in (
        (_DATE, lambda m: [f"{_MONTH_BY_NAME[m['month']]} {m['day']}"]),
        (_PHONE, lambda m: [m.group()]),
        (_TIME, lambda m: [m["hour"] if m["minute"] == "00" else m.group()]),
        (_NUMBER, _number_entities),
        (_WEEKDAY, lambda m: [m.group()]),
    ):
        matches, working = _scan(working, pattern, render)
        found.extend(matches)
    found.extend(_proper_noun_phrases(text))
    name_tokens = spoken_tokens(name)
    if contains_tokens(spoken_tokens(text), name_tokens):
        found.append((-1, name))
    seen: set[tuple[str, ...]] = set()
    entities: list[str] = []
    for _position, entity in sorted(found, key=lambda item: item[0]):
        tokens = spoken_tokens(entity)
        key = tuple(tokens)
        within_name = entity != name and bool(name_tokens) and contains_tokens(name_tokens, tokens)
        if tokens and key not in seen and not within_name:
            seen.add(key)
            entities.append(entity)
    return entities


def check_entities(text: str, heard: str, name: str = "") -> tuple[int, list[str]]:
    entities = extract_entities(text, name)
    heard_tokens = spoken_tokens(heard)
    missed = [
        entity for entity in entities if not contains_tokens(heard_tokens, spoken_tokens(entity))
    ]
    return len(entities), missed


def missing_pronunciations(phrases: list[str], heard: list[str]) -> list[str]:
    heard_tokens = [spoken_tokens(text) for text in heard]
    return [
        phrase
        for phrase in phrases
        if (tokens := spoken_tokens(phrase))
        and not any(contains_tokens(candidate, tokens) for candidate in heard_tokens)
    ]
