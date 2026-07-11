import asyncio
import sys
import os
sys.path.append(os.getcwd())
from api.chat.services.db_service import AsyncSessionLocal, StorageItem, select

async def find():
    async with AsyncSessionLocal() as session:
        stmt = select(StorageItem).where(StorageItem.file_path.ilike("%.json%"))
        result = await session.execute(stmt)
        items = result.scalars().all()
        print(f"Found {len(items)} items with JSON in path.")
        for item in items:
            print(f"ID: {item.id}, Name: {item.file_name}, Path: {item.file_path}")

if __name__ == "__main__":
    asyncio.run(find())
