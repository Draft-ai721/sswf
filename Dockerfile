FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:railway

FROM node:24-bookworm-slim
ENV NODE_ENV=production DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/dist/public ./dist/public
COPY --from=build /app/server ./server
COPY --from=build /app/worker ./worker
COPY --from=build /app/shared ./shared
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["node", "server/index.mjs"]
