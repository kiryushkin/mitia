from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import JSONResponse
import httpx
import uuid
import base64
from ..core.config import log, YOOKASSA_CONFIG
from ..routers.admin.deps import verify_token
from ..services.db_service import add_balance_transaction, get_balance_transactions

router = APIRouter(prefix="/api/payments", tags=["payments"])

@router.post("/create")
async def create_payment(request: Request):
    """Создание платежа в ЮKassa."""
    try:
        data = await request.json()
        amount = data.get("amount")
        client_id = data.get("client_id")
        
        log.info(f"[PAYMENT] Create request: amount={amount} (type={type(amount).__name__}), client_id={client_id}")
        
        if not amount or not client_id:
            log.warning(f"[PAYMENT] 400 Bad Request: amount={amount}, client_id={client_id}")
            return JSONResponse(
                status_code=400, 
                content={"success": False, "error": "Amount and client_id are required"}
            )

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
        
        payload = {
            "amount": {
                "value": f"{amount}.00",
                "currency": "RUB"
            },
            "confirmation": {
                "type": "redirect",
                "return_url": f"{request.base_url}admin-v2?client_id={client_id}&tab=profile"
            },
            "capture": True,
            "description": f"Пополнение баланса Mitia: {client_id}",
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

    except Exception as e:
        import traceback
        err_trace = traceback.format_exc()
        log.error(f"Create Payment Error: {e}\n{err_trace}")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

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
                from ..services.db_service import update_user_balance
                amount_value = float(verified_amount)
                await update_user_balance(client_id, -amount_value)
                await add_balance_transaction(
                    client_id=client_id,
                    amount=amount_value,
                    source="topup",
                    description="Пополнение баланса через ЮKassa",
                    external_id=payment_id
                )
                log.info(f"Payment verified & credited: {payment_id} for {client_id}, amount: {verified_amount}, source: {source}")

        return {"status": "ok"}
    except Exception as e:
        log.error(f"Yookassa Webhook Error: {e}")
        return JSONResponse(status_code=400, content={"status": "error"})

@router.get("/status/{payment_id}")
async def get_payment_status(payment_id: str):
    """Проверка статуса платежа (заглушка)."""
    return {"status": "pending", "payment_id": payment_id}


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
