FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

WORKDIR /app

ADD --checksum=sha256:761fb4568f24d88bd174f162280c8ba154afc4d1cc4a87f6b54ceb277bfb19ff \
  https://github.com/sub-store-org/Sub-Store/releases/download/2.36.39/sub-store.bundle.js \
  /app/sub-store.bundle.js

RUN addgroup -S substore \
  && adduser -S -G substore substore \
  && mkdir /data \
  && chown -R substore:substore /app /data

ENV SUB_STORE_BACKEND_API_HOST=0.0.0.0 \
  SUB_STORE_BACKEND_API_PORT=3000 \
  SUB_STORE_DATA_BASE_PATH=/data \
  SUB_STORE_CORS_ALLOWED_ORIGINS=https://rules.flacier.com

USER substore

EXPOSE 3000

CMD ["node", "/app/sub-store.bundle.js"]
