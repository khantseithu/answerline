import pytest
from answerline_agent.eval_wer import normalize_words, word_error_rate


def test_normalize_folds_case_width_and_punctuation():
    assert normalize_words("  Hello,   WORLD!  ") == ["hello", "world"]
    assert normalize_words("ＨＥＬＬＯ") == ["hello"]
    assert normalize_words("Straße") == ["strasse"]
    assert normalize_words("What's the price? $5.") == ["whats", "the", "price", "5"]
    assert normalize_words("don’t") == normalize_words("don't") == ["dont"]
    assert normalize_words("...") == []
    assert normalize_words("") == []


def test_normalize_splits_every_digit_into_its_own_token():
    expected = list("2025550147")
    assert normalize_words("202-555-0147") == expected
    assert normalize_words("202 555 0147") == expected
    assert normalize_words("2025550147") == expected
    assert normalize_words("(202) 555-0147") == expected
    assert normalize_words("5th") == ["5", "th"]


def test_normalize_maps_number_words_to_digits():
    assert normalize_words("five") == ["5"]
    assert normalize_words("Zero") == ["0"]
    assert normalize_words("twenty") == ["2", "0"]
    assert normalize_words("ninety") == ["9", "0"]
    assert normalize_words("thirteen") == ["1", "3"]
    assert normalize_words("twenty-one") == ["2", "1"]
    assert normalize_words("thirty five") == ["3", "5"]
    assert normalize_words("twenty ten") == ["2", "0", "1", "0"]
    assert normalize_words("five o'clock") == ["5", "oclock"]


def test_number_words_and_digits_agree():
    assert word_error_rate("my number is 5", "my number is five") == 0
    assert word_error_rate("I am 21", "I am twenty one") == 0
    spoken = "call two zero two five five five zero one four seven"
    assert word_error_rate("call 202-555-0147", spoken) == 0


def test_identical_text_has_zero_error():
    assert word_error_rate("Book me for Tuesday", "book me for tuesday.") == 0


def test_substitution_deletion_and_insertion_each_count_once():
    assert word_error_rate("a b c d", "a x c d") == pytest.approx(0.25)
    assert word_error_rate("a b c d", "a b d") == pytest.approx(0.25)
    assert word_error_rate("a b c d", "a b c x d") == pytest.approx(0.25)


def test_error_rate_can_exceed_one_when_hypothesis_is_longer():
    assert word_error_rate("hi", "hi there how are you") == pytest.approx(4.0)


def test_completely_wrong_and_missing_hypotheses():
    assert word_error_rate("one two three", "") == 1.0
    assert word_error_rate("hello there", "goodbye now") == 1.0


def test_empty_reference():
    assert word_error_rate("", "") == 0.0
    assert word_error_rate("...", "") == 0.0
    assert word_error_rate("", "hello") == 1.0
    assert word_error_rate("!!!", "hello there") == 1.0


def test_digit_errors_are_counted_per_digit():
    assert word_error_rate("202-555-0147", "202-555-0148") == pytest.approx(0.1)
