# app/auth.py
# Password hashing only — uses werkzeug's generate_password_hash /
# check_password_hash (ships with Flask, no extra install needed). This
# uses scrypt under the hood, so passwords are never stored in plain text.

from werkzeug.security import generate_password_hash, check_password_hash


def hash_password(password: str) -> str:
    return generate_password_hash(password, method='scrypt')


def verify_password(password: str, password_hash: str) -> bool:
    return check_password_hash(password_hash, password)
