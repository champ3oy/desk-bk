FROM node:22-alpine

WORKDIR /app

COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

COPY . .

# Build the application
RUN yarn build

EXPOSE 3000

CMD ["node", "dist/main"]
