FROM node:18-alpine

LABEL maintainer="RealTime Editor Team"
LABEL description="多端实时同步文本编辑器"

WORKDIR /app

RUN apk add --no-cache tzdata

COPY package*.json ./

RUN npm ci --only=production && \
    npm cache clean --force

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=Asia/Shanghai

RUN mkdir -p /app/data /app/logs && \
    chown -R node:node /app/data /app/logs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

USER node

CMD ["node", "src/server.js"]
