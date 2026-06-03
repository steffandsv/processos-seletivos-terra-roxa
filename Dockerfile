# Imagem única do app Node (monolito). Multi-stage para enxugar o resultado.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Gera o Prisma Client para o runtime
RUN npx prisma generate

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Dependências de produção apenas
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Prisma Client gerado + schema/migrations + código + assets
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma
COPY src ./src
COPY public ./public
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh \
  && mkdir -p /data/uploads \
  && chown -R node:node /app /data
USER node
EXPOSE 3000
# Healthcheck simples no endpoint /health
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
