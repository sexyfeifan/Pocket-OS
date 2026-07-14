FROM node:18-alpine

WORKDIR /app

ARG VERSION=dev
ENV APP_VERSION=${VERSION}

COPY package.json package-lock.json ./
RUN npm ci --production

COPY server.js index.html canbox.html ./
RUN mkdir -p /app/data/topics

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
