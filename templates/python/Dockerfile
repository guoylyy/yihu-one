FROM python:3.12-slim
WORKDIR /app
COPY . .
# 有第三方依赖时放 requirements.txt
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi
ENV PORT=3000 PYTHONUNBUFFERED=1
EXPOSE 3000
CMD ["python", "app.py"]
