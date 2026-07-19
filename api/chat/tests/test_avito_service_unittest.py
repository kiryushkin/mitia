import unittest
from unittest.mock import patch, MagicMock, AsyncMock

class TestAvitoService(unittest.IsolatedAsyncioTestCase):

    def setUp(self):
        from api.chat.services.avito_service import extract_avito_text
        self.extract_avito_text = extract_avito_text

    def test_extract_avito_text_simple(self):
        payload = {"text": "Hello"}
        self.assertEqual(self.extract_avito_text(payload), "Hello")

    def test_extract_avito_text_nested_body(self):
        payload = {"body": {"text": "Hello from body"}}
        self.assertEqual(self.extract_avito_text(payload), "Hello from body")

    def test_extract_avito_text_nested_content(self):
        payload = {"content": {"text": "Hello from content"}}
        self.assertEqual(self.extract_avito_text(payload), "Hello from content")

    def test_extract_avito_text_value_content(self):
        payload = {"value": {"content": {"text": "Hello from value content"}}}
        self.assertEqual(self.extract_avito_text(payload), "Hello from value content")

    def test_extract_avito_text_empty(self):
        self.assertEqual(self.extract_avito_text({}), "")
        self.assertEqual(self.extract_avito_text(None), "")

    @patch("httpx.AsyncClient.post")
    async def test_get_access_token_success(self, mock_post):
        from api.chat.services.avito_service import get_access_token
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"access_token": "test_token"}
        mock_post.return_value = mock_response
        
        token = await get_access_token("id", "secret")
        self.assertEqual(token, "test_token")

    @patch("api.chat.services.avito_service.get_access_token")
    @patch("httpx.AsyncClient.get")
    async def test_get_avito_chats_v2_priority(self, mock_get, mock_token):
        from api.chat.services.avito_service import get_avito_chats
        mock_token.return_value = "token"
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"chats": [{"id": "chat1"}]}
        mock_get.return_value = mock_response
        
        chats = await get_avito_chats("id", "secret", user_id="123")
        self.assertEqual(len(chats), 1)
        self.assertEqual(chats[0]["id"], "chat1")
        
        # Проверяем, что первый вызов был к v2 (так как user_id передан)
        args, kwargs = mock_get.call_args_list[0]
        self.assertIn("messenger/v2/accounts/123/chats", args[0])

    @patch("api.chat.services.avito_service.get_access_token")
    @patch("httpx.AsyncClient.get")
    async def test_get_avito_chat_info_fallback(self, mock_get, mock_token):
        from api.chat.services.avito_service import get_avito_chat_info
        mock_token.return_value = "token"
        
        # Первый ответ (v3) - 404
        mock_resp_v3 = MagicMock()
        mock_resp_v3.status_code = 404
        
        # Второй ответ (v2) - 200
        mock_resp_v2 = MagicMock()
        mock_resp_v2.status_code = 200
        mock_resp_v2.json.return_value = {"id": "chat1", "chat_type": "u2u"}
        
        mock_get.side_effect = [mock_resp_v3, mock_resp_v2]
        
        info = await get_avito_chat_info("id", "secret", "chat1", user_id="123")
        self.assertEqual(info["id"], "chat1")
        self.assertEqual(mock_get.call_count, 2)
        
        # Проверяем URL-адреса
        self.assertIn("messenger/v3/chats/chat1", mock_get.call_args_list[0][0][0])
        self.assertIn("messenger/v2/accounts/123/chats/chat1", mock_get.call_args_list[1][0][0])

    @patch("api.chat.services.avito_service.get_access_token")
    @patch("httpx.AsyncClient.post")
    async def test_mark_avito_chat_as_read(self, mock_post, mock_token):
        from api.chat.services.avito_service import mark_avito_chat_as_read
        mock_token.return_value = "token"
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_post.return_value = mock_response
        
        result = await mark_avito_chat_as_read("id", "secret", "chat1", user_id="123")
        self.assertTrue(result)
        
        # Проверяем URL
        args, kwargs = mock_post.call_args_list[0]
        self.assertIn("messenger/v1/accounts/123/chats/chat1/read", args[0])

    @patch("api.chat.services.avito_service.get_access_token")
    @patch("httpx.AsyncClient.get")
    async def test_get_avito_chat_messages_fallback(self, mock_get, mock_token):
        from api.chat.services.avito_service import get_avito_chat_messages
        mock_token.return_value = "token"
        
        # Первый ответ (v3) - 404
        mock_resp_v3 = MagicMock()
        mock_resp_v3.status_code = 404
        
        # Второй ответ (v2) - 200
        mock_resp_v2 = MagicMock()
        mock_resp_v2.status_code = 200
        mock_resp_v2.json.return_value = {"messages": [{"id": "msg1", "text": "hi"}]}
        
        mock_get.side_effect = [mock_resp_v3, mock_resp_v2]
        
        messages = await get_avito_chat_messages("id", "secret", "chat1", user_id="123")
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["id"], "msg1")
        self.assertEqual(mock_get.call_count, 2)

if __name__ == "__main__":
    unittest.main()
