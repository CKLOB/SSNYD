FROM node:26-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1
ENV YOUTUBE_DL_SKIP_DOWNLOAD=1

COPY package*.json ./

RUN npm ci --omit=dev

COPY --chown=node:node . .

USER node

# 게이트웨이가 정상일 때 봇이 갱신하는 파일이 2분 넘게 멈춰 있으면 unhealthy
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "process.exit(Date.now()-require('fs').statSync('/tmp/ssnyd-healthy').mtimeMs<120000?0:1)"

CMD ["npm", "start"]
