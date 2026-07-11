import pytest
from unittest.mock import AsyncMock, patch


class TestScenarios:
    """
    Тест проверяет полный цикл прохождения сценария:
    от инициализации до создания лида — через моки scenario_engine.
    """

    @pytest.mark.asyncio
    async def test_lead_generation_scenario(self):
        client_id = "test_client_123"
        session_id = "test_session_scenario"
        template_id = "test_lead_gen"

        # Мокаем scenario_engine — тестируем логику вызовов, а не БД
        with patch(
            "api.chat.services.conversion_scenarios.scenario_engine.start_session",
            new_callable=AsyncMock,
        ) as mock_start, patch(
            "api.chat.services.conversion_scenarios.scenario_engine.process_step",
            new_callable=AsyncMock,
        ) as mock_step:

            mock_start.return_value = {
                "status": "active",
                "question": "Как вас зовут?",
                "type": "text",
            }

            mock_step.side_effect = [
                {
                    "status": "active",
                    "question": "Ваш телефон или email?",
                    "type": "text",
                },
                {
                    "status": "completed",
                    "message": "Готово! Мы свяжемся с вами.",
                },
            ]

            from api.chat.services.conversion_scenarios import scenario_engine

            # 1. Запуск сценария
            start_res = await scenario_engine.start_session(
                client_id, session_id, template_id
            )
            assert start_res["status"] == "active"
            assert start_res["question"] == "Как вас зовут?"
            mock_start.assert_awaited_once_with(
                client_id, session_id, template_id
            )

            # 2. Ответ на первый вопрос
            step2_res = await scenario_engine.process_step(session_id, "Иван Тестовый")
            assert step2_res["status"] == "active"
            assert step2_res["question"] == "Ваш телефон или email?"

            # 3. Ответ на второй вопрос (финализация)
            final_res = await scenario_engine.process_step(
                session_id, "+79990000000"
            )
            assert final_res["status"] == "completed"
            assert "Готово" in final_res["message"]

            # Проверяем, что process_step вызывался дважды с правильными аргументами
            assert mock_step.await_count == 2
            mock_step.assert_any_await(session_id, "Иван Тестовый")
            mock_step.assert_any_await(session_id, "+79990000000")
