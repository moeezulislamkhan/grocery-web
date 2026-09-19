# app/routes/auth.py
import re

from flask import Blueprint, request, jsonify, current_app

from app.auth import hash_password, verify_password
from app.db import query_one, execute
from app.sessions import create_session, destroy_session, get_session_user

bp = Blueprint('auth', __name__, url_prefix='/api/auth')

EMAIL_RE = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')

# One unified auth surface for admin-family accounts (admin/manager/staff)
# AND customer accounts (user). There is deliberately no separate admin
# login route — the frontend has exactly one login form, and the backend
# alone decides the role.


@bp.post('/register')
def register():
    body = request.get_json(silent=True) or {}
    name = (body.get('name') or '').strip()
    email = (body.get('email') or '').strip().lower()
    password = body.get('password') or ''

    if not name:
        return jsonify(error='Please enter your name.'), 400
    if not email or not EMAIL_RE.match(email):
        return jsonify(error='Please enter a valid email address.'), 400
    if len(password) < 8:
        return jsonify(error='Password must be at least 8 characters.'), 400

    db = current_app.get_db()
    existing = query_one(db, 'SELECT id FROM users WHERE email = ?', (email,))
    if existing:
        return jsonify(error='An account with this email already exists.'), 409

    # Public self-registration always creates a 'user' (customer) account —
    # admin/manager/staff accounts are provisioned in the database only, so
    # nobody can grant themselves staff access through the sign-up form.
    cur = execute(db, 'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
                  (name, email, hash_password(password), 'user'))
    if hasattr(db, 'commit'):
        db.commit()
    user_id = cur.lastrowid

    token = create_session(db, user_id)
    if hasattr(db, 'commit'):
        db.commit()
    return jsonify(token=token, user={'id': user_id, 'name': name, 'email': email, 'role': 'user'}), 201


@bp.post('/login')
def login():
    body = request.get_json(silent=True) or {}
    email = (body.get('email') or '').strip().lower()
    password = body.get('password') or ''
    if not email or not password:
        return jsonify(error='Email and password are required.'), 400

    db = current_app.get_db()
    user = query_one(db, 'SELECT * FROM users WHERE email = ?', (email,))
    # Same generic error for "no such email" and "wrong password" — never
    # leak which emails are registered.
    if not user or not verify_password(password, user['password_hash']):
        return jsonify(error='Invalid email or password.'), 401

    token = create_session(db, user['id'])
    if hasattr(db, 'commit'):
        db.commit()
    return jsonify(token=token, user={'id': user['id'], 'name': user['name'], 'email': user['email'], 'role': user['role']})


@bp.post('/logout')
def logout():
    db = current_app.get_db()
    header = request.headers.get('Authorization', '')
    token = header[len('Bearer '):] if header.startswith('Bearer ') else None
    destroy_session(db, token)
    if hasattr(db, 'commit'):
        db.commit()
    return jsonify(success=True)


@bp.get('/me')
def me():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not user:
        return jsonify(error='Not authenticated.'), 401
    return jsonify(user=user)
