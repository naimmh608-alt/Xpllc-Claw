FROM node:20-alpine

WORKDIR /app

COPY package.json .
COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p storage

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "src/server.js"]
