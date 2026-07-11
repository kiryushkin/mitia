import asyncio
import sys
import os
sys.path.append(os.getcwd())
from sqlalchemy import or_, delete
from api.chat.services.db_service import AsyncSessionLocal, StorageItem

async def cleanup():
    print("Starting final cleanup of storage...")
    async with AsyncSessionLocal() as session:
        try:
            # Удаляем по нескольким критериям
            stmt = delete(StorageItem).where(
                or_(
                    StorageItem.file_name.ilike("%json%"),
                    StorageItem.file_name.ilike("%image_img%"),
                    StorageItem.file_path == None
                )
            )
            result = await session.execute(stmt)
            await session.commit()
            print(f"Successfully deleted {result.rowcount} items (JSON, image_img, or broken paths).")
        except Exception as e:
            print(f"Error during cleanup: {e}")
            await session.rollback()

if __name__ == "__main__":
    asyncio.run(cleanup())
