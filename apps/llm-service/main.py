import time
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from prometheus_client import CollectorRegistry, Counter, CONTENT_TYPE_LATEST, generate_latest, Histogram

import random

app = FastAPI(title="Python Microservice")

START_TIME = time.time()

# Dedicated registry so only this service's metrics are exposed
registry = CollectorRegistry()
request_counter = Counter(
  "app_requests_total",
  "Total number of requests handled by endpoint",
  ["endpoint"],
  registry=registry,
)
LLM_REQUESTS = Counter(
  "llm_requests_total",
  "Total number of LLM inference requests",
  ["model", "status"],
  registry=registry,
)
LLM_LATENCY = Histogram(
  "llm_inference_duration_seconds",
  "LLM inference latency in seconds",
  ["model"],
  registry=registry,
)

class ItemsPayload(BaseModel):
  items: list[str]

@app.get("/health")
async def health() -> dict:
  request_counter.labels(endpoint="health").inc()
  uptime = time.time() - START_TIME
  return {
    "status": "ok",
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "uptime": uptime,
  }

@app.get("/metrics")
async def metrics() -> Response:
  request_counter.labels(endpoint="metrics").inc()
  data = generate_latest(registry)
  return Response(content=data, media_type=CONTENT_TYPE_LATEST)

@app.get("/test")
async def test() -> Response:
  return "hello world!"

@app.post("/check-items")
async def random_items(payload: ItemsPayload) -> dict:
  if len(payload.items) < 5:
    raise HTTPException(status_code=400, detail="Provide at least 5 items.")

  request_counter.labels(endpoint="random_items").inc()
  selected = random.sample(payload.items, 5)
  return {"items": selected}

@app.post("/inference")
async def inference(payload: dict):
  model_name = payload.get("model", "default")

  start = time.time()
  try:
    result = call_llm(...)
    # result = {"answer": "Hello from LLM: " + model_name}
    duration = time.time() - start

    LLM_REQUESTS.labels(model=model_name, status="success").inc()
    LLM_LATENCY.labels(model=model_name).observe(duration)

    return result
  except Exception:
    LLM_REQUESTS.labels(model=model_name, status="error").inc()
    raise

if __name__ == "__main__":
  import uvicorn
  uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
