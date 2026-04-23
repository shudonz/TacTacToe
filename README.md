# TacTacToeHub

A real-time multiplayer game hub built with **ASP.NET Core** and **SignalR**. Register an account, see who's online in the shared lobby, and jump into one of ten games — from classic card and board games to dice and puzzle challenges.

---

## Table of Contents

- [Games](#games)
- [Tech Stack](#tech-stack)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Docker (recommended)](#1-docker-recommended)
  - [Run Locally with .NET CLI](#2-run-locally-with-net-cli)
  - [Deploy to IIS (Windows Server)](#3-deploy-to-iis-windows-server)
- [How It Works](#how-it-works)

---

## Games

### 🎮 Tic Tac Toe
The classic 3×3 grid game. From the lobby, click any online player to send them a challenge. They accept or decline in real-time. The first to get three in a row wins. Moves are synced instantly via SignalR so both players always see the same board state.

---

### 🎲 Yahtzee
Up to **4 players** in a shared room take turns rolling five dice up to three times per turn. After each roll you may hold any dice before re-rolling. Score across the 13 standard Yahtzee categories (Ones through Chance, Three of a Kind, Four of a Kind, Full House, Small/Large Straight, and Yahtzee). The player with the highest total after all categories are filled wins. Scores for all players are displayed side-by-side in real-time.

---

### 🎰 Slots
Up to **4 players** share a slot-machine room. Each player spins independently and results are broadcast live to the room. Match symbols across the reels to score. A lightweight luck-based game that works well as a warm-up between longer sessions.

---

### 🧠 Concentration Madness
A classic **memory card matching** game using emoji cards. Flip two cards per turn — if they match they stay face-up, otherwise they flip back. Play solo against a CPU opponent or compete in online rooms with up to **4 players**. The player with the most matched pairs when the board is cleared wins.

---

### 🧩 Puzzle Time
A **sliding and rotation tile puzzle** inspired by classic jigsaw puzzles. Choose from several image designs and select a difficulty (5, 25, 50, or 100 pieces). Tiles can be slid into the empty space or rotated individually. Supports solo play and collaborative/competitive online rooms for up to **4 players**. Tiles can be locked in place once correctly positioned so other players don't accidentally move them.

---

### 🃏 Solitaire
**Klondike Solitaire** — the standard single-player card patience game. Cards are dealt into seven tableau columns; move cards to the four foundation piles (Ace → King by suit) to win. In multiplayer mode up to **4 players** race through identical shuffled decks simultaneously. The first player to complete their foundation wins.

---

### 🟠 Peg Solitaire (Triangular)
Played on a classic **15-hole triangular peg board**. Remove a peg by jumping an adjacent peg over it into an empty hole. The goal is to clear as many pegs as possible. In solo mode try to leave as few pegs as possible. In race mode (up to **4 players**) each player works on their own board; points are awarded for each peg removed and the player who clears the most wins when all boards are complete.

---

### 🎯 Chinese Checkers
A **strategy race game** played on a star-shaped board. Move your colored marbles from your starting triangle to the opposite triangle before your opponents. Supports solo play (you vs. 6 bots) and multiplayer with up to **7 players**. Plan chains of jumps over other marbles to cross the board faster than everyone else.

---

### 🃏 Crazy Eights
The classic **shedding card game**. Players take turns playing a card that matches either the suit or rank of the top discard pile card. Eights are wild and let you declare the next suit. First player to empty their hand wins. Features:
- Solo mode vs. up to **3 CPU bots**
- Online multiplayer with up to **4 players**
- Card play hints and valid-move highlights
- Sound effects and win confetti celebration

---

### 🚢 Battle Boat
A **Battleship-style naval combat** game. Each player secretly places a fleet of ships on their grid, then players alternate calling shots to locate and sink the enemy fleet. Features:
- Multiple ship classes (carrier, battleship, cruiser, submarine, destroyer)
- Peg markers for hits and misses
- Animated ship sinking sequences
- Solo mode vs. a computer opponent
- Local 2-player mode (hot-seat)
- Win confetti celebration

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | ASP.NET Core (.NET 10) |
| Real-time | SignalR (WebSockets) |
| Database | SQLite via Dapper + Microsoft.Data.Sqlite |
| Auth | Cookie-based auth with BCrypt password hashing |
| Frontend | Vanilla HTML, CSS, JavaScript |
| Containerization | Docker / Docker Compose |

---

## Requirements

| Environment | Requirement |
|---|---|
| Docker | Docker Desktop 4.x or Docker Engine 20.x+ with Docker Compose v2 |
| Local (.NET CLI) | [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) |
| IIS (Windows Server) | IIS 10+, [.NET 10 Hosting Bundle](https://dotnet.microsoft.com/download/dotnet/10.0), write access to `App_Data` folder |

---

## Installation

### 1. Docker (recommended)

The easiest way to run TacTacToeHub on any platform (Windows, macOS, Linux).

**Prerequisites:** Docker Desktop or Docker Engine + Docker Compose v2.

1. Clone the repository:
   ```bash
   git clone https://github.com/shudonz/TacTacToe.git
   cd TacTacToe
   ```

2. Start the app:
   ```bash
   docker compose up --build
   ```

3. Open your browser and navigate to **http://localhost:8080**

4. Register an account and start playing.

To stop the app:
```bash
docker compose down
```

To stop and remove all stored data (database volume):
```bash
docker compose down -v
```

---

### 2. Run Locally with .NET CLI

**Prerequisites:** [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0) installed.

1. Clone the repository:
   ```bash
   git clone https://github.com/shudonz/TacTacToe.git
   cd TacTacToe/TacTacToe
   ```

2. Run the app:
   ```bash
   dotnet run
   ```

3. Open your browser. By default the app listens on **http://localhost:5000** (the exact URL is printed in the terminal output).

4. Register an account and start playing.

> **Note:** The SQLite database is automatically created at `TacTacToe/App_Data/tactactoe.db` on first run. No manual database setup is required.

---

### 3. Deploy to IIS (Windows Server)

**Prerequisites:**
- Windows Server with IIS 10+ enabled
- [.NET 10 Hosting Bundle](https://dotnet.microsoft.com/download/dotnet/10.0) installed on the server
- IIS app-pool running in **No Managed Code** mode

1. Publish the app from the project root:
   ```bash
   dotnet publish TacTacToe/TacTacToe.csproj -c Release -o ./publish
   ```

2. Copy the contents of `./publish` to your IIS site's physical path (e.g. `C:\inetpub\wwwroot\tactactoe`).

3. In IIS Manager:
   - Create a new site (or application) pointing to that folder.
   - Set the application pool to use **No Managed Code**.
   - Ensure the app pool identity has **Modify** permissions on the `App_Data` subfolder so the SQLite database can be created and written to.

4. Browse to your configured IIS hostname/port.

> **Tip:** Startup errors are written to the Windows Event Log (Application log, source `TacTacToe`). If the site returns a 500 error, check Event Viewer first.

---

## How It Works

1. **Register / Log in** — Create an account with a username, password, and optional avatar.
2. **Lobby** — See all currently online players and their status in real-time.
3. **Pick a game** — Select any game from the sidebar. Each game shows its player range and category.
4. **Challenge or join a room** — For 1v1 games like Tic Tac Toe and Battle Boat, click a player to send a challenge. For room-based games (Yahtzee, Slots, Solitaire, etc.) create or join an existing room from the game's lobby page.
5. **Play** — All moves are broadcast instantly to every player in the room via SignalR. No page refreshes needed.
6. **Results** — Win/loss outcomes and scores are recorded to the database and visible on your profile.
