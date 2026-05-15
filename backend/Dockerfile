FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate

COPY . .
RUN npm run build

EXPOSE 8080

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]