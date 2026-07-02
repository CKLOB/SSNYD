FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV YOUTUBE_DL_SKIP_PYTHON_CHECK=1

COPY package*.json ./

RUN npm ci --omit=dev

COPY --chown=node:node . .

USER node

CMD ["npm", "start"]