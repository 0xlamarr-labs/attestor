## Attestor — Production Container
##
## Multi-stage build: compile TypeScript → slim runtime image
## Used by both API and Worker services (different CMD)
##
## API:    docker run attestor node dist/service/api-server.js
## Worker: docker run attestor node dist/service/worker.js

FROM node:22-alpine AS build
WORKDIR /app
ENV REDISMS_DISABLE_POSTINSTALL=true
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ src/
RUN npm run build && npm prune --production

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
ENV NODE_ENV=production
USER node
EXPOSE 3700
CMD ["node", "dist/service/api-server.js"]
