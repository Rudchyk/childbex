# Python Microservice

FastAPI service exposing health, Prometheus metrics, and a sampler endpoint.

## Check

1. `py --version`
2. `which py`

## Setup

1. `cd apps/llm-service`
1. Create a virtualenv (optional): `py -m venv .venv`
1. Activate it: `source .venv/Scripts/activate`
1. Install deps: `pip install -r requirements.txt`

## Run

- `uvicorn main:app --host 0.0.0.0 --port 8000 --reload`
- `cd apps/llm-service && py main.py`

## ALT

1. `source apps/llm-service/.venv/Scripts/activate`
2. `py apps/llm-service/main.py`

## Endpoints

- `GET /health` � simple health check`
- `GET /metrics` � Prometheus metrics in text format
- `POST /random-items` � body `{ "items": ["a", "b", "c", "d", "e", "f"] }` returns 5 random items

## Help

- deactivate venv `deactivate`

## TESTING

- curl 'http://localhost:8000/health'

- `http://localhost:8000/random-items`

```json
curl -X 'POST' \
  'http://localhost:8000/random-items' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
    "items": ["a", "b", "c", "d", "e", "f"]
  }'
```

- `http://localhost:8000/inference`

```json
curl -X 'POST' \
  'http://localhost:8000/inference' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "hello"
  }'
```
