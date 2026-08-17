# Use the official Apify SDK image for Node.js
FROM apify/actor-node:20

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev --prefer-offline \
    && echo "Installed NPM packages:" \
    && (npm ls --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && rm -r ~/.npm

# Copy source code
COPY . ./

# Run the actor
CMD npm start
