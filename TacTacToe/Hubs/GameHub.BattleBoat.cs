using Microsoft.AspNetCore.SignalR;
using System.Security.Claims;
using TacTacToe.Services;

namespace TacTacToe.Hubs;

public partial class GameHub
{
    /* ================================================================
       Battle Boat Methods
       ================================================================ */

    public async Task CreateBattleBoatRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateBattleBoatRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
        {
            var trimmedName = roomName.Trim();
            room.Settings.RoomName = trimmedName[..Math.Min(trimmedName.Length, RoomNameMaxLength)];
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("BattleBoatRoomCreated", roomId);
        await BroadcastBattleBoatRooms();
    }

    public async Task GetBattleBoatRooms() =>
        await Clients.Caller.SendAsync("BattleBoatRoomList", BattleBoatRoomSummaries());

    public async Task JoinBattleBoatRoom(string roomId)
    {
        var room = _lobby.GetBattleBoatRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new BattleBoatPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("BattleBoatRoomUpdated", room);
        await BroadcastBattleBoatRooms();
    }

    public async Task RejoinBattleBoatRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetBattleBoatRoom(roomId);
        if (room == null) return;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var player = room.Players.FirstOrDefault(p => p.Name == name);
        if (player == null) return;
        player.ConnectionId = Context.ConnectionId;
        player.Connected = true;
        if (room.HostName == name) room.HostConnectionId = Context.ConnectionId;
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        if (room.Started)
        {
            _lobby.SetInGame(Context.ConnectionId, true);
            await BroadcastLobby();
            await Clients.Caller.SendAsync("BattleBoatGameState", BuildBattleBoatState(room, name));
        }
        else
        {
            await Clients.Group(roomId).SendAsync("BattleBoatRoomUpdated", room);
        }
    }

    public async Task StartBattleBoatGame(string roomId)
    {
        var room = _lobby.GetBattleBoatRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        if (room.Players.Count != 2) return;

        room.Started = true;
        room.CurrentPlayerIndex = 0;
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        foreach (var p in room.Players)
        {
            p.FleetPlaced = false;
            p.Fleet.Clear();
            p.Shots.Clear();
            p.Lost = false;
        }

        foreach (var p in room.Players)
        {
            _lobby.SetInGame(p.ConnectionId, true);
        }

        await Clients.Group(roomId).SendAsync("BattleBoatGameStarted", room);
        await BroadcastBattleBoatRooms();
        await BroadcastLobby();
    }

    public async Task LeaveBattleBoatRoom(string roomId)
    {
        var room = _lobby.GetBattleBoatRoom(roomId);
        if (room == null) return;
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
        if (player != null) room.Players.Remove(player);
        if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
        {
            await Clients.Group(roomId).SendAsync("BattleBoatRoomDissolved");
            _lobby.RemoveBattleBoatRoom(roomId);
        }
        else
        {
            await Clients.Group(roomId).SendAsync("BattleBoatRoomUpdated", room);
        }
        await BroadcastBattleBoatRooms();
    }

    public async Task KickBattleBoatPlayer(string roomId, string playerName)
    {
        var room = _lobby.GetBattleBoatRoom(roomId);
        if (room == null) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;
        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);
        await Clients.Group(roomId).SendAsync("BattleBoatRoomUpdated", room);
        await BroadcastBattleBoatRooms();
    }

    public async Task SubmitBattleBoatFleet(string roomId, List<BattleBoatShip> fleet)
    {
        var room = _lobby.GetBattleBoatRoom(roomId);
        if (room == null || !room.Started) return;
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (player == null || player.FleetPlaced) return;

        player.Fleet = fleet;
        player.FleetPlaced = true;

        await Clients.Group(roomId).SendAsync("BattleBoatFleetSubmitted", player.Name);

        // If both players have placed their fleets, start the battle
        if (room.Players.All(p => p.FleetPlaced))
        {
            await Clients.Group(roomId).SendAsync("BattleBoatBattleBegins");
            foreach (var p in room.Players)
            {
                await Clients.Client(p.ConnectionId).SendAsync("BattleBoatGameState", BuildBattleBoatState(room, p.Name));
            }
        }
    }

    public async Task BattleBoatFire(string roomId, int row, int col)
    {
        var room = _lobby.GetBattleBoatRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;
        var shooter = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (shooter == null) return;

        var shooterIndex = room.Players.IndexOf(shooter);
        if (shooterIndex != room.CurrentPlayerIndex) return;

        var targetIndex = (shooterIndex + 1) % 2;
        var target = room.Players[targetIndex];

        var coord = $"{row},{col}";
        if (shooter.Shots.Contains(coord)) return;
        shooter.Shots.Add(coord);

        var hit = false;
        BattleBoatShip? hitShip = null;

        foreach (var ship in target.Fleet)
        {
            if (ship.Cells.Any(cell => cell[0] == row && cell[1] == col))
            {
                ship.Hits++;
                hit = true;
                hitShip = ship;
                if (ship.Hits >= ship.Size)
                {
                    ship.Sunk = true;
                }
                break;
            }
        }

        if (hit) shooter.HitShots.Add(coord);

        var sunkShip = hitShip?.Sunk == true ? hitShip.Name : null;
        await Clients.Group(roomId).SendAsync("BattleBoatShotFired", shooter.Name, row, col, hit, sunkShip);

        // Check if target has lost all ships
        if (target.Fleet.All(s => s.Sunk))
        {
            room.IsOver = true;
            room.WinnerName = shooter.Name;
            await Clients.Group(roomId).SendAsync("BattleBoatGameOver", shooter.Name);
            await SaveBattleBoatSessionsAsync(room);

            foreach (var p in room.Players)
            {
                _lobby.SetInGame(p.ConnectionId, false);
            }
            await BroadcastLobby();
            return;
        }

        // If miss, switch turn; if hit, shooter goes again
        if (!hit)
        {
            room.CurrentPlayerIndex = targetIndex;
        }

        foreach (var p in room.Players)
        {
            await Clients.Client(p.ConnectionId).SendAsync("BattleBoatGameState", BuildBattleBoatState(room, p.Name));
        }
    }

    private object BuildBattleBoatState(BattleBoatRoom room, string myName)
    {
        var me = room.Players.FirstOrDefault(p => p.Name == myName);
        var opponent = room.Players.FirstOrDefault(p => p.Name != myName);
        var myIndex = me != null ? room.Players.IndexOf(me) : -1;

        return new
        {
            room.Id,
            room.Started,
            room.IsOver,
            room.WinnerName,
            room.CurrentPlayerIndex,
            MyIndex = myIndex,
            IsMyTurn = myIndex == room.CurrentPlayerIndex,
            AllFleetsPlaced = room.Players.All(p => p.FleetPlaced),
            Me = me == null ? null : new
            {
                me.Name,
                me.FleetPlaced,
                Fleet = me.Fleet.Select(s => new
                {
                    s.Key,
                    s.Name,
                    s.Size,
                    s.Cells,
                    s.Hits,
                    s.Sunk
                }),
                OpponentShots = opponent?.Shots ?? [],
                OpponentHitShots = opponent?.HitShots ?? []
            },
            Opponent = opponent == null ? null : new
            {
                opponent.Name,
                opponent.FleetPlaced,
                MyShots = me?.Shots ?? [],
                MyHitShots = me?.HitShots ?? [],
                Fleet = opponent.Fleet.Select(s => new
                {
                    s.Key,
                    s.Name,
                    s.Size,
                    s.Hits,
                    s.Sunk,
                    Cells = s.Sunk ? s.Cells : new List<int[]>()
                })
            }
        };
    }

    private async Task SaveBattleBoatSessionsAsync(BattleBoatRoom room)
    {
        try
        {
            var now = DateTime.UtcNow.ToString("o");
            int elapsed = (int)((DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - room.StartedAtMs) / 1000);

            foreach (var p in room.Players)
            {
                var uid = await _users.GetIdByUsernameAsync(p.Name);
                if (!uid.HasValue) continue;
                var result = p.Name == room.WinnerName ? "Win" : "Loss";
                var score = p.Name == room.WinnerName ? Math.Max(1, p.Fleet.Count(s => !s.Sunk) * 10) : 0;
                await _sessions.SaveAsync(new Models.GameSession
                {
                    UserId = uid.Value,
                    GameType = "BattleBoat",
                    Score = score,
                    Result = result,
                    TimePlayed = elapsed,
                    PlayedAt = now,
                    Details = "Multiplayer"
                });
            }
        }
        catch { }
    }

    private IEnumerable<object> BattleBoatRoomSummaries() =>
        _lobby.GetOpenBattleBoatRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            RoomName = r.Settings.RoomName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            IsFull = r.Players.Count >= r.Settings.MaxPlayers
        });

    private async Task BroadcastBattleBoatRooms() =>
        await Clients.All.SendAsync("BattleBoatRoomList", BattleBoatRoomSummaries());
}
