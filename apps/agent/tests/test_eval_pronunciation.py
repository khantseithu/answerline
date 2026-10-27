from answerline_agent.eval_pronunciation import (
    check_entities,
    contains_tokens,
    extract_entities,
    missing_pronunciations,
    spoken_tokens,
)


def test_phone_number_matches_digit_by_digit_with_oh_for_zero():
    heard = "two oh two five five five zero one four seven"
    assert spoken_tokens("202-555-0147") == spoken_tokens(heard)
    assert check_entities("Call 202-555-0147.", heard) == (1, [])


def test_oh_is_zero_only_inside_digit_sequences():
    assert spoken_tokens("oh") == ["oh"]
    assert spoken_tokens("oh well") == ["oh", "well"]
    assert spoken_tokens("two oh oh five") == ["2", "0", "0", "5"]
    assert spoken_tokens("oh oh seven") == ["0", "0", "7"]


def test_phone_number_formats_are_one_entity():
    assert extract_entities("Call (202) 555-0147 today") == ["(202) 555-0147"]
    assert extract_entities("Call +1 202 555 0147 today") == ["+1 202 555 0147"]
    assert extract_entities("Dial 555-0147") == ["555-0147"]


def test_wrong_digit_is_a_miss():
    count, missed = check_entities(
        "Call 202-555-0147.", "two oh two five five five zero one four nine"
    )
    assert count == 1
    assert missed == ["202-555-0147"]


def test_prices_split_into_dollars_and_cents():
    assert extract_entities("That is $45.50 today") == ["45", "50"]
    assert extract_entities("That is $45.00 today") == ["45"]
    assert check_entities("That is $45.50.", "That's forty five dollars and fifty cents.") == (
        2,
        [],
    )


def test_scale_words_match_grouped_numbers():
    assert spoken_tokens("one hundred and fifty") == list("150")
    assert spoken_tokens("twelve hundred") == list("1200")
    assert spoken_tokens("one thousand two hundred") == list("1200")
    assert spoken_tokens("two thousand twenty five") == list("2025")
    assert spoken_tokens("twenty twenty five") == list("2025")
    assert spoken_tokens("five five five") == list("555")
    assert check_entities("It costs $1,200.", "It costs twelve hundred dollars") == (1, [])
    assert check_entities("It costs $150.", "it costs one hundred fifty dollars") == (1, [])


def test_times_match_spoken_forms():
    assert extract_entities("We open at 9:30 and close at 5:00.") == ["9:30", "5"]
    assert check_entities("We open at 9:30.", "we open at nine thirty") == (1, [])
    assert check_entities("We open at 9:05.", "we open at nine oh five") == (1, [])
    assert check_entities("We open at 9:00.", "we open at nine a m") == (1, [])


def test_month_and_day_match_ordinals_in_either_form():
    assert extract_entities("See you on Mar. 3rd") == ["March 3"]
    assert check_entities("See you on March 3rd.", "See you on March third.") == (1, [])
    assert check_entities("See you on March 23rd.", "see you march twenty third") == (1, [])
    assert check_entities("See you on March 3rd.", "see you on march 3") == (1, [])
    assert check_entities("See you on March 3rd.", "see you on march 8") == (1, ["March 3"])


def test_date_digits_are_not_double_counted_as_numbers():
    assert extract_entities("On March 3rd at 9:30") == ["March 3", "9:30"]


def test_weekday_names_are_entities():
    assert extract_entities("Come in on Tuesday or Friday.") == ["Tuesday", "Friday"]
    assert check_entities("Come in on Tuesday.", "come in on thursday") == (1, ["Tuesday"])


def test_proper_nouns_skip_sentence_initial_words_pronouns_and_titles():
    assert extract_entities("Hello there. Thanks for calling.") == []
    assert extract_entities("Can I help? I'm happy to. Ask Dr. Nguyen.") == ["Nguyen"]
    assert extract_entities("Ask for Maria Lopez at the front desk.") == ["Maria Lopez"]
    assert extract_entities("We accept AM and PM visits.") == []


def test_proper_noun_phrases_break_on_punctuation():
    assert extract_entities("Meet Alex, Jordan and Casey.") == ["Alex", "Jordan", "Casey"]


def test_agent_name_is_checked_even_when_sentence_initial():
    name = "Bright Smile Dental"
    assert extract_entities("Bright Smile Dental, how can I help?", name) == [name]
    assert extract_entities("Thanks for calling Bright Smile Dental.", name) == [name]
    assert extract_entities("Thanks for calling.", name) == []
    assert check_entities(
        "Bright Smile Dental, how can I help?", "bright smile dental how", name
    ) == (
        1,
        [],
    )
    assert check_entities(
        "Bright Smile Dental, how can I help?", "bright mile dental how", name
    ) == (
        1,
        [name],
    )


def test_entities_are_deduplicated_per_text():
    assert extract_entities("Call 202-555-0147 or 202 555 0147.") == ["202-555-0147"]


def test_contains_tokens_requires_a_contiguous_subsequence():
    assert contains_tokens(["a", "b", "c"], ["b", "c"])
    assert not contains_tokens(["a", "b", "c"], ["a", "c"])
    assert not contains_tokens(["a"], [])
    assert not contains_tokens([], ["a"])


def test_missing_pronunciations_search_each_turn_with_the_same_normalization():
    heard = ["thanks for calling bright smile dental", "your code is one two three"]
    assert missing_pronunciations(["Bright Smile Dental", "123"], heard) == []
    assert missing_pronunciations(["Bright Smile Dental", "124", "!!"], heard) == ["124"]
    assert missing_pronunciations(["dental your"], heard) == ["dental your"]
