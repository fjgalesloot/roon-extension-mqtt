FROM node:lts-buster-slim
ENV DEBIAN_FRONTEND noninteractive

RUN apt-get update \
  && apt-get -y upgrade \
  && apt-get install -qqy --no-install-recommends bash curl bzip2 git \
  && apt-get autoremove -y && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Create app directory
RUN mkdir -p /usr/src/app/config
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json /usr/src/app/

# In case build is done outside of Github
RUN git config --global http.sslverify false
RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . /usr/src/app
RUN ln -sf /usr/src/app/config/config.json /usr/src/app/config.json
CMD ["/bin/bash","run.sh"]
