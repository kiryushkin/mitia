import pytest

pytestmark = pytest.mark.skip(reason="Устаревший Telegram integration test не совместим с текущей async тестовой инфраструктурой")
