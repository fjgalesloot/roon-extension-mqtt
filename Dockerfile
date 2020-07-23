FROM node:latest

# Create app directory
RUN mkdir -p /usr/src/app/config
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json /usr/src/app/

RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . /usr/src/app
RUN ln -sf /usr/src/app/config/config.json /usr/src/app/config.json
CMD ["node","roon-mqtt.js"]
