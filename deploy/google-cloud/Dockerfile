FROM node:22-slim AS builder
WORKDIR /app/deploy/google-cloud
COPY deploy/google-cloud/package.json deploy/google-cloud/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
WORKDIR /app/deploy/google-cloud
COPY --from=builder /app/deploy/google-cloud/node_modules ./node_modules
COPY deploy/google-cloud/src/ ./src/
COPY deploy/google-cloud/package.json ./
COPY src/core/ /app/src/core/
RUN ln -s /app/deploy/google-cloud/node_modules /app/node_modules
ENV PORT=8080
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "src/server.ts"]
