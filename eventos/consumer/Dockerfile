FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY consumer.js ./

USER node
CMD ["node", "consumer.js"]
