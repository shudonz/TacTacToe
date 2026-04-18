# TacTacToe

A real-time multiplayer Tic Tac Toe game with Google login, lobby system, and live gameplay via SignalR.

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
3. Click a player to challenge them
4. They accept/decline the challenge
5. Play Tic Tac Toe in real-time!
