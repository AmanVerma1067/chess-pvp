const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

let rooms = {};

/*
Room structure:

rooms = {
  roomId: {
    players: [socketId1, socketId2],
    fen: "current board"
  }
}
*/

io.on("connection", (socket) => {

  socket.on("join-room", (roomId) => {

    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        fen: null
      };
    }

    const room = rooms[roomId];

    // Assign role
    if (room.players.length < 2 && !room.players.includes(socket.id)) {
      room.players.push(socket.id);
    }

    let role = "spectator";

    if (socket.id === room.players[0]) role = "white";
    else if (socket.id === room.players[1]) role = "black";

    socket.emit("role", role);

    // Sync board for spectators / late join
    if (room.fen) {
      socket.emit("sync-board", room.fen);
    }

  });

  socket.on("move", ({ roomId, move, fen }) => {

    if (!rooms[roomId]) return;

    rooms[roomId].fen = fen;

    socket.to(roomId).emit("opponent-move", move);
  });

  socket.on("chat", ({ roomId, msg }) => {
    io.to(roomId).emit("chat", msg);
  });

  socket.on("disconnect", () => {

    for (let roomId in rooms) {

      let room = rooms[roomId];

      room.players = room.players.filter(id => id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[roomId];
      }
    }

  });

});

server.listen(process.env.PORT || 3001, () => {
  console.log("Realtime server running");
});