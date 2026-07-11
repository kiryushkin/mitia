import json
import os
import logging
from datetime import datetime
from typing import Dict, List, Optional
from sqlalchemy import select, update, delete, insert
from sqlalchemy.dialects.postgresql import insert as pg_insert
from ..core.config import log
from .db_service import AsyncSessionLocal, UserScenario, ScenarioTemplate, ActiveScenario, Lead

class ScenarioEngine:
    """
    Универсальный движок сценариев для платформы-конструктора.
    Работает с PostgreSQL через SQLAlchemy.
    """
    
    async def get_scenario_config(self, client_id: str, scenario_id: str) -> Optional[Dict]:
        """Получает конфигурацию сценария пользователя из БД."""
        async with AsyncSessionLocal() as db:
            res = await db.execute(
                select(UserScenario.config_json)
                .where(UserScenario.client_id == client_id, UserScenario.scenario_id == scenario_id)
            )
            config = res.scalar_one_or_none()
            if config:
                return config
            
            res = await db.execute(
                select(ScenarioTemplate.config_json)
                .where(ScenarioTemplate.template_id == scenario_id)
            )
            return res.scalar_one_or_none()

    async def start_session(self, client_id: str, session_id: str, scenario_id: str) -> Dict:
        """Инициализирует прохождение сценария для пользователя."""
        config = await self.get_scenario_config(client_id, scenario_id)
        if not config:
            return {"status": "error", "message": "Сценарий не найден"}

        initial_state = {
            "scenario_id": scenario_id,
            "current_step_index": 0,
            "answers": {},
            "started_at": datetime.now().isoformat(),
            "completed": False
        }

        async with AsyncSessionLocal() as db:
            stmt = pg_insert(ActiveScenario).values(
                session_id=session_id,
                client_id=client_id,
                state_json=initial_state
            ).on_conflict_do_update(
                index_elements=['session_id'],
                set_={'state_json': initial_state}
            )
            await db.execute(stmt)
            await db.commit()

        return await self.get_next_step(initial_state, config)

    async def process_step(self, session_id: str, answer: str) -> Dict:
        """Обрабатывает ответ пользователя и возвращает следующий шаг."""
        async with AsyncSessionLocal() as db:
            res = await db.execute(
                select(ActiveScenario.client_id, ActiveScenario.state_json)
                .where(ActiveScenario.session_id == session_id)
            )
            row = res.first()
            if not row:
                return {"status": "error", "message": "Активный сценарий не найден"}
            
            client_id, state = row

        config = await self.get_scenario_config(client_id, state['scenario_id'])
        if not config: return {"status": "error", "message": "Конфигурация сценария утеряна"}
        
        steps = config.get('steps', [])
        current_idx = state['current_step_index']
        
        if current_idx >= len(steps):
            return {"status": "completed", "message": "Сценарий уже завершен"}

        current_step = steps[current_idx]
        state['answers'][current_step['id']] = answer
        state['current_step_index'] += 1

        if state['current_step_index'] >= len(steps):
            state['completed'] = True
            await self._finalize_scenario(session_id, client_id, state)
            return {"status": "completed", "message": config.get('success_msg', 'Спасибо! Ваша заявка принята.')}

        async with AsyncSessionLocal() as db:
            await db.execute(
                update(ActiveScenario)
                .where(ActiveScenario.session_id == session_id)
                .values(state_json=state)
            )
            await db.commit()

        return await self.get_next_step(state, config)

    async def get_next_step(self, state: Dict, config: Dict) -> Dict:
        """Формирует данные для следующего вопроса."""
        steps = config.get('steps', [])
        idx = state['current_step_index']
        
        if idx >= len(steps):
            return {"status": "completed"}

        step = steps[idx]
        return {
            "status": "active",
            "question": step.get('question'),
            "type": step.get('type', 'text'),
            "options": step.get('options', []),
            "placeholder": step.get('placeholder', '')
        }

    async def _finalize_scenario(self, session_id: str, client_id: str, state: Dict):
        """Превращает ответы сценария в Лид и уведомляет владельца."""
        summary = "\n".join([f"{k}: {v}" for k, v in state['answers'].items()])
        
        async with AsyncSessionLocal() as db:
            new_lead = Lead(
                client_id=client_id,
                name=state['answers'].get('name', 'Аноним'),
                contact=state['answers'].get('contact', 'Не указан'),
                message=f"Результаты сценария {state['scenario_id']}:\n{summary}",
                intent=f"scenario_complete:{state['scenario_id']}",
                token=session_id
            )
            db.add(new_lead)
            await db.execute(delete(ActiveScenario).where(ActiveScenario.session_id == session_id))
            await db.commit()
        
        log.info(f"Сценарий {state['scenario_id']} завершен для {client_id}. Лид создан.")

scenario_engine = ScenarioEngine()
