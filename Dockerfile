# Use the official Microsoft Playwright image as the base.
# It includes Node.js, Chromium, and all system libraries required for headless browser automation.
FROM mcr.microsoft.com/playwright:v1.60.0-noble

# Remove unused browsers and tools to reduce attack surface.
# ClearLoad only needs Chromium headless shell + ffmpeg.
RUN rm -rf /ms-playwright/firefox-* /ms-playwright/webkit-* /ms-playwright/chromium-[0-9]* \
    && npm uninstall -g yarn \
    && apt-get remove -y git openssh-client \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /app

# Copy package files first to leverage Docker build cache
COPY package*.json ./

# Install production npm dependencies
RUN npm ci --omit=dev

# Copy all application files (server.js, audit.js, public/)
COPY . .

# Change ownership of the app directory to the non-root Playwright user
RUN chown -R pwuser:pwuser /app

# Switch to non-root user for security (Playwright image includes 'pwuser')
USER pwuser

# Set production environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Expose the application port
EXPOSE 3000

# Start the Express server
CMD ["node", "server.js"]
