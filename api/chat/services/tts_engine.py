import os
import json
import hashlib
import re
import asyncio
import shutil
import logging
import wave
import io
from pathlib import Path
from typing import Optional

log = logging.getLogger('tts_engine')

class TTSEngine:
    def __init__(self):
        # Путь к кэшу относительно BASE_DIR
        self.cache_dir = Path(__file__).parent.parent / "static" / "tts_cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        
        # Инициализация Silero
        self.local_model = None
        self.device = "cpu"
        self._init_local_model()

    def _init_local_model(self):
        """Загрузка модели Silero при старте."""
        try:
            import torch
            import silero
            
            log.info("Initializing Local Silero TTS...")
            model_id = 'v4_ru'
            self.local_model, _ = silero.silero_tts(language='ru', speaker=model_id)
            self.local_model.to(self.device)
            log.info("Local Silero TTS initialized successfully.")
        except Exception as e:
            log.error(f"Failed to initialize Silero TTS: {e}")

    def _preprocess_text(self, text: str) -> str:
        """Очистка и подготовка текста."""
        text = re.sub(r'!\[([^\]]*)\]\([^\)]+\)', '', text)
        text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
        text = text.replace('*', '').replace('#', '').replace('`', '').strip()
        text = text.replace(' — ', ', ').replace(' - ', ', ')
        return text

    def _split_text(self, text: str, max_chars: int = 250) -> list:
        """Разбивает текст на части по знакам препинания."""
        parts = re.split(r'(?<=[.!?])\s+', text)
        final_parts = []
        for part in parts:
            if len(part) <= max_chars:
                final_parts.append(part)
            else:
                sub_parts = re.split(r'(?<=,)\s+', part)
                for sub in sub_parts:
                    if len(sub) > max_chars:
                        # Если всё еще длинно, бьем просто по пробелам
                        words = sub.split(' ')
                        temp = ""
                        for w in words:
                            if len(temp) + len(w) < max_chars:
                                temp += w + " "
                            else:
                                final_parts.append(temp.strip())
                                temp = w + " "
                        if temp: final_parts.append(temp.strip())
                    else:
                        final_parts.append(sub.strip())
        return [p.strip() for p in final_parts if p.strip()]

    async def generate(self, text: str, voice: Optional[str] = None) -> Optional[dict]:
        if not text: return None

        clean_text = self._preprocess_text(text)
        if not any(c.isalnum() for c in clean_text): return None

        voice_map = {
            'Nec_24000': 'kseniya',
            'Bys_24000': 'eugene',
            'May_24000': 'baya',
            'Nat_24000': 'kseniya'
        }
        speaker = voice_map.get(voice, 'kseniya')

        text_hash = hashlib.md5(f"{clean_text}_{speaker}".encode()).hexdigest()
        file_path = self.cache_dir / f"{text_hash}.wav"
        marks_path = self.cache_dir / f"{text_hash}.json"

        if file_path.exists():
            return {"url": f"/api/chat/static/tts_cache/{text_hash}.wav", "marks": []}

        if not self.local_model:
            self._init_local_model()
            if not self.local_model: return None

        try:
            text_parts = self._split_text(clean_text)
            combined_data = []
            params = None
            
            loop = asyncio.get_event_loop()
            
            for i, part in enumerate(text_parts):
                temp_wav = await loop.run_in_executor(None, lambda p=part: self.local_model.save_wav(
                    text=p,
                    speaker=speaker,
                    sample_rate=48000,
                    put_accent=True,
                    put_yo=True
                ))
                
                with wave.open(temp_wav, 'rb') as w:
                    if params is None:
                        params = w.getparams()
                    combined_data.append(w.readframes(w.getnframes()))
                
                if os.path.exists(temp_wav):
                    os.remove(temp_wav)
                
                # Добавляем тишину (0.3 сек) между частями
                if i < len(text_parts) - 1:
                    # 48000 Гц * 2 байта * 1 канал * 0.3 сек = 28800 байт тишины
                    silence = b'\x00' * int(48000 * 2 * 1 * 0.3)
                    combined_data.append(silence)

            if not combined_data: return None

            with wave.open(str(file_path), 'wb') as output:
                output.setparams(params)
                for data in combined_data:
                    output.writeframes(data)

            with open(marks_path, "w", encoding='utf-8') as f:
                json.dump([], f)

            return {
                "url": f"/api/chat/static/tts_cache/{text_hash}.wav",
                "marks": []
            }
        except Exception as e:
            log.error(f"Silero TTS Generation Error: {e}")
        return None

tts_engine = TTSEngine()
