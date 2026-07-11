import asyncio
import sys
import os
sys.path.append(os.getcwd())
from api.chat.services.db_service import AsyncSessionLocal, StorageItem, select

async def check():
    async with AsyncSessionLocal() as session:
        stmt = select(StorageItem).limit(20)
        result = await session.execute(stmt)
        items = result.scalars().all()
        for item in items:
            print(f"ID: {item.id}, Name: {item.file_name}, Path: {item.file_path}")

if __name__ == "__main__":
    asyncio.run(check())
