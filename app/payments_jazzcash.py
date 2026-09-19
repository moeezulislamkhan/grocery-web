# app/payments_jazzcash.py
#
# JazzCash integration — Hosted Checkout Page (HCP), the standard redirect-
# based integration used by most merchants (mobile wallet + card, all
# handled on JazzCash's own page, so card/wallet details never touch our
# server).
#
# This follows JazzCash's documented request format exactly:
#
#   1. Build a set of pp_* fields (merchant ID, amount in paisa, a unique
#      transaction reference, timestamps, return URL, etc.)
#   2. Compute pp_SecureHash = HMAC-SHA256(IntegritySalt, "<IntegritySalt>&
#      <all pp_ values, sorted alphabetically by field name, joined with &>")
#   3. Auto-submit those fields as an HTML POST form to JazzCash's Hosted
#      Checkout Page endpoint — the browser navigates there directly
#   4. The customer completes payment on JazzCash's own page
#   5. JazzCash redirects back to pp_ReturnURL with the result (including
#      pp_ResponseCode / pp_SecureHash for us to verify) — see
#      verify_response() below
#
# Sandbox endpoint:    https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/
# Production endpoint: https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/
#
# SANDBOX / DEMO MODE
# --------------------
# Real integration requires a JazzCash merchant account — apply via the
# JazzCash Business/Developer Portal — which issues a Merchant ID, Password,
# and Integrity Salt. Until those are set in .env, this module builds a
# request in the exact same shape (so you can see precisely what would be
# sent) but points the auto-submit form at our own local
# /mock-checkout.html instead of JazzCash's real servers, so the full
# checkout flow can still be demoed end-to-end with no live credentials.
# Add real credentials to .env and nothing else needs to change.

import hashlib
import hmac
import os
from datetime import datetime, timedelta

JAZZCASH_MODE = os.environ.get('JAZZCASH_MODE', 'sandbox')  # 'sandbox' | 'production'
JAZZCASH_MERCHANT_ID = os.environ.get('JAZZCASH_MERCHANT_ID', '')
JAZZCASH_PASSWORD = os.environ.get('JAZZCASH_PASSWORD', '')
JAZZCASH_INTEGRITY_SALT = os.environ.get('JAZZCASH_INTEGRITY_SALT', '')
PUBLIC_BASE_URL = os.environ.get('PUBLIC_BASE_URL', '')  # optional override — see build_checkout_form()

SANDBOX_URL = 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/'
PRODUCTION_URL = 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/'


def is_live_mode() -> bool:
    return bool(JAZZCASH_MERCHANT_ID and JAZZCASH_PASSWORD and JAZZCASH_INTEGRITY_SALT)


def _compute_secure_hash(fields: dict, integrity_salt: str) -> str:
    """JazzCash's documented algorithm: sort all pp_ fields alphabetically by
    key, join their values with '&', prepend the integrity salt + '&', then
    HMAC-SHA256 the whole thing using the integrity salt as the key."""
    sorted_keys = sorted(k for k in fields if fields[k] not in (None, ''))
    joined_values = '&'.join(str(fields[k]) for k in sorted_keys)
    message = f'{integrity_salt}&{joined_values}'
    digest = hmac.new(integrity_salt.encode('utf-8'), message.encode('utf-8'), hashlib.sha256)
    return digest.hexdigest()


def build_checkout_form(order_code: str, amount_pkr: float, bill_reference: str, description: str, base_url: str) -> dict:
    """Builds the complete set of HTML form fields for JazzCash's Hosted
    Checkout Page, plus the URL to POST them to.

    `base_url` is the public origin (scheme://host:port) that pp_ReturnURL
    should point back to. Pass the ACTUAL incoming request's origin (see
    routes/orders.py) rather than a hard-coded value — that way the return
    URL is always correct no matter which port the server happens to be
    running on, with zero configuration. Set PUBLIC_BASE_URL in .env only to
    override this (e.g. once you have a real public domain in production).

    Returns: { "action_url": str, "fields": {pp_...: value, ...}, "live": bool }
    """
    effective_base_url = PUBLIC_BASE_URL or base_url

    now = datetime.now()
    txn_datetime = now.strftime('%Y%m%d%H%M%S')
    txn_expiry = (now + timedelta(hours=1)).strftime('%Y%m%d%H%M%S')
    txn_ref_no = 'T' + now.strftime('%Y%m%d%H%M%S') + order_code.replace('-', '')[-6:]

    fields = {
        'pp_Version': '1.1',
        'pp_TxnType': 'MWALLET',
        'pp_Language': 'EN',
        'pp_MerchantID': JAZZCASH_MERCHANT_ID or 'DEMO_MERCHANT',
        'pp_Password': JAZZCASH_PASSWORD or 'demo_password',
        'pp_TxnRefNo': txn_ref_no,
        'pp_Amount': str(int(round(amount_pkr * 100))),  # JazzCash expects amount in paisa
        'pp_TxnCurrency': 'PKR',
        'pp_TxnDateTime': txn_datetime,
        'pp_BillReference': bill_reference,
        'pp_Description': description[:100],
        'pp_TxnExpiryDateTime': txn_expiry,
        'pp_ReturnURL': f'{effective_base_url}/api/payments/jazzcash/return',
        'ppmpf_1': order_code,
    }

    integrity_salt = JAZZCASH_INTEGRITY_SALT or 'demo-integrity-salt'
    fields['pp_SecureHash'] = _compute_secure_hash(fields, integrity_salt)

    if is_live_mode():
        action_url = SANDBOX_URL if JAZZCASH_MODE == 'sandbox' else PRODUCTION_URL
        live = True
    else:
        # No live credentials yet — point the auto-submitted form at our own
        # Flask route instead of JazzCash's real servers (a static HTML file
        # can't receive POST form data server-side, so this has to be a real
        # route, not a static page). The fields above are still built and
        # hashed exactly as they would be for real, so this is a faithful
        # preview of the real request.
        action_url = '/api/payments/mock-checkout'
        live = False

    return {'action_url': action_url, 'fields': fields, 'txn_ref_no': txn_ref_no, 'live': live}


def verify_response(fields: dict) -> bool:
    """Verifies pp_SecureHash on a response/callback from JazzCash. Always
    verify this before trusting a payment result — never trust the redirect
    alone. In demo mode (no integrity salt configured) this always returns
    True so the local simulation can complete."""
    if not JAZZCASH_INTEGRITY_SALT:
        return True
    incoming_hash = fields.get('pp_SecureHash', '')
    fields_without_hash = {k: v for k, v in fields.items() if k != 'pp_SecureHash'}
    expected_hash = _compute_secure_hash(fields_without_hash, JAZZCASH_INTEGRITY_SALT)
    return hmac.compare_digest(incoming_hash, expected_hash)


# JazzCash's core response codes (there are more granular decline codes in
# the full spec — these are the ones that matter for order status).
RESPONSE_CODE_MEANINGS = {
    '000': 'success',
    '121': 'pending',
    '124': 'pending',
}


def response_code_to_status(code: str) -> str:
    if code == '000':
        return 'paid'
    if code in RESPONSE_CODE_MEANINGS and RESPONSE_CODE_MEANINGS[code] == 'pending':
        return 'pending'
    return 'failed'
