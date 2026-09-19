# app/routes/settings.py
from flask import Blueprint, request, jsonify, current_app

from app.db import query_one, query_all, execute
from app.sessions import get_session_user, role_allowed

bp = Blueprint('settings', __name__, url_prefix='/api/settings')


# Publicly readable subset of settings — no login required. This is what the
# storefront footer calls so the Contact Number (and other footer info
# that's controlled through Settings) always matches whatever the admin last
# saved on the Settings page, instead of being hard-coded in the HTML.
@bp.get('/public')
def get_public_settings():
    db = current_app.get_db()
    rows = query_all(db, 'SELECT * FROM settings')
    values = {row['setting_key']: row['value'] for row in rows}
    return jsonify(settings={
        'store_name': values.get('store_name') or 'ShakarGanj Grocery Store',
        'support_phone': values.get('support_phone') or '+92 300 1234567',
        'whatsapp_number': values.get('whatsapp_number') or '',
        'bank_iban': values.get('bank_iban') or 'PK00 MEZN 0000 0000 1234 567',
        'bank_name': values.get('bank_name') or 'Meezan Bank',
    })


@bp.get('')
def get_settings():
    """Get all settings (admin only)."""
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin']):
        return jsonify(error='Admin access required.'), 403

    settings = query_all(db, 'SELECT * FROM settings')
    result = {}
    for setting in settings:
        result[setting['setting_key']] = setting['value']
    return jsonify(settings=result)


@bp.put('')
def update_settings():
    """Update settings (admin only)."""
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin']):
        return jsonify(error='Admin access required.'), 403

    body = request.get_json(silent=True) or {}

    # Update each setting passed in the request
    for key, value in body.items():
        existing = query_one(db, 'SELECT setting_key FROM settings WHERE setting_key = ?', (key,))
        if existing:
            execute(db, 'UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE setting_key = ?',
                    (value, key))
        else:
            execute(db, 'INSERT INTO settings (setting_key, value) VALUES (?, ?)',
                    (key, value))

    if hasattr(db, 'commit'):
        db.commit()

    return jsonify(success=True)
