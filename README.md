# TacTacToe Hub 🎮

A real-time multiplayer game hub built with **ASP.NET Core** and **SignalR**. Challenge friends to **Tic Tac Toe** or host a multi-player **Yahtzee** room — all from your browser, no plugins required.

---

## Features

- 🔐 **Cookie-based authentication** — pick a username and jump straight in
- 🏠 **Live lobby** — see who's online and send game challenges in real time
- ✕○ **Tic Tac Toe** — classic 1v1, challenge any player in the lobby
- 🎲 **Yahtzee** — host or join rooms with 2–20 players, full scorecard, turn timer, and 3D dice rolling
- ⚡ **SignalR** for instant, low-latency updates across all clients
- 🐳 **Docker** support — single-command deployment

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | ASP.NET Core (.NET 10), C# |
| Real-time | ASP.NET Core SignalR |
| Frontend | Vanilla HTML / CSS / JavaScript |
| 3D Dice | dice-box (WebGL) |
| Auth | ASP.NET Core Cookie Authentication |
| Container | Docker / Docker Compose |

---

## Getting Started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- _or_ [Docker](https://www.docker.com/get-started)

### Run locally

```bash
cd TacTacToe
dotnet run
```

Then open [http://localhost:5000](http://localhost:5000) in your browser.

### Run with Docker

```bash
docker compose up --build
```

The app will be available at [http://localhost:8080](http://localhost:8080).

---

## Project Structure

```
TacTacToeHub/
├── TacTacToe/
│   ├── Hubs/
│   │   └── GameHub.cs          # SignalR hub — lobby, challenges, game events
│   ├── Services/
│   │   ├── LobbyService.cs     # In-memory player/game/room state
│   │   └── YahtzeeState.cs     # Yahtzee room, player, scoring models
│   ├── wwwroot/
│   │   ├── login.html
│   │   ├── lobby.html
│   │   ├── game.html           # Tic Tac Toe
│   │   ├── yahtzee.html        # Yahtzee game board
│   │   ├── yahtzee-room.html   # Yahtzee room lobby
│   │   ├── css/style.css
│   │   └── js/                 # Client-side game logic
│   └── Program.cs              # Minimal API + middleware setup
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## How to Play

1. **Login** — enter a display name (max 20 characters)
2. **Lobby** — choose a game type from the top picker
3. **Tic Tac Toe** — click a player's name to challenge them; accept or decline incoming challenges
4. **Yahtzee** — create a room, share the room with friends, and the host starts the game when everyone is ready

---

## License

This project is open source. Feel free to fork and build on it.

