const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const stoppable = require("stoppable");
const listenOnFreePort = require("listen-on-free-port");

const logger = require("corvid-local-logger");
const singleSocketConnectionMiddleware = require("./singleSocketConnectionMiddleware");
const originsMiddleware = require("./originsMiddleWare");

const setupSocketServer = async (defaultPort, options = {}) => {
  const app = express();
  const server = http.Server(app);

  await listenOnFreePort(defaultPort, ["localhost"], () =>
    stoppable(server, 0)
  );

  const port = server.address().port;

  const io = socketIo(server);
  io.use(
    singleSocketConnectionMiddleware(() => {
      logger.warn(`blocking multiple connection on port [${port}]`);
    })
  );
  io.use(
    originsMiddleware(
      options.allowedDomains,
      origin => logger.warn(`refused origin [${origin}]`),
      origin => logger.warn(`accepted origin [${origin}]`)
    )
  );

  return {
    close: () => {
      io.close();
      server.close();
    },
    port,
    io
  };
};

module.exports = setupSocketServer;