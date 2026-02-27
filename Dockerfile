FROM node:20-slim

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN npm install --production

# Copy application code
COPY . .

# Create directories for data and uploads
RUN mkdir -p /data /app/uploads /app/credentials

# Expose port
EXPOSE 3000

# Start the app
CMD ["node", "server.js"]
