from datetime import datetime, timezone


def parse_deal_datetime(value):
    if not value:
        raise ValueError('Date and time are required.')
    text = str(value).strip().replace('Z', '+00:00')
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise ValueError('Use a valid date and time.') from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


def db_datetime(value):
    return value.strftime('%Y-%m-%d %H:%M:%S')


def deal_status(deal, now=None):
    now = now or datetime.utcnow()
    if not deal['is_active']:
        return 'disabled'
    start = datetime.fromisoformat(str(deal['start_date'])) if deal.get('start_date') else None
    end = datetime.fromisoformat(str(deal['end_date'])) if deal.get('end_date') else None
    if start and now < start:
        return 'scheduled'
    if end and now >= end:
        return 'expired'
    return 'active'


def final_deal_price(original_price, discount_type, discount_value):
    original = float(original_price)
    value = float(discount_value)
    if discount_type == 'percentage':
        return round(original - (original * value / 100), 2)
    return round(original - value, 2)


def serialize_deal(deal, product, now=None):
    original_price = float(product['price'])
    discount_value = float(deal['discount_value'])
    final_price = final_deal_price(original_price, deal['discount_type'], discount_value)
    discount_amount = round(original_price - final_price, 2)
    status = deal_status(deal, now)
    return {
        'id': deal['id'],
        'product_id': deal['product_id'],
        'discount_type': deal['discount_type'],
        'discount_value': discount_value,
        'start_date': deal['start_date'],
        'end_date': deal['end_date'],
        'is_active': bool(deal['is_active']),
        'status': status,
        'created_at': deal['created_at'],
        'updated_at': deal['updated_at'],
        'original_price': original_price,
        'discount_amount': discount_amount,
        'final_price': final_price,
        'discount_label': f'{discount_value:g}% OFF' if deal['discount_type'] == 'percentage' else f'Rs. {discount_amount:g} OFF',
        'product': dict(product),
    }


def active_deal_for_product(db, product_id, now=None):
    from app.db import query_one
    deal = query_one(db, 'SELECT * FROM deals WHERE product_id = ?', (product_id,))
    if not deal or deal_status(deal, now) != 'active':
        return None
    product = query_one(db, 'SELECT * FROM products WHERE id = ?', (product_id,))
    return serialize_deal(deal, product, now) if product else None
