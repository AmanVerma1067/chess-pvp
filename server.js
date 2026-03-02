const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { Chess } = require("chess.js");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

/*
Room Structure

rooms = {
  roomId: {
    players: [whiteSocketId, blackSocketId],
    spectators: [],
    fen: null
  }
}
*/

let rooms = {};

io.on("connection", (socket) => {

  socket.on("join-room", (roomId) => {

    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        spectators: [],
        fen: null
      };
    }

    const room = rooms[roomId];

    // Assign player role if space available
    if (room.players.length < 2 && !room.players.includes(socket.id)) {
      room.players.push(socket.id);
    }

    let role = "spectator";

    if (socket.id === room.players[0]) role = "white";
    else if (socket.id === room.players[1]) role = "black";

    // Add spectators
    if (role === "spectator" && !room.spectators.includes(socket.id)) {
      room.spectators.push(socket.id);
    }

    socket.emit("role", role);

    // Send latest board state if exists
    if (room.fen) {
      socket.emit("sync-board", room.fen);
    }

    // Spectator count update
    io.to(roomId).emit("spectator-count", room.spectators.length);

    // Notify if opponent exists
    if (room.players.length === 2) {
      socket.emit("opponent-joined");
    }

  });

  socket.on("move", ({ roomId, from, to, promotion }) => {

    const room = rooms[roomId];
    if (!room) return;

    const playerIndex = room.players.indexOf(socket.id);
    if (playerIndex === -1) return; // spectators cannot move

    const game = new Chess(room.fen || undefined);

    const expectedTurn = game.turn(); // 'w' or 'b'
    const senderColor = playerIndex === 0 ? 'w' : 'b';

    if (expectedTurn !== senderColor) return;

    const result = game.move({ from, to, promotion });
    if (!result) return;

    room.fen = game.fen();

    socket.to(roomId).emit("opponent-move", { from, to, promotion });

    socket.emit("move-confirmed", {
      fen: room.fen
    });

  });

  socket.on("chat", ({ roomId, msg }) => {
    io.to(roomId).emit("chat", msg);
  });

  socket.on("disconnect", () => {

    for (let roomId in rooms) {

      const room = rooms[roomId];

      const wasPlayer = room.players.includes(socket.id);

      room.players = room.players.filter(id => id !== socket.id);
      room.spectators = room.spectators.filter(id => id !== socket.id);

      if (wasPlayer) {
        io.to(roomId).emit("opponent-disconnected");
      }

      io.to(roomId).emit("spectator-count", room.spectators.length);

      if (room.players.length === 0 && room.spectators.length === 0) {
        delete rooms[roomId];
      }
    }

  });

});

server.listen(process.env.PORT || 3001, () => {
  console.log("Realtime server running");
});