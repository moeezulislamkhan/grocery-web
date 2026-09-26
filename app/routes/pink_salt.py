from datetime import datetime

from flask import Blueprint, current_app, jsonify, request

from app.db import execute, query_all, query_one
from app.sessions import get_session_user, role_allowed

bp = Blueprint('pink_salt', __name__, url_prefix='/api')


def _normalize_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {'1', 'true', 'yes', 'on'}
    return bool(value)


def _is_active_now(start_date=None, end_date=None, now=None):
    now = now or datetime.utcnow()
    if start_date:
        try:
            start_dt = datetime.fromisoformat(str(start_date).replace(' ', 'T'))
            if now < start_dt:
                return False
        except ValueError:
            pass
    if end_date:
        try:
            end_dt = datetime.fromisoformat(str(end_date).replace(' ', 'T'))
            if now > end_dt:
                return False
        except ValueError:
            pass
    return True


def _serialize_product(product):
    if not product:
        return None
    result = dict(product)
    result['is_pink_salt'] = bool(product.get('is_pink_salt'))
    return result


def _serialize_slider(row):
    slider = dict(row)
    slider['is_active'] = bool(slider.get('is_active'))
    slider['display_order'] = int(slider.get('display_order', 0) or 0)
    if slider.get('product_id'):
        product = query_one(current_app.get_db(), 'SELECT * FROM products WHERE id = ?', (slider['product_id'],))
        slider['product'] = _serialize_product(product) if product else None
    else:
        slider['product'] = None
    return slider


def _pink_salt_products_query(db):
    return query_all(
        db,
        '''
        SELECT * FROM products
        WHERE is_pink_salt = 1
           OR LOWER(category) LIKE LOWER(?)
           OR LOWER(name) LIKE LOWER(?)
        ORDER BY created_at DESC
        ''',
        ('%pink salt%', '%pink salt%'),
    )


def _settings_row(db):
    row = query_one(db, 'SELECT * FROM pink_salt_settings ORDER BY id DESC LIMIT 1')
    if not row:
        return {
            'is_enabled': True,
            'title': 'Explore Our Pink Salt Collection',
            'subtitle': 'Our signature range',
            'description': 'Discover premium Pink Salt products selected for everyday cooking, gifting and home styling.',
            'cta_text': 'Explore Pink Salt Products',
            'cta_link': 'pink-salt.html',
            'hero_image': 'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=1200&q=80',
        }
    return {
        'id': row['id'],
        'is_enabled': bool(row.get('is_enabled', 1)),
        'title': row.get('title') or 'Explore Our Pink Salt Collection',
        'subtitle': row.get('subtitle') or 'Our signature range',
        'description': row.get('description') or 'Discover premium Pink Salt products selected for everyday cooking, gifting and home styling.',
        'cta_text': row.get('cta_text') or 'Explore Pink Salt Products',
        'cta_link': row.get('cta_link') or 'pink-salt.html',
        'hero_image': row.get('hero_image') or 'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=1200&q=80',
    }


@bp.get('/pink-salt')
def public_pink_salt():
    db = current_app.get_db()
    settings = _settings_row(db)
    if not settings.get('is_enabled', True):
        return jsonify({
            'enabled': False,
            'settings': settings,
            'products': [],
            'sliders': [],
        })
    products = [_serialize_product(product) for product in _pink_salt_products_query(db)]
    sliders = []
    for row in query_all(db, 'SELECT * FROM pink_salt_sliders WHERE is_active = 1 ORDER BY display_order ASC, id ASC'):
        if not _is_active_now(row.get('start_date'), row.get('end_date')):
            continue
        sliders.append(_serialize_slider(row))
    return jsonify({
        'enabled': True,
        'settings': settings,
        'products': products,
        'sliders': sliders,
    })


@bp.get('/pink-salt/sliders')
def public_pink_salt_sliders():
    db = current_app.get_db()
    settings = _settings_row(db)
    if not settings.get('is_enabled', True):
        return jsonify({'sliders': [], 'enabled': False})
    rows = query_all(db, 'SELECT * FROM pink_salt_sliders WHERE is_active = 1 ORDER BY display_order ASC, id ASC')
    sliders = []
    for row in rows:
        if not _is_active_now(row.get('start_date'), row.get('end_date')):
            continue
        sliders.append(_serialize_slider(row))
    return jsonify({'enabled': True, 'sliders': sliders})


@bp.get('/admin/pink-salt')
def admin_pink_salt():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager']):
        return jsonify(error='Admin access required.'), 403
    settings = _settings_row(db)
    rows = query_all(db, 'SELECT * FROM pink_salt_sliders ORDER BY display_order ASC, id ASC')
    sliders = [_serialize_slider(row) for row in rows]
    pink_products = [_serialize_product(product) for product in _pink_salt_products_query(db)]
    return jsonify({'settings': settings, 'sliders': sliders, 'products': pink_products})


@bp.post('/admin/pink-salt')
def save_pink_salt_settings():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager']):
        return jsonify(error='Admin access required.'), 403
    body = request.get_json(silent=True) or {}
    title = str(body.get('title') or 'Explore Our Pink Salt Collection').strip() or 'Explore Our Pink Salt Collection'
    subtitle = str(body.get('subtitle') or 'Our signature range').strip() or 'Our signature range'
    description = str(body.get('description') or 'Discover premium Pink Salt products selected for everyday cooking, gifting and home styling.').strip() or 'Discover premium Pink Salt products selected for everyday cooking, gifting and home styling.'
    cta_text = str(body.get('cta_text') or 'Explore Pink Salt Products').strip() or 'Explore Pink Salt Products'
    cta_link = str(body.get('cta_link') or 'pink-salt.html').strip() or 'pink-salt.html'
    hero_image = str(body.get('hero_image') or '').strip()
    is_enabled = _normalize_bool(body.get('is_enabled'), True)

    existing = query_one(db, 'SELECT * FROM pink_salt_settings ORDER BY id DESC LIMIT 1')
    if existing:
        execute(db, '''
            UPDATE pink_salt_settings
            SET is_enabled=?, title=?, subtitle=?, description=?, cta_text=?, cta_link=?, hero_image=?, updated_at=?
            WHERE id=?
        ''', (1 if is_enabled else 0, title, subtitle, description, cta_text, cta_link, hero_image or existing.get('hero_image') or 'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=1200&q=80', datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'), existing['id']))
    else:
        execute(db, '''
            INSERT INTO pink_salt_settings (is_enabled, title, subtitle, description, cta_text, cta_link, hero_image)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (1 if is_enabled else 0, title, subtitle, description, cta_text, cta_link, hero_image or 'https://images.unsplash.com/photo-1610348725531-843dff563e2c?w=1200&q=80'))
    if hasattr(db, 'commit'):
        db.commit()
    return jsonify({'settings': _settings_row(db), 'success': True})


@bp.post('/admin/pink-salt/sliders')
def create_pink_salt_slider():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager']):
        return jsonify(error='Admin access required.'), 403
    body = request.get_json(silent=True) or {}
    title = str(body.get('title') or '').strip()
    if not title:
        return jsonify(error='Slider title is required.'), 400
    product_id = body.get('product_id')
    if product_id not in (None, ''):
        try:
            product_id = int(product_id)
            if not query_one(db, 'SELECT id FROM products WHERE id = ?', (product_id,)):
                return jsonify(error='Invalid product ID.'), 400
        except (TypeError, ValueError):
            return jsonify(error='Invalid product ID.'), 400
    slider = {
        'title': title,
        'subtitle': str(body.get('subtitle') or '').strip(),
        'description': str(body.get('description') or '').strip(),
        'image': str(body.get('image') or '').strip(),
        'button_text': str(body.get('button_text') or 'Shop Now').strip() or 'Shop Now',
        'button_url': str(body.get('button_url') or 'pink-salt.html').strip() or 'pink-salt.html',
        'product_id': product_id,
        'display_order': int(body.get('display_order') or 0),
        'is_active': 1 if _normalize_bool(body.get('is_active'), True) else 0,
        'start_date': str(body.get('start_date') or '').strip() or None,
        'end_date': str(body.get('end_date') or '').strip() or None,
    }
    cur = execute(db, '''
        INSERT INTO pink_salt_sliders (title, subtitle, description, image, button_text, button_url, product_id, display_order, is_active, start_date, end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (slider['title'], slider['subtitle'], slider['description'], slider['image'], slider['button_text'], slider['button_url'], slider['product_id'], slider['display_order'], slider['is_active'], slider['start_date'], slider['end_date']))
    if hasattr(db, 'commit'):
        db.commit()
    row = query_one(db, 'SELECT * FROM pink_salt_sliders WHERE id = ?', (cur.lastrowid,))
    return jsonify({'slider': _serialize_slider(row)}), 201


@bp.put('/admin/pink-salt/sliders/<int:slider_id>')
def update_pink_salt_slider(slider_id):
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager']):
        return jsonify(error='Admin access required.'), 403
    existing = query_one(db, 'SELECT * FROM pink_salt_sliders WHERE id = ?', (slider_id,))
    if not existing:
        return jsonify(error='Pink Salt slider not found.'), 404
    body = request.get_json(silent=True) or {}
    product_id = body.get('product_id', existing.get('product_id'))
    if product_id not in (None, ''):
        try:
            product_id = int(product_id)
            if not query_one(db, 'SELECT id FROM products WHERE id = ?', (product_id,)):
                return jsonify(error='Invalid product ID.'), 400
        except (TypeError, ValueError):
            return jsonify(error='Invalid product ID.'), 400
    title = str(body.get('title', existing.get('title')) or '').strip()
    if not title:
        return jsonify(error='Slider title is required.'), 400
    execute(db, '''
        UPDATE pink_salt_sliders
        SET title=?, subtitle=?, description=?, image=?, button_text=?, button_url=?, product_id=?, display_order=?, is_active=?, start_date=?, end_date=?, updated_at=?
        WHERE id=?
    ''', (
        title,
        str(body.get('subtitle', existing.get('subtitle')) or '').strip(),
        str(body.get('description', existing.get('description')) or '').strip(),
        str(body.get('image', existing.get('image')) or '').strip(),
        str(body.get('button_text', existing.get('button_text') or 'Shop Now') or 'Shop Now').strip(),
        str(body.get('button_url', existing.get('button_url') or 'pink-salt.html') or 'pink-salt.html').strip(),
        product_id,
        int(body.get('display_order', existing.get('display_order', 0) or 0)),
        1 if _normalize_bool(body.get('is_active', bool(existing.get('is_active'))), True) else 0,
        str(body.get('start_date', existing.get('start_date')) or '').strip() or None,
        str(body.get('end_date', existing.get('end_date')) or '').strip() or None,
        datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
        slider_id,
    ))
    if hasattr(db, 'commit'):
        db.commit()
    updated = query_one(db, 'SELECT * FROM pink_salt_sliders WHERE id = ?', (slider_id,))
    return jsonify({'slider': _serialize_slider(updated)})


@bp.delete('/admin/pink-salt/sliders/<int:slider_id>')
def delete_pink_salt_slider(slider_id):
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager']):
        return jsonify(error='Admin access required.'), 403
    existing = query_one(db, 'SELECT id FROM pink_salt_sliders WHERE id = ?', (slider_id,))
    if not existing:
        return jsonify(error='Pink Salt slider not found.'), 404
    execute(db, 'DELETE FROM pink_salt_sliders WHERE id = ?', (slider_id,))
    if hasattr(db, 'commit'):
        db.commit()
    return jsonify({'success': True})
