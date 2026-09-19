# app/routes/products.py
from flask import Blueprint, request, jsonify, current_app

from app.db import query_one, query_all, execute
from app.sessions import get_session_user, role_allowed
from app.deal_utils import active_deal_for_product


def enrich_product(db, product):
    result = dict(product)
    deal = active_deal_for_product(db, product['id'])
    result['deal'] = deal
    result['effective_price'] = deal['final_price'] if deal else float(product['sale_price'] or product['price'])
    result['has_sale_price'] = bool(product['sale_price'] and float(product['sale_price']) < float(product['price']))
    return result


def parse_sale_price(body, original_price):
    value = body.get('salePrice', body.get('sale_price'))
    if value in (None, ''):
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError('Sale price must be a valid number.')
    if value <= 0 or value >= float(original_price):
        raise ValueError('Sale price must be less than the original price.')
    return value

bp = Blueprint('products', __name__, url_prefix='/api/products')


@bp.get('')
def list_products():
    db = current_app.get_db()
    category = request.args.get('category')  # optional ?category=Bakery filter, used by category.html
    if category:
        products = query_all(db, 'SELECT * FROM products WHERE category = ? ORDER BY created_at DESC', (category,))
    else:
        products = query_all(db, 'SELECT * FROM products ORDER BY created_at DESC')
    return jsonify(products=[enrich_product(db, product) for product in products])


@bp.get('/categories')
def list_categories():
    """Distinct category names currently in the catalog, with a live product
    count each — powers the storefront's category browsing pages and cards.
    Since this reads straight from the products table, it always reflects
    whatever an Admin has added/edited/removed in the Admin Panel."""
    db = current_app.get_db()
    rows = query_all(db, 'SELECT category, COUNT(*) AS product_count FROM products GROUP BY category ORDER BY category')
    return jsonify(categories=rows)


@bp.get('/<int:product_id>')
def get_product(product_id):
    db = current_app.get_db()
    product = query_one(db, 'SELECT * FROM products WHERE id = ?', (product_id,))
    if not product:
        return jsonify(error='Product not found.'), 404
    return jsonify(product=enrich_product(db, product))


@bp.post('')
def create_product():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager', 'staff', 'employee']):
        return jsonify(error='Admin or manager access required.'), 403

    body = request.get_json(silent=True) or {}
    name, category, price = body.get('name'), body.get('category'), body.get('price')
    if not name or not category or not price:
        return jsonify(error='name, category and price are required.'), 400

    try:
        sale_price = parse_sale_price(body, price)
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    cur = execute(db, 'INSERT INTO products (name, category, price, sale_price, old_price, stock, image, tag) VALUES (?,?,?,?,?,?,?,?)',
                  (name, category, price, sale_price or None, body.get('oldPrice'), body.get('stock', 0), body.get('image'), body.get('tag')))
    if hasattr(db, 'commit'):
        db.commit()
    product = query_one(db, 'SELECT * FROM products WHERE id = ?', (cur.lastrowid,))
    return jsonify(product=product), 201


@bp.put('/<int:product_id>')
def update_product(product_id):
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager', 'staff', 'employee']):
        return jsonify(error='Admin or manager access required.'), 403

    existing = query_one(db, 'SELECT * FROM products WHERE id = ?', (product_id,))
    if not existing:
        return jsonify(error='Product not found.'), 404

    body = request.get_json(silent=True) or {}
    merged = {**existing, **body}
    try:
        sale_price = parse_sale_price(body, merged['price']) if ('salePrice' in body or 'sale_price' in body) else existing.get('sale_price')
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    execute(db, 'UPDATE products SET name=?, category=?, price=?, sale_price=?, old_price=?, stock=?, image=?, tag=? WHERE id=?',
            (merged['name'], merged['category'], merged['price'], sale_price or None, merged.get('old_price') or merged.get('oldPrice'),
             merged['stock'], merged['image'], merged['tag'], product_id))
    if hasattr(db, 'commit'):
        db.commit()
    product = query_one(db, 'SELECT * FROM products WHERE id = ?', (product_id,))
    return jsonify(product=enrich_product(db, product))


@bp.delete('/<int:product_id>')
def delete_product(product_id):
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin']):
        return jsonify(error='Admin access required.'), 403

    existing = query_one(db, 'SELECT * FROM products WHERE id = ?', (product_id,))
    if not existing:
        return jsonify(error='Product not found.'), 404

    execute(db, 'DELETE FROM products WHERE id = ?', (product_id,))
    if hasattr(db, 'commit'):
        db.commit()
    return jsonify(success=True)
