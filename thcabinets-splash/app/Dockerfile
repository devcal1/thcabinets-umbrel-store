FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js db.js ./
COPY public ./public

ENV UPLOADS_DIR=/app/uploads
ENV DB_DIR=/app/db
ENV PORT=3000

EXPOSE 3000
CMD ["node", "server.js"]
