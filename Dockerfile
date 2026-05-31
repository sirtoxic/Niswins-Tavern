FROM python:3.12-alpine

RUN addgroup -S tavern && adduser -S tavern -G tavern

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/
COPY config.yaml .

RUN chown -R tavern:tavern /app
USER tavern

EXPOSE 8000

WORKDIR /app/backend
ENV PYTHONPATH=/app

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
