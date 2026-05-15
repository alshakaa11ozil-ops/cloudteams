FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci
RUN npx prisma generate



ARG CACHEBUST=3

COPY . .
RUN npm run build
RUN ls -la dist/ && echo "Build output verified"

EXPOSE 8080

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js 2>&1"]