"""Regression tests for the assistant knowledge-source contract."""
from pathlib import Path

from api.chat.services.data_guard import apply_data_guard


AI_SERVICE = Path("api/chat/services/ai_service.py")
SITE_INDEXER = Path("api/chat/services/site_indexer.py")


def test_prompt_declares_file_cards_and_site_in_required_order():
    source = AI_SERVICE.read_text(encoding="utf-8")

    file_position = source.index("База знаний из загруженного файла")
    cards_position = source.index("Заполненные карточки")
    site_position = source.index("Проиндексированные страницы сайта")

    assert file_position < cards_position < site_position
    assert "Никогда не предполагай и не создавай данные." in source


def test_site_search_uses_assistant_card_site_url_and_assistant_scope():
    source = AI_SERVICE.read_text(encoding="utf-8")

    assert "site_url = final_site_url or bot_settings.get('site_url') or contacts.get('website')" in source
    assert "get_indexer_for_client(client_id, site_url, assistant_id=assistant_id)" in source
    assert "[ПРОИНДЕКСИРОВАННЫЕ СТРАНИЦЫ САЙТА (ПРИОРИТЕТ №3)]" in source


def test_knowledge_file_vector_index_is_isolated_per_assistant():
    source = AI_SERVICE.read_text(encoding="utf-8")

    assert 'VectorService(f"{client_id}:{assistant_id or \'main\'}")' in source


def test_site_indexer_scopes_search_and_sitemap_state_to_assistant():
    source = SITE_INDEXER.read_text(encoding="utf-8")

    assert "SitePage.assistant_id == self.assistant_id" in source
    assert 'VectorService(f"{self.client_id}:{self.assistant_id}").clear()' in source


def test_contact_guard_removes_an_invented_contact_from_an_answer():
    answer = "Напишите на sales@example.com или позвоните +7 999 111-22-33."

    filtered = apply_data_guard(answer, ["support@business.example", "+7 495 123-45-67"])

    assert "sales@example.com" not in filtered
    assert "+7 999 111-22-33" not in filtered
