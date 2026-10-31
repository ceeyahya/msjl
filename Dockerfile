FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json ./

ENTRYPOINT ["npm", "run", "build-citywide-release", "--"]
