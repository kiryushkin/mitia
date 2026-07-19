"""Regression checks for the YooKassa balance top-up flow."""
from pathlib import Path


PAYMENTS = Path("api/chat/routers/payment_router.py")
PROFILE_BILLING = Path("api/chat/static/js/modules/profile-billing.js")


def test_yookassa_webhook_verifies_and_credits_each_payment_once():
    source = PAYMENTS.read_text(encoding="utf-8")

    assert 'f"https://api.yookassa.ru/v3/payments/{payment_id}"' in source
    assert "verified.get('status') != 'succeeded'" in source
    assert "await credit_balance_once(" in source
    assert 'external_id=payment_id' in source


def test_yookassa_payment_includes_a_fiscal_receipt():
    source = PAYMENTS.read_text(encoding="utf-8")

    assert '"receipt": {' in source
    assert '"customer": {"email": customer_email}' in source
    assert '"payment_subject": "service"' in source
    assert '"payment_mode": "full_prepayment"' in source


def test_returned_user_confirms_the_same_payment_without_trusting_browser_amount():
    router = PAYMENTS.read_text(encoding="utf-8")
    client = PROFILE_BILLING.read_text(encoding="utf-8")

    assert '@router.get("/status/{payment_id}")' in router
    assert 'payment.get("metadata", {}).get("client_id") != token_client_id' in router
    assert "sessionStorage.setItem('mitia_pending_yookassa_payment', data.payment_id)" in client
    assert 'fetch(`/api/payments/status/${encodeURIComponent(paymentId)}`' in client
