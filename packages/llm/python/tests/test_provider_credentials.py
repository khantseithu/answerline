import pytest
from answerline_llm.provider_credentials import (
    decrypt_provider_credential,
    encrypt_provider_credential,
)
from cryptography.exceptions import InvalidTag

KEY = "a1" * 32


def test_provider_credentials_encrypt_and_decrypt_with_the_deployment_key():
    encrypted = encrypt_provider_credential("provider-secret", KEY)

    assert encrypted.startswith("v1.")
    assert encrypted != "provider-secret"
    assert decrypt_provider_credential(encrypted, KEY) == "provider-secret"


def test_provider_credentials_decrypt_values_written_by_the_dashboard():
    envelope = "v1.iTK3IOWjzk0phYtYS_ktLv1QyvemE-wqYmNwFzvt1x4NOEhWgQnjOKRDEvoyUwZt6Q"

    assert decrypt_provider_credential(envelope, KEY) == "cross-language-secret"


def test_provider_credentials_reject_malformed_keys_and_tampering():
    with pytest.raises(ValueError):
        encrypt_provider_credential("provider-secret", "short")

    encrypted = encrypt_provider_credential("provider-secret", KEY)
    with pytest.raises(InvalidTag):
        decrypt_provider_credential(encrypted, "b2" * 32)
    with pytest.raises(ValueError, match="Unsupported"):
        decrypt_provider_credential("v2.invalid", KEY)
