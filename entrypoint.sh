#!/bin/sh
node src/server.js &
sleep 5
node run_probes.js
wait