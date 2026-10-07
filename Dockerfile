FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/client/dist ./packages/client/dist
COPY --from=build /app/node_modules/ws ./node_modules/ws
ENV PORT=8787 NODE_ENV=production
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "packages/server/dist/index.js"]
