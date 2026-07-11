import json
import re
from typing import Optional
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, update, text

from ...core.config import log, TARIFF_RULES
from ...services.db_service import (
    AsyncSessionLocal, User, ChatSession, ChatMessage, get_metrics_summary,
    AICache, get_ai_cache, save_ai_cache, get_user_by_client_id, update_user_balance,
    get_storage_usage, get_storage_items, get_storage_objects
)
from ...services.ai_service import ask_ai, generate_faq
from ...services.cache_service import cache_service
from .deps import verify_token

router = APIRouter()


async def run_ai_analysis_task(target_id: str, cache_key: str):
    """Фоновая задача для генерации рекомендаций и FAQ."""
    try:
        async with AsyncSessionLocal() as db:
            query = text("""
                SELECT m.role, m.content, m.session_id
                FROM chat_messages m
                WHERE m.session_id IN (
                    SELECT session_id FROM chat_sessions
                    WHERE client_id = :client_id AND is_deleted = false
                    ORDER BY start_time DESC LIMIT 30
                )
                ORDER BY m.id ASC
            """)
            result = await db.execute(query, {"client_id": target_id})
            rows = result.all()

            page_query = text("""
                SELECT source_url, COUNT(*) as count 
                FROM leads 
                WHERE client_id = :client_id
                GROUP BY source_url ORDER BY count DESC LIMIT 5
            """)
            page_res = await db.execute(page_query, {"client_id": target_id})
            top_pages = [{"url": r.source_url, "count": r.count} for r in page_res.all()]

            full_dialog_history = ""
            user_only_history = ""
            for r in reversed(rows):
                line = f"{'Клиент' if r.role == 'user' else 'Бот'}: {r.content}\n"
                full_dialog_history += line
                if r.role == 'user':
                    user_only_history += r.content + "\n"

        try:
            if len(user_only_history) < 10:
                result_data = {
                    "status": "success",
                    "traffic_analysis": "Недостаточно данных для анализа.",
                    "business_recommendations": "👋 **Добро пожаловать!**\n\nПока у вас мало диалогов. Как только клиенты начнут спрашивать о товарах и ценах, здесь появится глубокая бизнес-аналитика.",
                    "frequent_requests": [],
                    "top_pages": [],
                    "generated_at": datetime.now().isoformat()
                }
            else:
                frequent_requests, traffic_quality, spam_detected = await generate_faq(target_id, user_only_history)

                stop_patterns = ['привет', 'здравствуй', 'добрый день', 'добрый вечер', 'спасибо', 'благодарю', 'как дела', 'что нового', 'ты кто', 'кто ты', 'о платформе']
                business_keywords = ['цена', 'стоимость', 'сколько', 'как', 'где', 'когда', 'купить', 'заказать', 'услуг', 'срок', 'доставк', 'оплат', 'гарант']

                filtered_requests = []
                for item in frequent_requests:
                    q = item.get('question', '').strip()
                    q_lower = q.lower()
                    if any(p in q_lower for p in stop_patterns) and len(q) < 30:
                        continue
                    if len(q) < 10 and not any(bk in q_lower for bk in business_keywords):
                        continue
                    filtered_requests.append(item)
                frequent_requests = filtered_requests[:10]

                prompt = f"""Ты — Senior Business Analyst. Проанализируй диалоги и данные о страницах.
Твоя цель: найти точки роста прибыли и "дыры" в сервисе.

ДАННЫЕ:
1. Топ страниц, где открывали чат: {json.dumps(top_pages)}
2. История диалогов:
{full_dialog_history}

ВЫДАЙ АНАЛИЗ СТРОГО В ФОРМАТЕ JSON:
{{
  "lost_profit": "текст про упущенную выгоду",
  "barriers": "текст про барьеры",
  "strategy": "текст про стратегию",
  "sentiment": 85, (число от 0 до 100, где 100 - полный восторг клиентов)
  "hot_leads_count": 3 (сколько человек были максимально близки к покупке)
}}
Будь максимально конкретным. Не лей воду.
"""
                raw_recs = await ask_ai([{"role": "user", "content": prompt}])

                if not raw_recs:
                    raise ValueError("ask_ai returned None")

                try:
                    json_match = re.search(r'\{.*\}', raw_recs, re.DOTALL)
                    business_data = json.loads(json_match.group(0))
                except:
                    business_data = {
                        "lost_profit": (raw_recs or "")[:200],
                        "barriers": "Требуется ручной анализ",
                        "strategy": "Обновите базу знаний",
                        "sentiment": 70,
                        "hot_leads_count": 0
                    }

                result_data = {
                    "status": "success",
                    "traffic_analysis": traffic_quality,
                    "business_data": business_data,
                    "frequent_requests": frequent_requests,
                    "top_pages": top_pages,
                    "spam_detected": spam_detected,
                    "generated_at": datetime.now().isoformat()
                }
        except Exception as e:
            log.exception(f"Error during AI analysis for {target_id}: {e}")
            result_data = {
                "status": "success",
                "traffic_analysis": "Временная ошибка аналитики. Используется безопасный fallback.",
                "business_data": {
                    "lost_profit": "Недостаточно данных для расчета упущенной выгоды.",
                    "barriers": "Проверьте интеграции и накопите больше диалогов для точной аналитики.",
                    "strategy": "Соберите больше целевых обращений и повторите анализ позже.",
                    "sentiment": 70,
                    "hot_leads_count": 0
                },
                "frequent_requests": [],
                "top_pages": top_pages if 'top_pages' in locals() else [],
                "spam_detected": False,
                "generated_at": datetime.now().isoformat(),
                "fallback": True,
                "message": "Аналитика временно недоступна, показан базовый результат."
            }

        await save_ai_cache(target_id, cache_key, json.dumps(result_data))
        log.info(f"Background AI analysis completed for {target_id}")
    except Exception as e:
        log.error(f"Error in background AI analysis: {e}")


@router.post("/history/{token}/analyze")
async def analyze_conversation(token: str, client_id: str, token_data: dict = Depends(verify_token)):
    """Анализ диалога с помощью ИИ."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ChatMessage.content, ChatMessage.role)
            .where(ChatMessage.session_id == token)
            .order_by(ChatMessage.id)
        )
        rows = result.all()

    if not rows:
        return {"status": "error", "message": "Диалог пуст"}

    history_text = "\n".join([f"{r.role}: {r.content}" for r in rows])

    analysis = await ask_ai([
        {"role": "system", "content": "Ты — эксперт-аналитик. Проанализируй диалог и дай краткое резюме намерений клиента."},
        {"role": "user", "content": history_text}
    ])

    async with AsyncSessionLocal() as db:
        await db.execute(
            update(ChatSession)
            .where(ChatSession.session_id == token, ChatSession.client_id == client_id)
            .values(status='analyzed')
        )
        await db.commit()

    return {"status": "success", "analysis": analysis}


@router.get("/balance")
async def get_balance(client_id: str, token_data: dict = Depends(verify_token)):
    """Получение текущего баланса пользователя с проверкой срока тарифа."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()

        if user:
            tariff_info = TARIFF_RULES.get(user.tariff_name, TARIFF_RULES.get('start'))
            messages_limit = tariff_info.get('base_limit', 30)
            display_name = tariff_info.get('name', user.tariff_name)
            
            # Инициализация даты сброса сообщений, если её ещё нет
            reset_days = tariff_info.get('reset_period_days', 30)
            now = datetime.now()
            if user.messages_reset_at is None:
                user.messages_reset_at = now + timedelta(days=reset_days)
                await db.execute(
                    update(User).where(User.client_id == client_id).values(
                        messages_reset_at=user.messages_reset_at
                    )
                )
                await db.commit()
            elif user.messages_reset_at < now:
                new_reset_at = now + timedelta(days=reset_days)
                
                # Автоматический сброс счетчика сообщений делаем только для тарифа «Старт».
                # Для платных тарифов лимит не обнуляется просто так.
                update_values = {"messages_reset_at": new_reset_at}
                if user.tariff_name == 'start':
                    update_values["messages_consumed"] = 0
                    user.messages_consumed = 0
                    log.info(f"Messages counter reset for {client_id} (Start tariff)")
                
                await db.execute(
                    update(User).where(User.client_id == client_id).values(**update_values)
                )
                await db.commit()
                user.messages_reset_at = new_reset_at

            # Дату сброса лимита показываем только для бесплатного тарифа «Старт».
            # Для платных тарифов лимит — это пакет, который не обновляется сам по себе.
            show_reset_date = (user.tariff_name == 'start')

            return {
                "status": "success",
                "balance": user.balance,
                "tariff_name": display_name,
                "tariff_expires_at": user.tariff_expires_at.isoformat() if user.tariff_expires_at else None,
                "messages_consumed": user.messages_consumed,
                "messages_limit": messages_limit,
                "messages_reset_at": user.messages_reset_at.isoformat() if (user.messages_reset_at and show_reset_date) else None,
                "auto_renew": user.auto_renew,
                "is_active": user.is_active,
                "used_storage": user.used_storage,
                "storage_limit": tariff_info.get('storage_limit', 1 * 1024 * 1024 * 1024)
            }

    return {"status": "success", "balance": 0, "tariff_name": "Старт", "messages_consumed": 0, "is_active": True}


@router.get("/storage-usage")
async def get_storage_usage_endpoint(
    client_id: str,
    category: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    token_data: dict = Depends(verify_token)
):
    """Детализация хранилища: по категориям, по типам, текст, список файлов."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    usage = await get_storage_usage(client_id)
    files = await get_storage_items(client_id, category=category, limit=limit, offset=offset)
    items = await get_storage_objects(client_id, category=category, limit=limit, offset=offset)

    return {
        "status": "success",
        "summary": usage["by_category"],
        "by_type": usage["by_type"],
        "files_total": usage["files_total"],
        "text_total": usage["text_total"],
        "text_breakdown": usage["text_breakdown"],
        "files": files,
        "items": items
    }


@router.get("/metrics")
async def get_metrics(client_id: str, days: int = 7, token_data: dict = Depends(verify_token)):
    """Получение метрик для дашборда."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    target_id = client_id if client_id != 'default' else 'mitia_assistant'

    metrics = await get_metrics_summary(target_id)

    total_dialogs = metrics["total_dialogs"]
    total_leads = metrics["total_leads"]
    conversion_rate = round((total_leads / total_dialogs * 100), 1) if total_dialogs > 0 else 0

    return {
        "status": "success",
        "total_dialogs": total_dialogs,
        "total_leads": total_leads,
        "conversion_rate": conversion_rate
    }


@router.post("/change-tariff")
async def change_tariff(client_id: str, request: Request, token_data: dict = Depends(verify_token)):
    """Смена тарифного плана клиента."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    data = await request.json()
    new_tariff = data.get('tariff')

    if new_tariff not in TARIFF_RULES:
        raise HTTPException(status_code=400, detail="Invalid tariff name")

    tariff_info = TARIFF_RULES[new_tariff]
    tariff_price = tariff_info.get('price', 0)
    tariff_name_ru = tariff_info.get('name', new_tariff)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()

        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Не даём повторно выбрать тот же тариф
        if user.tariff_name == new_tariff:
            return {"status": "error", "message": f"Вы уже на тарифе «{tariff_name_ru}»"}

        # Для платных тарифов проверяем баланс и списываем
        if tariff_price > 0:
            if user.balance < tariff_price:
                return JSONResponse(
                    status_code=400,
                    content={"status": "error", "message": f"Недостаточно средств. Тариф «{tariff_name_ru}» стоит {tariff_price} ₽, у вас {user.balance:.0f} ₽"}
                )
            user.balance -= tariff_price
            user.tariff_expires_at = datetime.now() + timedelta(days=30)
        else:
            # Бесплатный тариф (Старт) — сбрасываем срок
            user.tariff_expires_at = None

        user.tariff_name = new_tariff
        user.messages_consumed = 0
        await db.commit()

    return {"status": "success", "message": f"Тариф изменён на «{tariff_name_ru}»"}


@router.post("/reindex")
async def reindex_site(client_id: str, token_data: dict = Depends(verify_token)):
    """Ручная переиндексация сайта (платная)."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    REINDEX_COST = 50.0

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.client_id == client_id))
        user = result.scalar_one_or_none()

        if not user or user.balance < REINDEX_COST:
            return JSONResponse(status_code=400, content={"status": "error", "message": "Недостаточно средств на балансе (нужно 50 ₽)"})

        user.balance -= REINDEX_COST
        await db.commit()

        log.info(f"Manual reindexing started for {client_id}. Cost: {REINDEX_COST}")

    return {"status": "success", "message": "Reindexing started"}


@router.get("/ai-recommendations")
async def get_ai_recommendations(
    client_id: str,
    background_tasks: BackgroundTasks,
    force: str = "false",
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    token_data: dict = Depends(verify_token)
):
    """
    Получение рекомендаций. 
    Автоматически генерируется бесплатно по понедельникам.
    При ручном нажатии (force=true) всегда списывается 49 руб.
    """
    is_force = force.lower() == "true"
    
    # Используем client_id из токена для обычных пользователей
    # Админы могут запрашивать данные других пользователей
    if token_data['sub'] != 'admin':
        # Обычный пользователь может видеть только свои данные
        target_id = token_data['sub']
    else:
        # Админ может запросить данные конкретного пользователя
        target_id = client_id if client_id != 'default' else 'mitia_assistant'

    # Режим фильтра по датам: возвращаем FAQ по выбранному диапазону.
    if date_from and date_to:
        try:
            from_dt = datetime.strptime(date_from, "%Y-%m-%d").date()
            to_dt = datetime.strptime(date_to, "%Y-%m-%d").date()
            if from_dt > to_dt:
                from_dt, to_dt = to_dt, from_dt
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date range format")

        range_cache_key = f"faq_range_{target_id}_{from_dt}_{to_dt}"
        cached_range = await get_ai_cache(target_id, range_cache_key)
        if cached_range:
            try:
                cached_payload = json.loads(cached_range)
                if isinstance(cached_payload, dict):
                    return cached_payload
            except Exception:
                log.warning(f"Invalid date-range cache payload for {target_id}, regenerating")

        try:
            async with AsyncSessionLocal() as db:
                query = text("""
                    SELECT m.role, m.content, m.timestamp::date AS day
                    FROM chat_messages m
                    JOIN chat_sessions s ON s.session_id = m.session_id
                    WHERE s.client_id = :client_id
                      AND s.is_deleted = false
                      AND m.timestamp::date >= :date_from
                      AND m.timestamp::date <= :date_to
                    ORDER BY m.timestamp ASC, m.id ASC
                """)
                result = await db.execute(query, {
                    "client_id": target_id,
                    "date_from": from_dt,
                    "date_to": to_dt
                })
                rows = result.all()

            user_only_history = ""
            user_history_by_day: dict[str, str] = {}
            for r in rows:
                if r.role == 'user' and r.content:
                    user_only_history += r.content + "\n"
                    day_key = r.day.isoformat() if r.day else None
                    if day_key:
                        user_history_by_day[day_key] = user_history_by_day.get(day_key, "") + r.content + "\n"

            if len(user_only_history.strip()) < 10:
                payload = {
                    "status": "success",
                    "frequent_requests": [],
                    "faq_by_day": [],
                    "date_from": str(from_dt),
                    "date_to": str(to_dt),
                    "range_mode": True
                }
                await save_ai_cache(target_id, range_cache_key, json.dumps(payload))
                return payload

            frequent_requests, _, _ = await generate_faq(target_id, user_only_history)

            stop_patterns = ['привет', 'здравствуй', 'добрый день', 'добрый вечер', 'спасибо', 'благодарю', 'как дела', 'что нового', 'ты кто', 'кто ты', 'о платформе']
            business_keywords = ['цена', 'стоимость', 'сколько', 'как', 'где', 'когда', 'купить', 'заказать', 'услуг', 'срок', 'доставк', 'оплат', 'гарант']

            filtered_requests = []
            for item in frequent_requests or []:
                q = (item.get('question') or item.get('q') or '').strip()
                q_lower = q.lower()
                if any(p in q_lower for p in stop_patterns) and len(q) < 30:
                    continue
                if len(q) < 10 and not any(bk in q_lower for bk in business_keywords):
                    continue
                filtered_requests.append(item)

            filtered_top = filtered_requests[:10]
            question_tokens: dict[str, list[str]] = {}
            for item in filtered_top:
                question = (item.get('question') or item.get('q') or '').strip()
                if not question:
                    continue
                tokens = [t for t in re.findall(r"[\wа-яА-ЯёЁ]+", question.lower()) if len(t) >= 4]
                if not tokens:
                    normalized = question.lower().strip()
                    if normalized:
                        tokens = [normalized]
                if tokens:
                    question_tokens[question] = sorted(set(tokens))

            faq_by_day = []
            for day_key in sorted(user_history_by_day.keys()):
                day_history = (user_history_by_day.get(day_key, "") or "").lower()
                if len(day_history.strip()) < 10 or not question_tokens:
                    faq_by_day.append({"date": day_key, "frequent_requests": []})
                    continue

                day_items = []
                for question, tokens in question_tokens.items():
                    score = 0
                    for token in tokens:
                        score += day_history.count(token)
                    if score > 0:
                        day_items.append({"q": question, "count": score})

                day_items.sort(key=lambda x: x.get("count", 0), reverse=True)
                faq_by_day.append({"date": day_key, "frequent_requests": day_items[:10]})

            payload = {
                "status": "success",
                "frequent_requests": filtered_top,
                "faq_by_day": faq_by_day,
                "date_from": str(from_dt),
                "date_to": str(to_dt),
                "range_mode": True,
                "generated_at": datetime.now().isoformat()
            }
            await save_ai_cache(target_id, range_cache_key, json.dumps(payload))
            return payload
        except Exception as e:
            log.error(f"Date-range FAQ analytics failed for {target_id}: {e}")
            payload = {
                "status": "success",
                "frequent_requests": [],
                "faq_by_day": [],
                "date_from": str(from_dt),
                "date_to": str(to_dt),
                "range_mode": True,
                "generated_at": datetime.now().isoformat()
            }
            await save_ai_cache(target_id, range_cache_key, json.dumps(payload))
            return payload

    now = datetime.now()
    today_str = now.strftime('%Y-%m-%d')
    cache_key = f"dashboard_recs_daily_{target_id}_{today_str}"

    cached = await get_ai_cache(target_id, cache_key)

    async def get_dashboard_cache_rows() -> list[dict]:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AICache.content)
                .where(
                    AICache.client_id == target_id,
                    AICache.cache_key.like("dashboard_recs_daily_%")
                )
                .order_by(AICache.created_at.desc())
            )
            rows = result.scalars().all()

        parsed_rows = []
        for raw in rows:
            try:
                parsed = json.loads(raw)
            except Exception:
                continue
            if isinstance(parsed, dict):
                parsed_rows.append(parsed)
        return parsed_rows

    async def get_last_successful_dashboard_cache() -> Optional[dict]:
        rows = await get_dashboard_cache_rows()
        for parsed in rows:
            if parsed.get("status") != "success":
                continue
            if parsed.get("fallback") is True:
                continue
            return parsed
        return None

    async def get_last_faq_snapshot() -> Optional[list]:
        rows = await get_dashboard_cache_rows()
        for parsed in rows:
            frequent_requests = parsed.get("frequent_requests")
            if isinstance(frequent_requests, list) and frequent_requests:
                return frequent_requests
        return None

    async def apply_faq_fallback(payload: dict, reason: str) -> dict:
        faq_snapshot = await get_last_faq_snapshot()
        if faq_snapshot:
            payload = dict(payload)
            payload["frequent_requests"] = faq_snapshot
            payload["stale"] = True
            payload["stale_reason"] = reason
            payload["faq_stale_only"] = True
        return payload

    if is_force:
        user = await get_user_by_client_id(target_id)
        cost = 49
        if not user or user.balance < cost:
            return {"status": "error", "message": f"Недостаточно средств"}

        await update_user_balance(target_id, cost, consumed_increment=0)
        background_tasks.add_task(run_ai_analysis_task, target_id, cache_key)
        return {"status": "processing", "message": "Анализ запущен. Результаты появятся через 10-20 секунд."}

    if cached:
        try:
            cached_data = json.loads(cached)
        except Exception:
            log.warning(f"Invalid AI cache payload for {target_id}, regenerating")
            background_tasks.add_task(run_ai_analysis_task, target_id, cache_key)
            fallback_data = await get_last_successful_dashboard_cache()
            if fallback_data:
                fallback_data = dict(fallback_data)
                fallback_data["stale"] = True
                fallback_data["stale_reason"] = "invalid_today_cache"
                return fallback_data
            processing_payload = {"status": "processing", "message": "Обновляем аналитический отчет..."}
            return await apply_faq_fallback(processing_payload, "invalid_today_cache_faq")

        if isinstance(cached_data, dict) and cached_data.get("status") == "error":
            log.info(f"Cached AI analysis has error status for {target_id}, regenerating")
            background_tasks.add_task(run_ai_analysis_task, target_id, cache_key)
            fallback_data = await get_last_successful_dashboard_cache()
            if fallback_data:
                fallback_data = dict(fallback_data)
                fallback_data["stale"] = True
                fallback_data["stale_reason"] = "error_today_cache"
                return fallback_data
            processing_payload = {"status": "processing", "message": "Повторно генерируем отчет после ошибки..."}
            return await apply_faq_fallback(processing_payload, "error_today_cache_faq")

        if isinstance(cached_data, dict) and cached_data.get("fallback") is True:
            log.info(f"Cached AI analysis is fallback-only for {target_id}, trying previous successful snapshot")
            background_tasks.add_task(run_ai_analysis_task, target_id, cache_key)
            fallback_data = await get_last_successful_dashboard_cache()
            if fallback_data:
                fallback_data = dict(fallback_data)
                fallback_data["stale"] = True
                fallback_data["stale_reason"] = "fallback_today_cache"
                return fallback_data
            return await apply_faq_fallback(cached_data, "fallback_today_cache_faq")

        return cached_data

    if not cached:
        log.info(f"Auto-generating free daily analysis for {target_id}")
        background_tasks.add_task(run_ai_analysis_task, target_id, cache_key)
        fallback_data = await get_last_successful_dashboard_cache()
        if fallback_data:
            fallback_data = dict(fallback_data)
            fallback_data["stale"] = True
            fallback_data["stale_reason"] = "missing_today_cache"
            return fallback_data
        processing_payload = {"status": "processing", "message": "Генерируем ежедневный бесплатный отчет..."}
        return await apply_faq_fallback(processing_payload, "missing_today_cache_faq")

    return {"status": "empty", "message": "Накопите больше диалогов для анализа."}


@router.post("/reindex-site")
async def reindex_site_background(client_id: str, background_tasks: BackgroundTasks, token_data: dict = Depends(verify_token)):
    """Запуск переиндексации сайта в фоновом режиме."""
    target_id = token_data['sub'] if token_data['sub'] != 'admin' else client_id

    from ...services.clients import get_client_config
    from ...services.site_indexer import run_indexer_async

    cfg = await get_client_config(target_id)
    site_url = cfg.raw.get('site_url') or cfg.raw.get('contacts', {}).get('website')

    if not site_url:
        return {"status": "error", "message": "URL сайта не настроен в профиле"}

    if not site_url.startswith('http'):
        site_url = f"https://{site_url}"

    background_tasks.add_task(run_indexer_async, target_id, site_url)

    return {"status": "success", "message": "Индексация запущена в фоновом режиме"}


@router.get("/cache/stats")
async def get_cache_stats(client_id: str, token_data: dict = Depends(verify_token)):
    """Получение статистики кэша из Redis."""
    target_id = token_data['sub'] if token_data['sub'] != 'admin' else client_id

    if not cache_service.client:
        return {"status": "success", "count": 0}

    pattern = cache_service._get_key(f"ai_cache:{target_id}:*")
    keys = cache_service.client.keys(pattern)
    return {"status": "success", "count": len(keys)}


@router.post("/cache/clear")
async def clear_ai_cache_admin(client_id: str, token_data: dict = Depends(verify_token)):
    """Очистка кэша ответов ИИ в Redis."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    target_id = client_id if client_id != 'default' else 'mitia_assistant'
    cache_service.clear_pattern(f"ai_cache:{target_id}:*")
    log.info(f"AI Cache cleared in Redis for client: {target_id}")
    return {"status": "success", "message": "Кэш успешно очищен"}


@router.get("/visitor-stats")
async def get_visitor_stats(client_id: str, days: int = 7, token_data: dict = Depends(verify_token)):
    """Статистика посещений (диалогов) по дням."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    async with AsyncSessionLocal() as db:
        query = text("""
            WITH RECURSIVE dates AS (
                SELECT CURRENT_DATE - (:days - 1) * INTERVAL '1 day' as date
                UNION ALL
                SELECT date + INTERVAL '1 day'
                FROM dates
                WHERE date < CURRENT_DATE
            )
            SELECT 
                d.date::date as date,
                COALESCE(s.dialogs, 0) as dialogs,
                COALESCE(l.leads, 0) as leads,
                COALESCE(s.dialogs, 0) as humans,
                0 as bots
            FROM dates d
            LEFT JOIN (
                SELECT start_time::date as date, COUNT(*) as dialogs
                FROM chat_sessions 
                WHERE client_id = :client_id AND is_deleted = false
                GROUP BY start_time::date
            ) s ON d.date = s.date
            LEFT JOIN (
                SELECT created_at::date as date, COUNT(*) as leads
                FROM leads
                WHERE client_id = :client_id
                GROUP BY created_at::date
            ) l ON d.date = l.date
            ORDER BY d.date ASC
        """)
        result = await db.execute(query, {"days": days, "client_id": client_id})
        rows = result.mappings().all()
        stats = [dict(r) for r in rows]

    return {"status": "success", "stats": stats}


@router.get("/dialog-case-history")
async def get_dialog_case_history(
    client_id: str,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    mode: Optional[str] = None,
    limit_dialogs: int = 20,
    limit_cases: int = 3,
    token_data: dict = Depends(verify_token)
):
    """История кейсов по диалогам для блока аналитики."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    selected_mode = (mode or "").strip().lower()
    if selected_mode not in {"assistant", "operator"}:
        selected_mode = ""

    limit_dialogs = max(1, min(limit_dialogs, 100))
    limit_cases = max(1, min(limit_cases, 10))

    params: dict = {
        "client_id": client_id,
        "limit_dialogs": limit_dialogs,
        "limit_cases": limit_cases,
    }

    where_parts = [
        "cs.client_id = :client_id",
        "cs.is_deleted = false",
    ]

    if selected_mode == "operator":
        where_parts.append("cs.is_operator_mode = true")
    elif selected_mode == "assistant":
        where_parts.append("cs.is_operator_mode = false")

    if date_from and date_to:
        try:
            d_from = datetime.strptime(date_from, '%Y-%m-%d').date()
            d_to = datetime.strptime(date_to, '%Y-%m-%d').date()
            if d_from > d_to:
                d_from, d_to = d_to, d_from
            params.update({"date_from": d_from, "date_to": d_to})
            where_parts.append("sc.opened_at::date >= :date_from")
            where_parts.append("sc.opened_at::date <= :date_to")
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date range format")

    where_sql = " AND ".join(where_parts)

    query = text("""
        WITH ranked_cases AS (
            SELECT
                sc.id,
                sc.session_id,
                sc.case_number,
                sc.is_active,
                sc.open_reason,
                sc.close_reason,
                sc.opened_at,
                sc.closed_at,
                ROW_NUMBER() OVER (PARTITION BY sc.session_id ORDER BY sc.case_number DESC, sc.id DESC) AS case_rank,
                MAX(sc.opened_at) OVER (PARTITION BY sc.session_id) AS latest_case_opened
            FROM session_cases sc
            JOIN chat_sessions cs ON cs.session_id = sc.session_id
            WHERE """ + where_sql + """
        ),
        filtered_cases AS (
            SELECT *
            FROM ranked_cases
            WHERE case_rank <= :limit_cases
        ),
        ranked_dialogs AS (
            SELECT
                session_id,
                latest_case_opened,
                ROW_NUMBER() OVER (ORDER BY latest_case_opened DESC, session_id) AS dialog_rank
            FROM (
                SELECT DISTINCT session_id, latest_case_opened
                FROM filtered_cases
            ) d
        )
        SELECT
            fc.session_id,
            COALESCE(
                NULLIF(cs.metadata_json->>'platform', ''),
                CASE
                    WHEN cs.session_id LIKE 'tg-%' THEN 'telegram'
                    WHEN cs.session_id LIKE 'max-%' THEN 'max'
                    WHEN cs.session_id LIKE 'vk-%' THEN 'vk'
                    WHEN cs.session_id LIKE 'email_%' THEN 'email'
                    WHEN cs.session_id LIKE 'avito-%' THEN 'avito'
                    ELSE 'web'
                END
            ) AS platform,
            fc.case_number,
            fc.is_active,
            fc.open_reason,
            fc.close_reason,
            fc.opened_at,
            fc.closed_at,
            rd.latest_case_opened,
            rd.dialog_rank
        FROM filtered_cases fc
        JOIN ranked_dialogs rd ON rd.session_id = fc.session_id
        JOIN chat_sessions cs ON cs.session_id = fc.session_id
        WHERE rd.dialog_rank <= :limit_dialogs
        ORDER BY rd.dialog_rank ASC, fc.case_number ASC
    """)

    async with AsyncSessionLocal() as db:
        result = await db.execute(query, params)
        rows = result.mappings().all()

    dialogs_map: dict[str, dict] = {}
    for row in rows:
        session_id = row.get("session_id")
        if not session_id:
            continue

        if session_id not in dialogs_map:
            latest_case_opened = row.get("latest_case_opened")
            dialogs_map[session_id] = {
                "session_id": session_id,
                "platform": row.get("platform") or "web",
                "latest_case_opened": latest_case_opened.isoformat() if latest_case_opened else None,
                "cases": []
            }

        opened_at = row.get("opened_at")
        closed_at = row.get("closed_at")
        dialogs_map[session_id]["cases"].append({
            "case_number": row.get("case_number"),
            "is_active": bool(row.get("is_active")),
            "open_reason": row.get("open_reason"),
            "close_reason": row.get("close_reason"),
            "opened_at": opened_at.isoformat() if opened_at else None,
            "closed_at": closed_at.isoformat() if closed_at else None,
        })

    dialogs = sorted(
        dialogs_map.values(),
        key=lambda d: d.get("latest_case_opened") or "",
        reverse=True
    )

    return {
        "status": "success",
        "dialogs": dialogs,
        "limit_dialogs": limit_dialogs,
        "limit_cases": limit_cases
    }


@router.get("/close-reasons-analytics")
async def get_close_reasons_analytics(
    client_id: str,
    days: int = 30,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    mode: Optional[str] = None,
    token_data: dict = Depends(verify_token)
):
    """Агрегированная аналитика по причинам закрытия кейсов (бизнес vs системные)."""
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    selected_mode = (mode or "").strip().lower()
    if selected_mode not in {"assistant", "operator"}:
        selected_mode = ""

    params = {"client_id": client_id}
    where_parts = [
        "cs.client_id = :client_id",
        "cs.is_deleted = false",
        "sc.closed_at IS NOT NULL",
    ]

    if selected_mode == "operator":
        where_parts.append("cs.is_operator_mode = true")
    elif selected_mode == "assistant":
        where_parts.append("cs.is_operator_mode = false")

    if date_from and date_to:
        try:
            d_from = datetime.strptime(date_from, '%Y-%m-%d').date()
            d_to = datetime.strptime(date_to, '%Y-%m-%d').date()
            if d_from > d_to:
                d_from, d_to = d_to, d_from
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date range format")
    else:
        days = max(1, min(days, 365))
        d_to = datetime.utcnow().date()
        d_from = d_to - timedelta(days=days - 1)

    params["date_from"] = d_from
    params["date_to"] = d_to
    where_parts.append("sc.closed_at::date >= :date_from")
    where_parts.append("sc.closed_at::date <= :date_to")

    where_sql = " AND ".join(where_parts)

    base_cte_sql = """
        WITH base AS (
            SELECT
                sc.close_reason,
                sc.closed_at::date AS closed_date,
                CASE
                    WHEN sc.close_reason IN ('manual_archive', 'auto_reopened') THEN 'system'
                    WHEN sc.close_reason IS NULL OR btrim(sc.close_reason) = '' THEN 'unknown'
                    ELSE 'user'
                END AS reason_type
            FROM session_cases sc
            JOIN chat_sessions cs ON cs.session_id = sc.session_id AND cs.client_id = sc.client_id
            WHERE """ + where_sql + """
        )
    """

    summary_query = text(base_cte_sql + """
        SELECT
            COUNT(*)::int AS total_closed,
            COUNT(*) FILTER (WHERE reason_type = 'user')::int AS total_user,
            COUNT(*) FILTER (WHERE reason_type = 'system')::int AS total_system,
            COUNT(*) FILTER (WHERE reason_type = 'unknown')::int AS total_unknown
        FROM base
    """)

    top_query = text(base_cte_sql + """
        SELECT
            close_reason AS reason,
            COUNT(*)::int AS cnt
        FROM base
        WHERE reason_type = 'user'
        GROUP BY close_reason
        ORDER BY cnt DESC, reason ASC
        LIMIT 10
    """)

    trend_query = text(base_cte_sql + """
        , daily AS (
            SELECT
                closed_date,
                COUNT(*) FILTER (WHERE reason_type = 'user')::int AS user_count,
                COUNT(*) FILTER (WHERE reason_type = 'system')::int AS system_count,
                COUNT(*) FILTER (WHERE reason_type = 'unknown')::int AS unknown_count,
                COUNT(*)::int AS total_count
            FROM base
            GROUP BY closed_date
        )
        SELECT
            gs.d::date AS date,
            COALESCE(d.user_count, 0)::int AS user_count,
            COALESCE(d.system_count, 0)::int AS system_count,
            COALESCE(d.unknown_count, 0)::int AS unknown_count,
            COALESCE(d.total_count, 0)::int AS total_count
        FROM generate_series(CAST(:date_from AS date), CAST(:date_to AS date), interval '1 day') AS gs(d)
        LEFT JOIN daily d ON d.closed_date = gs.d::date
        ORDER BY gs.d ASC
    """)

    system_breakdown_query = text(base_cte_sql + """
        SELECT close_reason AS reason, COUNT(*)::int AS cnt
        FROM base
        WHERE reason_type = 'system'
        GROUP BY close_reason
        ORDER BY cnt DESC, reason ASC
    """)

    async with AsyncSessionLocal() as db:
        summary_row = (await db.execute(summary_query, params)).mappings().first() or {}
        top_rows = (await db.execute(top_query, params)).mappings().all()
        trend_rows = (await db.execute(trend_query, params)).mappings().all()
        system_rows = (await db.execute(system_breakdown_query, params)).mappings().all()

    total_user = int(summary_row.get("total_user") or 0)
    top_user_reasons = []
    for row in top_rows:
        cnt = int(row.get("cnt") or 0)
        reason = row.get("reason") or "—"
        share = round((cnt / total_user) * 100, 2) if total_user > 0 else 0.0
        top_user_reasons.append({
            "reason": reason,
            "count": cnt,
            "share_percent": share,
        })

    trend = []
    for row in trend_rows:
        dt = row.get("date")
        trend.append({
            "date": dt.isoformat() if dt else None,
            "user_count": int(row.get("user_count") or 0),
            "system_count": int(row.get("system_count") or 0),
            "unknown_count": int(row.get("unknown_count") or 0),
            "total_count": int(row.get("total_count") or 0),
        })

    system_breakdown = [
        {"reason": r.get("reason") or "—", "count": int(r.get("cnt") or 0)}
        for r in system_rows
    ]

    return {
        "status": "success",
        "range": {
            "from": d_from.isoformat(),
            "to": d_to.isoformat(),
        },
        "summary": {
            "total_closed": int(summary_row.get("total_closed") or 0),
            "total_user": total_user,
            "total_system": int(summary_row.get("total_system") or 0),
            "total_unknown": int(summary_row.get("total_unknown") or 0),
        },
        "top_user_reasons": top_user_reasons,
        "system_breakdown": system_breakdown,
        "trend": trend,
    }


@router.get("/activity-stats")
async def get_activity_stats(
    client_id: str,
    days: int = 7,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    statuses: Optional[str] = None,
    platforms: Optional[str] = None,
    mode: Optional[str] = None,
    token_data: dict = Depends(verify_token)
):
    """Единая статистика активности по дням.

    Фильтрация синхронизирована с разделом Диалоги:
    - statuses: unread, read, lead, application, spam, archive (через запятую)
    - platforms: web, telegram, max, vk, email, avito (через запятую)
    - mode: assistant | operator
    """
    if token_data['sub'] != client_id and token_data['sub'] != 'admin':
        raise HTTPException(status_code=403, detail="Access denied")

    allowed_statuses = {"unread", "read", "lead", "application", "spam", "archive"}
    allowed_platforms = {"web", "telegram", "max", "vk", "email", "avito"}
    allowed_modes = {"assistant", "operator"}

    selected_statuses = [s.strip().lower() for s in (statuses or "").split(",") if s.strip()]
    selected_statuses = [s for s in selected_statuses if s in allowed_statuses]

    selected_platforms = [p.strip().lower() for p in (platforms or "").split(",") if p.strip()]
    selected_platforms = [p for p in selected_platforms if p in allowed_platforms]

    selected_mode = (mode or "").strip().lower()
    if selected_mode not in allowed_modes:
        selected_mode = ""

    status_predicates = {
        "unread": "(cs.is_read = false)",
        "read": "(cs.is_read = true AND (cs.status = 'new' OR cs.status IS NULL) AND COALESCE(cs.is_archived, false) = false AND cs.is_operator_mode = false)",
        "lead": "(cs.status = 'lead' AND COALESCE(cs.is_archived, false) = false)",
        "application": "(cs.is_operator_mode = true AND COALESCE(cs.is_archived, false) = false AND cs.status IS DISTINCT FROM 'archive' AND cs.status IS DISTINCT FROM 'lead')",
        "spam": "(cs.status = 'spam')",
        "archive": "(COALESCE(cs.is_archived, false) = true OR cs.status = 'archive')",
    }

    platform_expr = """
        COALESCE(
            NULLIF(cs.metadata_json->>'platform', ''),
            CASE
                WHEN cs.session_id LIKE 'tg-%' THEN 'telegram'
                WHEN cs.session_id LIKE 'max-%' THEN 'max'
                WHEN cs.session_id LIKE 'vk-%' THEN 'vk'
                WHEN cs.session_id LIKE 'email_%' THEN 'email'
                WHEN cs.session_id LIKE 'avito-%' THEN 'avito'
                ELSE 'web'
            END
        )
    """

    session_filter_parts = ["cs.client_id = :client_id", "cs.is_deleted = false"]

    if selected_mode == "operator":
        session_filter_parts.append("cs.is_operator_mode = true")
    elif selected_mode == "assistant":
        session_filter_parts.append("cs.is_operator_mode = false")

    if selected_statuses:
        session_filter_parts.append("(" + " OR ".join(status_predicates[s] for s in selected_statuses) + ")")

    params: dict = {"client_id": client_id}

    if selected_platforms:
        platform_placeholders = []
        for i, p in enumerate(selected_platforms):
            key = f"platform_{i}"
            params[key] = p
            platform_placeholders.append(f":{key}")
        session_filter_parts.append(f"({platform_expr}) IN (" + ", ".join(platform_placeholders) + ")")

    session_filters_sql = " AND ".join(session_filter_parts)

    async with AsyncSessionLocal() as db:
        if date_from and date_to:
            # Конвертируем строки в объекты date для asyncpg
            try:
                d_from = datetime.strptime(date_from, '%Y-%m-%d').date()
                d_to = datetime.strptime(date_to, '%Y-%m-%d').date()
            except Exception:
                d_from = date_from
                d_to = date_to

            date_condition_msgs = "cm.timestamp::date >= :date_from AND cm.timestamp::date <= :date_to"
            date_condition_sessions = "fs.start_time::date >= :date_from AND fs.start_time::date <= :date_to"
            date_condition_leads = "l.created_at::date >= :date_from AND l.created_at::date <= :date_to"
            dates_cte = """
                WITH RECURSIVE dates AS (
                    SELECT CAST(:date_from AS DATE) as date
                    UNION ALL
                    SELECT (date + INTERVAL '1 day')::DATE
                    FROM dates
                    WHERE date < CAST(:date_to AS DATE)
                ),
                filtered_sessions AS (
                    SELECT cs.session_id, cs.start_time, cs.last_time, cs.is_read, cs.status, cs.is_archived, cs.is_operator_mode,
                           """ + platform_expr + """ AS platform
                    FROM chat_sessions cs
                    WHERE """ + session_filters_sql + """
                )
            """
            params.update({"date_from": d_from, "date_to": d_to})
        else:
            d_to = datetime.now().date()
            d_from = d_to - timedelta(days=days-1)

            date_condition_msgs = "cm.timestamp::date >= :date_from AND cm.timestamp::date <= :date_to"
            date_condition_sessions = "fs.start_time::date >= :date_from AND fs.start_time::date <= :date_to"
            date_condition_leads = "l.created_at::date >= :date_from AND l.created_at::date <= :date_to"
            
            dates_cte = """
                WITH RECURSIVE dates AS (
                    SELECT CAST(:date_from AS DATE) as date
                    UNION ALL
                    SELECT (date + INTERVAL '1 day')::DATE
                    FROM dates
                    WHERE date < CAST(:date_to AS DATE)
                ),
                filtered_sessions AS (
                    SELECT cs.session_id, cs.start_time, cs.last_time, cs.is_read, cs.status, cs.is_archived, cs.is_operator_mode,
                           """ + platform_expr + """ AS platform
                    FROM chat_sessions cs
                    WHERE """ + session_filters_sql + """
                )
            """
            params.update({"date_from": d_from, "date_to": d_to, "days": days})

        query = text(dates_cte + """
            SELECT
                d.date::date as date,
                COALESCE(m.user_msgs, 0) as user_msgs,
                COALESCE(m.bot_msgs, 0) as bot_msgs,
                COALESCE(m.operator_msgs, 0) as operator_msgs,
                COALESCE(m.total_msgs, 0) as total_msgs,
                COALESCE(m.spam_msgs, 0) as spam_msgs,
                COALESCE(m.bulk_msgs, 0) as bulk_msgs,
                COALESCE(s.total_dialogs, 0) as total_dialogs,
                COALESCE(s.web_dialogs, 0) as web_dialogs,
                COALESCE(s.tg_dialogs, 0) as tg_dialogs,
                COALESCE(s.max_dialogs, 0) as max_dialogs,
                COALESCE(s.vk_dialogs, 0) as vk_dialogs,
                COALESCE(s.email_dialogs, 0) as email_dialogs,
                COALESCE(s.avito_dialogs, 0) as avito_dialogs,
                COALESCE(l.leads, 0) as leads,
                COALESCE(l.applications, 0) as applications
            FROM dates d
            LEFT JOIN (
                SELECT
                    cm.timestamp::date as date,
                    COUNT(*) FILTER (WHERE cm.role = 'user') as user_msgs,
                    COUNT(*) FILTER (WHERE (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as bot_msgs,
                    COUNT(*) FILTER (WHERE cm.author_role = 'operator' OR cm.role = 'operator') as operator_msgs,
                    COUNT(*) as total_msgs,
                    COUNT(*) FILTER (WHERE cm.role = 'user' AND cm.author_role = 'spam') as spam_msgs,
                    COUNT(*) FILTER (WHERE cm.role = 'user' AND cm.author_role = 'bulk') as bulk_msgs,
                    -- Сообщения по платформам (общие)
                    COUNT(*) FILTER (WHERE fs.platform = 'web') as web_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram') as tg_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'max') as max_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk') as vk_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'email') as email_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito') as avito_msgs,
                    -- Детальные сообщения (Актор + Платформа)
                    -- WEB
                    COUNT(*) FILTER (WHERE fs.platform = 'web' AND cm.role = 'user') as web_user_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'web' AND (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as web_bot_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'web' AND (cm.author_role = 'operator' OR cm.role = 'operator')) as web_operator_msgs,
                    -- TG
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram' AND cm.role = 'user') as tg_user_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram' AND (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as tg_bot_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram' AND (cm.author_role = 'operator' OR cm.role = 'operator')) as tg_operator_msgs,
                    -- AVITO
                    COUNT(*) FILTER (WHERE fs.platform = 'avito' AND cm.role = 'user') as avito_user_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito' AND (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as avito_bot_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito' AND (cm.author_role = 'operator' OR cm.role = 'operator')) as avito_operator_msgs,
                    -- EMAIL
                    COUNT(*) FILTER (WHERE fs.platform = 'email' AND cm.role = 'user') as email_user_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'email' AND (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as email_bot_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'email' AND (cm.author_role = 'operator' OR cm.role = 'operator')) as email_operator_msgs,
                    -- VK
                    COUNT(*) FILTER (WHERE fs.platform = 'vk' AND cm.role = 'user') as vk_user_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk' AND (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as vk_bot_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk' AND (cm.author_role = 'operator' OR cm.role = 'operator')) as vk_operator_msgs,
                    -- MAX
                    COUNT(*) FILTER (WHERE fs.platform = 'max' AND cm.role = 'user') as max_user_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'max' AND (cm.role = 'assistant' OR cm.role = 'bot') AND (cm.author_role IS NULL OR cm.author_role != 'operator')) as max_bot_msgs,
                    COUNT(*) FILTER (WHERE fs.platform = 'max' AND (cm.author_role = 'operator' OR cm.role = 'operator')) as max_operator_msgs
                FROM chat_messages cm
                JOIN filtered_sessions fs ON cm.session_id = fs.session_id
                WHERE cm.timestamp::date >= CAST(:date_from AS DATE) AND cm.timestamp::date <= CAST(:date_to AS DATE)
                GROUP BY cm.timestamp::date
            ) m ON d.date = m.date
            LEFT JOIN (
                SELECT
                    fs.start_time::date as date,
                    COUNT(*) as total_dialogs,
                    COUNT(*) FILTER (WHERE fs.platform = 'web') as web_dialogs,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram') as tg_dialogs,
                    COUNT(*) FILTER (WHERE fs.platform = 'max') as max_dialogs,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk') as vk_dialogs,
                    COUNT(*) FILTER (WHERE fs.platform = 'email') as email_dialogs,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito') as avito_dialogs
                FROM filtered_sessions fs
                WHERE fs.start_time::date >= :date_from AND fs.start_time::date <= :date_to
                GROUP BY fs.start_time::date
            ) s ON d.date = s.date
            LEFT JOIN (
                SELECT
                    fs.last_time::date as date,
                    COUNT(*) FILTER (WHERE fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as leads,
                    COUNT(*) FILTER (WHERE fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as applications,
                    -- Лиды по платформам
                    COUNT(*) FILTER (WHERE fs.platform = 'web' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as web_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as tg_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'max' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as max_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as vk_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'email' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as email_leads,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito' AND fs.status = 'lead' AND COALESCE(fs.is_archived, false) = false) as avito_leads,
                    -- Заявки по платформам
                    COUNT(*) FILTER (WHERE fs.platform = 'web' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as web_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'telegram' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as tg_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'max' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as max_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'vk' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as vk_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'email' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as email_applications,
                    COUNT(*) FILTER (WHERE fs.platform = 'avito' AND fs.is_operator_mode = true AND COALESCE(fs.is_archived, false) = false AND fs.status IS DISTINCT FROM 'archive' AND fs.status IS DISTINCT FROM 'lead') as avito_applications
                FROM filtered_sessions fs
                WHERE fs.last_time::date >= :date_from AND fs.last_time::date <= :date_to
                GROUP BY fs.last_time::date
            ) l ON d.date = l.date
            ORDER BY d.date ASC
        """)

        result = await db.execute(query, params)
        rows = result.mappings().all()
        stats = [dict(r) for r in rows]

    return {"status": "success", "stats": stats}
