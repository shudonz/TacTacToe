using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using TacTacToe.Data;
using TacTacToe.Models;
using TacTacToe.Services;

namespace TacTacToe.Hubs;

[Authorize]
public partial class GameHub : Hub
{
    private const int RoomNameMaxLength = 30;
    private const int DefaultRejoinGracePeriodSeconds = 8;
    private const int YahtzeeRejoinGracePeriodSeconds = 10;
    private const int ConcentrationMismatchDelayMs = 5000;
    private const int ConcentrationBotFirstMoveMinDelayMs = 500;
    private const int ConcentrationBotFirstMoveMaxDelayMs = 1000;
    private const int ConcentrationBotSecondMoveMinDelayMs = 400;
    private const int ConcentrationBotSecondMoveMaxDelayMs = 900;

    private readonly LobbyService _lobby;
    private readonly IHubContext<GameHub> _hubContext;
    private readonly UserRepository _users;
    private readonly GameSessionRepository _sessions;

    public GameHub(LobbyService lobby, IHubContext<GameHub> hubContext, UserRepository users, GameSessionRepository sessions)
    {
        _lobby = lobby;
        _hubContext = hubContext;
        _users = users;
        _sessions = sessions;
    }

    public override async Task OnConnectedAsync()
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var email = Context.User?.FindFirst(ClaimTypes.Email)?.Value ?? "";
        var picture = Context.User?.FindFirst("picture")?.Value ?? "";
        _lobby.AddPlayer(Context.ConnectionId, name, email, picture);
        await BroadcastLobby();
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var disconnectedConnectionId = Context.ConnectionId;

        // Defer Slots waiting-room cleanup (same navigation grace period as TTT/Yahtzee)
        var slotsWaitSnapshot = _lobby.GetSlotsRoomsForConnection(disconnectedConnectionId).ToList();
        if (slotsWaitSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                bool changed = false;
                foreach (var snap in slotsWaitSnapshot)
                {
                    var room = _lobby.GetSlotsRoom(snap.Id);
                    if (room == null || room.Started) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    room.Players.Remove(player);
                    changed = true;
                    if (room.Players.Count == 0 || room.HostName == name)
                    { await _hubContext.Clients.Group(room.Id).SendAsync("SlotsRoomDissolved"); _lobby.RemoveSlotsRoom(room.Id); }
                    else
                    { await _hubContext.Clients.Group(room.Id).SendAsync("SlotsRoomUpdated", room); }
                }
                if (changed) await _hubContext.Clients.All.SendAsync("SlotsRoomList", SlotsRoomSummaries());
            });
        }

        // Defer Slots active-game disconnect
        var slotsGameSnapshot = _lobby.GetActiveSlotsRoomsForConnection(disconnectedConnectionId).ToList();
        if (slotsGameSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                foreach (var snap in slotsGameSnapshot)
                {
                    var room = _lobby.GetSlotsRoom(snap.Id);
                    if (room == null || room.IsOver) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    player.Connected = false;
                    await _hubContext.Clients.Group(room.Id).SendAsync("PlayerLeft", name);

                    var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
                    if (connectedHumans.Count == 0)
                    {
                        _lobby.RemoveSlotsRoom(room.Id);
                        await BroadcastSlotsRooms();
                        continue;
                    }
                    if (connectedHumans.Count == 1 && !room.IsSinglePlayer)
                    {
                        room.IsOver = true;
                        room.WinnerName = connectedHumans[0].Name;
                        await _hubContext.Clients.Group(room.Id).SendAsync("SlotsUpdated", room);
                        await BroadcastSlotsRooms();
                        continue;
                    }

                    if (!player.HasSpun && room.Phase == SlotsPhase.Betting)
                    {
                        if (player.Balance > 0)
                        {
                            var (betPerLine, activePaylines) = ChooseAutoSlotsBet(player.Balance);
                            player.BetPerLine = betPerLine;
                            player.ActivePaylines = activePaylines;
                            player.CurrentBet = betPerLine * activePaylines;
                            player.Reels = SlotsEngine.SpinReels();
                            var spin = SlotsEngine.EvaluateSpin(player.Reels, betPerLine, activePaylines);
                            player.Balance = player.Balance - player.CurrentBet + spin.Payout;
                            player.LastWin = spin.Payout;
                            player.WinningPaylines = spin.WinningPaylines;
                            player.TotalMultiplier = spin.TotalMultiplier;
                        }
                        player.HasSpun = true;
                        await _hubContext.Clients.Group(room.Id).SendAsync("SlotsUpdated", room);
                        if (AllSlotsSpun(room)) _ = AdvanceSlotsRoundAsync(room.Id);
                    }
                }
            });
        }

        // Defer Concentration waiting-room cleanup (same navigation grace period)
        var concentrationWaitSnapshot = _lobby.GetConcentrationRoomsForConnection(disconnectedConnectionId).ToList();
        if (concentrationWaitSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                bool changed = false;
                foreach (var snap in concentrationWaitSnapshot)
                {
                    var room = _lobby.GetConcentrationRoom(snap.Id);
                    if (room == null || room.Started) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    room.Players.Remove(player);
                    changed = true;
                    if (room.Players.Count == 0 || room.HostName == name)
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("ConcentrationRoomDissolved");
                        _lobby.RemoveConcentrationRoom(room.Id);
                    }
                    else
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("ConcentrationRoomUpdated", room);
                    }
                }
                if (changed) await _hubContext.Clients.All.SendAsync("ConcentrationRoomList", ConcentrationRoomSummaries());
            });
        }

        // Defer Concentration active-game disconnect handling
        var concentrationGameSnapshot = _lobby.GetActiveConcentrationRoomsForConnection(disconnectedConnectionId).ToList();
        if (concentrationGameSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                foreach (var snap in concentrationGameSnapshot)
                {
                    var room = _lobby.GetConcentrationRoom(snap.Id);
                    if (room == null || room.IsOver) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    player.Connected = false;
                    await _hubContext.Clients.Group(room.Id).SendAsync("PlayerLeft", name);

                    var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
                    if (connectedHumans.Count == 0)
                    {
                        _lobby.RemoveConcentrationRoom(room.Id);
                        continue;
                    }
                    if (connectedHumans.Count == 1 && !room.IsSinglePlayer)
                    {
                        room.IsOver = true;
                        room.WinnerName = connectedHumans[0].Name;
                        await _hubContext.Clients.Group(room.Id).SendAsync("ConcentrationUpdated", BuildConcentrationState(room));
                        continue;
                    }

                    if (room.Players[room.CurrentPlayerIndex].ConnectionId == disconnectedConnectionId)
                    {
                        MoveToNextConcentrationPlayer(room);
                        await _hubContext.Clients.Group(room.Id).SendAsync("ConcentrationUpdated", BuildConcentrationState(room));
                        if (!room.IsOver) _ = TakeConcentrationBotTurnAsync(room.Id);
                    }
                }
            });
        }

        // Defer Solitaire waiting-room cleanup
        var solitaireWaitSnapshot = _lobby.GetSolitaireRoomsForConnection(disconnectedConnectionId).ToList();
        if (solitaireWaitSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                bool changed = false;
                foreach (var snap in solitaireWaitSnapshot)
                {
                    var room = _lobby.GetSolitaireRoom(snap.Id);
                    if (room == null || room.Started) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    room.Players.Remove(player);
                    changed = true;
                    if (room.Players.Count == 0 || room.HostName == name)
                    { await _hubContext.Clients.Group(room.Id).SendAsync("SolitaireRoomDissolved"); _lobby.RemoveSolitaireRoom(room.Id); }
                    else
                    { await _hubContext.Clients.Group(room.Id).SendAsync("SolitaireRoomUpdated", room); }
                }
                if (changed) await _hubContext.Clients.All.SendAsync("SolitaireRoomList", SolitaireRoomSummaries());
            });
        }

        // Defer Solitaire active-game disconnect
        var solitaireGameSnapshot = _lobby.GetActiveSolitaireRoomsForConnection(disconnectedConnectionId).ToList();
        if (solitaireGameSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                foreach (var snap in solitaireGameSnapshot)
                {
                    var room = _lobby.GetSolitaireRoom(snap.Id);
                    if (room == null || room.IsOver) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    player.Connected = false;
                    await _hubContext.Clients.Group(room.Id).SendAsync("PlayerLeft", name);

                    var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
                    if (connectedHumans.Count == 0)
                    { _lobby.RemoveSolitaireRoom(room.Id); }
                    else if (connectedHumans.Count == 1 && !room.IsSinglePlayer)
                    {
                        var winner = connectedHumans[0];
                        if (!winner.HasFinished)
                        {
                            winner.HasFinished = true;
                            room.FinishCount = Math.Max(room.FinishCount, 1);
                            winner.FinishRank = 1;
                            winner.FinishedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                            winner.Score = SolitaireEngine.ScoreFor(winner);
                        }
                        room.IsOver = true;
                        await _hubContext.Clients.Group(room.Id).SendAsync("SolitaireUpdated", room);
                    }
                    else
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("SolitaireUpdated", room);
                        CheckSolitaireOver(room);
                    }
                }
            });
        }

        // Defer Peg Solitaire waiting-room cleanup
        var pegWaitSnapshot = _lobby.GetPegSolitaireRoomsForConnection(disconnectedConnectionId).ToList();
        if (pegWaitSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                bool changed = false;
                foreach (var snap in pegWaitSnapshot)
                {
                    var room = _lobby.GetPegSolitaireRoom(snap.Id);
                    if (room == null || room.Started) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    room.Players.Remove(player);
                    changed = true;
                    if (room.Players.Count == 0 || room.HostName == name)
                    { await _hubContext.Clients.Group(room.Id).SendAsync("PegSolitaireRoomDissolved"); _lobby.RemovePegSolitaireRoom(room.Id); }
                    else
                    { await _hubContext.Clients.Group(room.Id).SendAsync("PegSolitaireRoomUpdated", room); }
                }
                if (changed) await _hubContext.Clients.All.SendAsync("PegSolitaireRoomList", PegSolitaireRoomSummaries());
            });
        }

        // Defer Peg Solitaire active-game disconnect
        var pegGameSnapshot = _lobby.GetActivePegSolitaireRoomsForConnection(disconnectedConnectionId).ToList();
        if (pegGameSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                foreach (var snap in pegGameSnapshot)
                {
                    var room = _lobby.GetPegSolitaireRoom(snap.Id);
                    if (room == null || room.IsOver) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    player.Connected = false;
                    await _hubContext.Clients.Group(room.Id).SendAsync("PlayerLeft", name);

                    var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
                    if (connectedHumans.Count == 0)
                    {
                        _lobby.RemovePegSolitaireRoom(room.Id);
                    }
                    else if (connectedHumans.Count == 1 && !room.IsSinglePlayer)
                    {
                        var winner = connectedHumans[0];
                        FinalizePegSolitairePlayer(room, winner);
                        room.IsOver = true;
                        await _hubContext.Clients.Group(room.Id).SendAsync("PegSolitaireUpdated", room);
                    }
                    else
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("PegSolitaireUpdated", room);
                        CheckPegSolitaireOver(room);
                    }
                }
            });
        }

        // Defer Chinese Checkers waiting-room cleanup
        var ccWaitSnapshot = _lobby.GetChineseCheckersRoomsForConnection(disconnectedConnectionId).ToList();
        if (ccWaitSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                bool changed = false;
                foreach (var snap in ccWaitSnapshot)
                {
                    var room = _lobby.GetChineseCheckersRoom(snap.Id);
                    if (room == null || room.Started) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    room.Players.Remove(player);
                    changed = true;
                    if (room.Players.Count == 0 || room.HostName == name)
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("ChineseCheckersRoomDissolved");
                        _lobby.RemoveChineseCheckersRoom(room.Id);
                    }
                    else
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("ChineseCheckersRoomUpdated", room);
                    }
                }
                if (changed) await _hubContext.Clients.All.SendAsync("ChineseCheckersRoomList", ChineseCheckersRoomSummaries());
            });
        }

        // Defer Chinese Checkers active-game disconnect handling
        var ccGameSnapshot = _lobby.GetActiveChineseCheckersRoomsForConnection(disconnectedConnectionId).ToList();
        if (ccGameSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                foreach (var snap in ccGameSnapshot)
                {
                    var room = _lobby.GetChineseCheckersRoom(snap.Id);
                    if (room == null || room.IsOver) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    player.Connected = false;
                    await _hubContext.Clients.Group(room.Id).SendAsync("PlayerLeft", name);

                    if (room.IsSinglePlayer)
                    {
                        _lobby.RemoveChineseCheckersRoom(room.Id);
                        continue;
                    }

                    var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
                    if (connectedHumans.Count == 0)
                    {
                        _lobby.RemoveChineseCheckersRoom(room.Id);
                        continue;
                    }

                    if (room.Players[room.CurrentPlayerIndex].ConnectionId == disconnectedConnectionId)
                        MoveToNextChineseCheckersPlayer(room);

                    await _hubContext.Clients.Group(room.Id).SendAsync("ChineseCheckersUpdated", BuildChineseCheckersState(room));

                    if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
                        _ = TakeChineseCheckersBotTurnAsync(room.Id);
                }
            });
        }

        // Defer Crazy Eights waiting-room cleanup
        var ceWaitSnapshot = _lobby.GetCrazyEightsRoomsForConnection(disconnectedConnectionId).ToList();
        if (ceWaitSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                bool changed = false;
                foreach (var snap in ceWaitSnapshot)
                {
                    var room = _lobby.GetCrazyEightsRoom(snap.Id);
                    if (room == null || room.Started) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    room.Players.Remove(player);
                    changed = true;
                    if (room.Players.Count == 0 || room.HostName == name)
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("CrazyEightsRoomDissolved");
                        _lobby.RemoveCrazyEightsRoom(room.Id);
                    }
                    else
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("CrazyEightsRoomUpdated", room);
                    }
                }
                if (changed) await _hubContext.Clients.All.SendAsync("CrazyEightsRoomList", CrazyEightsRoomSummaries());
            });
        }

        // Defer Crazy Eights active-game disconnect handling
        var ceGameSnapshot = _lobby.GetActiveCrazyEightsRoomsForConnection(disconnectedConnectionId).ToList();
        if (ceGameSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                foreach (var snap in ceGameSnapshot)
                {
                    var room = _lobby.GetCrazyEightsRoom(snap.Id);
                    if (room == null || room.IsOver) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    player.Connected = false;
                    await _hubContext.Clients.Group(room.Id).SendAsync("PlayerLeft", name);

                    if (room.IsSinglePlayer)
                    {
                        _lobby.RemoveCrazyEightsRoom(room.Id);
                        continue;
                    }

                    var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
                    if (connectedHumans.Count == 0)
                    {
                        _lobby.RemoveCrazyEightsRoom(room.Id);
                        continue;
                    }

                    if (connectedHumans.Count == 1)
                    {
                        room.IsOver = true;
                        room.WinnerName = connectedHumans[0].Name;
                        await SaveCrazyEightsSessionsAsync(room);
                        await BroadcastCrazyEightsState(room);
                        continue;
                    }

                    if (room.Players[room.CurrentPlayerIndex].ConnectionId == disconnectedConnectionId)
                        MoveToNextCrazyEightsPlayer(room);

                    await BroadcastCrazyEightsState(room);
                    if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
                        _ = TakeCrazyEightsBotTurnAsync(room.Id);
                }
            });
        }

        // Defer Puzzle Time waiting-room cleanup
        var puzzleWaitSnapshot = _lobby.GetPuzzleTimeRoomsForConnection(disconnectedConnectionId).ToList();
        if (puzzleWaitSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                bool changed = false;
                foreach (var snap in puzzleWaitSnapshot)
                {
                    var room = _lobby.GetPuzzleTimeRoom(snap.Id);
                    if (room == null || room.Started) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    room.Players.Remove(player);
                    changed = true;
                    if (room.Players.Count == 0 || room.HostName == name)
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("PuzzleTimeRoomDissolved");
                        _lobby.RemovePuzzleTimeRoom(room.Id);
                    }
                    else
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("PuzzleTimeRoomUpdated", room);
                    }
                }
                if (changed) await _hubContext.Clients.All.SendAsync("PuzzleTimeRoomList", PuzzleTimeRoomSummaries());
            });
        }

        // Defer Puzzle Time active-game disconnect handling
        var puzzleGameSnapshot = _lobby.GetActivePuzzleTimeRoomsForConnection(disconnectedConnectionId).ToList();
        if (puzzleGameSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                foreach (var snap in puzzleGameSnapshot)
                {
                    var room = _lobby.GetPuzzleTimeRoom(snap.Id);
                    if (room == null || room.IsOver) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;

                    player.Connected = false;
                    PuzzleTimeEngine.ReleaseLocksForConnection(room, disconnectedConnectionId);
                    await _hubContext.Clients.Group(room.Id).SendAsync("PlayerLeft", name);

                    if (room.IsSinglePlayer)
                    {
                        _lobby.RemovePuzzleTimeRoom(room.Id);
                        continue;
                    }

                    var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
                    if (connectedHumans.Count == 0)
                    {
                        _lobby.RemovePuzzleTimeRoom(room.Id);
                        continue;
                    }

                    await _hubContext.Clients.Group(room.Id).SendAsync("PuzzleTimeUpdated", BuildPuzzleTimeState(room));
                }
            });
        }

        // Defer Bones waiting-room cleanup
        var bonesWaitSnapshot = _lobby.GetBonesRoomsForConnection(disconnectedConnectionId).ToList();
        if (bonesWaitSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                bool changed = false;
                foreach (var snap in bonesWaitSnapshot)
                {
                    var room = _lobby.GetBonesRoom(snap.Id);
                    if (room == null || room.Started) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    room.Players.Remove(player);
                    changed = true;
                    if (room.Players.Count == 0 || room.HostName == name)
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("BonesRoomDissolved");
                        _lobby.RemoveBonesRoom(room.Id);
                    }
                    else
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("BonesRoomUpdated", room);
                    }
                }
                if (changed) await _hubContext.Clients.All.SendAsync("BonesRoomList", BonesRoomSummaries());
            });
        }

        // Defer Bones active-game disconnect handling
        var bonesGameSnapshot = _lobby.GetActiveBonesRoomsForConnection(disconnectedConnectionId).ToList();
        if (bonesGameSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                foreach (var snap in bonesGameSnapshot)
                {
                    var room = _lobby.GetBonesRoom(snap.Id);
                    if (room == null || room.IsOver) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    player.Connected = false;
                    await _hubContext.Clients.Group(room.Id).SendAsync("PlayerLeft", name);

                    if (room.IsSinglePlayer)
                    {
                        _lobby.RemoveBonesRoom(room.Id);
                        continue;
                    }

                    var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
                    if (connectedHumans.Count == 0)
                    {
                        _lobby.RemoveBonesRoom(room.Id);
                        continue;
                    }

                    if (connectedHumans.Count == 1 && !room.IsOver)
                    {
                        room.IsOver = true;
                        room.WinnerName = connectedHumans[0].Name;
                        await SaveBonesSessionsAsync(room);
                        await BroadcastBonesState(room);
                        continue;
                    }

                    if (room.Players[room.CurrentPlayerIndex].ConnectionId == disconnectedConnectionId)
                        MoveToNextBonesPlayer(room);

                    await BroadcastBonesState(room);
                    if (!room.IsOver && !room.RoundOver && room.Players[room.CurrentPlayerIndex].IsBot)
                        _ = TakeBonesBotTurnAsync(room.Id);
                }
            });
        }

        // Defer Fox and Hounds waiting-room cleanup
        var fahWaitSnapshot = _lobby.GetFoxAndHoundsRoomsForConnection(disconnectedConnectionId).ToList();
        if (fahWaitSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                bool changed = false;
                foreach (var snap in fahWaitSnapshot)
                {
                    var room = _lobby.GetFoxAndHoundsRoom(snap.Id);
                    if (room == null || room.Started) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    room.Players.Remove(player);
                    changed = true;
                    if (room.Players.Count == 0 || room.HostName == name)
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("FoxAndHoundsRoomDissolved");
                        _lobby.RemoveFoxAndHoundsRoom(room.Id);
                    }
                    else
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("FoxAndHoundsRoomUpdated", room);
                    }
                }
                if (changed) await _hubContext.Clients.All.SendAsync("FoxAndHoundsRoomList", FoxAndHoundsRoomSummaries());
            });
        }

        // Defer Fox and Hounds active-game disconnect handling
        var fahGameSnapshot = _lobby.GetActiveFoxAndHoundsRoomsForConnection(disconnectedConnectionId).ToList();
        if (fahGameSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                foreach (var snap in fahGameSnapshot)
                {
                    var room = _lobby.GetFoxAndHoundsRoom(snap.Id);
                    if (room == null || room.IsOver) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    player.Connected = false;
                    await _hubContext.Clients.Group(room.Id).SendAsync("PlayerLeft", name);

                    if (room.IsSinglePlayer) { _lobby.RemoveFoxAndHoundsRoom(room.Id); continue; }

                    var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
                    if (connectedHumans.Count == 0) { _lobby.RemoveFoxAndHoundsRoom(room.Id); continue; }

                    room.IsOver = true;
                    room.WinnerName = connectedHumans[0].Name;
                    room.WinnerRole = connectedHumans[0].Role;
                    await _hubContext.Clients.Group(room.Id).SendAsync("FoxAndHoundsUpdated", BuildFoxAndHoundsState(room));
                    _ = SaveFoxAndHoundsSessionsAsync(room);
                }
            });
        }

        // Defer TTT room cleanup
        // because creating/joining a room causes a page navigation which disconnects the
        // lobby connection before RejoinTttRoom can update the player's ConnectionId.
        var tttSnapshot = _lobby.GetTttRoomsForConnection(disconnectedConnectionId).ToList();
        if (tttSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                bool changed = false;
                foreach (var snap in tttSnapshot)
                {
                    var room = _lobby.GetTttRoom(snap.Id);
                    if (room == null || room.Started) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name);
                    // If the player rejoined, RejoinTttRoom will have updated their ConnectionId
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;

                    room.Players.Remove(player);
                    changed = true;
                    if (room.Players.Count == 0 || room.HostName == name)
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("TttRoomDissolved");
                        _lobby.RemoveTttRoom(room.Id);
                    }
                    else
                    {
                        await _hubContext.Clients.Group(room.Id).SendAsync("TttRoomUpdated", room);
                    }
                }
                if (changed)
                    await _hubContext.Clients.All.SendAsync("TttRoomList", TttRoomSummaries());
            });
        }

        // Defer TTT game disconnect — grace period lets page-navigation reconnects through JoinGame
        var gameSnapshot = _lobby.GetGamesForConnection(disconnectedConnectionId).ToList();
        if (gameSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                foreach (var snap in gameSnapshot)
                {
                    var game = _lobby.GetGame(snap.Id);
                    if (game == null) continue;

                    // If the player reconnected, JoinGame will have updated their ConnectionId
                    bool stillX = game.XConnectionId == disconnectedConnectionId;
                    bool stillO = game.OConnectionId == disconnectedConnectionId;
                    if (!stillX && !stillO) continue;

                    if (!game.IsOver)
                    {
                        game.IsOver = true;
                        game.Winner = stillX ? "O" : "X";
                        await _hubContext.Clients.Group(game.Id).SendAsync("GameUpdated", game);
                    }

                    await _hubContext.Clients.Group(game.Id).SendAsync("OpponentLeft");
                    _lobby.RemoveGame(game.Id);
                }
            });
        }

        // Defer Yahtzee waiting-room cleanup (navigation/rejoin grace period)
        var yahtzeeWaitSnapshot = _lobby.GetPublicRooms()
            .Where(r => r.Players.Any(p => p.ConnectionId == disconnectedConnectionId))
            .Select(r => r.Id)
            .ToList();
        if (yahtzeeWaitSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(DefaultRejoinGracePeriodSeconds));
                bool changed = false;
                foreach (var roomId in yahtzeeWaitSnapshot)
                {
                    var room = _lobby.GetRoom(roomId);
                    if (room == null || room.Started || room.IsOver) continue;
                    var player = room.Players.FirstOrDefault(p => p.ConnectionId == disconnectedConnectionId);
                    if (player == null) continue;

                    room.Players.Remove(player);
                    changed = true;
                    if (room.Players.Count == 0 || room.HostConnectionId == disconnectedConnectionId)
                    {
                        _lobby.RemoveRoom(room.Id);
                    }
                    else
                    {
                        room.HostConnectionId = room.Players[0].ConnectionId;
                        room.HostName = room.Players[0].Name;
                        await _hubContext.Clients.Group(room.Id).SendAsync("YahtzeeRoomUpdated", room);
                    }
                }
                if (changed) await BroadcastYahtzeeRooms();
            });
        }

        // Defer Yahtzee mid-game disconnect handling to give page-navigations time to rejoin
        var roomsSnapshot = _lobby.GetActiveRoomsForConnection(disconnectedConnectionId).ToList();
        if (roomsSnapshot.Count > 0)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(TimeSpan.FromSeconds(YahtzeeRejoinGracePeriodSeconds));
                foreach (var snapshot in roomsSnapshot)
                {
                    var room = _lobby.GetRoom(snapshot.Id);
                    if (room == null || room.IsOver) continue;
                    var player = room.Players.FirstOrDefault(p => p.Name == name);
                    if (player == null || player.ConnectionId != disconnectedConnectionId) continue;
                    await HandleYahtzeePlayerDisconnected(room, disconnectedConnectionId, name);
                }
            });
        }

        _lobby.RemovePlayer(disconnectedConnectionId);
        await BroadcastLobby();
        await BroadcastAllRoomLists();
        await base.OnDisconnectedAsync(exception);
    }

    private async Task HandleYahtzeePlayerDisconnected(YahtzeeRoom room, string connectionId, string playerName)
    {
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == connectionId);
        if (player == null) return;

        player.Connected = false;

        // Notify remaining players (connection is gone so use _hubContext, not Groups)
        await _hubContext.Clients.Group(room.Id).SendAsync("PlayerLeft", playerName);

        // If no human players remain, clean up silently
        var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
        if (connectedHumans.Count == 0)
        {
            _lobby.RemoveRoom(room.Id);
            return;
        }
        if (connectedHumans.Count == 1 && !room.IsSinglePlayer)
        {
            room.IsOver = true;
            room.WinnerName = connectedHumans[0].Name;
            await _hubContext.Clients.Group(room.Id).SendAsync("YahtzeeUpdated", room);
            await BroadcastYahtzeeRooms();
            return;
        }

        // If it was the leaving player's turn, advance to the next connected player
        if (room.CurrentPlayerConnectionId == connectionId)
        {
            int next = room.CurrentPlayerIndex;
            int tries = 0;
            do
            {
                next = (next + 1) % room.Players.Count;
                tries++;
            }
            while (!room.Players[next].Connected && tries < room.Players.Count);

            room.CurrentPlayerIndex = next;
            room.RollsLeft = room.Settings.RollsPerTurn;
            room.Held = new bool[room.Settings.NumberOfDice];
            room.Dice = new int[room.Settings.NumberOfDice];

            // Trigger AI turn if the next player is a bot
            var nextPlayer = room.Players[next];
            if (nextPlayer.IsBot && !room.IsOver)
                _ = TakeYahtzeeAiBotTurnAsync(room.Id, nextPlayer.AiDifficulty);
        }

        await _hubContext.Clients.Group(room.Id).SendAsync("YahtzeeUpdated", room);
        await BroadcastYahtzeeRooms();
    }

    /* ================================================================
       TTT Room Methods
       ================================================================ */

    public async Task CreateTttRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateTttRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, RoomNameMaxLength)];
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("TttRoomCreated", roomId);
        await BroadcastTttRooms();
    }

    public async Task GetTttRooms()
    {
        await Clients.Caller.SendAsync("TttRoomList", TttRoomSummaries());
    }

    public async Task JoinTttRoom(string roomId)
    {
        var room = _lobby.GetTttRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= 2) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new TttPlayer { ConnectionId = Context.ConnectionId, Name = name });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("TttRoomUpdated", room);
        await BroadcastTttRooms();
    }

    public async Task RejoinTttRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetTttRoom(roomId);
        if (room == null || room.Started) return;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var player = room.Players.FirstOrDefault(p => p.Name == name);
        if (player == null) return;
        player.ConnectionId = Context.ConnectionId;
        if (room.HostName == name) room.HostConnectionId = Context.ConnectionId;
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("TttRoomUpdated", room);
    }

    public async Task StartTttGame(string roomId)
    {
        var room = _lobby.GetTttRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        if (room.Players.Count < 2) return;

        room.Started = true;
        var gameId = Guid.NewGuid().ToString("N");
        var x = room.Players[0]; // host plays X
        var o = room.Players[1];

        var game = new GameState
        {
            Id = gameId,
            XConnectionId = x.ConnectionId,
            OConnectionId = o.ConnectionId,
            XName = x.Name,
            OName = o.Name,
            Board = new string[9],
            CurrentTurn = "X",
            IsOver = false,
            StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
        _lobby.StoreGame(gameId, game);
        await Groups.AddToGroupAsync(x.ConnectionId, gameId);
        await Groups.AddToGroupAsync(o.ConnectionId, gameId);
        await Clients.Client(x.ConnectionId).SendAsync("GameStarted", gameId, "X", x.Name, o.Name);
        await Clients.Client(o.ConnectionId).SendAsync("GameStarted", gameId, "O", x.Name, o.Name);

        _lobby.RemoveTttRoom(roomId);
        await BroadcastTttRooms();
    }

    public async Task LeaveTttRoom(string roomId)
    {
        var room = _lobby.GetTttRoom(roomId);
        if (room == null) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
        if (player != null) room.Players.Remove(player);

        if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
        {
            await Clients.Group(roomId).SendAsync("TttRoomDissolved");
            _lobby.RemoveTttRoom(roomId);
        }
        else
        {
            await Clients.Group(roomId).SendAsync("TttRoomUpdated", room);
        }
        await BroadcastTttRooms();
    }

    public async Task KickTttPlayer(string roomId, string playerName)
    {
        var room = _lobby.GetTttRoom(roomId);
        if (room == null) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;
        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);
        await Clients.Group(roomId).SendAsync("TttRoomUpdated", room);
        await BroadcastTttRooms();
    }

    private IEnumerable<object> TttRoomSummaries() =>
        _lobby.GetOpenTttRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            r.RoomName,
            PlayerCount = r.Players.Count,
            IsFull = r.Players.Count >= 2
        });

    private async Task BroadcastTttRooms() =>
        await Clients.All.SendAsync("TttRoomList", TttRoomSummaries());

    /* ================================================================
       Slots Room Methods
       ================================================================ */

    public async Task CreateSlotsRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateSlotsRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.Settings.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, RoomNameMaxLength)];
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("SlotsRoomCreated", roomId);
        await BroadcastSlotsRooms();
    }

    public async Task GetSlotsRooms() =>
        await Clients.Caller.SendAsync("SlotsRoomList", SlotsRoomSummaries());

    public async Task JoinSlotsRoom(string roomId)
    {
        var room = _lobby.GetSlotsRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new SlotsPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("SlotsRoomUpdated", room);
        await BroadcastSlotsRooms();
    }

    public async Task RejoinSlotsRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetSlotsRoom(roomId);
        if (room == null) return;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
        if (player == null) return;
        player.ConnectionId = Context.ConnectionId;
        player.Connected = true;
        if (room.HostName == name) room.HostConnectionId = Context.ConnectionId;
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        if (room.Started)
        {
            _lobby.SetInGame(Context.ConnectionId, true);
            await BroadcastLobby();
            await Clients.Caller.SendAsync("SlotsUpdated", room);
        }
        else
        {
            await Clients.Group(roomId).SendAsync("SlotsRoomUpdated", room);
        }
    }

    public async Task StartSlotsGame(string roomId)
    {
        var room = _lobby.GetSlotsRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        if (room.Players.Count < 2) return;
        room.Started = true;
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var p in room.Players) p.Balance = room.Settings.StartingBalance;
        await Clients.Group(roomId).SendAsync("SlotsGameStarted", room);
        await BroadcastSlotsRooms();
    }

    public async Task LeaveSlotsRoom(string roomId)
    {
        var room = _lobby.GetSlotsRoom(roomId);
        if (room == null) return;
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (!room.Started)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
            if (player != null) room.Players.Remove(player);
            if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
            { await Clients.Group(roomId).SendAsync("SlotsRoomDissolved"); _lobby.RemoveSlotsRoom(roomId); }
            else
            { await Clients.Group(roomId).SendAsync("SlotsRoomUpdated", room); }
        }
        else
        {
            if (player != null) player.Connected = false;
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
            await Clients.Group(roomId).SendAsync("PlayerLeft", player?.Name ?? "Someone");

            var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
            if (connectedHumans.Count == 0)
                _lobby.RemoveSlotsRoom(roomId);
            else if (connectedHumans.Count == 1 && !room.IsSinglePlayer)
            {
                room.IsOver = true;
                room.WinnerName = connectedHumans[0].Name;
                await Clients.Group(roomId).SendAsync("SlotsUpdated", room);
            }
            else if (player != null && !player.HasSpun && room.Phase == SlotsPhase.Betting && player.Balance > 0)
            {
                var (betPerLine, activePaylines) = ChooseAutoSlotsBet(player.Balance);
                player.BetPerLine = betPerLine;
                player.ActivePaylines = activePaylines;
                player.CurrentBet = betPerLine * activePaylines;
                player.Reels = SlotsEngine.SpinReels();
                var spin = SlotsEngine.EvaluateSpin(player.Reels, betPerLine, activePaylines);
                player.Balance = player.Balance - player.CurrentBet + spin.Payout;
                player.LastWin = spin.Payout;
                player.WinningPaylines = spin.WinningPaylines;
                player.TotalMultiplier = spin.TotalMultiplier;
                player.HasSpun = true;
                await Clients.Group(roomId).SendAsync("SlotsUpdated", room);
                if (AllSlotsSpun(room)) _ = AdvanceSlotsRoundAsync(roomId);
            }
        }
        await BroadcastSlotsRooms();
    }

    public async Task KickSlotsPlayer(string roomId, string playerName)
    {
        var room = _lobby.GetSlotsRoom(roomId);
        if (room == null) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;
        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);
        await Clients.Group(roomId).SendAsync("SlotsRoomUpdated", room);
        await BroadcastSlotsRooms();
    }

    public async Task SpinSlots(string roomId, int betPerLine, int activePaylines)
    {
        var room = _lobby.GetSlotsRoom(roomId);
        if (room == null || !room.Started || room.IsOver || room.Phase != SlotsPhase.Betting) return;
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && !p.IsBot);
        if (player == null || player.HasSpun || player.Balance <= 0) return;
        activePaylines = Math.Clamp(activePaylines, 1, SlotsEngine.MaxPaylines);
        if (betPerLine < 1) return;
        int totalBet = betPerLine * activePaylines;
        if (totalBet < 1 || totalBet > player.Balance) return;

        player.BetPerLine = betPerLine;
        player.ActivePaylines = activePaylines;
        player.CurrentBet = totalBet;
        player.Reels = SlotsEngine.SpinReels();
        var spin = SlotsEngine.EvaluateSpin(player.Reels, betPerLine, activePaylines);
        player.Balance = player.Balance - totalBet + spin.Payout;
        player.LastWin = spin.Payout;
        player.WinningPaylines = spin.WinningPaylines;
        player.TotalMultiplier = spin.TotalMultiplier;
        player.HasSpun = true;

        await Clients.Group(roomId).SendAsync("SlotsUpdated", room);
        if (AllSlotsSpun(room)) _ = AdvanceSlotsRoundAsync(roomId);
    }

    public async Task StartSlotsSinglePlayer()
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");
        var room = new SlotsRoom
        {
            Id = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName = name,
            IsSinglePlayer = true,
            Players =
            [
                new SlotsPlayer { ConnectionId = Context.ConnectionId, Name = name, Balance = 1000, Connected = true },
                new SlotsPlayer { ConnectionId = "BOT_" + roomId, Name = "🎰 The Machine", Balance = 1000, IsBot = true, Connected = true }
            ]
        };
        room.Settings.RoomName = "vs The Machine";
        room.Settings.MaxPlayers = 2;
        room.Started = true;
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        _lobby.StoreSlotsRoom(roomId, room);
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("SlotsSinglePlayerStarted", roomId);
        _ = TakeSlotsBotTurnAsync(roomId);
    }

    private static bool AllSlotsSpun(SlotsRoom room) =>
        room.Players.All(p => p.HasSpun);

    private async Task AdvanceSlotsRoundAsync(string roomId)
    {
        // Show results phase briefly
        var r0 = _lobby.GetSlotsRoom(roomId);
        if (r0 != null) { r0.Phase = SlotsPhase.Results; await _hubContext.Clients.Group(roomId).SendAsync("SlotsUpdated", r0); }

        await Task.Delay(3500);

        var room = _lobby.GetSlotsRoom(roomId);
        if (room == null) return;

        room.RoundsPlayed++;
        bool allBust = room.Players.Where(p => !p.IsBot).All(p => p.Balance <= 0);
        bool done = room.RoundsPlayed >= room.Settings.TotalRounds;

        if (allBust || done)
        {
            room.IsOver = true;
            room.WinnerName = room.Players.OrderByDescending(p => p.Balance).First().Name;
            await _hubContext.Clients.Group(roomId).SendAsync("SlotsUpdated", room);
            _ = SaveSlotsSessionsAsync(room);
            return;
        }

        // Reset for next round — bust players are auto-marked so they don't block
        room.Phase = SlotsPhase.Betting;
        foreach (var p in room.Players)
        {
            p.HasSpun = p.Balance <= 0;
            if (!p.HasSpun)
            {
                p.Reels = SlotsEngine.UnspunReels();
                p.CurrentBet = 0;
                p.BetPerLine = 0;
                p.ActivePaylines = 0;
                p.LastWin = 0;
                p.WinningPaylines = [];
                p.TotalMultiplier = 0;
            }
        }

        await _hubContext.Clients.Group(roomId).SendAsync("SlotsUpdated", room);

        if (room.IsSinglePlayer) _ = TakeSlotsBotTurnAsync(roomId);
    }

    private async Task TakeSlotsBotTurnAsync(string roomId)
    {
        await Task.Delay(Random.Shared.Next(900, 2200));
        var room = _lobby.GetSlotsRoom(roomId);
        if (room == null || room.IsOver || room.Phase != SlotsPhase.Betting) return;
        var bot = room.Players.FirstOrDefault(p => p.IsBot && !p.HasSpun && p.Balance > 0);
        if (bot == null) return;

        var (betPerLine, activePaylines) = ChooseAutoSlotsBet(bot.Balance);
        bot.BetPerLine = betPerLine;
        bot.ActivePaylines = activePaylines;
        bot.CurrentBet = betPerLine * activePaylines;
        bot.Reels = SlotsEngine.SpinReels();
        var spin = SlotsEngine.EvaluateSpin(bot.Reels, betPerLine, activePaylines);
        bot.Balance = bot.Balance - bot.CurrentBet + spin.Payout;
        bot.LastWin = spin.Payout;
        bot.WinningPaylines = spin.WinningPaylines;
        bot.TotalMultiplier = spin.TotalMultiplier;
        bot.HasSpun = true;

        await _hubContext.Clients.Group(roomId).SendAsync("SlotsUpdated", room);
        if (AllSlotsSpun(room)) _ = AdvanceSlotsRoundAsync(roomId);
    }

    private IEnumerable<object> SlotsRoomSummaries() =>
        _lobby.GetOpenSlotsRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            RoomName = r.Settings.RoomName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            IsFull = r.Players.Count >= r.Settings.MaxPlayers
        });

    private async Task BroadcastSlotsRooms() =>
        await Clients.All.SendAsync("SlotsRoomList", SlotsRoomSummaries());

    private static (int BetPerLine, int ActivePaylines) ChooseAutoSlotsBet(int balance)
    {
        if (balance <= 0) return (1, 1);

        int[] paylineOptions = [5, 3, 1];
        int[] betPerLineOptions = [50, 25, 10, 5, 2, 1];

        foreach (var lines in paylineOptions)
        {
            if (lines > balance) continue;
            foreach (var perLine in betPerLineOptions)
            {
                if (perLine * lines <= balance) return (perLine, lines);
            }
        }

        return (1, 1);
    }

    /* ================================================================
       Concentration Madness Methods
       ================================================================ */

    public async Task CreateConcentrationRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateConcentrationRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
        {
            var trimmedName = roomName.Trim();
            room.Settings.RoomName = trimmedName[..Math.Min(trimmedName.Length, RoomNameMaxLength)];
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("ConcentrationRoomCreated", roomId);
        await BroadcastConcentrationRooms();
    }

    public async Task GetConcentrationRooms() =>
        await Clients.Caller.SendAsync("ConcentrationRoomList", ConcentrationRoomSummaries());

    public async Task JoinConcentrationRoom(string roomId)
    {
        var room = _lobby.GetConcentrationRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new ConcentrationPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("ConcentrationRoomUpdated", room);
        await BroadcastConcentrationRooms();
    }

    public async Task RejoinConcentrationRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetConcentrationRoom(roomId);
        if (room == null) return;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
        if (player == null) return;
        player.ConnectionId = Context.ConnectionId;
        player.Connected = true;
        if (room.HostName == name) room.HostConnectionId = Context.ConnectionId;
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        if (room.Started)
        {
            _lobby.SetInGame(Context.ConnectionId, true);
            await BroadcastLobby();
            await Clients.Caller.SendAsync("ConcentrationUpdated", BuildConcentrationState(room));
        }
        else
        {
            await Clients.Group(roomId).SendAsync("ConcentrationRoomUpdated", room);
        }
    }

    public async Task StartConcentrationGame(string roomId)
    {
        var room = _lobby.GetConcentrationRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        if (room.Players.Count < 2) return;

        room.Started = true;
        room.Settings.MaxPlayers = Math.Clamp(room.Settings.MaxPlayers, 2, 4);
        room.Settings.PairCount = 12;
        room.Deck = ConcentrationEngine.CreateDeck(room.Settings.PairCount);
        room.Matched = new bool[room.Deck.Count];
        room.CurrentPlayerIndex = 0;
        room.TurnRevealedIndexes.Clear();
        room.IsOver = false;
        room.WinnerName = null;
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var p in room.Players) p.Score = 0;

        await Clients.Group(roomId).SendAsync("ConcentrationGameStarted", room);
        await Clients.Group(roomId).SendAsync("ConcentrationUpdated", BuildConcentrationState(room));
        await BroadcastConcentrationRooms();
    }

    public async Task LeaveConcentrationRoom(string roomId)
    {
        var room = _lobby.GetConcentrationRoom(roomId);
        if (room == null) return;
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
        if (player != null) room.Players.Remove(player);
        if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
        {
            await Clients.Group(roomId).SendAsync("ConcentrationRoomDissolved");
            _lobby.RemoveConcentrationRoom(roomId);
        }
        else
        {
            await Clients.Group(roomId).SendAsync("ConcentrationRoomUpdated", room);
        }
        await BroadcastConcentrationRooms();
    }

    public async Task KickConcentrationPlayer(string roomId, string playerName)
    {
        var room = _lobby.GetConcentrationRoom(roomId);
        if (room == null) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;
        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);
        await Clients.Group(roomId).SendAsync("ConcentrationRoomUpdated", room);
        await BroadcastConcentrationRooms();
    }

    public async Task StartConcentrationSinglePlayer(string difficulty = "regular")
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");
        var botName = difficulty == "easy" ? "🤖 Computer (Easy)"
                    : difficulty == "hard"  ? "🤖 Computer (Hard)"
                    : "🤖 Computer";
        var room = new ConcentrationRoom
        {
            Id = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName = name,
            IsSinglePlayer = true,
            Started = true,
            Players =
            [
                new ConcentrationPlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true },
                new ConcentrationPlayer { ConnectionId = "BOT_" + roomId, Name = botName, IsBot = true, Connected = true, AiDifficulty = difficulty }
            ]
        };
        room.Settings.RoomName = "Concentration vs Computer";
        room.Settings.MaxPlayers = 2;
        room.Settings.PairCount = 12;
        room.Deck = ConcentrationEngine.CreateDeck(room.Settings.PairCount);
        room.Matched = new bool[room.Deck.Count];
        room.CurrentPlayerIndex = 0;
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        _lobby.StoreConcentrationRoom(roomId, room);
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("ConcentrationSinglePlayerStarted", roomId);
        await Clients.Caller.SendAsync("ConcentrationUpdated", BuildConcentrationState(room));
    }

    public async Task ConcentrationFlipCard(string roomId, int cardIndex)
    {
        var room = _lobby.GetConcentrationRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;
        if (cardIndex < 0 || cardIndex >= room.Deck.Count) return;
        if (room.Matched[cardIndex] || room.TurnRevealedIndexes.Contains(cardIndex)) return;
        if (room.TurnRevealedIndexes.Count >= 2) return;
        var current = room.Players[room.CurrentPlayerIndex];
        if (current.ConnectionId != Context.ConnectionId || current.IsBot) return;

        room.TurnRevealedIndexes.Add(cardIndex);
        room.SeenCardIndexes.Add(cardIndex);
        await Clients.Group(roomId).SendAsync("ConcentrationUpdated", BuildConcentrationState(room));

        if (room.TurnRevealedIndexes.Count < 2) return;

        var a = room.TurnRevealedIndexes[0];
        var b = room.TurnRevealedIndexes[1];
        bool isMatch = room.Deck[a] == room.Deck[b];
        if (isMatch)
        {
            room.Matched[a] = true;
            room.Matched[b] = true;
            current.Score++;
            room.TurnRevealedIndexes.Clear();
            EvaluateConcentrationWinner(room);
            await Clients.Group(roomId).SendAsync("ConcentrationUpdated", BuildConcentrationState(room));
            if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
                _ = TakeConcentrationBotTurnAsync(roomId);
            return;
        }

        await Clients.Group(roomId).SendAsync("ConcentrationUpdated", BuildConcentrationState(room));
        var revealedSnapshot = room.TurnRevealedIndexes.ToArray();
        await Task.Delay(ConcentrationMismatchDelayMs);
        var refreshed = _lobby.GetConcentrationRoom(roomId);
        if (refreshed == null || refreshed.IsOver || refreshed.TurnRevealedIndexes.Count != 2) return;
        if (!revealedSnapshot.All(i => refreshed.TurnRevealedIndexes.Contains(i))) return;
        refreshed.TurnRevealedIndexes.Clear();
        MoveToNextConcentrationPlayer(refreshed);
        await Clients.Group(roomId).SendAsync("ConcentrationUpdated", BuildConcentrationState(refreshed));
        if (!refreshed.IsOver && refreshed.Players[refreshed.CurrentPlayerIndex].IsBot)
            _ = TakeConcentrationBotTurnAsync(roomId);
    }

    public async Task LeaveConcentrationGame(string roomId)
    {
        var room = _lobby.GetConcentrationRoom(roomId);
        if (room == null) return;
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
        if (player == null) return;

        if (!room.Started)
        {
            room.Players.Remove(player);
            if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
                _lobby.RemoveConcentrationRoom(roomId);
            else
                await Clients.Group(roomId).SendAsync("ConcentrationRoomUpdated", room);
            await BroadcastConcentrationRooms();
            return;
        }

        if (room.IsSinglePlayer)
        {
            _lobby.RemoveConcentrationRoom(roomId);
            return;
        }

        player.Connected = false;
        await Clients.Group(roomId).SendAsync("PlayerLeft", player.Name);
        var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
        if (connectedHumans.Count == 0)
        {
            _lobby.RemoveConcentrationRoom(roomId);
            return;
        }
        if (connectedHumans.Count == 1 && !room.IsSinglePlayer)
        {
            room.IsOver = true;
            room.WinnerName = connectedHumans[0].Name;
            await Clients.Group(roomId).SendAsync("ConcentrationUpdated", BuildConcentrationState(room));
            return;
        }

        if (room.Players[room.CurrentPlayerIndex].ConnectionId == Context.ConnectionId)
            MoveToNextConcentrationPlayer(room);

        await Clients.Group(roomId).SendAsync("ConcentrationUpdated", BuildConcentrationState(room));
        if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
            _ = TakeConcentrationBotTurnAsync(roomId);
    }

    private IEnumerable<object> ConcentrationRoomSummaries() =>
        _lobby.GetOpenConcentrationRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            RoomName = r.Settings.RoomName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            IsFull = r.Players.Count >= r.Settings.MaxPlayers,
            r.Started
        });

    private async Task BroadcastConcentrationRooms() =>
        await Clients.All.SendAsync("ConcentrationRoomList", ConcentrationRoomSummaries());

    private object BuildConcentrationState(ConcentrationRoom room)
    {
        return new
        {
            room.Id,
            room.Started,
            room.IsOver,
            room.WinnerName,
            room.CurrentPlayerIndex,
            TurnLocked = room.TurnRevealedIndexes.Count >= 2,
            Players = room.Players.Select(p => new
            {
                p.Name,
                p.Score,
                p.Connected,
                p.IsBot
            }),
            Cards = room.Deck.Select((emoji, index) => new
            {
                Index = index,
                IsMatched = room.Matched.Length > index && room.Matched[index],
                IsRevealed = room.TurnRevealedIndexes.Contains(index),
                Emoji = room.TurnRevealedIndexes.Contains(index) || (room.Matched.Length > index && room.Matched[index]) ? emoji : null
            })
        };
    }

    private void MoveToNextConcentrationPlayer(ConcentrationRoom room)
    {
        if (room.IsOver || room.Players.Count == 0) return;
        int tries = 0;
        do
        {
            room.CurrentPlayerIndex = (room.CurrentPlayerIndex + 1) % room.Players.Count;
            tries++;
        }
        while (!room.Players[room.CurrentPlayerIndex].Connected && tries < room.Players.Count);
    }

    private void EvaluateConcentrationWinner(ConcentrationRoom room)
    {
        if (room.Matched.Any(m => !m)) return;
        room.IsOver = true;
        var best = room.Players.Max(p => p.Score);
        var leaders = room.Players.Where(p => p.Score == best).ToList();
        room.WinnerName = leaders.Count == 1 ? leaders[0].Name : null;
        _ = SaveConcentrationSessionsAsync(room);
    }

    private async Task TakeConcentrationBotTurnAsync(string roomId)
    {
        await Task.Delay(Random.Shared.Next(ConcentrationBotFirstMoveMinDelayMs, ConcentrationBotFirstMoveMaxDelayMs));
        var room = _lobby.GetConcentrationRoom(roomId);
        if (room == null || room.IsOver || !room.Started) return;
        var bot = room.Players[room.CurrentPlayerIndex];
        if (!bot.IsBot || !bot.Connected || room.TurnRevealedIndexes.Count > 0) return;

        var available = Enumerable.Range(0, room.Deck.Count)
            .Where(i => !room.Matched[i])
            .ToList();
        if (available.Count < 2) return;

        int first = available[Random.Shared.Next(available.Count)];
        room.TurnRevealedIndexes.Add(first);
        room.SeenCardIndexes.Add(first);
        await _hubContext.Clients.Group(roomId).SendAsync("ConcentrationUpdated", BuildConcentrationState(room));

        await Task.Delay(Random.Shared.Next(ConcentrationBotSecondMoveMinDelayMs, ConcentrationBotSecondMoveMaxDelayMs));
        available = Enumerable.Range(0, room.Deck.Count)
            .Where(i => !room.Matched[i] && !room.TurnRevealedIndexes.Contains(i))
            .ToList();
        if (available.Count == 0) return;

        // Bot only uses memory of previously-seen cards — not perfect deck knowledge.
        // Miss chance varies by difficulty:
        //   easy    — remembers  10% of the time (90% miss)
        //   regular — remembers  70% of the time (30% miss, default)
        //   hard    — remembers  90% of the time (10% miss)
        double botMissChance = bot.AiDifficulty switch
        {
            "easy" => 0.90,
            "hard" => 0.10,
            _      => 0.30
        };
        var knownMatchIdx = available
            .Where(i => room.SeenCardIndexes.Contains(i) && room.Deck[i] == room.Deck[first])
            .Cast<int?>()
            .FirstOrDefault();
        int second;
        if (knownMatchIdx.HasValue && Random.Shared.NextDouble() >= botMissChance)
        {
            second = knownMatchIdx.Value;
        }
        else
        {
            // Pick randomly from unseen cards first (looks more natural)
            var unseen = available.Where(i => !room.SeenCardIndexes.Contains(i)).ToList();
            second = unseen.Count > 0
                ? unseen[Random.Shared.Next(unseen.Count)]
                : available[Random.Shared.Next(available.Count)];
        }
        room.TurnRevealedIndexes.Add(second);
        room.SeenCardIndexes.Add(second);
        await _hubContext.Clients.Group(roomId).SendAsync("ConcentrationUpdated", BuildConcentrationState(room));

        bool isMatch = room.Deck[first] == room.Deck[second];
        if (isMatch)
        {
            room.Matched[first] = true;
            room.Matched[second] = true;
            bot.Score++;
            room.TurnRevealedIndexes.Clear();
            EvaluateConcentrationWinner(room);
            await _hubContext.Clients.Group(roomId).SendAsync("ConcentrationUpdated", BuildConcentrationState(room));
            if (!room.IsOver && room.Players[room.CurrentPlayerIndex].IsBot)
                _ = TakeConcentrationBotTurnAsync(roomId);
            return;
        }

        var botRevealSnapshot = room.TurnRevealedIndexes.ToArray();
        await Task.Delay(ConcentrationMismatchDelayMs);
        var refreshed = _lobby.GetConcentrationRoom(roomId);
        if (refreshed == null || refreshed.IsOver || refreshed.TurnRevealedIndexes.Count != 2) return;
        if (!botRevealSnapshot.All(i => refreshed.TurnRevealedIndexes.Contains(i))) return;
        refreshed.TurnRevealedIndexes.Clear();
        MoveToNextConcentrationPlayer(refreshed);
        await _hubContext.Clients.Group(roomId).SendAsync("ConcentrationUpdated", BuildConcentrationState(refreshed));
    }

    public async Task ReplaySinglePlayerTTT(string gameId)
    {
        var game = _lobby.GetGame(gameId);
        if (game == null || !game.IsOver || !game.IsSinglePlayer) return;
        if (Context.ConnectionId != game.XConnectionId) return;

        game.Board = new string[9];
        game.CurrentTurn = "X";
        game.IsOver = false;
        game.Winner = null;

        await Clients.Group(gameId).SendAsync("GameUpdated", game);
    }

    public async Task StartSinglePlayerTTT(string difficulty)
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var gameId = Guid.NewGuid().ToString("N");
        var aiName = difficulty == "hard" ? "🤖 Computer (Hard)" : "🤖 Computer";

        var game = new GameState
        {
            Id = gameId,
            XConnectionId = Context.ConnectionId,
            OConnectionId = "BOT_" + gameId,
            XName = name,
            OName = aiName,
            Board = new string[9],
            CurrentTurn = "X",
            IsSinglePlayer = true,
            AiDifficulty = difficulty,
            StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
        _lobby.StoreGame(gameId, game);

        await Groups.AddToGroupAsync(Context.ConnectionId, gameId);
        await Clients.Caller.SendAsync("GameStarted", gameId, "X", name, aiName);
    }

    public async Task JoinGame(string gameId, string mark)
    {
        var game = _lobby.GetGame(gameId);
        if (game == null) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";

        if (mark == "X" && game.XName == name)
            game.XConnectionId = Context.ConnectionId;
        else if (mark == "O" && game.OName == name)
            game.OConnectionId = Context.ConnectionId;
        else
            return;

        await Groups.AddToGroupAsync(Context.ConnectionId, gameId);
        _lobby.SetInGame(Context.ConnectionId, true);
        await BroadcastLobby();
        await Clients.Caller.SendAsync("GameUpdated", game);
    }

    public async Task MakeMove(string gameId, int cell)
    {
        var game = _lobby.GetGame(gameId);
        if (game == null || game.IsOver) return;
        if (cell < 0 || cell > 8 || game.Board[cell] != null) return;

        var isX = Context.ConnectionId == game.XConnectionId;
        var isO = Context.ConnectionId == game.OConnectionId;
        if (!isX && !isO) return;
        if (isX && game.CurrentTurn != "X") return;
        if (isO && game.CurrentTurn != "O") return;

        game.Board[cell] = game.CurrentTurn;

        if (CheckWin(game.Board, game.CurrentTurn))
        {
            game.IsOver = true;
            game.Winner = game.CurrentTurn;
        }
        else if (game.Board.All(c => c != null))
        {
            game.IsOver = true;
            game.Winner = null;
        }
        else
        {
            game.CurrentTurn = game.CurrentTurn == "X" ? "O" : "X";
        }

        await Clients.Group(gameId).SendAsync("GameUpdated", game);

        // Trigger AI move for single-player games
        if (!game.IsOver && game.IsSinglePlayer && game.CurrentTurn == "O")
            _ = TakeTttAiMoveAsync(gameId);

        if (game.IsOver)
            _ = SaveTttSessionsAsync(game);
    }

    public async Task LeaveGame(string gameId)
    {
        var game = _lobby.GetGame(gameId);
        if (game == null) return;

        if (!game.IsOver)
        {
            game.IsOver = true;
            game.Winner = Context.ConnectionId == game.XConnectionId ? "O" : "X";
            await Clients.Group(gameId).SendAsync("GameUpdated", game);
        }

        // Notify any remaining player in the group before we remove the leaver
        await Clients.OthersInGroup(gameId).SendAsync("OpponentLeft");
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, gameId);
        _lobby.RemoveGame(gameId);
    }

    public async Task RequestRematch(string gameId)
    {
        var game = _lobby.GetGame(gameId);
        if (game == null || !game.IsOver) return;

        var isX = Context.ConnectionId == game.XConnectionId;
        var isO = Context.ConnectionId == game.OConnectionId;
        if (!isX && !isO) return;

        if (isX) game.RematchRequestedByX = true;
        else game.RematchRequestedByO = true;

        if (game.RematchRequestedByX && game.RematchRequestedByO)
        {
            // Swap marks so each player gets the other side
            (game.XConnectionId, game.OConnectionId) = (game.OConnectionId, game.XConnectionId);
            (game.XName, game.OName) = (game.OName, game.XName);
            game.Board = new string[9];
            game.CurrentTurn = "X";
            game.IsOver = false;
            game.Winner = null;
            game.RematchRequestedByX = false;
            game.RematchRequestedByO = false;

            await Clients.Client(game.XConnectionId).SendAsync("RematchStarted", "X", game.XName, game.OName);
            await Clients.Client(game.OConnectionId).SendAsync("RematchStarted", "O", game.XName, game.OName);
            await Clients.Group(gameId).SendAsync("GameUpdated", game);
        }
        else
        {
            // Tell the other player someone wants a rematch
            var requesterName = isX ? game.XName : game.OName;
            await Clients.OthersInGroup(gameId).SendAsync("RematchRequested", requesterName);
        }
    }

    private async Task BroadcastLobby()
    {
        var players = _lobby.GetLobbyPlayers().Select(p => new
        {
            p.ConnectionId,
            p.Name,
            p.Picture
        });
        await Clients.All.SendAsync("LobbyUpdated", players);
    }

    private async Task BroadcastAllRoomLists()
    {
        await BroadcastTttRooms();
        await BroadcastSlotsRooms();
        await BroadcastConcentrationRooms();
        await BroadcastSolitaireRooms();
        await BroadcastPegSolitaireRooms();
        await BroadcastYahtzeeRooms();
        await BroadcastChineseCheckersRooms();
        await BroadcastCrazyEightsRooms();
        await BroadcastPuzzleTimeRooms();
        await BroadcastBonesRooms();
    }

    private static bool CheckWin(string[] board, string mark)
    {
        int[][] wins =
        [
            [0, 1, 2], [3, 4, 5], [6, 7, 8],
            [0, 3, 6], [1, 4, 7], [2, 5, 8],
            [0, 4, 8], [2, 4, 6]
        ];
        return wins.Any(w => w.All(i => board[i] == mark));
    }

    /* ================================================================
       Yahtzee Room Methods
       ================================================================ */

    public async Task CreateYahtzeeRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.Settings.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, RoomNameMaxLength)];
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("YahtzeeRoomCreated", roomId);
        await BroadcastYahtzeeRooms();
    }

    public async Task GetYahtzeeRooms()
    {
        var rooms = _lobby.GetPublicRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            r.Settings.RoomName,
            r.Started,
            IsFull = r.Players.Count >= r.Settings.MaxPlayers
        });
        await Clients.Caller.SendAsync("YahtzeeRoomList", rooms);
    }

    public async Task JoinYahtzeeRoom(string roomId)
    {
        var room = _lobby.GetRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;

        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new YahtzeePlayer { ConnectionId = Context.ConnectionId, Name = name });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("YahtzeeRoomUpdated", room);
        await BroadcastYahtzeeRooms();
    }

    public async Task RejoinYahtzeeRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetRoom(roomId);
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
            await Clients.Caller.SendAsync("YahtzeeUpdated", room);
        }
        else
        {
            await Clients.Group(roomId).SendAsync("YahtzeeRoomUpdated", room);
        }
    }

    public async Task UpdateYahtzeeSettings(string roomId, YahtzeeSettings settings)
    {
        var room = _lobby.GetRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;

        // Clamp values
        settings.MaxPlayers = Math.Clamp(settings.MaxPlayers, 2, 20);
        settings.RollsPerTurn = Math.Clamp(settings.RollsPerTurn, 1, 5);
        settings.NumberOfDice = Math.Clamp(settings.NumberOfDice, 3, 8);
        settings.UpperBonusThreshold = Math.Clamp(settings.UpperBonusThreshold, 0, 999);
        settings.UpperBonusPoints = Math.Clamp(settings.UpperBonusPoints, 0, 100);
        settings.TurnTimeLimitSeconds = Math.Clamp(settings.TurnTimeLimitSeconds, 0, 300);
        settings.FullHouseScore = Math.Clamp(settings.FullHouseScore, 0, 100);
        settings.SmallStraightScore = Math.Clamp(settings.SmallStraightScore, 0, 100);
        settings.LargeStraightScore = Math.Clamp(settings.LargeStraightScore, 0, 100);
        settings.YahtzeeScore = Math.Clamp(settings.YahtzeeScore, 0, 100);
        if (!string.IsNullOrWhiteSpace(settings.RoomName))
            settings.RoomName = settings.RoomName.Trim()[..Math.Min(settings.RoomName.Trim().Length, RoomNameMaxLength)];

        room.Settings = settings;
        await Clients.Group(roomId).SendAsync("YahtzeeRoomUpdated", room);
        await BroadcastYahtzeeRooms();
    }

    public async Task KickPlayer(string roomId, string playerName)
    {
        var room = _lobby.GetRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;
        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);
        await Clients.Group(roomId).SendAsync("YahtzeeRoomUpdated", room);
        await BroadcastYahtzeeRooms();
    }

    public async Task StartYahtzeeGame(string roomId)
    {
        var room = _lobby.GetRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        if (room.Players.Count < 2) return;

        room.Started = true;
        room.CurrentPlayerIndex = 0;
        room.RollsLeft = room.Settings.RollsPerTurn;
        room.Dice = new int[room.Settings.NumberOfDice];
        room.Held = new bool[room.Settings.NumberOfDice];
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        await Clients.Group(roomId).SendAsync("YahtzeeGameStarted", room);
        await BroadcastYahtzeeRooms();
    }

    public async Task YahtzeeRoll(string gameId)
    {
        var room = _lobby.GetRoom(gameId);
        if (room == null || !room.Started || room.IsOver || room.RollsLeft <= 0) return;
        if (Context.ConnectionId != room.CurrentPlayerConnectionId) return;

        YahtzeeScoring.RollDice(room);
        await Clients.Group(gameId).SendAsync("YahtzeeUpdated", room);
    }

    public async Task YahtzeeToggleHold(string gameId, int dieIndex)
    {
        var room = _lobby.GetRoom(gameId);
        if (room == null || !room.Started || room.IsOver) return;
        if (dieIndex < 0 || dieIndex >= room.Settings.NumberOfDice) return;
        if (Context.ConnectionId != room.CurrentPlayerConnectionId) return;
        if (room.RollsLeft == room.Settings.RollsPerTurn) return;

        room.Held[dieIndex] = !room.Held[dieIndex];
        await Clients.Group(gameId).SendAsync("YahtzeeUpdated", room);
    }

    public async Task YahtzeeScore(string gameId, string category)
    {
        var room = _lobby.GetRoom(gameId);
        if (room == null || !room.Started || room.IsOver) return;
        if (Context.ConnectionId != room.CurrentPlayerConnectionId) return;
        if (room.RollsLeft == room.Settings.RollsPerTurn) return;

        var player = room.Players[room.CurrentPlayerIndex];
        if (!player.Scores.ContainsKey(category) || player.Scores[category] != null) return;

        await AdvanceYahtzeeScore(gameId, room, category);
    }

    // Shared scoring logic used by both the hub method and the AI bot
    private async Task AdvanceYahtzeeScore(string gameId, YahtzeeRoom room, string category)
    {
        var player = room.Players[room.CurrentPlayerIndex];
        player.Scores[category] = YahtzeeScoring.CalculateScore(category, room.Dice, room.Settings);

        bool allDone = room.Players.All(p => p.Scores.Values.All(v => v != null));
        if (allDone)
        {
            room.IsOver = true;
            room.WinnerName = room.Players
                .OrderByDescending(p => YahtzeeScoring.TotalScore(p.Scores, room.Settings))
                .First().Name;
            await _hubContext.Clients.Group(gameId).SendAsync("YahtzeeUpdated", room);
            _ = SaveYahtzeeSessionsAsync(room);
        }
        else
        {
            do
            {
                room.CurrentPlayerIndex = (room.CurrentPlayerIndex + 1) % room.Players.Count;
            }
            while (!room.Players[room.CurrentPlayerIndex].Connected);

            room.RollsLeft = room.Settings.RollsPerTurn;
            room.Held = new bool[room.Settings.NumberOfDice];
            // Dice are kept from the previous turn so the board looks realistic
            // between turns rather than resetting to blank placeholders.

            await _hubContext.Clients.Group(gameId).SendAsync("YahtzeeUpdated", room);

            // If the next player is an AI bot, trigger its turn
            var next = room.Players[room.CurrentPlayerIndex];
            if (next.IsBot && !room.IsOver)
                _ = TakeYahtzeeAiBotTurnAsync(gameId, next.AiDifficulty);
        }
    }

    public async Task StartYahtzeeSinglePlayer(string difficulty)
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");
        var aiName = difficulty == "hard" ? "🤖 Computer (Hard)" : "🤖 Computer";

        var room = new YahtzeeRoom
        {
            Id = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName = name,
            IsSinglePlayer = true,
            Players =
            [
                new YahtzeePlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true },
                new YahtzeePlayer { ConnectionId = "BOT_" + roomId, Name = aiName, IsBot = true, AiDifficulty = difficulty, Connected = true }
            ]
        };
        room.Settings.MaxPlayers = 2;
        room.Settings.RoomName = "vs Computer";
        room.Started = true;
        room.CurrentPlayerIndex = 0;
        room.RollsLeft = room.Settings.RollsPerTurn;
        room.Dice = new int[room.Settings.NumberOfDice];
        room.Held = new bool[room.Settings.NumberOfDice];
        room.StartedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        _lobby.StoreRoom(roomId, room);
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("YahtzeeSinglePlayerStarted", roomId);
    }

    public async Task LeaveYahtzee(string roomId)
    {
        var room = _lobby.GetRoom(roomId);
        if (room == null) return;

        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        if (player != null) player.Connected = false;
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);

        if (!room.Started)
        {
            // Pre-game: remove player entirely
            if (player != null) room.Players.Remove(player);

            // If host left, assign new host or delete room
            if (Context.ConnectionId == room.HostConnectionId)
            {
                if (room.Players.Count > 0)
                {
                    room.HostConnectionId = room.Players[0].ConnectionId;
                    room.HostName = room.Players[0].Name;
                    await Clients.Group(roomId).SendAsync("YahtzeeRoomUpdated", room);
                }
                else
                {
                    _lobby.RemoveRoom(roomId);
                }
            }
            else
            {
                await Clients.Group(roomId).SendAsync("YahtzeeRoomUpdated", room);
            }
        }
        else
        {
            // Mid-game: if all disconnected, clean up
            var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
            if (connectedHumans.Count == 0)
            {
                _lobby.RemoveRoom(roomId);
            }
            else if (connectedHumans.Count == 1 && !room.IsSinglePlayer)
            {
                room.IsOver = true;
                room.WinnerName = connectedHumans[0].Name;
                await Clients.Group(roomId).SendAsync("YahtzeeUpdated", room);
            }
            else
            {
                // If it's the leaving player's turn, skip them
                if (room.CurrentPlayerConnectionId == Context.ConnectionId && !room.IsOver)
                {
                    room.CurrentPlayerIndex = (room.CurrentPlayerIndex + 1) % room.Players.Count;
                    room.RollsLeft = room.Settings.RollsPerTurn;
                    room.Held = new bool[room.Settings.NumberOfDice];
                    room.Dice = new int[room.Settings.NumberOfDice];
                }
                await Clients.Group(roomId).SendAsync("YahtzeeUpdated", room);
            }
        }
        await BroadcastYahtzeeRooms();
    }

    public async Task SendChat(string groupId, string message)
    {
        if (string.IsNullOrWhiteSpace(message)) return;
        message = message.Trim();
        if (message.Length > 500) message = message[..500];
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        await Clients.Group(groupId).SendAsync("ChatMessage", name, message, DateTime.UtcNow);
    }

    public async Task SendLobbyChat(string message)
    {
        if (string.IsNullOrWhiteSpace(message)) return;
        message = message.Trim();
        if (message.Length > 500) message = message[..500];
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        await Clients.All.SendAsync("LobbyChatMessage", name, message, DateTime.UtcNow);
    }

    private async Task BroadcastYahtzeeRooms()
    {
        var rooms = _lobby.GetPublicRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            r.Settings.RoomName,
            r.Started,
            IsFull = r.Players.Count >= r.Settings.MaxPlayers
        });
        await Clients.All.SendAsync("YahtzeeRoomList", rooms);
    }

    /* ================================================================
       Tic-Tac-Toe AI
       ================================================================ */

    private async Task TakeTttAiMoveAsync(string gameId)
    {
        try
        {
            await Task.Delay(520);
            var game = _lobby.GetGame(gameId);
            if (game == null || game.IsOver || game.CurrentTurn != "O") return;

            int cell = game.AiDifficulty == "hard"
                ? TttMinimaxBestMove(game.Board)
                : TttRandomMove(game.Board);
            if (cell < 0 || game.Board[cell] != null) return;

            game.Board[cell] = "O";
            if (CheckWin(game.Board, "O"))        { game.IsOver = true; game.Winner = "O"; }
            else if (game.Board.All(c => c != null)) { game.IsOver = true; game.Winner = null; }
            else                                    game.CurrentTurn = "X";

            await _hubContext.Clients.Group(gameId).SendAsync("GameUpdated", game);

            if (game.IsOver)
                _ = SaveTttSessionsAsync(game);
        }
        catch { }
    }

    private static int TttRandomMove(string[] board)
    {
        var empty = board.Select((v, i) => (v, i)).Where(x => x.v == null).Select(x => x.i).ToList();
        return empty.Count > 0 ? empty[Random.Shared.Next(empty.Count)] : -1;
    }

    private static int TttMinimaxBestMove(string[] board)
    {
        int bestScore = int.MinValue, bestMove = -1;
        for (int i = 0; i < 9; i++)
        {
            if (board[i] != null) continue;
            board[i] = "O";
            int score = TttMinimax(board, false, 0);
            board[i] = null;
            if (score > bestScore) { bestScore = score; bestMove = i; }
        }
        return bestMove;
    }

    private static int TttMinimax(string[] board, bool maximising, int depth)
    {
        if (CheckWin(board, "O")) return 10 - depth;
        if (CheckWin(board, "X")) return depth - 10;
        if (board.All(c => c != null)) return 0;

        if (maximising)
        {
            int best = int.MinValue;
            for (int i = 0; i < 9; i++)
            {
                if (board[i] != null) continue;
                board[i] = "O";
                best = Math.Max(best, TttMinimax(board, false, depth + 1));
                board[i] = null;
            }
            return best;
        }
        else
        {
            int best = int.MaxValue;
            for (int i = 0; i < 9; i++)
            {
                if (board[i] != null) continue;
                board[i] = "X";
                best = Math.Min(best, TttMinimax(board, true, depth + 1));
                board[i] = null;
            }
            return best;
        }
    }

    /* ================================================================
       Yahtzee AI
       ================================================================ */

    private async Task TakeYahtzeeAiBotTurnAsync(string gameId, string difficulty)
    {
        try
        {
            var room = _lobby.GetRoom(gameId);
            if (room == null || room.IsOver) return;

            // Perform all rolls with think-pauses between them
            while (room.RollsLeft > 0 && !room.IsOver)
            {
                await Task.Delay(900);
                YahtzeeScoring.RollDice(room);
                await _hubContext.Clients.Group(gameId).SendAsync("YahtzeeUpdated", room);

                if (room.RollsLeft > 0)
                {
                    await Task.Delay(750);
                    room.Held = difficulty == "hard"
                        ? YahtzeeHardHold(room)
                        : YahtzeeEasyHold(room);
                    await _hubContext.Clients.Group(gameId).SendAsync("YahtzeeUpdated", room);
                }
            }

            await Task.Delay(750);

            // Choose and apply a scoring category
            string category = difficulty == "hard"
                ? YahtzeeHardScore(room)
                : YahtzeeEasyScore(room);

            await AdvanceYahtzeeScore(gameId, room, category);
        }
        catch { }
    }

    // Easy: hold the most-frequent face; fall back to highest single die
    private static bool[] YahtzeeEasyHold(YahtzeeRoom room)
    {
        var dice = room.Dice;
        var held = new bool[dice.Length];
        var counts = new int[7];
        foreach (var d in dice) counts[d]++;

        int maxCount = counts.Skip(1).Max();
        if (maxCount <= 1)
        {
            int maxVal = dice.Max();
            for (int i = 0; i < dice.Length; i++)
                if (dice[i] == maxVal) { held[i] = true; break; }
        }
        else
        {
            int face = Array.IndexOf(counts, maxCount, 1);
            for (int i = 0; i < dice.Length; i++)
                if (dice[i] == face) held[i] = true;
        }
        return held;
    }

    // Hard: strategic hold — chase Yahtzee > full house > straight > pairs
    private static bool[] YahtzeeHardHold(YahtzeeRoom room)
    {
        var dice = room.Dice;
        var held = new bool[dice.Length];
        var counts = new int[7];
        foreach (var d in dice) counts[d]++;
        var scores = room.Players[room.CurrentPlayerIndex].Scores;

        int maxCount = counts.Skip(1).Max();
        int maxFace = Array.IndexOf(counts, maxCount, 1);

        // 1 – Chase Yahtzee (4+ of a kind)
        if (maxCount >= 4 && scores.GetValueOrDefault("yahtzee") == null)
        {
            for (int i = 0; i < dice.Length; i++)
                if (dice[i] == maxFace) held[i] = true;
            return held;
        }

        // 2 – Full house (3-of + 2-of)
        if (maxCount >= 3 && scores.GetValueOrDefault("fullHouse") == null)
        {
            for (int i = 0; i < dice.Length; i++)
                if (dice[i] == maxFace) held[i] = true;
            if (maxCount == 3)
            {
                int pairFace = counts.Select((c, idx) => (c, idx)).Skip(1)
                                     .FirstOrDefault(x => x.c == 2).idx;
                if (pairFace > 0)
                    for (int i = 0; i < dice.Length; i++)
                        if (dice[i] == pairFace) held[i] = true;
            }
            return held;
        }

        // 3 – Chase 3/4 of a kind or Yahtzee
        if (maxCount >= 3)
        {
            for (int i = 0; i < dice.Length; i++)
                if (dice[i] == maxFace) held[i] = true;
            return held;
        }

        // 4 – Straight potential
        var unique = dice.Distinct().OrderBy(d => d).ToList();
        int run = LongestRun(unique);
        if (run >= 3 && (scores.GetValueOrDefault("largeStraight") == null || scores.GetValueOrDefault("smallStraight") == null))
        {
            var keep = BestStraightVals(unique);
            bool[] usedVal = new bool[7];
            for (int i = 0; i < dice.Length; i++)
            {
                if (keep.Contains(dice[i]) && !usedVal[dice[i]])
                { held[i] = true; usedVal[dice[i]] = true; }
            }
            return held;
        }

        // 5 – Keep any pair
        if (maxCount >= 2)
        {
            for (int i = 0; i < dice.Length; i++)
                if (dice[i] == maxFace) held[i] = true;
            return held;
        }

        // Default: keep highest die
        int hi = dice.Max();
        for (int i = 0; i < dice.Length; i++) if (dice[i] == hi) { held[i] = true; break; }
        return held;
    }

    private static int LongestRun(List<int> sorted)
    {
        if (sorted.Count == 0) return 0;
        int run = 1, max = 1;
        for (int i = 1; i < sorted.Count; i++)
        {
            if (sorted[i] == sorted[i - 1] + 1) { run++; max = Math.Max(max, run); }
            else run = 1;
        }
        return max;
    }

    private static HashSet<int> BestStraightVals(List<int> sorted)
    {
        // Test each 4-window and 5-window, pick the one with most matches
        int[][] windows = [[1,2,3,4],[2,3,4,5],[3,4,5,6],[1,2,3,4,5],[2,3,4,5,6]];
        var set = new HashSet<int>(sorted);
        HashSet<int>? best = null;
        int bestMatch = 0;
        foreach (var w in windows)
        {
            int match = w.Count(v => set.Contains(v));
            if (match > bestMatch) { bestMatch = match; best = new HashSet<int>(w.Where(v => set.Contains(v))); }
        }
        return best ?? [];
    }

    // Easy score: random pick from categories that score > 0; else random available
    private static string YahtzeeEasyScore(YahtzeeRoom room)
    {
        var player = room.Players[room.CurrentPlayerIndex];
        var available = YahtzeeScoring.Categories
            .Where(c => player.Scores.GetValueOrDefault(c) == null).ToList();
        var nonZero = available
            .Where(c => YahtzeeScoring.CalculateScore(c, room.Dice, room.Settings) > 0).ToList();
        var pool = nonZero.Count > 0 ? nonZero : available;
        return pool[Random.Shared.Next(pool.Count)];
    }

    // Hard score: always pick the category that maximises current score
    private static string YahtzeeHardScore(YahtzeeRoom room)
    {
        var player = room.Players[room.CurrentPlayerIndex];
        return YahtzeeScoring.Categories
            .Where(c => player.Scores.GetValueOrDefault(c) == null)
            .OrderByDescending(c => YahtzeeScoring.CalculateScore(c, room.Dice, room.Settings))
            .First();
    }

    /* ================================================================
       Solitaire Methods
       ================================================================ */

    public async Task CreateSolitaireRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreateSolitaireRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.Settings.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, RoomNameMaxLength)];
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("SolitaireRoomCreated", roomId);
        await BroadcastSolitaireRooms();
    }

    public async Task GetSolitaireRooms() =>
        await Clients.Caller.SendAsync("SolitaireRoomList", SolitaireRoomSummaries());

    public async Task JoinSolitaireRoom(string roomId)
    {
        var room = _lobby.GetSolitaireRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new SolitairePlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("SolitaireRoomUpdated", room);
        await BroadcastSolitaireRooms();
    }

    public async Task RejoinSolitaireRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetSolitaireRoom(roomId);
        if (room == null) return;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
        if (player == null) return;
        player.ConnectionId = Context.ConnectionId;
        player.Connected = true;
        if (room.HostName == name) room.HostConnectionId = Context.ConnectionId;
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        if (room.Started)
        {
            _lobby.SetInGame(Context.ConnectionId, true);
            await BroadcastLobby();
            await Clients.Caller.SendAsync("SolitaireUpdated", room);
        }
        else
        {
            await Clients.Group(roomId).SendAsync("SolitaireRoomUpdated", room);
        }
    }

    public async Task StartSolitaireGame(string roomId)
    {
        var room = _lobby.GetSolitaireRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        if (room.Players.Count < 2) return;
        int seed = SolitaireEngine.GetWinnableSeed();
        room.DeckSeed = seed;
        room.Started = true;
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var p in room.Players)
        {
            ResetSolitairePlayerForNewGame(p, seed, now);
        }
        await Clients.Group(roomId).SendAsync("SolitaireGameStarted", room);
        await BroadcastSolitaireRooms();
    }

    public async Task StartSolitaireSinglePlayer()
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");
        int seed = SolitaireEngine.GetWinnableSeed();
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var room = new SolitaireRoom
        {
            Id = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName = name,
            IsSinglePlayer = true,
            Started = true,
            DeckSeed = seed,
            Players = [new SolitairePlayer
            {
                ConnectionId = Context.ConnectionId,
                Name = name,
                Connected = true,
                Game = SolitaireEngine.Deal(seed),
                StartedAtMs = now,
                HintsUsed = 0,
                GaveUp = false
            }]
        };
        room.Settings.RoomName = "Solitaire";
        room.Settings.MaxPlayers = 1;
        _lobby.StoreSolitaireRoom(roomId, room);
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("SolitaireSinglePlayerStarted", roomId);
    }

    public async Task LeaveSolitaireRoom(string roomId)
    {
        var room = _lobby.GetSolitaireRoom(roomId);
        if (room == null) return;
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
        if (!room.Started)
        {
            if (player != null) room.Players.Remove(player);
            if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
            { await Clients.Group(roomId).SendAsync("SolitaireRoomDissolved"); _lobby.RemoveSolitaireRoom(roomId); }
            else
            { await Clients.Group(roomId).SendAsync("SolitaireRoomUpdated", room); }
        }
        else
        {
            if (player != null) player.Connected = false;
            await Clients.Group(roomId).SendAsync("PlayerLeft", player?.Name ?? "Someone");
            var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
            if (connectedHumans.Count == 0)
                _lobby.RemoveSolitaireRoom(roomId);
            else if (connectedHumans.Count == 1 && !room.IsSinglePlayer)
            {
                var winner = connectedHumans[0];
                if (!winner.HasFinished)
                {
                    winner.HasFinished = true;
                    room.FinishCount = Math.Max(room.FinishCount, 1);
                    winner.FinishRank = 1;
                    winner.FinishedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                    winner.Score = SolitaireEngine.ScoreFor(winner);
                }
                room.IsOver = true;
                await Clients.Group(roomId).SendAsync("SolitaireUpdated", room);
            }
            else
            {
                await Clients.Group(roomId).SendAsync("SolitaireUpdated", room);
                CheckSolitaireOver(room);
            }
        }
        await BroadcastSolitaireRooms();
    }

    public async Task KickSolitairePlayer(string roomId, string playerName)
    {
        var room = _lobby.GetSolitaireRoom(roomId);
        if (room == null || Context.ConnectionId != room.HostConnectionId) return;
        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;
        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);
        await Clients.Group(roomId).SendAsync("SolitaireRoomUpdated", room);
        await BroadcastSolitaireRooms();
    }

    public async Task MakeSolitaireMove(string roomId, string moveType, int cardId, int toPile)
    {
        var room = _lobby.GetSolitaireRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && !p.IsBot);
        if (player == null || player.HasFinished) return;

        var g = player.Game;
        bool moved = moveType switch
        {
            "stock-flip" => SolitaireEngine.FlipStock(g),
            "waste-to-foundation" => SolitaireEngine.WasteToFoundation(g),
            "waste-to-tableau" => SolitaireEngine.WasteToTableau(g, toPile),
            "tableau-to-foundation" => HandleTableauToFoundation(g, cardId),
            "tableau-to-tableau" => HandleTableauToTableau(g, cardId, toPile),
            "auto-complete" => HandleAutoComplete(g),
            _ => false
        };

        if (!moved) return;

        player.Score = SolitaireEngine.ScoreFor(player);

        if (g.IsComplete && !player.HasFinished)
        {
            player.HasFinished = true;
            room.FinishCount++;
            player.FinishRank = room.FinishCount;
            player.FinishedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            player.Score = SolitaireEngine.ScoreFor(player);
            _ = SaveSolitairePlayerSessionAsync(room, player);
            if (room.IsSinglePlayer) room.IsOver = true;
        }

        await Clients.Group(roomId).SendAsync("SolitaireUpdated", room);

        if (!room.IsSinglePlayer) CheckSolitaireOver(room);
    }

    // Client requests a hint for the current game state. Server computes an
    // authoritative hint, applies a hint-use penalty if a hint is available,
    // updates the player's score and broadcasts the updated room state.
    public async Task RequestSolitaireHint(string roomId)
    {
        var room = _lobby.GetSolitaireRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && !p.IsBot);
        if (player == null || player.HasFinished) return;

        var hint = SolitaireEngine.ComputeHint(player.Game);
        if (hint != null && hint.HintAvailable)
        {
            // Increment hint counter and update score immediately
            player.HintsUsed++;
            player.Score = SolitaireEngine.ScoreFor(player);
        }

        // Send the hint only to the requester, and broadcast the updated room
        await Clients.Caller.SendAsync("SolitaireHint", hint);
        await Clients.Group(roomId).SendAsync("SolitaireUpdated", room);
    }

    public async Task GiveUpSolitaire(string roomId)
    {
        var room = _lobby.GetSolitaireRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && !p.IsBot);
        if (player == null || player.HasFinished) return;

        player.HasFinished = true;
        player.GaveUp = true;
        room.FinishCount++;
        player.FinishRank = room.FinishCount;
        player.FinishedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        player.Score = SolitaireEngine.ScoreFor(player);
        _ = SaveSolitairePlayerSessionAsync(room, player);

        if (room.IsSinglePlayer)
            room.IsOver = true;

        await Clients.Group(roomId).SendAsync("SolitaireUpdated", room);

        if (!room.IsSinglePlayer)
            CheckSolitaireOver(room);
    }

    private static bool HandleTableauToFoundation(SolitaireGameState g, int cardId)
    {
        var (pile, _) = SolitaireEngine.FindInTableau(g, cardId);
        if (pile < 0) return false;
        return SolitaireEngine.TableauToFoundation(g, pile);
    }

    private static bool HandleTableauToTableau(SolitaireGameState g, int cardId, int toPile)
    {
        var (pile, idx) = SolitaireEngine.FindInTableau(g, cardId);
        if (pile < 0) return false;
        return SolitaireEngine.TableauToTableau(g, pile, idx, toPile);
    }

    private static bool HandleAutoComplete(SolitaireGameState g)
    {
        if (!SolitaireEngine.CanAutoComplete(g)) return false;
        bool any = false;
        while (SolitaireEngine.AutoCompleteStep(g)) any = true;
        return any;
    }

    private static void ResetSolitairePlayerForNewGame(SolitairePlayer player, int seed, long startedAtMs)
    {
        player.Game = SolitaireEngine.Deal(seed);
        player.StartedAtMs = startedAtMs;
        player.FinishedAtMs = 0;
        player.HintsUsed = 0;
        player.GaveUp = false;
        player.HasFinished = false;
        player.FinishRank = 0;
        player.Score = 0;
    }

    private void CheckSolitaireOver(SolitaireRoom room)
    {
        if (room.IsOver) return;
        bool allDone = room.Players.Where(p => !p.IsBot).All(p => p.HasFinished || !p.Connected);
        if (allDone)
        {
            room.IsOver = true;
            _ = _hubContext.Clients.Group(room.Id).SendAsync("SolitaireUpdated", room);
        }
    }

    private IEnumerable<object> SolitaireRoomSummaries() =>
        _lobby.GetOpenSolitaireRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            RoomName = r.Settings.RoomName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            IsFull = r.Players.Count >= r.Settings.MaxPlayers
        });

    private async Task BroadcastSolitaireRooms() =>
        await Clients.All.SendAsync("SolitaireRoomList", SolitaireRoomSummaries());

    /* ================================================================
       Peg Solitaire Methods
       ================================================================ */

    public async Task CreatePegSolitaireRoom(string? roomName = null)
    {
        var roomId = Guid.NewGuid().ToString("N");
        var room = _lobby.CreatePegSolitaireRoom(roomId, Context.ConnectionId);
        if (!string.IsNullOrWhiteSpace(roomName))
            room.Settings.RoomName = roomName.Trim()[..Math.Min(roomName.Trim().Length, RoomNameMaxLength)];
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("PegSolitaireRoomCreated", roomId);
        await BroadcastPegSolitaireRooms();
    }

    public async Task GetPegSolitaireRooms() =>
        await Clients.Caller.SendAsync("PegSolitaireRoomList", PegSolitaireRoomSummaries());

    public async Task JoinPegSolitaireRoom(string roomId)
    {
        var room = _lobby.GetPegSolitaireRoom(roomId);
        if (room == null || room.Started || room.IsOver) return;
        if (room.Players.Count >= room.Settings.MaxPlayers) return;
        if (room.Players.Any(p => p.ConnectionId == Context.ConnectionId)) return;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        room.Players.Add(new PegSolitairePlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true });
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("PegSolitaireRoomUpdated", room);
        await BroadcastPegSolitaireRooms();
    }

    public async Task RejoinPegSolitaireRoom(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return;
        var room = _lobby.GetPegSolitaireRoom(roomId);
        if (room == null) return;
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var player = room.Players.FirstOrDefault(p => p.Name == name && !p.IsBot);
        if (player == null) return;
        player.ConnectionId = Context.ConnectionId;
        player.Connected = true;
        if (room.HostName == name) room.HostConnectionId = Context.ConnectionId;
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        if (room.Started)
        {
            _lobby.SetInGame(Context.ConnectionId, true);
            await BroadcastLobby();
            await Clients.Caller.SendAsync("PegSolitaireUpdated", room);
        }
        else
        {
            await Clients.Group(roomId).SendAsync("PegSolitaireRoomUpdated", room);
        }
    }

    public async Task StartPegSolitaireGame(string roomId)
    {
        var room = _lobby.GetPegSolitaireRoom(roomId);
        if (room == null || room.Started) return;
        if (Context.ConnectionId != room.HostConnectionId) return;
        if (room.Players.Count < 2) return;

        room.Started = true;
        room.IsOver = false;
        room.FinishCount = 0;
        room.Settings.MaxPlayers = Math.Clamp(room.Settings.MaxPlayers, 2, 4);
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var p in room.Players) ResetPegSolitairePlayerForNewGame(room, p, now);

        await Clients.Group(roomId).SendAsync("PegSolitaireGameStarted", room);
        await Clients.Group(roomId).SendAsync("PegSolitaireUpdated", room);
        await BroadcastPegSolitaireRooms();
    }

    public async Task StartPegSolitaireSinglePlayer()
    {
        var name = Context.User?.FindFirst(ClaimTypes.Name)?.Value ?? "Unknown";
        var roomId = Guid.NewGuid().ToString("N");
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var room = new PegSolitaireRoom
        {
            Id = roomId,
            HostConnectionId = Context.ConnectionId,
            HostName = name,
            IsSinglePlayer = true,
            Started = true,
            Players = [new PegSolitairePlayer { ConnectionId = Context.ConnectionId, Name = name, Connected = true }]
        };
        room.Settings.RoomName = "Peg Solitaire";
        room.Settings.MaxPlayers = 1;
        ResetPegSolitairePlayerForNewGame(room, room.Players[0], now);
        _lobby.StorePegSolitaireRoom(roomId, room);
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("PegSolitaireSinglePlayerStarted", roomId);
        await Clients.Caller.SendAsync("PegSolitaireUpdated", room);
    }

    public async Task LeavePegSolitaireRoom(string roomId)
    {
        var room = _lobby.GetPegSolitaireRoom(roomId);
        if (room == null) return;
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);

        if (!room.Started)
        {
            if (player != null) room.Players.Remove(player);
            if (room.Players.Count == 0 || Context.ConnectionId == room.HostConnectionId)
            {
                await Clients.Group(roomId).SendAsync("PegSolitaireRoomDissolved");
                _lobby.RemovePegSolitaireRoom(roomId);
            }
            else
            {
                await Clients.Group(roomId).SendAsync("PegSolitaireRoomUpdated", room);
            }
            await BroadcastPegSolitaireRooms();
            return;
        }

        if (player != null) player.Connected = false;
        await Clients.Group(roomId).SendAsync("PlayerLeft", player?.Name ?? "Someone");
        var connectedHumans = room.Players.Where(p => !p.IsBot && p.Connected).ToList();
        if (connectedHumans.Count == 0)
        {
            _lobby.RemovePegSolitaireRoom(roomId);
        }
        else if (connectedHumans.Count == 1 && !room.IsSinglePlayer)
        {
            FinalizePegSolitairePlayer(room, connectedHumans[0]);
            room.IsOver = true;
            await Clients.Group(roomId).SendAsync("PegSolitaireUpdated", room);
        }
        else
        {
            await Clients.Group(roomId).SendAsync("PegSolitaireUpdated", room);
            CheckPegSolitaireOver(room);
        }

        await BroadcastPegSolitaireRooms();
    }

    public async Task KickPegSolitairePlayer(string roomId, string playerName)
    {
        var room = _lobby.GetPegSolitaireRoom(roomId);
        if (room == null || Context.ConnectionId != room.HostConnectionId) return;
        var player = room.Players.FirstOrDefault(p => p.Name == playerName && p.ConnectionId != room.HostConnectionId);
        if (player == null) return;
        await Clients.Client(player.ConnectionId).SendAsync("KickedFromRoom");
        await Groups.RemoveFromGroupAsync(player.ConnectionId, roomId);
        room.Players.Remove(player);
        await Clients.Group(roomId).SendAsync("PegSolitaireRoomUpdated", room);
        await BroadcastPegSolitaireRooms();
    }

    public async Task MakePegSolitaireMove(string roomId, int from, int to)
    {
        var room = _lobby.GetPegSolitaireRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && !p.IsBot);
        if (player == null || player.HasFinished) return;
        if (player.Game.IsSetup) return;  // must remove first peg before jumping

        if (!PegSolitaireEngine.TryMove(player.Game, from, to)) return;

        player.Score += 1;
        player.PegsLeft = PegSolitaireEngine.CountPegs(player.Game);
        player.Rating = PegSolitaireEngine.RatingFor(player.PegsLeft);

        if (!PegSolitaireEngine.HasAnyMoves(player.Game))
        {
            FinalizePegSolitairePlayer(room, player);
            if (room.IsSinglePlayer) room.IsOver = true;
        }

        await Clients.Group(roomId).SendAsync("PegSolitaireUpdated", room);
        if (!room.IsSinglePlayer) CheckPegSolitaireOver(room);
    }

    public async Task PegSolitaireSetStartEmpty(string roomId, int pegIndex)
    {
        var room = _lobby.GetPegSolitaireRoom(roomId);
        if (room == null || !room.Started || room.IsOver) return;
        var player = room.Players.FirstOrDefault(p => p.ConnectionId == Context.ConnectionId && !p.IsBot);
        if (player == null || player.HasFinished || !player.Game.IsSetup) return;
        if (pegIndex < 0 || pegIndex >= 15) return;

        PegSolitaireEngine.SetStartEmpty(player.Game, pegIndex);
        player.PegsLeft = PegSolitaireEngine.CountPegs(player.Game);
        player.Rating = PegSolitaireEngine.RatingFor(player.PegsLeft);

        await Clients.Group(roomId).SendAsync("PegSolitaireUpdated", room);
    }

    private static void ResetPegSolitairePlayerForNewGame(PegSolitaireRoom room, PegSolitairePlayer player, long startedAtMs)
    {
        player.Game = PegSolitaireEngine.CreateInitialState();
        player.Score = 0;
        player.PegsLeft = PegSolitaireEngine.CountPegs(player.Game);
        player.Rating = PegSolitaireEngine.RatingFor(player.PegsLeft);
        player.HasFinished = false;
        player.FinishRank = 0;
        player.StartedAtMs = startedAtMs;
        player.FinishedAtMs = 0;
        player.SessionSaved = false;
    }

    private void FinalizePegSolitairePlayer(PegSolitaireRoom room, PegSolitairePlayer player)
    {
        if (player.HasFinished) return;
        player.HasFinished = true;
        room.FinishCount++;
        player.FinishRank = room.FinishCount;
        player.FinishedAtMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        player.PegsLeft = PegSolitaireEngine.CountPegs(player.Game);
        player.Rating = PegSolitaireEngine.RatingFor(player.PegsLeft);
        _ = SavePegSolitairePlayerSessionAsync(room, player);
    }

    private void CheckPegSolitaireOver(PegSolitaireRoom room)
    {
        if (room.IsOver) return;
        bool allDone = room.Players.Where(p => !p.IsBot).All(p => p.HasFinished || !p.Connected);
        if (allDone)
        {
            room.IsOver = true;
            _ = _hubContext.Clients.Group(room.Id).SendAsync("PegSolitaireUpdated", room);
        }
    }

    private IEnumerable<object> PegSolitaireRoomSummaries() =>
        _lobby.GetOpenPegSolitaireRooms().Select(r => new
        {
            r.Id,
            r.HostName,
            RoomName = r.Settings.RoomName,
            PlayerCount = r.Players.Count,
            r.Settings.MaxPlayers,
            IsFull = r.Players.Count >= r.Settings.MaxPlayers
        });

    private async Task BroadcastPegSolitaireRooms() =>
        await Clients.All.SendAsync("PegSolitaireRoomList", PegSolitaireRoomSummaries());

    /* ================================================================
       Session Persistence Helpers
       ================================================================ */

    private async Task SaveTttSessionsAsync(GameState game)
    {
        try
        {
            var now = DateTime.UtcNow.ToString("o");
            int elapsed = (int)((DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - game.StartedAtMs) / 1000);

            // X player
            if (!game.XConnectionId.StartsWith("BOT_"))
            {
                var uid = await _users.GetIdByUsernameAsync(game.XName);
                if (uid.HasValue)
                {
                    var result = game.Winner == "X" ? "Win" : game.Winner == null ? "Draw" : "Loss";
                    var score = result == "Win" ? 3 : result == "Draw" ? 1 : 0;
                    await _sessions.SaveAsync(new GameSession
                    {
                        UserId = uid.Value, GameType = "TicTacToe",
                        Score = score, Result = result,
                        TimePlayed = elapsed, PlayedAt = now,
                        Details = $"vs {game.OName}"
                    });
                }
            }

            // O player
            if (!game.OConnectionId.StartsWith("BOT_"))
            {
                var uid = await _users.GetIdByUsernameAsync(game.OName);
                if (uid.HasValue)
                {
                    var result = game.Winner == "O" ? "Win" : game.Winner == null ? "Draw" : "Loss";
                    var score = result == "Win" ? 3 : result == "Draw" ? 1 : 0;
                    await _sessions.SaveAsync(new GameSession
                    {
                        UserId = uid.Value, GameType = "TicTacToe",
                        Score = score, Result = result,
                        TimePlayed = elapsed, PlayedAt = now,
                        Details = $"vs {game.XName}"
                    });
                }
            }
        }
        catch { }
    }

    private async Task SaveYahtzeeSessionsAsync(YahtzeeRoom room)
    {
        try
        {
            var now = DateTime.UtcNow.ToString("o");
            int elapsed = (int)((DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - room.StartedAtMs) / 1000);

            foreach (var p in room.Players.Where(p => !p.IsBot))
            {
                var uid = await _users.GetIdByUsernameAsync(p.Name);
                if (!uid.HasValue) continue;
                var totalScore = YahtzeeScoring.TotalScore(p.Scores, room.Settings);
                var result = p.Name == room.WinnerName ? "Win"
                           : room.IsSinglePlayer ? "Loss" : "Completed";
                await _sessions.SaveAsync(new GameSession
                {
                    UserId = uid.Value, GameType = "Yahtzee",
                    Score = totalScore, Result = result,
                    TimePlayed = elapsed, PlayedAt = now
                });
            }
        }
        catch { }
    }

    private async Task SaveSlotsSessionsAsync(SlotsRoom room)
    {
        try
        {
            var now = DateTime.UtcNow.ToString("o");
            int elapsed = (int)((DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - room.StartedAtMs) / 1000);

            foreach (var p in room.Players.Where(p => !p.IsBot))
            {
                var uid = await _users.GetIdByUsernameAsync(p.Name);
                if (!uid.HasValue) continue;
                var result = p.Name == room.WinnerName ? "Win"
                           : room.IsSinglePlayer ? "Loss" : "Completed";
                await _sessions.SaveAsync(new GameSession
                {
                    UserId = uid.Value, GameType = "Slots",
                    Score = Math.Max(0, p.Balance), Result = result,
                    TimePlayed = elapsed, PlayedAt = now,
                    Details = $"Rounds:{room.RoundsPlayed}"
                });
            }
        }
        catch { }
    }

    private async Task SaveConcentrationSessionsAsync(ConcentrationRoom room)
    {
        try
        {
            var now = DateTime.UtcNow.ToString("o");
            int elapsed = (int)((DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - room.StartedAtMs) / 1000);

            foreach (var p in room.Players.Where(p => !p.IsBot))
            {
                var uid = await _users.GetIdByUsernameAsync(p.Name);
                if (!uid.HasValue) continue;
                var result = room.WinnerName == null ? "Draw"
                           : p.Name == room.WinnerName ? "Win" : "Loss";
                await _sessions.SaveAsync(new GameSession
                {
                    UserId = uid.Value, GameType = "Concentration",
                    Score = p.Score, Result = result,
                    TimePlayed = elapsed, PlayedAt = now
                });
            }
        }
        catch { }
    }

    private async Task SaveSolitairePlayerSessionAsync(SolitaireRoom room, SolitairePlayer player)
    {
        try
        {
            var uid = await _users.GetIdByUsernameAsync(player.Name);
            if (!uid.HasValue) return;
            int elapsed = (int)((player.FinishedAtMs - player.StartedAtMs) / 1000);
            var result = player.GaveUp ? "GiveUp"
                       : (room.IsSinglePlayer || player.FinishRank == 1) ? "Win" : "Loss";
            await _sessions.SaveAsync(new GameSession
            {
                UserId = uid.Value, GameType = "Solitaire",
                Score = player.Score, Result = result,
                TimePlayed = elapsed, PlayedAt = DateTime.UtcNow.ToString("o"),
                Details = $"Rank:{player.FinishRank},Hints:{player.HintsUsed},GaveUp:{(player.GaveUp ? 1 : 0)}"
            });
        }
        catch { }
    }

    private async Task SavePegSolitairePlayerSessionAsync(PegSolitaireRoom room, PegSolitairePlayer player)
    {
        if (player.SessionSaved) return;
        player.SessionSaved = true;
        try
        {
            var uid = await _users.GetIdByUsernameAsync(player.Name);
            if (!uid.HasValue) return;
            int elapsed = player.FinishedAtMs > player.StartedAtMs
                ? (int)((player.FinishedAtMs - player.StartedAtMs) / 1000)
                : 0;
            await _sessions.SaveAsync(new GameSession
            {
                UserId = uid.Value,
                GameType = "PegSolitaire",
                Score = player.Score,
                Result = player.Rating,
                TimePlayed = elapsed,
                PlayedAt = DateTime.UtcNow.ToString("o"),
                Details = $"PegsLeft:{player.PegsLeft},Rank:{player.FinishRank}"
            });
        }
        catch { }
    }
}
