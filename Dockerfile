FROM node:22-alpine

WORKDIR /app

ARG VERSION=""
ENV APP_VERSION=${VERSION}

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js schedule.js workflow.js workbench.js workbench.css view.html viewer.js viewer.css index.html canbox.html manifest.json html2canvas.min.js ./
COPY icon-192.png icon-512.png apple-touch-icon.png favicon.ico ./
COPY tests ./tests
RUN npm run check
RUN mkdir -p /app/data/topics

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
