import { useState, useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import "./App.css";

const QUESTION_DURATION = 60;

const socket = io({
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  transports: ["websocket", "polling"],
});

export default function App() {
  const [screen, setScreen]           = useState("login");
  const [username, setUsername]       = useState("");
  const [myScore, setMyScore]         = useState(0);
  const [connected, setConnected]     = useState(false);
  const [question, setQuestion]       = useState(null);
  const [solved, setSolved]           = useState(false);
  const [status, setStatus]           = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [answer, setAnswer]           = useState("");
  const [shakeInput, setShakeInput]   = useState(false);

  const questionIdRef  = useRef(null);
  const usernameRef    = useRef("");
  const answerInputRef = useRef(null);

  useEffect(() => {
    socket.on("connect", () => {
      setConnected(true);
      if (usernameRef.current) socket.emit("join", { username: usernameRef.current });
    });

    socket.on("disconnect", () => {
      setConnected(false);
      setStatus({ type: "info", text: "Connection lost. Reconnecting…" });
    });

    socket.on("joined", ({ username: name }) => {
      setScreen("game");
      setUsername(name);
      usernameRef.current = name;
    });

    socket.on("new_question", (q) => {
      questionIdRef.current = q.id;
      setQuestion(q);
      setSolved(false);
      setStatus(null);
      setAnswer("");
      setTimeout(() => answerInputRef.current?.focus(), 100);
    });

    socket.on("answer_result", ({ correct, reason, responseTime }) => {
      if (correct) {
        setMyScore((s) => s + 1);
        setSolved(true);
        setStatus({ type: "win", text: `✓ Correct! You answered in ${(responseTime / 1000).toFixed(2)}s` });
      } else if (reason === "wrong") {
        setShakeInput(true);
        setTimeout(() => setShakeInput(false), 400);
        setStatus({ type: "wrong", text: "✗ Wrong answer — try again!" });
      } else if (reason === "too_late") {
        setSolved(true);
        setStatus({ type: "lose", text: "Too slow — someone else got it!" });
      } else if (reason === "stale") {
        setStatus({ type: "info", text: "New question is loading…" });
      }
    });

    socket.on("question_solved", ({ winner, answer: ans, responseTime }) => {
      setSolved(true);
      setStatus((prev) => {
        if (prev?.type === "win") return prev;
        const t = responseTime != null ? ` in ${(responseTime / 1000).toFixed(2)}s` : "";
        return { type: "lose", text: `${winner} answered first${t}! The answer was ${ans}. Next question in 5s…` };
      });
    });

    socket.on("leaderboard_update", setLeaderboard);
    socket.on("users_update", setOnlineUsers);

    return () => socket.removeAllListeners();
  }, []);

  const join = useCallback((name) => {
    if (!name.trim()) return;
    usernameRef.current = name.trim();
    socket.emit("join", { username: name.trim() });
  }, []);

  const submitAnswer = useCallback(() => {
    if (!answer.trim() || solved) return;
    socket.emit("submit_answer", { answer, questionId: questionIdRef.current });
  }, [answer, solved]);

  return (
    <>
      {screen === "login" ? (
        <LoginScreen onJoin={join} />
      ) : (
        <GameScreen
          username={username}
          myScore={myScore}
          connected={connected}
          question={question}
          solved={solved}
          status={status}
          answer={answer}
          setAnswer={setAnswer}
          shakeInput={shakeInput}
          answerInputRef={answerInputRef}
          onSubmit={submitAnswer}
          leaderboard={leaderboard}
          onlineUsers={onlineUsers}
        />
      )}
    </>
  );
}

function LoginScreen({ onJoin }) {
  const [value, setValue] = useState("");

  return (
    <div className="login-screen">
      <div className="login-logo">MATHBLITZ</div>
      <p className="login-tagline">Real-Time Competitive Math Quiz</p>
      <div className="login-card">
        <p className="login-card-label">Choose a username</p>
        <input
          autoFocus
          className="login-input"
          type="text"
          maxLength={20}
          placeholder="e.g. MathWizard42"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onJoin(value)}
        />
        <button className="login-btn" onClick={() => onJoin(value)} disabled={!value.trim()}>
          JOIN GAME
        </button>
        <p className="login-hint">First to answer correctly wins each round</p>
      </div>
    </div>
  );
}

function GameScreen({ username, myScore, connected, question, solved, status, answer, setAnswer, shakeInput, answerInputRef, onSubmit, leaderboard, onlineUsers }) {
  return (
    <div className="game-screen">
      <Header username={username} myScore={myScore} connected={connected} />
      <div className="game-layout">
        <div className="game-left">
          <QuestionCard question={question} />
          {question && <TimerBar startedAt={question.startedAt} paused={solved} />}
          <AnswerRow
            answer={answer}
            setAnswer={setAnswer}
            shakeInput={shakeInput}
            inputRef={answerInputRef}
            onSubmit={onSubmit}
            disabled={solved || !question}
          />
          {status && <StatusBanner status={status} />}
        </div>
        <div className="game-right">
          <Leaderboard entries={leaderboard} myUsername={username} />
          <OnlineUsers users={onlineUsers} myUsername={username} />
        </div>
      </div>
    </div>
  );
}

function Header({ username, myScore, connected }) {
  return (
    <div className="header">
      <span className="header-logo">MATHBLITZ</span>
      <div className="header-right">
        <div className={`conn-dot ${connected ? "connected" : "disconnected"}`} />
        <span className="header-username">{username}</span>
        <div className="score-badge">⚡ {myScore} wins</div>
      </div>
    </div>
  );
}

function QuestionCard({ question }) {
  if (!question) {
    return <div className="question-waiting">Waiting for question…</div>;
  }
  return (
    <div key={question.id} className="question-card">
      <div className="question-card-top-bar" />
      <span className={`difficulty-badge ${question.difficulty}`}>
        {question.difficulty}
      </span>
      <div className="question-text">{question.question}</div>
      <p className="question-subtext">Type your answer and press Enter or Submit</p>
    </div>
  );
}

function TimerBar({ startedAt, paused }) {
  const [remaining, setRemaining] = useState(QUESTION_DURATION);

  useEffect(() => {
    if (!startedAt) return;
    const tick = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      setRemaining(Math.max(0, QUESTION_DURATION - elapsed));
    };
    tick();
    if (paused) return;
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [startedAt, paused]);

  const pct = (remaining / QUESTION_DURATION) * 100;
  const barColor = pct < 25 ? "var(--pink)" : pct < 50 ? "var(--yellow)" : "var(--neon)";

  return (
    <div className="timer-row">
      <div className="timer-track">
        <div className="timer-fill" style={{ width: `${pct}%`, background: barColor }} />
      </div>
      <span className="timer-label">{Math.ceil(remaining)}s</span>
    </div>
  );
}

function AnswerRow({ answer, setAnswer, shakeInput, inputRef, onSubmit, disabled }) {
  return (
    <div className="answer-row">
      <input
        ref={inputRef}
        type="number"
        step="any"
        placeholder="Your answer…"
        value={answer}
        disabled={disabled}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        className={`answer-input ${shakeInput ? "shake" : ""}`}
      />
      <button className="submit-btn" onClick={onSubmit} disabled={disabled || !answer.trim()}>
        SUBMIT
      </button>
    </div>
  );
}

function StatusBanner({ status }) {
  return (
    <div className={`status-banner ${status.type}`}>
      {status.text}
    </div>
  );
}

function Leaderboard({ entries, myUsername }) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div className="panel">
      <div className="panel-header">🏆 Leaderboard</div>
      <div className="panel-body">
        {entries.length === 0 ? (
          <p className="panel-empty">No scores yet</p>
        ) : (
          entries.map((e, i) => (
            <div key={e.username} className={`lb-row ${e.username === myUsername ? "is-me" : ""}`}>
              <span className="lb-medal">{medals[i] || `${i + 1}.`}</span>
              <span className={`lb-name ${e.username === myUsername ? "is-me" : ""}`}>
                {e.username}{e.username === myUsername ? " (you)" : ""}
              </span>
              <span className="lb-wins">{e.wins}W</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function OnlineUsers({ users, myUsername }) {
  return (
    <div className="panel">
      <div className="panel-header">🟢 Online ({users.length})</div>
      <div className="online-body">
        {users.length === 0 ? (
          <p className="panel-empty">No players yet</p>
        ) : (
          users.map((u) => (
            <span key={u.username} className={`user-chip ${u.username === myUsername ? "is-me" : ""}`}>
              {u.username}
            </span>
          ))
        )}
      </div>
    </div>
  );
}