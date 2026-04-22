# TacTacToeHub

A real-time multiplayer game hub with Google login, a shared lobby, and live gameplay via SignalR. Currently features six games: **Tic Tac Toe**, **Yahtzee**, **Slots**, **Concentration Madness**, **Solitaire**, and **Peg Solitaire (Triangular)**.

## Games

- **Tic Tac Toe** — Classic 1v1 board game. Challenge another online player and play in real-time.
- **Yahtzee** — Multiplayer dice game. Roll and score across standard Yahtzee categories with other players in a shared room.
- **Slots** — Spin the reels and try your luck in a shared slots room.
- **Concentration Madness** — Emoji memory matching game with 1vCPU mode and online rooms for 2–4 players.
- **Solitaire** — Klondike solitaire with solo mode and multiplayer races on identical decks.
- **Peg Solitaire (Triangular)** — Remove pegs by jumping over adjacent pegs on a 15-hole triangle board; solo or 2–4 player race mode with points for each peg removed.

## Tech Stack

- **Backend:** ASP.NET Core (.NET 10), SignalR
- **Frontend:** Vanilla HTML/CSS/JavaScript
- **Auth:** Google OAuth 2.0
- **Containerization:** Docker / Docker Compose

## Setup

### 1. Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create an OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URI: `http://localhost:8080/signin-google` (or your domain)
4. Note the **Client ID** and **Client Secret**

### 2. Run with Docker

Create a `.env` file:

```
GOOGLE_CLIENT_ID=your-client-id-here
GOOGLE_CLIENT_SECRET=your-client-secret-here
```

Then:

```bash
docker compose up --build
```

Open http://localhost:8080

### 3. Run Locally

Update `appsettings.json` with your Google credentials, then:

```bash
cd TacTacToe
dotnet run
```

## How It Works

1. Sign in with Google
2. See online players in the lobby
3. Choose a game to play
4. **Tic Tac Toe:** Click a player to challenge them — they accept or decline, then play in real-time
5. **Yahtzee / Slots / Concentration Madness / Solitaire / Peg Solitaire:** Join a shared room and play together with other online players
