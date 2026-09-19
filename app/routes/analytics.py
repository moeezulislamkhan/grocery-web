# app/routes/analytics.py
from flask import Blueprint, request, jsonify, current_app

from app.db import query_one, query_all
from app.sessions import get_session_user, role_allowed

bp = Blueprint('analytics', __name__, url_prefix='/api/analytics')


@bp.get('/summary')
def summary():
    db = current_app.get_db()
    user = get_session_user(db, request)
    if not role_allowed(user, ['admin', 'manager']):
        return jsonify(error='Admin or manager access required.'), 403

    revenue = query_one(db, "SELECT COALESCE(SUM(total),0) AS v FROM orders WHERE payment_status IN ('paid','cod_pending')")['v']
    order_count = query_one(db, 'SELECT COUNT(*) AS v FROM orders')['v']
    avg_order = (revenue / order_count) if order_count else 0
    customer_count = query_one(db, 'SELECT COUNT(DISTINCT phone) AS v FROM orders')['v']

    by_category = query_all(db, """
        SELECT p.category AS category, COALESCE(SUM(oi.qty * oi.unit_price),0) AS total
        FROM order_items oi JOIN products p ON p.id = oi.product_id
        GROUP BY p.category
    """)
    by_payment = query_all(db, 'SELECT payment_method AS method, COUNT(*) AS count FROM orders GROUP BY payment_method')
    daily_revenue = query_all(db, """
        SELECT date(created_at) AS day, COALESCE(SUM(total),0) AS total
        FROM orders GROUP BY date(created_at) ORDER BY day DESC LIMIT 14
    """)
    daily_revenue = list(reversed(daily_revenue))
    top_products = query_all(db, """
        SELECT product_name AS name, SUM(qty) AS units, SUM(qty*unit_price) AS revenue
        FROM order_items GROUP BY product_name ORDER BY revenue DESC LIMIT 5
    """)

    return jsonify(
        revenue=revenue, orderCount=order_count, avgOrder=avg_order, customerCount=customer_count,
        byCategory=by_category, byPayment=by_payment, dailyRevenue=daily_revenue, topProducts=top_products,
    )
