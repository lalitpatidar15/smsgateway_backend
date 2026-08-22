FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

EXPOSE 10000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
