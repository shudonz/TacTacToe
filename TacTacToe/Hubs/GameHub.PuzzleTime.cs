using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using TacTacToe.Models;
using TacTacToe.Services;

namespace TacTacToe.Hubs;

public partial class GameHub
{
    private const int PuzzleTimePointsPerPiece = 8;
    private const int PuzzleTimeMinScore       = 10;

    // -----------------------------------------------------------------------
    // Room lifecycle
    // -----------------------------------------------------------------------

    public async Task CreatePuzzleTimeRoom(string? roomName = null, string? imageKey = null, int pieceCount = 25, int maxPlayers = 4)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room   = _lobby.CreatePuzzleTimeRoom(roomId, Context.ConnectionId);

        room.Settings.RoomName   = string.IsNullOrWhiteSpace(roomName)
            ? "Puzzle Time Room"
            : roomName.Trim()[..Math.Min(roomName.Trim().Length, RoomNameMaxLength)];
        room.Settings.ImageKey   = PuzzleTimeEngine.NormalizeImageKey(imageKey);
        room.Settings.PieceCount = PuzzleTimeEngine.NormalizePieceCount(pieceCount);
        room.Settings.MaxPlayers = Math.Clamp(maxPlayers, 2, 4);

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("PuzzleTimeRoomCreated", roomId);
        await BroadcastPuzzleTimeRooms();
    }

    public async Task GetPuzzleTimeRooms() =>
        await Clients.Caller.SendAsync("PuzzleTimeRoomList", PuzzleTimeRoomSummaries());

    public async Task JoinPuzzleTimeRoom(string roomId)
    {
        var room = _lobby.GetPuzzleTimeRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new PuzzleTimePlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true });

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("PuzzleTimeRoomUpdated", room);
        await BroadcastPuzzleTimeRooms();
    }

    public async Task RejoinPuzzleTimeRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetPuzzleTimeRoom(roomId);
        if (room == null) return;

        var name   = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
        if (player == null) return;

        var oldConnectionId = player.ConnectionId;
        player.ConnectionId = Context.ConnectionId;
        player.Connected    = true;
        if (room.HostName == name) room.HostConnectionId = Context.ConnectionId;

        if (!string.IsNullOrWhiteSpace(oldConnectionId) && oldConnectionId != Context.ConnectionId)
            PuzzleTimeEngine.ReleaseLocksForConnection(room, oldConnectionId);

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        if (room.Started)
        {
            _lobby.SetInGame(Context.ConnectionId, true);
            await BroadcastLobby();
            await Clients.Caller.SendAsync("PuzzleTimeUpdated", BuildPuzzleTimeState(room));
        }
        else
        {
            await Clients.Group(roomId).SendAsync("PuzzleTimeRoomUpdated", room);
        }
    }

    public async Task StartPuzzleTimeGame(string roomId)
    {
        var room = _lobby.GetPuzzleTimeRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        if (room.Players.Count < 2) return;

        room.Started       = true;
        room.IsOver        = false;
        room.WinnerName    = null;
        room.SessionsSaved = false;
        room.Settings.MaxPlayers  = Math.Clamp(room.Settings.MaxPlayers, 2, 4);
        room.Settings.PieceCount  = PuzzleTimeEngine.NormalizePieceCount(room.Settings.PieceCount);
        room.Settings.ImageKey    = PuzzleTimeEngine.NormalizeImageKey(room.Settings.ImageKey);
        room.StartedAtMs          = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        room.Tiles                = PuzzleTimeEngine.CreateTiles(room.Settings.PieceCount, room.Settings.ImageKey);

        foreach (var p in room.Players.Where(x => !x.IsBot))
            _lobby.SetInGame(p.ConnectionId, true);

        await BroadcastLobby();
        await Clients.Group(roomId).SendAsync("PuzzleTimeGameStarted", room);
        await Clients.Group(roomId).SendAsync("PuzzleTimeUpdated", BuildPuzzleTimeState(room));
        await BroadcastPuzzleTimeRooms();
    }

    public async Task StartPuzzleTimeSinglePlayer(string? imageKey = null, int pieceCount = 25)
    {
        var name   = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");

        var room = new PuzzleTimeRoom
        {
            Id               = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName         = name,
            IsSinglePlayer   = true,
            Started          = true,
            IsOver           = false,
            Settings = new PuzzleTimeSettings
            {
                RoomName   = "Puzzle Time Solo",
                MaxPlayers = 1,
                PieceCount = PuzzleTimeEngine.NormalizePieceCount(pieceCount),
                ImageKey   = PuzzleTimeEngine.NormalizeImageKey(imageKey)
            },
            Players       = [new PuzzleTimePlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true }],
            StartedAtMs   = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
        room.Tiles = PuzzleTimeEngine.CreateTiles(room.Settings.PieceCount, room.Settings.ImageKey);

        _lobby.StorePuzzleTimeRoom(roomId, room);
        _lobby.SetInGame(Context.ConnectionId, true);
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await BroadcastLobby();
        await Clients.Caller.SendAsync("PuzzleTimeSinglePlayerStarted", roomId);
        await Clients.Caller.SendAsync("PuzzleTimeUpdated", BuildPuzzleTimeState(room));
    }

    // -----------------------------------------------------------------------
    // Tile locking
    // -----------------------------------------------------------------------

    public async Task AcquirePuzzleTileLock(string roomId, string tileId)
    {
        var room = _lobby.GetPuzzleTimeRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && p.Connected && !p.IsBot);
        if (player == null) return;

        if (!PuzzleTimeEngine.TryLockTile(room, tileId, Context.ConnectionId, player.Name))
        {
            await Clients.Caller.SendAsync("PuzzleTileLockRejected", tileId);
            return;
        }

        await Clients.Group(roomId).SendAsync("PuzzleTimeUpdated", BuildPuzzleTimeState(room));
    }

    public async Task ReleasePuzzleTileLock(string roomId, string tileId)
    {
        var room = _lobby.GetPuzzleTimeRoom(roomId);
        if (room == null || !room.Started) return;

        PuzzleTimeEngine.ReleaseTileLock(room, tileId, Context.ConnectionId);
        await Clients.Group(roomId).SendAsync("PuzzleTimeUpdated", BuildPuzzleTimeState(room));
    }

    // -----------------------------------------------------------------------
    // Free-position move (replaces the old index-based MovePuzzleTile)
    // -----------------------------------------------------------------------

    public async Task SetPuzzleTilePosition(string roomId, string tileId, double x, double y)
    {
        var room = _lobby.GetPuzzleTimeRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;

        if (!PuzzleTimeEngine.TrySetTilePosition(room, tileId, x, y, Context.ConnectionId)) return;

        // Automatically release lock once the piece is placed so other players can use it
        var tile = room.Tiles.FirstOrDefault(t => t.Id == tileId);
        if (tile is { IsPlaced: true })
        {
            tile.LockedByConnectionId = null;
            tile.LockedByName = null;
        }

        await CheckPuzzleSolved(room);
        await Clients.Group(roomId).SendAsync("PuzzleTimeUpdated", BuildPuzzleTimeState(room));
    }

    // -----------------------------------------------------------------------
    // Leave / kick
    // -----------------------------------------------------------------------

    public async Task LeavePuzzleTimeRoom(string roomId)
    {
        var room   = _lobby.GetPuzzleTimeRoom(roomId);
        if (room == null) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);

        if (!room.Started)
        {
            if (player != null) room.Players.Remove(player);
            if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
            {
                await Clients.Group(roomId).SendAsync("PuzzleTimeRoomDissolved");
                _lobby.RemovePuzzleTimeRoom(roomId);
            }
            else
            {
                await Clients.Group(roomId).SendAsync("PuzzleTimeRoomUpdated", room);
            }
            await BroadcastPuzzleTimeRooms();
            return;
        }

        if (player == null) return;

        PuzzleTimeEngine.ReleaseLocksForConnection(room, Context.ConnectionId);

        if (room.IsSinglePlayer)
        {
            _lobby.RemovePuzzleTimeRoom(roomId);
            _lobby.SetInGame(Context.ConnectionId, false);
            await BroadcastLobby();
            return;
        }

        player.Connected = false;
        await Clients.Group(roomId).SendAsync("PlayerLeft", player.Name);

        var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
        if (connectedHumans.Count == 0)
        {
            _lobby.RemovePuzzleTimeRoom(roomId);
            await BroadcastPuzzleTimeRooms();
            return;
        }

        await Clients.Group(roomId).SendAsync("PuzzleTimeUpdated", BuildPuzzleTimeState(room));
    }

    public async Task LeavePuzzleTimeGame(string roomId) => await LeavePuzzleTimeRoom(roomId);

    public async Task KickPuzzleTimePlayer(string roomId, string playerName)
    {
        var room = _lobby.GetPuzzleTimeRoom(roomId);
        if (room == null || Context.ConnectionId != room.HostConnectionId || room.Started) return;

        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;

        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);

        await Clients.Group(roomId).SendAsync("PuzzleTimeRoomUpdated", room);
        await BroadcastPuzzleTimeRooms();
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private async Task CheckPuzzleSolved(PuzzleTimeRoom room)
    {
        if (room.IsOver || !PuzzleTimeEngine.IsSolved(room)) return;

        room.IsOver = true;
        var me      = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        room.WinnerName    = me?.Name ?? room.HostName;
        room.SessionsSaved = false;

        // Release all locks on completion
        foreach (var tile in room.Tiles)
        {
            tile.LockedByConnectionId = null;
            tile.LockedByName = null;
        }

        await SavePuzzleTimeSessionsAsync(room);
    }

    private object BuildPuzzleTimeState(PuzzleTimeRoom room)
    {
        var (rows, cols) = PuzzleTimeEngine.GridFor(room.Settings.PieceCount);
        return new
        {
            room.Id,
            room.Started,
            room.IsOver,
            room.IsSinglePlayer,
            room.WinnerName,
            Settings = new
            {
                room.Settings.RoomName,
                room.Settings.MaxPlayers,
                room.Settings.PieceCount,
                room.Settings.ImageKey,
                Grid = new { Rows = rows, Cols = cols }
            },
            Players = room.Players.Select(p => new { p.Name, p.Connected, p.IsBot }),
            Catalog  = PuzzleTimeEngine.Catalog,
            PreviewFaces = PuzzleTimeEngine.BuildPreviewFaces(room.Settings.PieceCount, room.Settings.ImageKey),
            Tiles = room.Tiles.Select(t => new
            {
                t.Id,
                t.CorrectIndex,
                t.X,
                t.Y,
                t.IsPlaced,
                t.Face,
                t.Connectors,
                t.LockedByName,
                IsLocked     = t.LockedByConnectionId != null,
                IsLockedByMe = t.LockedByConnectionId == Context.ConnectionId
            })
        };
    }

    private IEnumerable<object> PuzzleTimeRoomSummaries() =>
        _lobby.GetOpenPuzzleTimeRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            RoomName    = r.Settings.RoomName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            r.Settings.PieceCount,
            r.Settings.ImageKey,
            IsFull      = r.Players.Count >= r.Settings.MaxPlayers,
            r.Started
        });

    private async Task BroadcastPuzzleTimeRooms() =>
        await Clients.All.SendAsync("PuzzleTimeRoomList", PuzzleTimeRoomSummaries());

    private async Task SavePuzzleTimeSessionsAsync(PuzzleTimeRoom room)
    {
        if (room.SessionsSaved) return;
        room.SessionsSaved = true;

        try
        {
            var now       = DateTime.UtcNow.ToString("o");
            int elapsed   = (int)((DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - room.StartedAtMs) / 1000);
            int pieceCount = PuzzleTimeEngine.NormalizePieceCount(room.Settings.PieceCount);
            int baseScore  = room.IsOver
                ? Math.Max(PuzzleTimeMinScore, pieceCount * PuzzleTimePointsPerPiece - elapsed)
                : 0;

            foreach (var p in room.Players.Where(p => !p.IsBot))
            {
                var uid = await _users.GetIdByUsernameAsync(p.Name);
                if (!uid.HasValue) continue;

                await _sessions.SaveAsync(new GameSession
                {
                    UserId     = uid.Value,
                    GameType   = "PuzzleTime",
                    Score      = baseScore,
                    Result     = room.IsOver ? "Win" : "Completed",
                    TimePlayed = elapsed,
                    PlayedAt   = now,
                    Details    = $"Pieces:{pieceCount},Image:{room.Settings.ImageKey},Players:{room.Players.Count}"
                });
            }
        }
        catch { }
    }
}
