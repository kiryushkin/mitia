import asyncio
import sys
import os

# Добавляем текущую директорию в путь, чтобы импорты работали
sys.path.append(os.getcwd())

from api.chat.services.db_service import AsyncSessionLocal, StorageItem, delete

async def cleanup():
    print("Starting cleanup of JSON files from storage...")
    async with AsyncSessionLocal() as session:
        try:
            # Удаляем все записи, где имя файла заканчивается на .json
            stmt = delete(StorageItem).where(StorageItem.file_name.ilike("%.json"))
            result = await session.execute(stmt)
            await session.commit()
            print(f"Successfully deleted {result.rowcount} JSON items from storage_items table.")
        except Exception as e:
            print(f"Error during cleanup: {e}")
            await session.rollback()

if __name__ == "__main__":
    asyncio.run(cleanup())
