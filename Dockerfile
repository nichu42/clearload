# Use the official Microsoft Playwright image as the base.
# It includes Node.js, Chromium, and all system libraries required for headless browser automation.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

# Set the working directory inside the container
WORKDIR /app

# Copy package files first to leverage Docker build cache
COPY package*.json ./

# Install npm dependencies. We use npm install --only=production for lightweight builds,
# but Playwright is required in production, so standard install is fine.
RUN npm install

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
