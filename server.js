const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"],
});

app.use(express.static(path.join(__dirname, "client", "dist")));

let currentQuestion = null;
let questionId = null;
let isSolvedLock = false;
let nextQuestionTimer = null;
const connectedUsers = new Map();
const highScores = new Map();

function generateQuestion() {
  const types = [
    () => { const a = rand(10,50), b = rand(10,50); return { q:`${a} + ${b}`, ans:a+b, diff:"easy" }; },
    () => { const a = rand(20,80), b = rand(1,20);  return { q:`${a} - ${b}`, ans:a-b, diff:"easy" }; },
    () => { const a = rand(2,12),  b = rand(2,12);  return { q:`${a} × ${b}`, ans:a*b, diff:"easy" }; },
    () => { const b = rand(2,10),  a = b*rand(2,10); return { q:`${a} ÷ ${b}`, ans:a/b, diff:"medium" }; },
    () => { const a = rand(5,15); return { q:`${a}²`, ans:a*a, diff:"medium" }; },
    () => { const p=[10,20,25,50][rand(0,3)], n=rand(2,20)*10; return { q:`${p}% of ${n}`, ans:(p*n)/100, diff:"medium" }; },
    () => { const a=rand(2,10),b=rand(2,10),c=rand(1,10); return { q:`${a} × ${b} + ${c}`, ans:a*b+c, diff:"hard" }; },
    () => { const a=rand(3,8); return { q:`${a}³`, ans:a*a*a, diff:"hard" }; },
    () => { const a=rand(3,12),b=rand(2,8),c=rand(2,6); return { q:`(${a} + ${b}) × ${c}`, ans:(a+b)*c, diff:"hard" }; },
  ];
  return types[Math.floor(Math.random() * types.length)]();
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function newQuestion() {
  isSolvedLock = false;
  const { q, ans, diff } = generateQuestion();
  questionId = uuidv4();
  currentQuestion = { id: questionId, question: q, answer: ans, difficulty: diff, startedAt: Date.now() };
  return currentQuestion;
}

function safeQuestion(q) {
  const { answer, ...safe } = q;
  return safe;
}

function scheduleNext(delay = 5000) {
  if (nextQuestionTimer) clearTimeout(nextQuestionTimer);
  nextQuestionTimer = setTimeout(() => {
    const q = newQuestion();
    io.emit("new_question", safeQuestion(q));
  }, delay);
}

function getLeaderboard() {
  return [...highScores.entries()]
    .map(([username, wins]) => ({ username, wins }))
    .sort((a, b) => b.wins - a.wins)
    .slice(0, 10);
}

function getOnlineUsers() {
  return [...connectedUsers.values()].map(u => ({ username: u.username, score: u.sessionScore }));
}

io.on("connection", (socket) => {
  if (currentQuestion) {
    socket.emit("new_question", safeQuestion(currentQuestion));
    if (isSolvedLock) socket.emit("question_solved", { questionId });
  } else {
    const q = newQuestion();
    socket.emit("new_question", safeQuestion(q));
  }
  socket.emit("leaderboard_update", getLeaderboard());

  socket.on("join", ({ username }) => {
    const name = String(username).trim().slice(0, 20);
    if (!name) return;
    connectedUsers.set(socket.id, { username: name, sessionScore: 0 });
    if (!highScores.has(name)) highScores.set(name, 0);
    socket.emit("joined", { username: name });
    io.emit("users_update", getOnlineUsers());
    io.emit("leaderboard_update", getLeaderboard());
  });

  socket.on("submit_answer", ({ answer, questionId: qId }) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    if (qId !== questionId) return socket.emit("answer_result", { correct: false, reason: "stale" });
    if (isSolvedLock) return socket.emit("answer_result", { correct: false, reason: "too_late" });

    const num = parseFloat(String(answer).trim());
    const correct = !isNaN(num) && Math.abs(num - currentQuestion.answer) < 0.001;

    if (correct) {
      isSolvedLock = true;
      user.sessionScore++;
      highScores.set(user.username, (highScores.get(user.username) || 0) + 1);
      const responseTime = Date.now() - currentQuestion.startedAt;
      socket.emit("answer_result", { correct: true, reason: "winner", responseTime });
      io.emit("question_solved", { winner: user.username, answer: currentQuestion.answer, responseTime, questionId });
      io.emit("leaderboard_update", getLeaderboard());
      io.emit("users_update", getOnlineUsers());
      scheduleNext(5000);
    } else {
      socket.emit("answer_result", { correct: false, reason: "wrong" });
    }
  });

  socket.on("disconnect", () => {
    connectedUsers.delete(socket.id);
    io.emit("users_update", getOnlineUsers());
  });
});

app.get("*", (_, res) => res.sendFile(path.join(__dirname, "client", "dist", "index.html")));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));