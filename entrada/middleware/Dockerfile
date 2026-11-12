FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY servidor.js ./

USER node
EXPOSE 8080
CMD ["node", "servidor.js"]
