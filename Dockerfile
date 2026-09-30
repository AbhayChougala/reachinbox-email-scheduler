FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --workspaces --include-workspace-root
COPY . .
RUN mkdir -p node_modules/@reachinbox \
  && rm -rf node_modules/@reachinbox/shared \
  && ln -s /app/packages/shared node_modules/@reachinbox/shared \
  && npx prisma generate \
  && npm run build -w @reachinbox/shared \
  && test -f packages/shared/dist/index.d.ts \
  && test -e node_modules/@reachinbox/shared \
  && npm run build -w @reachinbox/api \
  && npm run build -w @reachinbox/worker \
  && npm run build -w @reachinbox/web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps ./apps
COPY --from=build /app/packages ./packages
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
