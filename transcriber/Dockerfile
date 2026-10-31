FROM python:3.11-slim 

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

COPY requirements.txt . 
RUN uv pip install --system --no-cache -r requirements.txt 


COPY . . 

EXPOSE 5000 

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5000"]
