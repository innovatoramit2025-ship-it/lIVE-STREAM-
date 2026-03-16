FROM node:20-slim

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Create media directory
RUN mkdir -p media/live

# Expose HTTP and RTMP ports
EXPOSE 3000
EXPOSE 1935

# Start the server
CMD ["node", "server.js"]
