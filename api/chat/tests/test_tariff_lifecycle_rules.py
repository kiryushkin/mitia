"""Regression coverage for tariff lifecycle rules."""
from pathlib import Path


CONFIG = Path("api/chat/core/config.py")
DB_SERVICE = Path("api/chat/services/db_service.py")
BILLING = Path("api/chat/services/billing_service.py")
NOTIFICATIONS = Path("api/chat/services/notification_service.py")
PROFILE_UI = Path("api/chat/static/js/modules/profile-data-ui.js")
TARIFFS_TEMPLATE = Path("api/chat/templates/tariffs.html")
TARIFFS_JS = Path("api/chat/static/js/tariffs.js")


def test_start_has_one_time_trial_without_monthly_reset():
    source = CONFIG.read_text(encoding="utf-8")
    start = source[source.index("'start': {"):source.index("'business': {")]

    assert "'base_limit': 30" in start
    assert "'reset_period_days': 0" in start


def test_paid_tariffs_have_monthly_message_periods():
    source = CONFIG.read_text(encoding="utf-8")
    business = source[source.index("'business': {"):source.index("'neuro': {")]
    neuro = source[source.index("'neuro': {"):]

    assert "'reset_period_days': 30" in business
    assert "'reset_period_days': 30" in neuro


def test_message_period_reset_keeps_purchased_packs():
    source = DB_SERVICE.read_text(encoding="utf-8")
    helper = source[source.index("async def ensure_messages_period"):source.index("def get_message_quota_state")]

    assert "if period_days == 0:" in helper
    assert "user.messages_reset_at = None" in helper
    assert "Purchased message packs are not a monthly allowance" in helper
    assert "user.extra_messages_purchased = 0" not in helper
    assert "user.extra_messages_used = 0" not in helper


def test_billing_handles_paid_limit_resets_and_expired_tariffs():
    source = BILLING.read_text(encoding="utf-8")

    assert "await self._downgrade_expired_tariffs(now)" in source
    assert "await self._reset_paid_message_periods(now)" in source
    assert "async def _downgrade_expired_tariffs" in source
    assert "user.tariff_name = 'start'" in source
    assert "async def _reset_paid_message_periods" in source
    assert "user.messages_reset_at = user.messages_period_started_at + timedelta(days=30)" in source
    assert "billing_period = str(getattr(user, 'tariff_billing_period', 'month') or 'month')" in source


def test_tariff_lifecycle_events_are_sent_in_app_and_by_email():
    source = NOTIFICATIONS.read_text(encoding="utf-8")

    assert "async def notify_monthly_messages_reset" in source
    assert "async def notify_tariff_downgraded" in source
    assert "отдельно купленные пакеты сохранены" in source
    assert "Оплачено до" in source
    assert "send_email_copy=True" in source


def test_tariff_cards_explain_monthly_limits_for_each_billing_period():
    template = TARIFFS_TEMPLATE.read_text(encoding="utf-8")
    source = TARIFFS_JS.read_text(encoding="utf-8")

    assert 'пробных сообщений ассистента' in template
    assert 'пробных сообщений ассистента, один раз' not in template
    assert 'data-monthly-message-label' in template
    assert "сообщений ассистента" in source
    assert "сообщений ассистента в месяц" in source
    assert '+290 ₽' not in template
    assert '+990 ₽' not in template
    assert '+3 490 ₽' not in template


def test_profile_shows_only_paid_until_date_without_monthly_reset_date():
    source = PROFILE_UI.read_text(encoding="utf-8")

    assert "Оплачено до:" in source
    assert "Следующее обновление лимита сообщений:" not in source


def test_profile_and_live_poll_use_the_same_message_quota_fields():
    profile_ui = PROFILE_UI.read_text(encoding="utf-8")
    runtime = Path("api/chat/static/js/modules/profile-runtime.js").read_text(encoding="utf-8")
    tariffs = TARIFFS_JS.read_text(encoding="utf-8")

    assert "messages_total_remaining: balanceData.messages_total_remaining" in profile_ui
    assert "extra_messages_remaining: balanceData.extra_messages_remaining" in profile_ui
    assert "const totalRemaining = Math.max(Number(config.messages_total_remaining" in profile_ui
    assert "const totalRemaining = Math.max(Number(data.messages_total_remaining" in runtime
    assert "confirmBtn.classList.add(danger ? 'error-bg' : 'success-bg')" in tariffs


def test_start_trial_is_not_reissued_after_leaving_paid_tariff():
    source = DB_SERVICE.read_text(encoding="utf-8")
    billing = BILLING.read_text(encoding="utf-8")
    analytics = Path("api/chat/routers/admin/analytics.py").read_text(encoding="utf-8")

    assert "start_trial_messages_used" in source
    assert "if reset_days == 0:" in source
    assert "user.start_trial_messages_used" in analytics
    assert "messages_consumed = int(getattr(user, 'start_trial_messages_used', 0) or 0)" in billing


def test_tariff_change_keeps_purchased_messages_and_warns_about_tariff_remainder():
    analytics = Path("api/chat/routers/admin/analytics.py").read_text(encoding="utf-8")
    tariffs = Path("api/chat/static/js/tariffs.js").read_text(encoding="utf-8")

    assert "Extra message packs are paid separately and survive tariff changes." in analytics
    assert "Отдельно купленные пакеты сообщений сохранятся." in tariffs
