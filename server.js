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
    players: [], // [whiteSocketId, blackSocketId]
    spectators: [],
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
  }
}
*/
let rooms = {};

const INITIAL_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);

    // Initialize room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        spectators: [],
        fen: INITIAL_FEN
      };
    }

    const room = rooms[roomId];

    // Clean up if this socket is already somehow in the room (e.g., fast reconnect)
    room.players = room.players.filter(id => id !== socket.id);
    room.spectators = room.spectators.filter(id => id !== socket.id);

    // Assign player role if space available
    if (room.players.length < 2) {
      room.players.push(socket.id);
    } else {
      room.spectators.push(socket.id);
    }

    // Determine role based on array index
    let role = "spectator";
    if (room.players[0] === socket.id) {
      role = "white";
    } else if (room.players[1] === socket.id) {
      role = "black";
    }

    console.log(`Socket ${socket.id} joined room ${roomId} as ${role}`);
    
    // Send role to the user
    socket.emit("role", role);

    // Send latest board state to the newly joined user
    socket.emit("sync-board", room.fen);

    // Notify others of spectator count
    io.to(roomId).emit("spectator-count", room.spectators.length);

    // Notify if both players are present
    if (room.players.length === 2) {
      io.to(roomId).emit("opponent-joined");
    }
  });

  socket.on("move", ({ roomId, from, to, promotion }) => {
    const room = rooms[roomId];
    if (!room) return;

    const playerIndex = room.players.indexOf(socket.id);
    if (playerIndex === -1) return; // Spectators cannot move

    const game = new Chess(room.fen);

    const expectedTurn = game.turn(); // 'w' or 'b'
    const senderColor = playerIndex === 0 ? 'w' : 'b';

    // Prevent moving out of turn
    if (expectedTurn !== senderColor) return;

    try {
      const result = game.move({ from, to, promotion });
      if (!result) return; // Invalid move

      room.fen = game.fen();

      // Broadcast move to opponent and spectators
      socket.to(roomId).emit("opponent-move", { from, to, promotion });

      // Confirm move back to sender
      socket.emit("move-confirmed", { fen: room.fen });
      
    } catch (e) {
      console.error("Invalid move attempted:", e);
    }
  });

  socket.on("chat", ({ roomId, msg }) => {
    // Broadcast chat to everyone in the room
    io.to(roomId).emit("chat-received", msg);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    for (let roomId in rooms) {
      const room = rooms[roomId];

      const wasPlayer = room.players.includes(socket.id);

      // Remove the socket from players and spectators
      room.players = room.players.filter(id => id !== socket.id);
      room.spectators = room.spectators.filter(id => id !== socket.id);

      if (wasPlayer) {
        // Notify the remaining player/spectators that a player left
        io.to(roomId).emit("opponent-disconnected");
      }

      // Update spectator count for remaining users
      io.to(roomId).emit("spectator-count", room.spectators.length);

      // Clean up empty rooms
      if (room.players.length === 0 && room.spectators.length === 0) {
        console.log("Deleting empty room:", roomId);
        delete rooms[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Realtime server running on port ${PORT}`);
});
