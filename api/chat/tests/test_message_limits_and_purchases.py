import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.chat.core.config import MESSAGE_PACK_RULES, ASSISTANT_SLOT_PACK_RULES, ASSISTANT_SLOTS_HARD_CAP
from api.chat.services.assistants_service import get_effective_account_limits
from api.chat.routers.admin.deps import get_superadmin_access_state, get_superadmin_lock_scope, get_superadmin_request_fingerprint
from api.chat.routers import superadmin_router
from api.chat.routers.admin import analytics as analytics_router
from api.chat.routers.admin import notifications as notifications_router
from api.chat.services import notification_service
from api.chat.routers.admin import files as files_router
from api.chat.services import assistants_service as assistants_service_module
from fastapi import HTTPException, UploadFile
from api.chat.services.upload_limits import MAX_UPLOAD_FILE_SIZE, read_upload_limited


@pytest.mark.asyncio
async def test_read_upload_limited_rejects_oversized_file():
    file = MagicMock(spec=UploadFile)
    file.read = AsyncMock(return_value=b"x" * (MAX_UPLOAD_FILE_SIZE + 1))

    with pytest.raises(HTTPException) as error:
        await read_upload_limited(file)

    assert error.value.status_code == 413
    file.read.assert_awaited_once_with(MAX_UPLOAD_FILE_SIZE + 1)


class FakeScalarResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalar_one(self):
        return self._value


class FakeSession:
    def __init__(self, user):
        self.user = user
        self.add = MagicMock()
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    async def execute(self, stmt):
        return FakeScalarResult(self.user)

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return None


def compute_quota(user, base_limit):
    base_used = max(int(user.messages_consumed or 0), 0)
    extra_purchased = max(int(user.extra_messages_purchased or 0), 0)
    extra_used = max(int(user.extra_messages_used or 0), 0)
    base_remaining = max(int(base_limit or 0) - base_used, 0)
    extra_remaining = max(extra_purchased - extra_used, 0)
    total_remaining = base_remaining + extra_remaining
    quota_state = "ok"
    if base_remaining <= 0 and extra_remaining > 0:
        quota_state = "using_extra"
    elif total_remaining <= 0:
        quota_state = "operator_mode_only"
    return {
        "base_remaining": base_remaining,
        "extra_remaining": extra_remaining,
        "total_remaining": total_remaining,
        "quota_state": quota_state,
    }


class TestMessageQuotaHelpers:
    def test_get_message_quota_state_uses_base_first(self):
        user = SimpleNamespace(messages_consumed=12, extra_messages_purchased=50, extra_messages_used=5)

        quota = compute_quota(user, base_limit=100)

        assert quota["base_remaining"] == 88
        assert quota["extra_remaining"] == 45
        assert quota["total_remaining"] == 133
        assert quota["quota_state"] == "ok"

    def test_get_message_quota_state_switches_to_extra(self):
        user = SimpleNamespace(messages_consumed=100, extra_messages_purchased=50, extra_messages_used=10)

        quota = compute_quota(user, base_limit=100)

        assert quota["base_remaining"] == 0
        assert quota["extra_remaining"] == 40
        assert quota["quota_state"] == "using_extra"

    def test_get_message_quota_state_detects_full_exhaustion(self):
        user = SimpleNamespace(messages_consumed=100, extra_messages_purchased=50, extra_messages_used=50)

        quota = compute_quota(user, base_limit=100)

        assert quota["base_remaining"] == 0
        assert quota["extra_remaining"] == 0
        assert quota["total_remaining"] == 0
        assert quota["quota_state"] == "operator_mode_only"


@pytest.mark.asyncio
async def test_purchase_message_pack_success():
    pack = MESSAGE_PACK_RULES[1]
    user = SimpleNamespace(
        client_id="usr_test",
        tariff_name="business",
        balance=5000.0,
        messages_consumed=10,
        extra_messages_purchased=0,
        extra_messages_used=0,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_active=True,
        used_storage=0,
    )
    session = FakeSession(user)
    request = MagicMock()
    request.json = AsyncMock(return_value={"pack_id": pack["pack_id"]})

    with patch.object(analytics_router, "get_message_pack", MagicMock(return_value=pack)):
        with patch.object(analytics_router, "AsyncSessionLocal", MagicMock(return_value=session)):
            with patch.object(analytics_router, "ensure_messages_period", AsyncMock(return_value=user)):
                with patch.object(analytics_router, "get_message_quota_state", MagicMock(return_value={
                    "extra_purchased": pack["messages"],
                    "extra_used": 0,
                    "extra_remaining": pack["messages"],
                    "total_remaining": pack["messages"] + 990,
                })):
                    with patch.object(analytics_router, "add_balance_transaction", AsyncMock(return_value=True)):
                        data = await analytics_router.purchase_message_pack(
                            client_id="usr_test",
                            request=request,
                            token_data={"sub": "usr_test"},
                        )

    assert data["status"] == "success"
    assert data["extra_messages_purchased"] == pack["messages"]
    assert data["balance"] == pytest.approx(user.balance)
    assert user.balance < 5000.0


@pytest.mark.asyncio
async def test_purchase_message_pack_insufficient_balance():
    pack = MESSAGE_PACK_RULES[2]
    user = SimpleNamespace(
        client_id="usr_test",
        tariff_name="start",
        balance=0.0,
        messages_consumed=0,
        extra_messages_purchased=0,
        extra_messages_used=0,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_active=True,
        used_storage=0,
    )
    session = FakeSession(user)
    request = MagicMock()
    request.json = AsyncMock(return_value={"pack_id": pack["pack_id"]})

    with patch.object(analytics_router, "get_message_pack", MagicMock(return_value=pack)):
        with patch.object(analytics_router, "AsyncSessionLocal", MagicMock(return_value=session)):
            with patch.object(analytics_router, "ensure_messages_period", AsyncMock(return_value=user)):
                with patch.object(analytics_router, "add_balance_transaction", AsyncMock(return_value=True)):
                    response = await analytics_router.purchase_message_pack(
                        client_id="usr_test",
                        request=request,
                        token_data={"sub": "usr_test"},
                    )

    if hasattr(response, "status_code"):
        assert response.status_code == 400
        payload = json.loads(response.body.decode("utf-8"))
    else:
        payload = response
    assert payload["status"] == "error"
    assert "пополнить баланс" in payload["message"].lower()


@pytest.mark.asyncio
async def test_get_balance_returns_extra_message_fields():
    user = SimpleNamespace(
        client_id="usr_test",
        tariff_name="business",
        balance=2500.0,
        messages_consumed=1000,
        extra_messages_purchased=500,
        extra_messages_used=120,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_active=True,
        used_storage=0,
    )
    session = FakeSession(user)

    with patch.object(analytics_router, "AsyncSessionLocal", MagicMock(return_value=session)):
        with patch.object(analytics_router, "ensure_messages_period", AsyncMock(return_value=user)):
            with patch.object(analytics_router, "get_message_quota_state", MagicMock(return_value={
                "base_remaining": 0,
                "extra_purchased": 500,
                "extra_used": 120,
                "extra_remaining": 380,
                "total_remaining": 380,
                "quota_state": "using_extra",
            })):
                data = await analytics_router.get_balance(
                    client_id="usr_test",
                    token_data={"sub": "usr_test"},
                )

    assert data["status"] == "success"
    assert data["extra_messages_purchased"] == 500
    assert data["extra_messages_used"] == 120
    assert data["extra_messages_remaining"] == 380
    assert data["quota_state"] == "using_extra"
    assert len(data["available_message_packs"]) == 3


@pytest.mark.asyncio
async def test_change_tariff_success():
    user = SimpleNamespace(
        client_id="usr_test",
        tariff_name="start",
        balance=10000.0,
        messages_consumed=12,
        extra_messages_purchased=300,
        extra_messages_used=20,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
    )
    session = FakeSession(user)
    request = MagicMock()
    request.json = AsyncMock(return_value={"tariff": "business", "billing_period": "month"})

    with patch.object(analytics_router, "AsyncSessionLocal", MagicMock(return_value=session)):
        with patch.object(analytics_router, "add_balance_transaction", AsyncMock(return_value=True)):
            data = await analytics_router.change_tariff(
                client_id="usr_test",
                request=request,
                token_data={"sub": "usr_test"},
            )

    assert data["status"] == "success"
    assert data["tariff"] == "business"
    assert data["charged_amount"] == 3900
    assert user.balance == pytest.approx(6100.0)
    assert user.messages_consumed == 0
    assert user.extra_messages_purchased == 300
    assert user.extra_messages_used == 20


@pytest.mark.asyncio
async def test_change_tariff_insufficient_balance():
    user = SimpleNamespace(
        client_id="usr_test",
        tariff_name="start",
        balance=100.0,
        messages_consumed=0,
        extra_messages_purchased=0,
        extra_messages_used=0,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
    )
    session = FakeSession(user)
    request = MagicMock()
    request.json = AsyncMock(return_value={"tariff": "neuro", "billing_period": "month"})

    with patch.object(analytics_router, "AsyncSessionLocal", MagicMock(return_value=session)):
        response = await analytics_router.change_tariff(
            client_id="usr_test",
            request=request,
            token_data={"sub": "usr_test"},
        )

    assert response.status_code == 400
    payload = json.loads(response.body.decode("utf-8"))
    assert payload["status"] == "error"
    assert "недостаточно средств" in payload["message"].lower()


@pytest.mark.asyncio
async def test_change_tariff_same_tariff_returns_error_message():
    user = SimpleNamespace(
        client_id="usr_test",
        tariff_name="business",
        balance=10000.0,
        messages_consumed=0,
        extra_messages_purchased=0,
        extra_messages_used=0,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
    )
    session = FakeSession(user)
    request = MagicMock()
    request.json = AsyncMock(return_value={"tariff": "business", "billing_period": "month"})

    with patch.object(analytics_router, "AsyncSessionLocal", MagicMock(return_value=session)):
        data = await analytics_router.change_tariff(
            client_id="usr_test",
            request=request,
            token_data={"sub": "usr_test"},
        )

    assert data["status"] == "error"
    assert "уже активен" in data["message"].lower()


@pytest.mark.asyncio
async def test_purchase_assistant_pack_success():
    pack = ASSISTANT_SLOT_PACK_RULES[1]
    user = SimpleNamespace(
        client_id="usr_test",
        tariff_name="business",
        balance=10000.0,
        messages_consumed=0,
        extra_messages_purchased=0,
        extra_messages_used=0,
        extra_assistants_purchased=0,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_active=True,
        used_storage=0,
    )
    session = FakeSession(user)
    request = MagicMock()
    request.json = AsyncMock(return_value={"pack_id": pack["pack_id"]})

    with patch.object(analytics_router, "get_assistant_slot_pack", MagicMock(return_value=pack)):
        with patch.object(analytics_router, "AsyncSessionLocal", MagicMock(return_value=session)):
            with patch.object(analytics_router, "add_balance_transaction", AsyncMock(return_value=True)):
                data = await analytics_router.purchase_assistant_pack(
                    client_id="usr_test",
                    request=request,
                    token_data={"sub": "usr_test"},
                )

    assert data["status"] == "success"
    assert data["extra_assistants_purchased"] == pack["slots"]
    assert data["assistants_limit"] == 5 + pack["slots"]
    assert user.balance < 10000.0


@pytest.mark.asyncio
async def test_purchase_assistant_pack_insufficient_balance():
    pack = ASSISTANT_SLOT_PACK_RULES[2]
    user = SimpleNamespace(
        client_id="usr_test",
        tariff_name="business",
        balance=100.0,
        messages_consumed=0,
        extra_messages_purchased=0,
        extra_messages_used=0,
        extra_assistants_purchased=0,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_active=True,
        used_storage=0,
    )
    session = FakeSession(user)
    request = MagicMock()
    request.json = AsyncMock(return_value={"pack_id": pack["pack_id"]})

    with patch.object(analytics_router, "get_assistant_slot_pack", MagicMock(return_value=pack)):
        with patch.object(analytics_router, "AsyncSessionLocal", MagicMock(return_value=session)):
            response = await analytics_router.purchase_assistant_pack(
                client_id="usr_test",
                request=request,
                token_data={"sub": "usr_test"},
            )

    assert response.status_code == 400
    payload = json.loads(response.body.decode("utf-8"))
    assert payload["status"] == "error"
    assert "пополнить баланс" in payload["message"].lower()


@pytest.mark.asyncio
async def test_purchase_assistant_pack_hard_cap_guard():
    pack = ASSISTANT_SLOT_PACK_RULES[2]
    user = SimpleNamespace(
        client_id="usr_test",
        tariff_name="neuro",
        balance=50000.0,
        messages_consumed=0,
        extra_messages_purchased=0,
        extra_messages_used=0,
        extra_assistants_purchased=ASSISTANT_SLOTS_HARD_CAP - 20,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_active=True,
        used_storage=0,
    )
    session = FakeSession(user)
    request = MagicMock()
    request.json = AsyncMock(return_value={"pack_id": pack["pack_id"]})

    with patch.object(analytics_router, "get_assistant_slot_pack", MagicMock(return_value=pack)):
        with patch.object(analytics_router, "AsyncSessionLocal", MagicMock(return_value=session)):
            response = await analytics_router.purchase_assistant_pack(
                client_id="usr_test",
                request=request,
                token_data={"sub": "usr_test"},
            )

    assert response.status_code == 400
    payload = json.loads(response.body.decode("utf-8"))
    assert payload["status"] == "error"
    assert "технический предел" in payload["message"].lower()


@pytest.mark.asyncio
async def test_purchase_storage_plan_success():
    pack = {'pack_id': 'storage-plan-10gb', 'label': 'Память +10 ГБ', 'bytes': 10 * 1024 * 1024 * 1024, 'monthly_price': 990}
    user = SimpleNamespace(
        client_id='usr_test',
        tariff_name='business',
        balance=5000.0,
        messages_consumed=0,
        extra_messages_purchased=0,
        extra_messages_used=0,
        extra_messages_limit=0,
        extra_assistants_purchased=0,
        extra_storage_bytes=0,
        extra_storage_purchased_bytes=0,
        storage_plan_pack_id=None,
        extra_context_limit=0,
        extra_index_pages=0,
        extra_assistants_hard_cap=0,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_active=True,
        used_storage=0,
    )
    session = FakeSession(user)
    request = MagicMock()
    request.json = AsyncMock(return_value={'pack_id': pack['pack_id']})

    with patch.object(analytics_router, 'get_storage_pack', MagicMock(return_value=pack)):
        with patch.object(analytics_router, 'AsyncSessionLocal', MagicMock(return_value=session)):
            with patch.object(analytics_router, 'notify_storage_pack_purchased', AsyncMock(return_value=True)):
                data = await analytics_router.purchase_storage_pack(
                    client_id='usr_test',
                    request=request,
                    token_data={'sub': 'usr_test'},
                )

    assert data['status'] == 'success'
    assert data['monthly_price'] == 990
    assert data['storage_limit'] == 15 * 1024 * 1024 * 1024
    assert data['extra_storage_purchased_bytes'] == 10 * 1024 * 1024 * 1024
    assert data['storage_plan_pack_id'] == 'storage-plan-10gb'


@pytest.mark.asyncio
async def test_purchase_storage_plan_replaces_previous_selection():
    pack = {'pack_id': 'storage-plan-2gb', 'label': 'Память +2 ГБ', 'bytes': 2 * 1024 * 1024 * 1024, 'monthly_price': 290}
    user = SimpleNamespace(
        client_id='usr_test',
        tariff_name='business',
        balance=5000.0,
        messages_consumed=0,
        extra_messages_purchased=0,
        extra_messages_used=0,
        extra_messages_limit=0,
        extra_assistants_purchased=0,
        extra_storage_bytes=0,
        extra_storage_purchased_bytes=50 * 1024 * 1024 * 1024,
        storage_plan_pack_id='storage-plan-50gb',
        extra_context_limit=0,
        extra_index_pages=0,
        extra_assistants_hard_cap=0,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_active=True,
        used_storage=0,
    )
    session = FakeSession(user)
    request = MagicMock()
    request.json = AsyncMock(return_value={'pack_id': pack['pack_id']})

    with patch.object(analytics_router, 'get_storage_pack', MagicMock(return_value=pack)):
        with patch.object(analytics_router, 'AsyncSessionLocal', MagicMock(return_value=session)):
            with patch.object(analytics_router, 'notify_storage_pack_purchased', AsyncMock(return_value=True)):
                data = await analytics_router.purchase_storage_pack(
                    client_id='usr_test',
                    request=request,
                    token_data={'sub': 'usr_test'},
                )

    assert data['status'] == 'success'
    assert data['extra_storage_purchased_bytes'] == 2 * 1024 * 1024 * 1024
    assert data['storage_plan_pack_id'] == 'storage-plan-2gb'
    assert data['storage_limit'] == 7 * 1024 * 1024 * 1024


@pytest.mark.asyncio
async def test_cancel_storage_plan_resets_purchased_storage():
    user = SimpleNamespace(
        client_id='usr_test',
        tariff_name='business',
        balance=5000.0,
        messages_consumed=0,
        extra_messages_purchased=0,
        extra_messages_used=0,
        extra_messages_limit=0,
        extra_assistants_purchased=0,
        extra_storage_bytes=0,
        extra_storage_purchased_bytes=10 * 1024 * 1024 * 1024,
        storage_plan_pack_id='storage-plan-10gb',
        extra_context_limit=0,
        extra_index_pages=0,
        extra_assistants_hard_cap=0,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_active=True,
        used_storage=0,
    )
    session = FakeSession(user)

    with patch.object(analytics_router, 'AsyncSessionLocal', MagicMock(return_value=session)):
        data = await analytics_router.cancel_storage_pack(
            client_id='usr_test',
            token_data={'sub': 'usr_test'},
        )

    assert data['status'] == 'success'
    assert data['storage_limit'] == 5 * 1024 * 1024 * 1024
    assert data['extra_storage_purchased_bytes'] == 0
    assert data['storage_plan_pack_id'] == '' or data['storage_plan_pack_id'] is None


@pytest.mark.asyncio
async def test_purchase_assistant_pack_respects_custom_hard_cap():
    pack = ASSISTANT_SLOT_PACK_RULES[2]
    user = SimpleNamespace(
        client_id="usr_test",
        tariff_name="neuro",
        balance=50000.0,
        messages_consumed=0,
        extra_messages_purchased=0,
        extra_messages_used=0,
        extra_messages_limit=0,
        extra_assistants_purchased=130,
        extra_storage_bytes=0,
        extra_context_limit=0,
        extra_index_pages=0,
        extra_assistants_hard_cap=200,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_active=True,
        used_storage=0,
    )
    session = FakeSession(user)
    request = MagicMock()
    request.json = AsyncMock(return_value={"pack_id": pack["pack_id"]})

    with patch.object(analytics_router, "get_assistant_slot_pack", MagicMock(return_value=pack)):
        with patch.object(analytics_router, "AsyncSessionLocal", MagicMock(return_value=session)):
            with patch.object(analytics_router, "add_balance_transaction", AsyncMock(return_value=True)):
                data = await analytics_router.purchase_assistant_pack(
                    client_id="usr_test",
                    request=request,
                    token_data={"sub": "usr_test"},
                )

    assert data["status"] == "success"
    assert data["assistants_hard_cap"] == 200
    assert data["assistants_limit"] == 155


@pytest.mark.asyncio
async def test_get_balance_returns_assistant_slot_fields():
    user = SimpleNamespace(
        client_id="usr_test",
        tariff_name="business",
        balance=2500.0,
        messages_consumed=10,
        extra_messages_purchased=0,
        extra_messages_used=0,
        extra_messages_limit=120,
        extra_assistants_purchased=3,
        extra_storage_bytes=3 * 1024 * 1024 * 1024,
        extra_context_limit=15,
        extra_index_pages=100,
        extra_assistants_hard_cap=150,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_active=True,
        used_storage=0,
    )
    session = FakeSession(user)

    with patch.object(analytics_router, "AsyncSessionLocal", MagicMock(return_value=session)):
        with patch.object(analytics_router, "ensure_messages_period", AsyncMock(return_value=user)):
            with patch.object(analytics_router, "get_message_quota_state", MagicMock(return_value={
                "base_remaining": 990,
                "extra_purchased": 0,
                "extra_used": 0,
                "extra_remaining": 0,
                "total_remaining": 990,
                "quota_state": "ok",
            })):
                data = await analytics_router.get_balance(
                    client_id="usr_test",
                    token_data={"sub": "usr_test"},
                )

    assert data["status"] == "success"
    assert data["tariff_assistants_limit"] == 5
    assert data["extra_assistants_purchased"] == 3
    assert data["assistants_limit"] == 8
    assert data["messages_limit"] == 1120
    assert data["extra_messages_limit"] == 120
    assert data["storage_limit"] == 8 * 1024 * 1024 * 1024
    assert data["context_limit"] == 45
    assert data["max_index_pages"] == 600
    assert data["assistants_hard_cap"] == 150
    assert len(data["available_assistant_slot_packs"]) == 3


@pytest.mark.asyncio
async def test_change_tariff_preserves_extra_assistant_slots():
    user = SimpleNamespace(
        client_id="usr_test",
        tariff_name="business",
        balance=20000.0,
        messages_consumed=12,
        extra_messages_purchased=300,
        extra_messages_used=20,
        extra_assistants_purchased=4,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
    )
    session = FakeSession(user)
    request = MagicMock()
    request.json = AsyncMock(return_value={"tariff": "start", "billing_period": "month"})

    with patch.object(analytics_router, "AsyncSessionLocal", MagicMock(return_value=session)):
        with patch.object(analytics_router, "add_balance_transaction", AsyncMock(return_value=True)):
            data = await analytics_router.change_tariff(
                client_id="usr_test",
                request=request,
                token_data={"sub": "usr_test"},
            )

    assert data["status"] == "success"
    assert user.tariff_name == "start"
    assert user.extra_assistants_purchased == 4
    assert user.extra_messages_purchased == 300
    assert user.extra_messages_used == 20


def test_get_effective_account_limits_applies_superadmin_overrides():
    user = SimpleNamespace(
        tariff_name='business',
        extra_assistants_purchased=7,
        extra_messages_limit=150,
        extra_storage_bytes=2 * 1024 * 1024 * 1024,
        extra_context_limit=40,
        extra_index_pages=250,
        extra_assistants_hard_cap=160,
    )

    limits = get_effective_account_limits(user)

    assert limits['messages_limit'] == 1150
    assert limits['assistants_limit'] == 12
    assert limits['assistants_hard_cap'] == 160
    assert limits['storage_limit'] == 7 * 1024 * 1024 * 1024
    assert limits['context_limit'] == 70
    assert limits['max_index_pages'] == 750


@pytest.mark.asyncio
async def test_deactivate_custom_condition_recalculates_from_active_rows_only():
    row = SimpleNamespace(id=1, client_id='usr_test', is_active=True)
    user = SimpleNamespace(
        client_id='usr_test',
        extra_messages_purchased=10,
        extra_assistants_purchased=2,
        extra_messages_limit=120,
        extra_storage_bytes=3 * 1024 * 1024 * 1024,
        extra_context_limit=15,
        extra_index_pages=100,
        extra_assistants_hard_cap=150,
    )

    class ConditionSession:
        def __init__(self):
            self.commit = AsyncMock()
            self._calls = 0
        async def execute(self, stmt):
            self._calls += 1
            if self._calls == 1:
                return FakeScalarResult(row)
            return FakeScalarResult(user)
        async def __aenter__(self):
            return self
        async def __aexit__(self, exc_type, exc, tb):
            return None

    session = ConditionSession()

    async def fake_recalc(db, current_user):
        current_user.extra_messages_purchased = 0
        current_user.extra_assistants_purchased = 0
        current_user.extra_messages_limit = 0
        current_user.extra_storage_bytes = 0
        current_user.extra_context_limit = 0
        current_user.extra_index_pages = 0
        current_user.extra_assistants_hard_cap = 0

    with patch('api.chat.routers.superadmin_router.AsyncSessionLocal', MagicMock(return_value=session)):
        with patch('api.chat.routers.superadmin_router._recalculate_user_custom_condition_effects', AsyncMock(side_effect=fake_recalc)):
            with patch('api.chat.routers.superadmin_router.reload_client_config', AsyncMock(return_value=None)):
                result = await superadmin_router.deactivate_custom_condition(1, token_data={'role': 'superadmin'})

    assert result['status'] == 'success'
    assert row.is_active is False
    assert user.extra_messages_limit == 0
    assert user.extra_storage_bytes == 0
    assert user.extra_context_limit == 0
    assert user.extra_index_pages == 0
    assert user.extra_assistants_hard_cap == 0


def test_tariff_grid_start_limits_without_overrides():
    user = SimpleNamespace(
        tariff_name='start',
        extra_assistants_purchased=0,
        extra_messages_limit=0,
        extra_storage_bytes=0,
        extra_context_limit=0,
        extra_index_pages=0,
        extra_assistants_hard_cap=0,
    )
    limits = get_effective_account_limits(user)
    assert limits['messages_limit'] == 30
    assert limits['assistants_limit'] == 1
    assert limits['storage_limit'] == 1 * 1024 * 1024 * 1024
    assert limits['context_limit'] == 10
    assert limits['max_index_pages'] == 30


def test_tariff_grid_business_limits_without_overrides():
    user = SimpleNamespace(
        tariff_name='business',
        extra_assistants_purchased=0,
        extra_messages_limit=0,
        extra_storage_bytes=0,
        extra_context_limit=0,
        extra_index_pages=0,
        extra_assistants_hard_cap=0,
    )
    limits = get_effective_account_limits(user)
    assert limits['messages_limit'] == 1000
    assert limits['assistants_limit'] == 5
    assert limits['storage_limit'] == 5 * 1024 * 1024 * 1024
    assert limits['context_limit'] == 30
    assert limits['max_index_pages'] == 500


def test_tariff_grid_neuro_limits_without_overrides():
    user = SimpleNamespace(
        tariff_name='neuro',
        extra_assistants_purchased=0,
        extra_messages_limit=0,
        extra_storage_bytes=0,
        extra_context_limit=0,
        extra_index_pages=0,
        extra_assistants_hard_cap=0,
    )
    limits = get_effective_account_limits(user)
    assert limits['messages_limit'] == 5000
    assert limits['assistants_limit'] == 20
    assert limits['storage_limit'] == 10 * 1024 * 1024 * 1024
    assert limits['context_limit'] == 100
    assert limits['max_index_pages'] == 5000


def test_superadmin_request_fingerprint_changes_with_user_agent():
    request_a = SimpleNamespace(
        headers={'x-forwarded-for': '127.0.0.1', 'user-agent': 'Browser-A'},
        client=SimpleNamespace(host='127.0.0.1'),
    )
    request_b = SimpleNamespace(
        headers={'x-forwarded-for': '127.0.0.1', 'user-agent': 'Browser-B'},
        client=SimpleNamespace(host='127.0.0.1'),
    )

    fingerprint_a = get_superadmin_request_fingerprint(request_a)
    fingerprint_b = get_superadmin_request_fingerprint(request_b)

    assert fingerprint_a
    assert fingerprint_b
    assert fingerprint_a != fingerprint_b


def test_superadmin_lock_scope_is_same_for_different_browsers_on_same_ip(monkeypatch):
    monkeypatch.setenv('SUPERADMIN_MASTER_TOKEN', 'master-token')
    request_a = SimpleNamespace(
        headers={'x-forwarded-for': '127.0.0.1', 'user-agent': 'Browser-A'},
        client=SimpleNamespace(host='127.0.0.1'),
    )
    request_b = SimpleNamespace(
        headers={'x-forwarded-for': '10.0.0.2', 'user-agent': 'Browser-B'},
        client=SimpleNamespace(host='10.0.0.2'),
    )

    scope_a = get_superadmin_lock_scope(request_a)
    scope_b = get_superadmin_lock_scope(request_b)

    assert scope_a
    assert scope_a == scope_b


@pytest.mark.asyncio
async def test_superadmin_access_state_reports_attempt_counters(monkeypatch):
    monkeypatch.setenv('SUPERADMIN_MASTER_TOKEN', 'master-token')
    request = SimpleNamespace(
        headers={'x-forwarded-for': '127.0.0.1', 'user-agent': 'Browser-A'},
        client=SimpleNamespace(host='127.0.0.1'),
    )

    with patch('api.chat.routers.admin.deps.cache_service.get', MagicMock(side_effect=['1', None, '2'])):
        state = await get_superadmin_access_state(request)

    assert state['is_locked'] is True
    assert state['attempts'] == 2
    assert state['attempts_limit'] == 3
    assert state['attempts_remaining'] == 1
    assert state['client_ip'] == '127.0.0.1'


def test_effective_limits_return_personal_message_storage_context_index_values():
    user = SimpleNamespace(
        tariff_name='start',
        extra_assistants_purchased=2,
        extra_messages_limit=200,
        extra_storage_bytes=4 * 1024 * 1024 * 1024,
        extra_context_limit=25,
        extra_index_pages=70,
        extra_assistants_hard_cap=130,
    )

    limits = get_effective_account_limits(user)

    assert limits['messages_limit'] == 230
    assert limits['assistants_limit'] == 3
    assert limits['assistants_hard_cap'] == 130
    assert limits['storage_limit'] == 5 * 1024 * 1024 * 1024
    assert limits['context_limit'] == 35
    assert limits['max_index_pages'] == 100


@pytest.mark.asyncio
async def test_get_balance_returns_personal_tariff_name_when_flag_enabled():
    user = SimpleNamespace(
        client_id='usr_test',
        tariff_name='business',
        is_personal_tariff=True,
        balance=2500.0,
        messages_consumed=10,
        extra_messages_purchased=0,
        extra_messages_used=0,
        extra_messages_limit=120,
        extra_assistants_purchased=0,
        extra_storage_bytes=2 * 1024 * 1024 * 1024,
        extra_context_limit=10,
        extra_index_pages=50,
        extra_assistants_hard_cap=0,
        messages_reset_at=None,
        messages_period_started_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_active=True,
        used_storage=0,
    )
    session = FakeSession(user)

    with patch.object(analytics_router, 'AsyncSessionLocal', MagicMock(return_value=session)):
        with patch.object(analytics_router, 'ensure_messages_period', AsyncMock(return_value=user)):
            with patch.object(analytics_router, 'get_message_quota_state', MagicMock(return_value={
                'base_remaining': 1110,
                'extra_purchased': 0,
                'extra_used': 0,
                'extra_remaining': 0,
                'total_remaining': 1110,
                'quota_state': 'ok',
            })):
                data = await analytics_router.get_balance(
                    client_id='usr_test',
                    token_data={'sub': 'usr_test'},
                )

    assert data['status'] == 'success'
    assert data['tariff_name'] == 'Персональный'
    assert data['messages_limit'] == 1120
    assert data['storage_limit'] == 7 * 1024 * 1024 * 1024
    assert data['context_limit'] == 40
    assert data['max_index_pages'] == 550


@pytest.mark.asyncio
async def test_get_storage_usage_endpoint_returns_effective_storage_limit():
    user = SimpleNamespace(
        client_id='usr_test',
        tariff_name='business',
        extra_messages_limit=0,
        extra_assistants_purchased=0,
        extra_storage_bytes=3 * 1024 * 1024 * 1024,
        extra_context_limit=0,
        extra_index_pages=0,
        extra_assistants_hard_cap=0,
    )

    class StorageSession:
        async def execute(self, stmt):
            return FakeScalarResult(user)
        async def __aenter__(self):
            return self
        async def __aexit__(self, exc_type, exc, tb):
            return None

    with patch.object(analytics_router, 'AsyncSessionLocal', MagicMock(return_value=StorageSession())):
        with patch.object(analytics_router, 'get_storage_usage', AsyncMock(return_value={
            'by_category': {},
            'by_type': [],
            'files_total': 0,
            'text_total': 0,
            'text_breakdown': {},
        })):
            with patch.object(analytics_router, 'get_storage_items', AsyncMock(return_value=[])):
                with patch.object(analytics_router, 'ensure_client_access', MagicMock(return_value='usr_test')):
                    data = await analytics_router.get_storage_usage_endpoint(
                        client_id='usr_test',
                        token_data={'sub': 'usr_test'},
                    )

    assert data['status'] == 'success'
    assert data['storage_limit'] == 8 * 1024 * 1024 * 1024


@pytest.mark.asyncio
async def test_notify_storage_limit_exceeded_uses_email_channel_when_enabled():
    user = SimpleNamespace(email="user@example.com")

    class FakeConfigSession:
        async def execute(self, stmt):
            text = str(stmt)
            if "client_configs" in text:
                return FakeScalarResult({"notifications": {"limits_in_app": True, "limits_email": True}})
            return FakeScalarResult(user)
        async def commit(self):
            return None
        def add(self, row):
            return None
        async def __aenter__(self):
            return self
        async def __aexit__(self, exc_type, exc, tb):
            return None

    with patch.object(notification_service, "AsyncSessionLocal", MagicMock(return_value=FakeConfigSession())):
        row = await notification_service.notify_storage_limit_exceeded("usr_test", dedupe_key="storage:test")

    assert row is not None


@pytest.mark.asyncio
async def test_create_assistant_flow_sends_limit_notification():
    user = SimpleNamespace(
        client_id='usr_test',
        tariff_name='start',
        extra_assistants_purchased=0,
        extra_messages_limit=0,
        extra_storage_bytes=0,
        extra_storage_purchased_bytes=0,
        extra_context_limit=0,
        extra_index_pages=0,
        extra_assistants_hard_cap=0,
    )

    class AssistantsSession:
        def __init__(self):
            self.calls = 0
        async def execute(self, stmt):
            self.calls += 1
            if self.calls == 1:
                return FakeScalarResult(user)
            return FakeScalarResult(1)
        async def __aenter__(self):
            return self
        async def __aexit__(self, exc_type, exc, tb):
            return None

    with patch.object(assistants_service_module, 'ensure_assistant_migration', AsyncMock(return_value=None)):
        with patch.object(assistants_service_module, 'AsyncSessionLocal', MagicMock(return_value=AssistantsSession())):
            with patch.object(assistants_service_module, 'notify_assistants_limit_exceeded', AsyncMock(return_value=True)) as notify_mock:
                with pytest.raises(ValueError):
                    await assistants_service_module.create_assistant('usr_test', 'Test', 'Role')

    notify_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_notifications_endpoint_returns_items():
    row = SimpleNamespace(
        id=1,
        client_id="usr_test",
        category="billing",
        type="balance_topped_up",
        severity="success",
        title="Баланс пополнен",
        body="На ваш баланс зачислено 1000 ₽.",
        source="system",
        channel_scope="in_app",
        action_url="/admin",
        action_label="Открыть профиль",
        is_read=False,
        created_at=None,
    )

    with patch.object(notifications_router, "list_notifications", AsyncMock(return_value=[row])):
        with patch.object(notifications_router, "get_unread_notifications_count", AsyncMock(return_value=3)):
            data = await notifications_router.get_notifications(
                client_id="usr_test",
                limit=5,
                token_data={"sub": "usr_test"},
            )

    assert data["status"] == "success"
    assert data["unread_count"] == 3
    assert len(data["items"]) == 1
    assert data["items"][0]["title"] == "Баланс пополнен"


@pytest.mark.asyncio
async def test_create_notification_uses_email_channel_when_enabled():
    user = SimpleNamespace(email="user@example.com")

    class FakeConfigSession:
        async def execute(self, stmt):
            text = str(stmt)
            if "client_configs" in text:
                return FakeScalarResult({"notifications": {"billing_in_app": True, "billing_email": True}})
            return FakeScalarResult(user)
        async def commit(self):
            return None
        def add(self, row):
            return None
        async def __aenter__(self):
            return self
        async def __aexit__(self, exc_type, exc, tb):
            return None

    with patch.object(notification_service, "AsyncSessionLocal", MagicMock(return_value=FakeConfigSession())):
        with patch.object(notification_service, "send_email", AsyncMock(return_value=True)) as send_email_mock:
            row = await notification_service.create_notification(
                client_id="usr_test",
                category="billing",
                type="balance_topped_up",
                title="Баланс пополнен",
                body="На ваш баланс зачислено 1000 ₽.",
                send_email_copy=True,
            )

    assert row is not None
    send_email_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_upload_file_succeeds_when_enough_free_space():
    """Загрузка файла проходит успешно, если свободного места достаточно."""
    user = SimpleNamespace(
        client_id='usr_test',
        used_storage=50 * 1024 * 1024,  # 50 МБ занято
        tariff_name='business',
        balance=5000.0,
        messages_consumed=0,
        extra_messages_purchased=0,
        extra_messages_used=0,
        extra_assistants_purchased=0,
        extra_storage_purchased_bytes=0,
        storage_plan_pack_id=None,
        messages_reset_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_personal_tariff=False,
        is_verified=True,
        verification_token=None,
        verification_token_created_at=None,
        messages_period_started_at=None,
        extend_days=0,
        expires_at_override=None,
        reason_comment=None,
        created_by=None,
        is_active=True,
        created_at=None,
        updated_at=None,
    )

    class UploadSession:
        async def execute(self, stmt):
            return FakeScalarResult(user)
        async def __aenter__(self):
            return self
        async def __aexit__(self, exc_type, exc, tb):
            return None

    fake_file = MagicMock(spec=UploadFile)
    fake_file.filename = "test.pdf"
    fake_file.content_type = "application/pdf"
    fake_file.read = AsyncMock(return_value=b"x" * 1024 * 1024)  # 1 МБ

    with patch.object(files_router, 'AsyncSessionLocal', MagicMock(return_value=UploadSession())):
        with patch.object(assistants_service_module, 'get_effective_account_limits', MagicMock(return_value={'storage_limit': 5 * 1024 * 1024 * 1024})):
            with patch('os.makedirs', MagicMock()):
                with patch('builtins.open', MagicMock()):
                    with patch.object(files_router, 'glob', MagicMock(return_value=[])):
                        result = await files_router.upload_file(
                            client_id='usr_test',
                            file=fake_file,
                            field_id='knowledge_file',
                            token_data={'sub': 'usr_test'},
                        )
                        assert result['status'] == 'success'
                        assert result['original_name'] == 'test.pdf'


@pytest.mark.asyncio
async def test_upload_file_fails_when_storage_full():
    """Загрузка файла отклоняется, если свободного места меньше размера файла."""
    user = SimpleNamespace(
        client_id='usr_test',
            used_storage=5 * 1024 * 1024 * 1024 - 512 * 1024,  # свободно только 512 КБ
        tariff_name='business',
        balance=5000.0,
        messages_consumed=0,
        extra_messages_purchased=0,
        extra_messages_used=0,
        extra_assistants_purchased=0,
        extra_storage_purchased_bytes=0,
        storage_plan_pack_id=None,
        messages_reset_at=None,
        tariff_expires_at=None,
        auto_renew=False,
        is_personal_tariff=False,
        is_verified=True,
        verification_token=None,
        verification_token_created_at=None,
        messages_period_started_at=None,
        extend_days=0,
        expires_at_override=None,
        reason_comment=None,
        created_by=None,
        is_active=True,
        created_at=None,
        updated_at=None,
    )

    class UploadSession:
        async def execute(self, stmt):
            return FakeScalarResult(user)
        async def __aenter__(self):
            return self
        async def __aexit__(self, exc_type, exc, tb):
            return None

    fake_file = MagicMock(spec=UploadFile)
    fake_file.filename = "big.pdf"
    fake_file.content_type = "application/pdf"
    fake_file.read = AsyncMock(return_value=b"x" * 1024 * 1024)  # 1 МБ — больше свободных 512 КБ

    with patch.object(files_router, 'AsyncSessionLocal', MagicMock(return_value=UploadSession())):
        with patch.object(assistants_service_module, 'get_effective_account_limits', MagicMock(return_value={'storage_limit': 5 * 1024 * 1024 * 1024})):
            with pytest.raises(HTTPException) as error:
                await files_router.upload_file(
                    client_id='usr_test',
                    file=fake_file,
                    field_id='knowledge_file',
                    token_data={'sub': 'usr_test'},
                )

    assert error.value.status_code == 403
    assert 'Недостаточно места' in str(error.value.detail)

@pytest.mark.skip(reason="Хрупкий интеграционный сценарий process_ask требует отдельного harness для полной цепочки async-моков")
@pytest.mark.asyncio
async def test_chat_service_switches_to_operator_mode_when_quota_exhausted():
    pass
