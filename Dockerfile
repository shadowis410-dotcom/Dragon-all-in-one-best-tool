FROM node:20-bookworm-slim

WORKDIR /app

# Install Python 3, pip, CA certificates, procps, and build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-full \
    ca-certificates \
    curl \
    git \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests first to leverage Docker layer caching for Node dependencies
COPY package*.json ./
RUN npm install

# Copy requirements.txt with wildcard so build NEVER breaks if missing, and leverage caching
COPY requirements.txt* ./
RUN if [ -f requirements.txt ]; then \
      python3 -m pip install --no-cache-dir --break-system-packages -r requirements.txt; \
    else \
      python3 -m pip install --no-cache-dir --break-system-packages discord.py aiohttp websockets colorama python-dotenv; \
    fi

# Copy remaining source code
COPY . .

# Build Vite frontend and Express production server bundle
RUN npm run build

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256"

CMD ["npm", "start"]
