FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate



ARG CACHEBUST=2

COPY . .
RUN npm run build

EXPOSE 8080

CMD ["node", "dist/server.js"]