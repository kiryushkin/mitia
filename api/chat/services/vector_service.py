import os
import re
import numpy as np
import faiss
import pickle
import logging
from typing import List, Dict, Optional
from ..core.config import BASE_DIR, log
from .gigachat_service import get_gigachat_embeddings

HAS_FAISS = True

INDEX_DIR = os.path.join(BASE_DIR, 'api', 'chat', 'vector_indices')
os.makedirs(INDEX_DIR, exist_ok=True)

class VectorService:
    """
    Сервис для работы с векторной базой данных (FAISS).
    Создает и хранит индексы для каждого клиента отдельно.
    """

    def __init__(self, client_id: str):
        self.client_id = client_id
        self.index_path = os.path.join(INDEX_DIR, f"{client_id}.index")
        self.meta_path = os.path.join(INDEX_DIR, f"{client_id}.meta")
        self.index = None
        self.chunks = []
        self._load_index()

    def _load_index(self):
        """Загружает индекс и метаданные из файлов."""
        if os.path.exists(self.index_path) and os.path.exists(self.meta_path):
            try:
                self.index = faiss.read_index(self.index_path)
                with open(self.meta_path, 'rb') as f:
                    self.chunks = pickle.load(f)
                log.info(f"[Vector] Loaded index for {self.client_id}: {len(self.chunks)} chunks")
            except Exception as e:
                log.error(f"[Vector] Error loading index for {self.client_id}: {e}")

    def _save_index(self):
        """Сохраняет индекс и метаданные в файлы."""
        if self.index:
            faiss.write_index(self.index, self.index_path)
            with open(self.meta_path, 'wb') as f:
                pickle.dump(self.chunks, f)

    async def add_texts(self, texts: List[str], chunk_size: int = 800, overlap: int = 100):
        """
        Разбивает тексты на чанки, получает эмбеддинги и добавляет в индекс.
        """
        all_chunks = []
        for text in texts:
            if not text: continue
            
            # Очистка текста от лишних пробелов
            text = re.sub(r'\s+', ' ', text).strip()
            
            # Разбиение на чанки с учетом лимитов GigaChat (макс 512 токенов)
            # 800 символов ~ 200-300 токенов, что безопасно
            start = 0
            while start < len(text):
                end = start + chunk_size
                chunk = text[start:end]
                all_chunks.append(chunk)
                start += (chunk_size - overlap)

        if not all_chunks:
            return

        # Получаем эмбеддинги пачками по 16 (лимит API)
        embeddings = []
        batch_size = 16
        for i in range(0, len(all_chunks), batch_size):
            batch = all_chunks[i:i+batch_size]
            batch_embeddings = await get_gigachat_embeddings(batch)
            if batch_embeddings:
                embeddings.extend(batch_embeddings)

        if not embeddings:
            log.error(f"[Vector] Failed to get embeddings for {self.client_id}")
            return

        # Создаем или обновляем индекс
        emb_np = np.array(embeddings).astype('float32')
        dim = emb_np.shape[1]

        if self.index is None:
            self.index = faiss.IndexFlatL2(dim)
        
        self.index.add(emb_np)
        self.chunks.extend(all_chunks)
        self._save_index()
        log.info(f"[Vector] Added {len(all_chunks)} chunks to {self.client_id} index")

    async def search(self, query: str, top_k: int = 3) -> List[str]:
        """Поиск наиболее релевантных чанков по запросу."""
        if self.index is None or not self.chunks:
            return []

        query_emb = await get_gigachat_embeddings([query])
        if not query_emb:
            return []

        query_np = np.array(query_emb).astype('float32')
        distances, indices = self.index.search(query_np, top_k)

        results = []
        for idx in indices[0]:
            if idx != -1 and idx < len(self.chunks):
                results.append(self.chunks[idx])
        
        return results

    def clear(self):
        """Полная очистка индекса."""
        self.index = None
        self.chunks = []
        if os.path.exists(self.index_path): os.remove(self.index_path)
        if os.path.exists(self.meta_path): os.remove(self.meta_path)
        log.info(f"[Vector] Index cleared for {self.client_id}")
