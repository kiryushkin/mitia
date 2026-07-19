from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import JSONResponse
import httpx
import uuid
import base64
from decimal import Decimal, InvalidOperation
from ..core.config import log, PUBLIC_APP_URL, YOOKASSA_CONFIG
from ..routers.admin.deps import verify_token
from ..services.db_service import credit_balance_once, get_balance_transactions, get_user_by_client_id
from ..services.notification_service import notify_balance_topped_up

router = APIRouter(prefix="/api/payments", tags=["payments"])

@router.post("/create")
async def create_payment(request: Request, token_data: dict = Depends(verify_token)):
    """Создание платежа в ЮKassa."""
    try:
        data = await request.json()
        raw_amount = data.get("amount")
        requested_client_id = str(data.get("client_id") or "").strip()
        token_client_id = str(token_data.get("sub") or "").strip()
        is_superadmin = token_data.get("role") == "superadmin"

        if not token_client_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        if requested_client_id and requested_client_id != token_client_id and not is_superadmin:
            raise HTTPException(status_code=403, detail="Access denied")

        client_id = requested_client_id if is_superadmin and requested_client_id else token_client_id
        try:
            amount = Decimal(str(raw_amount))
        except (InvalidOperation, TypeError, ValueError):
            amount = Decimal("0")

        if amount < Decimal("0.01") or amount > Decimal("1000000") or amount.as_tuple().exponent < -2:
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": "Invalid amount"}
            )

        amount_value = f"{amount:.2f}"
        log.info(f"[PAYMENT] Create request: amount={amount_value}, client_id={client_id}")

        from ..services.integrations_service import get_integration_settings
        user_yk = await get_integration_settings(client_id, 'yookassa')
        
        if user_yk.get('enabled') and user_yk.get('shop_id') and user_yk.get('secret_key'):
            shop_id = user_yk['shop_id']
            secret_key = user_yk['secret_key']
        else:
            shop_id = YOOKASSA_CONFIG.get("shop_id")
            secret_key = YOOKASSA_CONFIG.get("secret_key")
        
        if not shop_id or not secret_key:
            return JSONResponse(
                status_code=500, 
                content={"success": False, "error": "Yookassa config missing"}
            )

        auth_str = f"{shop_id}:{secret_key}"
        auth_b64 = base64.b64encode(auth_str.encode()).decode()
        
        idempotence_key = str(uuid.uuid4())
        user = await get_user_by_client_id(client_id)
        customer_email = str(getattr(user, "email", "") or "").strip()
        if not customer_email:
            return JSONResponse(
                status_code=400,
                content={"success": False, "error": "Для оплаты укажите email в профиле аккаунта"},
            )

        payload = {
            "amount": {
                "value": amount_value,
                "currency": "RUB"
            },
            "confirmation": {
                "type": "redirect",
                "return_url": f"{PUBLIC_APP_URL}/admin?client_id={client_id}&tab=profile"
            },
            "capture": True,
            "description": f"Пополнение баланса Mitia: {client_id}",
            "receipt": {
                "customer": {"email": customer_email},
                "items": [{
                    "description": "Пополнение баланса MITIA",
                    "quantity": "1.00",
                    "amount": {"value": amount_value, "currency": "RUB"},
                    "vat_code": 1,
                    "payment_subject": "service",
                    "payment_mode": "full_prepayment",
                }],
            },
            "metadata": {
                "client_id": client_id
            }
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.yookassa.ru/v3/payments",
                json=payload,
                headers={
                    "Authorization": f"Basic {auth_b64}",
                    "Idempotence-Key": idempotence_key,
                    "Content-Type": "application/json"
                }
            )
            
            res_data = response.json()
            
            if response.status_code != 200:
                log.error(f"Yookassa API Error: {res_data}")
                return JSONResponse(status_code=response.status_code, content=res_data)
                
            return {
                "success": True,
                "confirmation_url": res_data["confirmation"]["confirmation_url"],
                "payment_id": res_data["id"]
            }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        err_trace = traceback.format_exc()
        log.error(f"Create Payment Error: {e}\n{err_trace}")
        return JSONResponse(status_code=500, content={"success": False, "error": "Payment creation failed"})

async def create_payment_internal(client_id: str, amount: int, description: str, return_url: str = None):
    """Внутренняя функция для создания платежа (вызывается из AI)."""
    log.info(f"Internal payment call: client={client_id}, amount={amount}")
    try:
        from ..services.integrations_service import get_integration_settings
        user_yk = await get_integration_settings(client_id, 'yookassa')
        
        if not user_yk.get('enabled') or not user_yk.get('shop_id') or not user_yk.get('secret_key'):
            log.warning(f"!!! YOOKASSA_NOT_CONFIGURED for {client_id}")
            return {"success": False, "error": "Интеграция ЮKassa не настроена"}

        shop_id = user_yk['shop_id']
        secret_key = user_yk['secret_key']
        auth_str = f"{shop_id}:{secret_key}"
        auth_b64 = base64.b64encode(auth_str.encode()).decode()
        
        if not return_url:
            return_url = user_yk.get('return_url')
            
        final_return_url = return_url or f"/admin-v2?client_id={client_id}&tab=profile"

        payload = {
            "amount": {"value": f"{amount}.00", "currency": "RUB"},
            "confirmation": {
                "type": "redirect",
                "return_url": final_return_url
            },
            "capture": True,
            "description": description,
            "metadata": {"client_id": client_id, "source": "ai_bot"}
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.yookassa.ru/v3/payments",
                json=payload,
                headers={
                    "Authorization": f"Basic {auth_b64}",
                    "Idempotence-Key": str(uuid.uuid4()),
                    "Content-Type": "application/json"
                }
            )
            res_data = response.json()
            log.info(f"Yookassa internal payment response: status={response.status_code}")
            
            if response.status_code != 200:
                return {"success": False, "error": res_data.get('description', 'Ошибка API')}
                
            return {
                "success": True,
                "confirmation_url": res_data["confirmation"]["confirmation_url"],
                "payment_id": res_data["id"]
            }
    except Exception as e:
        log.error(f"!!! INTERNAL_PAYMENT_EXCEPTION: {e}")
        return {"success": False, "error": str(e)}


@router.post("/yookassa/webhook")
async def yookassa_webhook(request: Request):
    """
    Обработка уведомлений от ЮKassa.
    """
    try:
        data = await request.json()
        event = data.get('event')
        obj = data.get('object', {})
        
        if event == 'payment.succeeded':
            payment_id = obj.get('id')
            client_id = obj.get('metadata', {}).get('client_id')
            source = obj.get('metadata', {}).get('source')

            if not payment_id or not client_id:
                log.warning(f"Webhook ignored: missing payment_id or client_id (payment_id={payment_id}, client_id={client_id})")
                return {"status": "ok"}

            # БЕЗОПАСНОСТЬ: не доверяем телу вебхука. Делаем обратный запрос в ЮKassa,
            # чтобы убедиться, что платёж реально существует и оплачен. Сумму берём из ответа API.
            from ..services.integrations_service import get_integration_settings
            user_yk = await get_integration_settings(client_id, 'yookassa')

            if user_yk.get('enabled') and user_yk.get('shop_id') and user_yk.get('secret_key'):
                shop_id = user_yk['shop_id']
                secret_key = user_yk['secret_key']
            else:
                shop_id = YOOKASSA_CONFIG.get("shop_id")
                secret_key = YOOKASSA_CONFIG.get("secret_key")

            if not shop_id or not secret_key:
                log.error(f"Webhook verification skipped: no Yookassa credentials for {client_id}")
                return {"status": "ok"}

            auth_b64 = base64.b64encode(f"{shop_id}:{secret_key}".encode()).decode()

            verified_amount = None
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(
                        f"https://api.yookassa.ru/v3/payments/{payment_id}",
                        headers={"Authorization": f"Basic {auth_b64}"},
                        timeout=15.0
                    )
                if resp.status_code != 200:
                    log.warning(f"Webhook verification failed: Yookassa returned {resp.status_code} for payment {payment_id}")
                    return {"status": "ok"}

                verified = resp.json()
                # Проверяем реальный статус, принадлежность клиенту и берём сумму из API
                if verified.get('status') != 'succeeded' or not verified.get('paid'):
                    log.warning(f"Webhook rejected: payment {payment_id} not succeeded/paid (status={verified.get('status')})")
                    return {"status": "ok"}

                verified_client_id = verified.get('metadata', {}).get('client_id')
                if verified_client_id != client_id:
                    log.warning(f"Webhook rejected: client_id mismatch (webhook={client_id}, api={verified_client_id})")
                    return {"status": "ok"}

                verified_amount = verified.get('amount', {}).get('value')
            except Exception as e:
                log.error(f"Webhook verification error for payment {payment_id}: {e}")
                return {"status": "ok"}

            if verified_amount:
                amount_value = float(verified_amount)
                credited = await credit_balance_once(
                    client_id=client_id,
                    amount=amount_value,
                    source="topup",
                    description="Пополнение баланса через ЮKassa",
                    external_id=payment_id,
                )
                if credited:
                    await notify_balance_topped_up(client_id, amount_value, source="yookassa")
                    log.info(f"Payment verified & credited: {payment_id} for {client_id}, amount: {verified_amount}, source: {source}")
                else:
                    log.info(f"Payment webhook already processed: {payment_id} for {client_id}")

        return {"status": "ok"}
    except Exception as e:
        log.error(f"Yookassa Webhook Error: {e}")
        return JSONResponse(status_code=400, content={"status": "error"})

@router.get("/status/{payment_id}")
async def get_payment_status(payment_id: str, token_data: dict = Depends(verify_token)):
    """Возвращает подтверждённый ЮKassa статус только владельцу платежа."""
    token_client_id = str(token_data.get("sub") or "").strip()
    if not token_client_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    shop_id = YOOKASSA_CONFIG.get("shop_id")
    secret_key = YOOKASSA_CONFIG.get("secret_key")
    if not shop_id or not secret_key:
        raise HTTPException(status_code=503, detail="Yookassa is not configured")

    auth_b64 = base64.b64encode(f"{shop_id}:{secret_key}".encode()).decode()
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.get(
            f"https://api.yookassa.ru/v3/payments/{payment_id}",
            headers={"Authorization": f"Basic {auth_b64}"},
        )
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Payment not found")
    if response.status_code != 200:
        log.warning("Payment status lookup failed: payment=%s status=%s", payment_id, response.status_code)
        raise HTTPException(status_code=502, detail="Could not verify payment")

    payment = response.json()
    if payment.get("metadata", {}).get("client_id") != token_client_id:
        raise HTTPException(status_code=403, detail="Access denied")

    amount = payment.get("amount", {}).get("value")
    credited = False
    if payment.get("status") == "succeeded" and payment.get("paid") and amount:
        credited = await credit_balance_once(
            client_id=token_client_id,
            amount=float(amount),
            source="topup",
            description="Пополнение баланса через ЮKassa",
            external_id=payment_id,
        )
        if credited:
            await notify_balance_topped_up(token_client_id, float(amount), source="yookassa")

    return {
        "payment_id": payment_id,
        "status": payment.get("status"),
        "paid": bool(payment.get("paid")),
        "amount": amount,
        "credited": credited,
    }


@router.get("/history")
async def get_payments_history(token_data: dict = Depends(verify_token)):
    """История пополнений баланса пользователя (дата + сумма)."""
    client_id = token_data.get("sub")
    if not client_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    transactions = await get_balance_transactions(client_id=client_id, limit=100)
    history = []
    for tx in transactions:
        history.append({
            "date": tx.created_at.strftime("%d.%m.%Y %H:%M") if tx.created_at else "-",
            "amount": int(tx.amount) if float(tx.amount).is_integer() else tx.amount,
            "source": tx.source,
            "description": tx.description
        })

    return {"status": "success", "history": history}
