FROM node:20-alpine AS builder

WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install

COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/
RUN cd backend && npx tsc

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/package.json ./backend/package.json

EXPOSE 8888

CMD ["node", "backend/dist/server.js"]
