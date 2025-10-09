# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install any needed packages
RUN npm install

# Bundle app source
COPY . .

# Build the TypeScript source code
RUN npm run build

# Your app binds to port 8080 so you need to expose it
EXPOSE 8080

# Define the command to run your app
CMD [ "npm", "start" ]