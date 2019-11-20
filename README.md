## Builder Bot

run `npm start` and a `node-crontab` will start downloading all the deployment root CID for each coordinate from the Decentraland's content server API, every six hours. If it finds differences, it will use the Decentraland's Builder API to get an image of the content deployed, and tweet it.
