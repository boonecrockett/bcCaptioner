#!/bin/bash
# setup.sh

# This script installs the system dependencies required by the canvas package.
# Netlify's build environment is based on Ubuntu, so we use apt-get.

/usr/bin/sudo apt-get update
/usr/bin/sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
