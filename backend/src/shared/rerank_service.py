from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import CrossEncoder
import logging

# 设置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 加载模型（启动时加载一次）
logger.info("Loading CrossEncoder model...")
model = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')
logger.info("Model loaded successfully")

# 定义请求体结构
class RerankRequest(BaseModel):
    query: str
    documents: list[str]

# 创建 FastAPI 应用
app = FastAPI()

@app.post("/rerank")
async def rerank(request: RerankRequest):
    query = request.query
    documents = request.documents
    pairs = [(query, doc) for doc in documents]
    scores = model.predict(pairs)
    results = [{'document': doc, 'score': float(score)} for doc, score in zip(documents, scores)]
    return results

# 运行服务（可选，调试用）
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7000)
