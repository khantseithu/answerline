import base64
import os
import re

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_KEY_PATTERN = re.compile(r"^[0-9a-fA-F]{64}$")
_IV_LENGTH = 12


def _key_bytes(encoded_key: str) -> bytes:
    if not _KEY_PATTERN.fullmatch(encoded_key):
        raise ValueError("PROVIDER_KEYS_ENCRYPTION_KEY must be 64 hexadecimal characters")
    return bytes.fromhex(encoded_key)


def decrypt_provider_credential(envelope: str, encoded_key: str) -> str:
    version, separator, payload = envelope.partition(".")
    if not separator or version != "v1":
        raise ValueError("Unsupported provider credential envelope")
    try:
        decoded = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
    except ValueError as error:
        raise ValueError("Invalid provider credential envelope") from error
    if len(decoded) <= _IV_LENGTH + 16:
        raise ValueError("Invalid provider credential envelope")
    nonce, ciphertext = decoded[:_IV_LENGTH], decoded[_IV_LENGTH:]
    plaintext = AESGCM(_key_bytes(encoded_key)).decrypt(nonce, ciphertext, None)
    return plaintext.decode("utf-8")


def encrypt_provider_credential(plaintext: str, encoded_key: str) -> str:
    nonce = os.urandom(_IV_LENGTH)
    encrypted = AESGCM(_key_bytes(encoded_key)).encrypt(nonce, plaintext.encode("utf-8"), None)
    payload = base64.urlsafe_b64encode(nonce + encrypted).decode("ascii").rstrip("=")
    return f"v1.{payload}"
