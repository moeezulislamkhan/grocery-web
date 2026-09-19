# app/sessions.py
#
# Real server-side sessions, stored in the `sessions` table. The token given
# to the browser is a random opaque string with no meaning of its own — it's
# only useful because it matches a row in the database. That's what makes
# logout actually work: deleting the row immediately and permanently kills
# that session, everywhere, unlike a self-signed token that stays "valid"
# until it expires no matter what the server does.

import secrets
from datetime import datetime, timedelta, timezone

from app.db import execute, query_one

SESSION_TTL_HOURS = 8


def create_session(conn, user_id: int) -> str:
    token = secrets.token_hex(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=SESSION_TTL_HOURS)).strftime('%Y-%m-%d %H:%M:%S')
    execute(conn, 'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', (token, user_id, expires_at))
    return token


def destroy_session(conn, token: str) -> None:
    if not token:
        return
    execute(conn, 'DELETE FROM sessions WHERE token = ?', (token,))


def get_session_user(conn, request) -> dict | None:
    """Resolves the Authorization: Bearer <token> header to a user dict, or
    None if missing / not found / expired. Expired sessions are deleted
    lazily on the read that discovers them."""
    header = request.headers.get('Authorization', '')
    if not header.startswith('Bearer '):
        return None
    token = header[len('Bearer '):]

    session = query_one(conn, 'SELECT * FROM sessions WHERE token = ?', (token,))
    if not session:
        return None

    expires_at = session['expires_at']
    if isinstance(expires_at, str):
        expires_dt = datetime.fromisoformat(expires_at.replace(' ', 'T'))
    else:
        expires_dt = expires_at
    if expires_dt.tzinfo is None:
        expires_dt = expires_dt.replace(tzinfo=timezone.utc)

    if expires_dt < datetime.now(timezone.utc):
        execute(conn, 'DELETE FROM sessions WHERE token = ?', (token,))
        return None

    user = query_one(conn, 'SELECT id, name, email, role FROM users WHERE id = ?', (session['user_id'],))
    return user


def prune_expired_sessions(conn) -> None:
    from app.db import DB_ENGINE
    if DB_ENGINE == 'mysql':
        execute(conn, 'DELETE FROM sessions WHERE expires_at < NOW()')
    else:
        execute(conn, "DELETE FROM sessions WHERE expires_at < datetime('now')")


def role_allowed(user: dict | None, allowed_roles: list[str]) -> bool:
    return bool(user) and user['role'] in allowed_roles
